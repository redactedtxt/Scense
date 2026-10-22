import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AiSettings, AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { optionalUser } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { requireSubject } from "../middleware/guest.js";
import { parseInput } from "../middleware/validate.js";
import { addTokens, refundMessage, reserveMessage, todaysUsage, torontoDay } from "../services/caps.js";
import type { CatalogueCache, CatalogueSnapshot } from "../services/catalogueCache.js";
import { askJson, type Tokens } from "../services/chat.js";
import {
  applyExtraction,
  assumedLine,
  assumeMissing,
  chipAnswer,
  chipsFor,
  labelOf,
  missingSlots,
  outingLine,
  QUESTIONS,
  SLOT_NAMES,
  slotsFrom,
  type SlotName,
  type Slots,
} from "../services/concierge.js";
import {
  buildExtractionPrompt,
  buildReasonsPrompt,
  EXTRACTION_SCHEMA,
  extractionOutput,
  reasonsOutput,
  reasonsSchema,
} from "../services/conciergePrompt.js";
import {
  deleteConversation,
  findConversation,
  listConversations,
  purgeExpiredConversations,
  recentHistory,
  storeExchange,
  type ConversationSummary,
} from "../services/conversations.js";
import type { Llm, LlmMessage } from "../services/llm.js";
import type { ConciergeSettings } from "../services/occasions.js";
import { checkReason, fallbackReason, pickFacts, type PickFacts } from "../services/pickReasons.js";
import { loadProfile, ownedIds } from "../services/profileStore.js";
import { cardsFor, conciergePicks, type FullSlots } from "../services/recommend.js";
import { createReplyGuard, mentionsRules, type ReplyGuard } from "../services/replyGuard.js";
import { completeProfile, isBlank, profileInput, type TasteProfile } from "../services/taste.js";

// The concierge (SPEC section 9; DECISIONS B37). A visitor describes an outing; the model
// fills its five slots from their words, and the server asks for what's missing, one
// question at a time with answer chips. Once every slot is filled, the server picks the
// top bottle and 2 alternatives from the visitor's Own list (the whole catalogue if that
// is empty), and the model writes one sentence per pick from facts the server passes in.
// It reuses the chat's machinery: the conversation tables, the atomic message claim with
// its own 8-a-day budget, the reply guard, and the one-message-in-flight lock.

export type ConciergeDeps = {
  db: Db;
  auth: AuthSettings;
  ai: AiSettings;
  llm: Llm | null; // null when no API key is configured
  catalogue: CatalogueCache;
  concierge: ConciergeSettings;
  now: () => number;
};

const FEATURE = "concierge" as const;

// Whose budget, which feature, which Toronto day: one llm_usage row.
type OutingKey = { subject: string; feature: typeof FEATURE; day: string };

const NO_OUTING = new ApiError(404, "no_outing", "That outing is gone. It may have been deleted, or it expired.");

const UNAVAILABLE = new ApiError(
  503,
  "assistant_unavailable",
  "The concierge is unavailable right now. Everything else on Scense works as usual, so try again later.",
);

export const CATALOGUE_LINE = "Your Own list is empty, so these come from the whole catalogue.";

export const CONFUSED_TEXT = "Sorry, I didn't catch that.";

// An outing id in a URL or body. Anything else is treated as an outing that doesn't exist.
const outingId = z.string().uuid();

export function conciergeRouter(deps: ConciergeDeps): Router {
  const router = Router();
  router.use("/concierge", optionalUser(deps.auth));
  const postBody = z.object({
    message: z.string().trim().min(1).max(deps.ai.messageMaxChars),
    conversationId: outingId.optional(),
    // Guests only (SPEC section 6): their profile and Own list live in the browser.
    tasteProfile: profileInput.nullable().optional(),
    owned: z.array(z.number().int().positive()).max(2000).optional(),
  });
  // One message at a time per visitor, so two answers can't race on one outing's slots.
  const busy = new Set<string>();

  router.get("/concierge", async (req, res) => {
    const subject = requireSubject(req, res);
    const usage = await todaysUsage(deps.db, { subject, feature: FEATURE, day: torontoDay(deps.now()) });
    res.json({
      available: deps.llm !== null,
      messagesUsed: usage?.userMessages ?? 0,
      messagesLimit: deps.ai.conciergeMaxUserMessages,
      conversations: await listConversations(deps.db, subject, FEATURE),
    });
  });

  router.get("/concierge/:id", async (req, res) => {
    const subject = requireSubject(req, res);
    const { summary, slots } = await ownOuting(deps.db, subject, req.params.id);
    const messages = await transcriptForPage(deps, summary.id, res.locals.userId as number | null);
    res.json({ conversation: summary, outing: outingView(slotsFrom(slots), deps.concierge), messages });
  });

  // No refund: the budget is counted in llm_usage, which holds no text and isn't touched.
  router.delete("/concierge/:id", async (req, res) => {
    const subject = requireSubject(req, res);
    if (outingId.safeParse(req.params.id).success) await deleteConversation(deps.db, subject, req.params.id, FEATURE);
    res.status(204).end();
  });

  router.post("/concierge", async (req, res) => {
    const body = parseInput(postBody, req.body);
    const subject = requireSubject(req, res);
    if (deps.llm === null) throw UNAVAILABLE;
    if (busy.has(subject)) throw new ApiError(409, "concierge_busy", "Wait for the reply to your last message.");
    busy.add(subject);
    try {
      res.json(await handleMessage(deps, deps.llm, subject, res.locals.userId as number | null, body));
    } finally {
      busy.delete(subject);
    }
  });

  return router;
}

type PostBody = {
  message: string;
  conversationId?: string;
  tasteProfile?: z.infer<typeof profileInput> | null;
  owned?: number[];
};

async function ownOuting(db: Db, subject: string, id: string) {
  const found = outingId.safeParse(id).success ? await findConversation(db, subject, id, FEATURE) : null;
  if (found === null) throw NO_OUTING;
  return found;
}

type Reply = { content: string; options: string[]; picks: ConciergePick[]; reasons: string[] };
type ConciergePick = ReturnType<typeof cardsFor>[number] & { reason: string };

// One user message, start to finish: claim a slot (unless it is a free chip answer), fill
// the outing's slots, then either ask the next question or pick the bottles, and store
// both sides of the exchange.
async function handleMessage(deps: ConciergeDeps, llm: Llm, subject: string, userId: number | null, body: PostBody) {
  const { db, ai } = deps;
  const key = { subject, feature: FEATURE, day: torontoDay(deps.now()) };
  // Checked before a slot is claimed, so a message to a missing outing costs nothing.
  const existing = body.conversationId ? await ownOuting(db, subject, body.conversationId) : null;
  const id = existing?.summary.id ?? randomUUID();
  const old = slotsFrom(existing?.slots);
  const chip = existing ? chipFor(old, body.message, deps.concierge) : null;
  // A chip answer is free (DECISIONS B38): only typed messages count against the 8.
  const used = chip ? ((await todaysUsage(db, key))?.userMessages ?? 0) : await claimMessage(db, key, ai);
  if (existing === null) await purgeExpiredConversations(db, ai.retentionDays);

  const filled = chip
    ? chipFill(old, chip)
    : await fillSlots(deps, llm, old, existing ? await recentHistory(db, id, ai.historyTurns) : [], body.message);
  await addTokens(db, key, filled.tokens);
  if (filled.kind === "unavailable") {
    await refundMessage(db, key);
    throw UNAVAILABLE;
  }

  const snapshot = await deps.catalogue.get();
  const ctx = { key, snapshot, guard: createReplyGuard(snapshot), userId, body };
  // The day's last typed message always ends with picks (B38).
  const reply = await chooseReply(deps, llm, filled, ctx, chip === null && used >= ai.conciergeMaxUserMessages);

  const conversation: ConversationSummary = await storeExchange(
    db,
    { id, subject, feature: FEATURE, slots: filled.slots },
    { message: body.message, named: [] },
    { content: reply.content, recommendations: reply.picks.map((p) => p.id), options: reply.options, reasons: reply.reasons },
  );
  return {
    conversation,
    reply: reply.content,
    options: reply.options,
    picks: reply.picks,
    outing: outingView(filled.slots, deps.concierge),
    degraded: filled.kind === "invalid",
    messagesUsed: used,
    messagesLimit: ai.conciergeMaxUserMessages,
  };
}

// The concierge's own budget (8 a day by default), claimed atomically before any model
// call, exactly like the chat's. The site-wide guest cap counts a guest once, whichever
// feature they used first today (services/caps.ts).
// Returns the messages used today, this one included.
async function claimMessage(db: Db, key: OutingKey, ai: AiSettings): Promise<number> {
  const caps = { maxUserMessages: ai.conciergeMaxUserMessages, guestDailyConversationCap: ai.guestDailyConversationCap };
  const slot = await reserveMessage(db, key, caps);
  if (slot === "daily_limit") {
    throw new ApiError(
      429,
      "concierge_limit",
      `You've used today's ${caps.maxUserMessages} typed concierge messages. You can still tap an answer; for more typing, come back tomorrow.`,
    );
  }
  if (slot === "guest_cap") {
    throw new ApiError(429, "guest_cap", "Today's guest demos are used up. Sign up or come back tomorrow.");
  }
  return slot.userMessages;
}

type Filled = { kind: "ok" | "invalid" | "unavailable"; slots: Slots; question: string | null; tokens: Tokens };

const NO_TOKENS: Tokens = { input: 0, output: 0 };

type ChipAnswer = { slot: SlotName; value: string };

// A message that is exactly one of the open question's chips ("Night"), tapped or typed.
// Only in an existing outing: a new one has shown no chips yet.
function chipFor(old: Slots, message: string, settings: ConciergeSettings): ChipAnswer | null {
  const asked = missingSlots(old)[0];
  const value = asked ? chipAnswer(asked, message, settings) : null;
  return asked && value ? { slot: asked, value } : null;
}

// A chip fills its slot directly, with no model call and no tokens.
function chipFill(old: Slots, chip: ChipAnswer): Filled {
  return { kind: "ok", slots: { ...old, [chip.slot]: chip.value }, question: null, tokens: NO_TOKENS };
}

// The outing's slots after a typed message: the model reads it, and only values it can
// quote from the visitor's own words are kept.
async function fillSlots(deps: ConciergeDeps, llm: Llm, old: Slots, history: LlmMessage[], message: string): Promise<Filled> {
  const asked = missingSlots(old)[0] ?? null;
  const system = buildExtractionPrompt(old, asked, deps.concierge, deps.ai.conciergeQuestionMaxWords);
  const messages: LlmMessage[] = [...history, { role: "user", content: message }];
  const result = await askJson(llm, { system, messages, schema: EXTRACTION_SCHEMA }, extractionOutput);
  if (result.kind !== "ok") return { kind: result.kind, slots: old, question: null, tokens: result.tokens };

  const visitorWords = messages.filter((m) => m.role === "user").map((m) => m.content);
  const slots = applyExtraction(old, result.output.slots, visitorWords);
  // The model's question is used only if it asks about the slot the server asks next.
  const next = missingSlots(slots)[0] ?? null;
  const question = next !== null && result.output.question_slot === next ? result.output.next_question : null;
  return { kind: "ok", slots, question, tokens: result.tokens };
}

// Picks when every slot is filled, or on the day's last typed message with the missing
// slots assumed. Otherwise the next question, or an apology after two invalid answers.
async function chooseReply(deps: ConciergeDeps, llm: Llm, filled: Filled, ctx: PickContext, lastMessage: boolean): Promise<Reply> {
  const complete = missingSlots(filled.slots).length === 0;
  if (lastMessage) {
    const { full, assumed } = assumeMissing(filled.slots, deps.concierge, deps.now());
    return pickReply(deps, llm, ctx, full, assumed);
  }
  if (filled.kind === "invalid") return confusedReply(filled.slots, deps);
  if (complete) return pickReply(deps, llm, ctx, filled.slots as FullSlots, []);
  return questionReply(filled.slots, filled.question, ctx.guard, deps);
}

// The next question, with that slot's chips. The model's wording is kept only if it is
// one short question that names no product, has no link, and doesn't talk about rules;
// otherwise the server asks in its own words.
function questionReply(slots: Slots, question: string | null, guard: ReplyGuard, deps: ConciergeDeps): Reply {
  const slot = missingSlots(slots)[0]!;
  const usable = question !== null && questionOk(question, guard, deps.ai.conciergeQuestionMaxWords);
  const text = usable ? question.trim() : QUESTIONS[slot];
  return { content: text, options: chipLabels(slot, deps), picks: [], reasons: [] };
}

function questionOk(question: string, guard: ReplyGuard, maxWords: number): boolean {
  const text = question.trim();
  if (text === "" || !text.endsWith("?") || /\n/.test(text) || text.split(/\s+/).length > maxWords) return false;
  if (mentionsRules(text)) return false;
  const check = guard.check(text);
  return check === "ok" || check === "off_topic";
}

// Two invalid answers in a row: say so, and ask the open question again. The message
// still counts, as in the chat (DECISIONS B34).
function confusedReply(slots: Slots, deps: ConciergeDeps): Reply {
  const slot = missingSlots(slots)[0];
  if (slot === undefined) {
    const content = `${CONFUSED_TEXT} Tell me what to change about the outing, or start a new one.`;
    return { content, options: [], picks: [], reasons: [] };
  }
  return { content: `${CONFUSED_TEXT} ${QUESTIONS[slot]}`, options: chipLabels(slot, deps), picks: [], reasons: [] };
}

function chipLabels(slot: SlotName, deps: ConciergeDeps): string[] {
  return chipsFor(slot, deps.concierge, deps.now()).map((chip) => chip.label);
}

type PickContext = {
  key: OutingKey;
  snapshot: CatalogueSnapshot;
  guard: ReplyGuard;
  userId: number | null;
  body: PostBody;
};

// Score the candidates, then ask the model for one sentence per pick. `assumed` lists the
// slots filled in by default on a forced result, for one line on the reply.
async function pickReply(deps: ConciergeDeps, llm: Llm, ctx: PickContext, slots: FullSlots, assumed: string[]): Promise<Reply> {
  const { db, concierge } = deps;
  const owned = new Set(ctx.userId !== null ? await ownedIds(db, ctx.userId) : (ctx.body.owned ?? []));
  const profile = await tasteFor(db, ctx.userId, ctx.body);
  const { picks, fromCatalogue } = conciergePicks(ctx.snapshot.entries, owned, slots, profile, concierge);
  const facts = picks.map((pick, index) => pickFacts(pick, index, slots, concierge));
  const written = await writeReasons(deps, llm, facts, ctx);
  await addTokens(db, ctx.key, written.tokens);

  const cards = cardsFor(picks.map((p) => p.entry.id), ctx.snapshot, owned);
  const lines = [
    `${outingLine(slots, concierge)} ${leadIn(picks.length)}`,
    assumedLine(assumed),
    fromCatalogue ? CATALOGUE_LINE : null,
  ];
  return {
    content: lines.filter(Boolean).join("\n"),
    options: [],
    picks: cards.map((card, i) => ({ ...card, reason: written.reasons[i]! })),
    reasons: written.reasons,
  };
}

function leadIn(count: number): string {
  if (count >= 3) return "Here is your top pick and two alternatives.";
  return count === 2 ? "Here is your top pick and one alternative." : "Here is your pick.";
}

// A user's profile from the account, a guest's from the request (numbers only). A blank
// profile counts as none, so taste adds nothing rather than a meaningless 0 cosine.
async function tasteFor(db: Db, userId: number | null, body: PostBody): Promise<TasteProfile | null> {
  const guest = body.tasteProfile ? completeProfile(body.tasteProfile) : null;
  const profile = userId !== null ? await loadProfile(db, userId) : guest;
  return profile && !isBlank(profile) ? profile : null;
}

// One sentence per pick. Each one that fails the fact check, and every one when the
// model is unavailable or answers badly twice, is replaced by the server's own sentence.
async function writeReasons(deps: ConciergeDeps, llm: Llm, facts: PickFacts[], ctx: PickContext) {
  const maxWords = deps.ai.conciergeReasonMaxWords;
  const result = await askJson(
    llm,
    {
      system: buildReasonsPrompt(facts.length, maxWords),
      messages: [{ role: "user", content: JSON.stringify({ picks: facts }) }],
      schema: reasonsSchema(facts.length),
    },
    reasonsOutput(facts.length),
  );
  const check = { guard: ctx.guard, noteNames: ctx.snapshot.noteNames, settings: deps.concierge, maxWords };
  const reasons = facts.map((fact, i) => {
    const text = result.kind === "ok" ? (result.output[`pick_${i + 1}`] ?? "") : "";
    return checkReason(text, fact, check) === "ok" ? text.trim() : fallbackReason(fact);
  });
  return { reasons, tokens: result.tokens };
}

// The five slots as the page shows them: each slot's label, or null while missing.
function outingView(slots: Slots, settings: ConciergeSettings) {
  return SLOT_NAMES.map((name) => {
    const value = slots[name];
    return { slot: name, value: value === null ? null : labelOf(name, value, settings) };
  });
}

// One outing's messages for the page, with each reply's pick cards rebuilt from the
// stored ids and sentences. `owned` is known for a user; a guest's page marks it.
async function transcriptForPage(deps: ConciergeDeps, conversationId: string, userId: number | null) {
  const { rows } = await deps.db.query(
    "SELECT role, content, recommendations, options, pick_reasons FROM chat_messages WHERE conversation_id = $1 ORDER BY seq",
    [conversationId],
  );
  const snapshot = await deps.catalogue.get();
  const owned = new Set(userId !== null ? await ownedIds(deps.db, userId) : []);
  return rows.map((r) => {
    const ids = (r.recommendations as number[] | null) ?? [];
    const reasons = (r.pick_reasons as string[] | null) ?? [];
    const byId = new Map(ids.map((id, i) => [id, reasons[i] ?? ""]));
    return {
      role: r.role as "user" | "assistant",
      content: r.content as string,
      options: (r.options as string[] | null) ?? [],
      picks: cardsFor(ids, snapshot, owned).map((card) => ({ ...card, reason: byId.get(card.id) ?? "" })),
    };
  });
}
