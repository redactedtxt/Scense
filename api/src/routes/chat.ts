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
import {
  deleteConversation,
  findConversation,
  listConversations,
  purgeExpiredConversations,
  recentHistory,
  storeExchange,
  type ConversationSummary,
} from "../services/conversations.js";
import type { CatalogueCache, CatalogueSnapshot } from "../services/catalogueCache.js";
import { askModel, budgetFrom, budgetNote, composeTurn, CONFUSED_REPLY, finishReply, type Turn } from "../services/chat.js";
import type { Llm } from "../services/llm.js";
import { matchNamedBottles, namedBottlesNote, namedBottlesUpdate, type NamedBottles } from "../services/namedBottles.js";
import { loadProfile, ownedIds, saveProfile } from "../services/profileStore.js";
import { describeBudget, storedBudget, type Budget, type PriceSettings } from "../services/price.js";
import { buildSystemPrompt } from "../services/prompt.js";
import { cardsFor, recommend, type Recommendation } from "../services/recommend.js";
import { createReplyGuard } from "../services/replyGuard.js";
import { completeProfile, emptyProfile, isBlank, profileInput, type TasteProfile } from "../services/taste.js";

// The chatbot (SPEC section 8) with its caps (section 10). The model only turns words
// into weights; the server picks every fragrance, checks every reply, and counts every
// message and token. DECISIONS B34 records the choices the spec left open. A visitor can
// keep several chats (B36): each has its own transcript and named-bottle exclusions,
// while the taste profile and the day's 8 messages are shared by all of them.

export type ChatDeps = {
  db: Db;
  auth: AuthSettings;
  ai: AiSettings;
  llm: Llm | null; // null when no API key is configured
  catalogue: CatalogueCache;
  // The typo search's threshold (scoring.yaml), for looking up bottles a visitor names.
  fuzzyMinSimilarity: number;
  // scoring.yaml's price section: what a stated budget does to the picks (DECISIONS B42).
  price: PriceSettings;
  now: () => number;
};

const NO_NAMES: NamedBottles = { matched: [], liked: [], unmatched: 0 };

const FEATURE = "chat" as const;

const NO_CHAT = new ApiError(404, "no_chat", "That chat is gone. It may have been deleted, or it expired.");

// A chat id in a URL or body. Anything else is treated as a chat that doesn't exist.
const chatId = z.string().uuid();

const UNAVAILABLE = new ApiError(
  503,
  "assistant_unavailable",
  "The assistant is unavailable right now. Everything else on Scense works as usual, so try the chat again later.",
);

export function chatRouter(deps: ChatDeps): Router {
  const router = Router();
  router.use("/chat", optionalUser(deps.auth));
  const postBody = z.object({
    message: z.string().trim().min(1).max(deps.ai.messageMaxChars),
    // Absent for the first message of a new chat: the chat is created only once that
    // message is answered, so "New chat" itself is free and leaves nothing behind.
    conversationId: chatId.optional(),
    // Guests only: their profile and Own list live in the browser (SPEC section 6).
    // A signed-in user's come from the database and these are ignored.
    tasteProfile: profileInput.nullable().optional(),
    owned: z.array(z.number().int().positive()).max(2000).optional(),
  });
  // One message at a time per visitor, not per chat. A second one sent before the first
  // is answered would read the same taste profile, which every chat shares, and one of
  // the two merges would be lost. (The daily count doesn't rely on this lock: the slot
  // claim in caps.ts is atomic in the database.)
  const busy = new Set<string>();

  // The day's shared budget and the visitor's chat list. Messages load per chat.
  router.get("/chat", async (req, res) => {
    const subject = requireSubject(req, res);
    const usage = await todaysUsage(deps.db, { subject, feature: FEATURE, day: torontoDay(deps.now()) });
    res.json({
      available: deps.llm !== null,
      messagesUsed: usage?.userMessages ?? 0,
      messagesLimit: deps.ai.maxUserMessages,
      conversations: await listConversations(deps.db, subject, FEATURE),
    });
  });

  router.get("/chat/:id", async (req, res) => {
    const subject = requireSubject(req, res);
    const { summary, slots } = await ownConversation(deps.db, subject, req.params.id);
    const messages = await transcriptForPage(deps, summary.id, res.locals.userId as number | null);
    const budget = storedBudget(slots);
    res.json({ conversation: summary, messages, budget: budget ? describeBudget(budget, deps.price) : null });
  });

  // No refund: the budget is counted in llm_usage, which holds no text and isn't touched.
  router.delete("/chat/:id", async (req, res) => {
    const subject = requireSubject(req, res);
    if (chatId.safeParse(req.params.id).success) await deleteConversation(deps.db, subject, req.params.id, FEATURE);
    res.status(204).end();
  });

  router.post("/chat", async (req, res) => {
    const body = parseInput(postBody, req.body);
    const subject = requireSubject(req, res);
    if (deps.llm === null) throw UNAVAILABLE;
    if (busy.has(subject)) throw new ApiError(409, "chat_busy", "Wait for the reply to your last message.");
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

// The visitor's own chat, or a 404 for a malformed id, someone else's chat, or a chat
// that was deleted or expired. A chat's `slots` holds its budget, if one was stated.
async function ownConversation(db: Db, subject: string, id: string): Promise<{ summary: ConversationSummary; slots: unknown }> {
  const found = chatId.safeParse(id).success ? await findConversation(db, subject, id, FEATURE) : null;
  if (found === null) throw NO_CHAT;
  return found;
}

// One user message, start to finish: claim a slot, ask the model, check its answer,
// save, recommend, and store both sides of the exchange.
async function handleMessage(deps: ChatDeps, llm: Llm, subject: string, userId: number | null, body: PostBody) {
  const { db, ai } = deps;
  const key = { subject, feature: FEATURE, day: torontoDay(deps.now()) };
  // Checked before a slot is claimed, so a message to a missing chat costs nothing.
  const found = body.conversationId ? await ownConversation(db, subject, body.conversationId) : null;
  const existing = found?.summary ?? null;
  const conversationId = existing?.id ?? randomUUID();
  const slot = await reserveMessage(db, key, ai);
  if (slot === "daily_limit") {
    throw new ApiError(429, "chat_limit", `You've used today's ${ai.maxUserMessages} messages. Come back tomorrow; your chats stay here to read.`);
  }
  if (slot === "guest_cap") {
    throw new ApiError(429, "guest_cap", "Today's guest demos are used up. Sign up or come back tomorrow.");
  }
  if (existing === null) await purgeExpiredConversations(db, ai.retentionDays);

  const old = userId !== null ? ((await loadProfile(db, userId)) ?? emptyProfile()) : guestProfile(body);
  const history = existing ? await recentHistory(db, conversationId, ai.historyTurns) : [];
  const system = buildSystemPrompt(old, ai.replyMaxWords);
  const result = await askModel(llm, system, [...history, { role: "user", content: body.message }]);
  await addTokens(db, key, result.tokens);

  if (result.kind === "unavailable") {
    await refundMessage(db, key);
    throw UNAVAILABLE;
  }
  const snapshot = await deps.catalogue.get();
  const named =
    result.kind === "ok"
      ? await matchNamedBottles(db, result.output.mentioned_fragrances, body.message, {
          max: ai.namedMax,
          fuzzyMinSimilarity: deps.fuzzyMinSimilarity,
        })
      : NO_NAMES;
  const turn: Turn =
    result.kind === "ok"
      ? composeTurn(result.output, old, createReplyGuard(snapshot), ai.replyMaxWords, namedUpdate(snapshot, named, ai))
      : { reply: CONFUSED_REPLY, profile: old, replaced: false };
  if (userId !== null && result.kind === "ok") await saveProfile(db, userId, turn.profile);
  // A budget lasts for the rest of this chat, until the visitor states another.
  const said = result.kind === "ok" ? budgetFrom(result.output.budget, body.message) : null;
  const budget: Budget | null = said ? said.budget : storedBudget(found?.slots);

  // Recommend when the model says it knows enough, or on the last message of the day
  // so a visitor who used all 8 never leaves empty-handed. The server decides either way.
  const ready = result.kind === "ok" && (result.output.ready_to_recommend || slot.userMessages >= ai.maxUserMessages);
  const recommendations = ready && !isBlank(turn.profile)
    ? await pick(deps, snapshot, turn.profile, { userId, body, conversationId, named, budget })
    : [];
  const notes = [namedBottlesNote(named), said ? budgetNote(said.budget, deps.price) : null].filter(Boolean);
  const reply =
    result.kind === "ok"
      ? finishReply(turn.reply, { showingPicks: recommendations.length > 0, note: notes.join(" ") || null })
      : turn.reply;

  const conversation = await storeExchange(
    db,
    { id: conversationId, subject, feature: FEATURE, slots: budget ? { budget } : null },
    { message: body.message, named: named.matched },
    { content: reply, recommendations: recommendations.map((r) => r.id) },
  );
  return {
    conversation,
    reply,
    profile: turn.profile,
    recommendations,
    // The budget the picks lean toward, in tier symbols, or null (DECISIONS B42).
    budget: budget ? describeBudget(budget, deps.price) : null,
    degraded: result.kind === "invalid",
    messagesUsed: slot.userMessages,
    messagesLimit: ai.maxUserMessages,
  };
}

// Liked bottles the visitor named, as one strong profile update (DECISIONS B35).
function namedUpdate(snapshot: CatalogueSnapshot, named: NamedBottles, ai: AiSettings) {
  return namedBottlesUpdate(snapshot.entries, named.liked, { weight: ai.namedBottleWeight, minWeight: ai.namedMinWeight });
}

// The server's picks. Bottles named anywhere in this chat are left out: the visitor
// already knows them. Each chat keeps its own list (DECISIONS B36).
async function pick(
  deps: ChatDeps,
  snapshot: CatalogueSnapshot,
  profile: TasteProfile,
  turn: { userId: number | null; body: PostBody; conversationId: string; named: NamedBottles; budget: Budget | null },
): Promise<Recommendation[]> {
  const owned = new Set(turn.userId !== null ? await ownedIds(deps.db, turn.userId) : (turn.body.owned ?? []));
  const exclude = new Set([...(await namedEarlier(deps.db, turn.conversationId)), ...turn.named.matched]);
  const options = { ownedMinMatch: deps.ai.ownedMinMatch, exclude, budget: turn.budget, price: deps.price };
  return recommend(snapshot.entries, profile, owned, options);
}

async function namedEarlier(db: Db, conversationId: string): Promise<number[]> {
  const { rows } = await db.query(
    "SELECT DISTINCT unnest(named_fragrances) AS id FROM chat_messages WHERE conversation_id = $1",
    [conversationId],
  );
  return rows.map((r) => r.id as number);
}

function guestProfile(body: PostBody): TasteProfile {
  return body.tasteProfile ? completeProfile(body.tasteProfile) : emptyProfile();
}

// One chat's messages for the page, with each reply's recommendation cards rebuilt from
// the stored ids. `owned` is known for a user; a guest's page marks it from the browser.
async function transcriptForPage(deps: ChatDeps, conversationId: string, userId: number | null) {
  const { rows } = await deps.db.query(
    "SELECT role, content, recommendations FROM chat_messages WHERE conversation_id = $1 ORDER BY seq",
    [conversationId],
  );
  const snapshot = await deps.catalogue.get();
  const owned = new Set(userId !== null ? await ownedIds(deps.db, userId) : []);
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content as string,
    recommendations: cardsFor((r.recommendations as number[] | null) ?? [], snapshot, owned),
  }));
}
