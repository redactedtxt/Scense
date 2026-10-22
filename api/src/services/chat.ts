import type { z } from "zod";
import { LlmUnavailableError, type Llm, type LlmMessage } from "./llm.js";
import { modelOutput, OUTPUT_SCHEMA, type ModelOutput } from "./prompt.js";
import { capWords, withoutRuleTalk, type ReplyGuard } from "./replyGuard.js";
import {
  clamp,
  describeProfile,
  FACET_NAMES,
  FAMILY_NAMES,
  mergeProfile,
  SUMMARY_MAX_CHARS,
  type ProfileUpdate,
  type TasteProfile,
} from "./taste.js";

// One chat turn's model work (SPEC section 8 steps 2 to 4): ask, validate, retry once,
// then turn the answer into what the visitor sees. No database here; routes/chat.ts
// handles caps, storage, and recommendations.

export type Tokens = { input: number; output: number };

export type JsonResult<T> =
  | { kind: "ok"; output: T; tokens: Tokens }
  | { kind: "invalid"; tokens: Tokens } // two answers in a row failed the schema
  | { kind: "unavailable"; tokens: Tokens }; // Anthropic could not answer at all

export type ModelResult = JsonResult<ModelOutput>;

const ATTEMPTS = 2; // the first try plus one retry

// Asks for JSON in `schema`'s shape and checks the answer with `shape` (Zod): one retry
// on an invalid answer, then "invalid". Every attempt's tokens are counted. The chat and
// the concierge (routes/concierge.ts) both use this.
export async function askJson<T>(
  llm: Llm,
  request: { system: string; messages: LlmMessage[]; schema: Record<string, unknown> },
  shape: z.ZodType<T>,
): Promise<JsonResult<T>> {
  const tokens: Tokens = { input: 0, output: 0 };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let response;
    try {
      response = await llm.complete(request);
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { kind: "unavailable", tokens };
      throw err;
    }
    tokens.input += response.inputTokens;
    tokens.output += response.outputTokens;
    const output = parseJson(response.text, response.stopReason, shape);
    if (output !== null) return { kind: "ok", output, tokens };
  }
  return { kind: "invalid", tokens };
}

export function askModel(llm: Llm, system: string, messages: LlmMessage[]): Promise<ModelResult> {
  return askJson(llm, { system, messages, schema: OUTPUT_SCHEMA }, modelOutput);
}

// A refusal or a reply cut off at max_tokens can't be trusted to be whole, even if it
// happens to parse, so both count as invalid.
export function parseJson<T>(text: string, stopReason: string | null, shape: z.ZodType<T>): T | null {
  if (stopReason === "refusal" || stopReason === "max_tokens") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = shape.safeParse(json);
  return result.success ? result.data : null;
}

export type Turn = { reply: string; profile: TasteProfile; replaced: boolean };

// The model's answer, made safe to show and store:
//  - the profile update is clamped to -1..1 and merged (unknown keys never got past Zod),
//    then the update from bottles the visitor named (namedBottles.ts) on top of it;
//  - the reply is capped at maxWords, loses any sentence about its own rules, and is
//    replaced by a server-written one if what's left names a product, has a link, or
//    says nothing about scent;
//  - the summary gets the same checks, falling back to one built from the numbers.
export function composeTurn(
  output: ModelOutput,
  old: TasteProfile,
  guard: ReplyGuard,
  maxWords: number,
  namedUpdate: ProfileUpdate = { families: {}, facets: {} },
): Turn {
  const update = clampUpdate(output.profile_update);
  const merged = mergeProfile(mergeProfile(old, update, null), namedUpdate, null);
  const summary = safeSummary(output.summary, guard) ?? describeProfile(merged);
  const profile = { ...merged, summary };
  const reply = withoutRuleTalk(capWords(output.reply, maxWords));
  if (reply !== "" && guard.check(reply) === "ok") return { reply, profile, replaced: false };
  return { reply: fallbackReply(update), profile, replaced: true };
}

// Shown before the picks when the reply ended by offering them (DECISIONS B35).
export const PICKS_LEAD_IN = "Here are a few picks from the catalogue that fit.";

// A closing question that offers recommendations: "Would you like some recommendations
// now?", "Shall I suggest a few bottles?". Only a question with both an offer and
// something to offer counts, so "Do you like spicy notes too?" stays.
const OFFER = /\b(?:would you like|do you want|want me to|shall i|should i|can i|could i|ready (?:for|to)|like to see|interested in)\b/i;
const OFFERED = /\b(?:recommend\w*|suggest\w*|picks?|options|ideas|bottles?|fragrances?|perfumes?|matches)\b/i;

function isOffer(sentence: string): boolean {
  return sentence.trim().endsWith("?") && OFFER.test(sentence) && OFFERED.test(sentence);
}

// The reply as finally shown, around the server's own sentences:
//  - when picks are shown under it, a closing offer of picks is replaced by a lead-in
//    (the cards are already there, so asking makes no sense);
//  - a note about named bottles (how many were found, never which) goes first.
export function finishReply(reply: string, options: { showingPicks: boolean; note: string | null }): string {
  let body = reply;
  if (options.showingPicks) {
    const sentences = reply.match(/[^.!?]+[.!?]*\s*/g) ?? [reply];
    const last = sentences[sentences.length - 1] ?? "";
    if (isOffer(last)) body = `${sentences.slice(0, -1).join("")}${PICKS_LEAD_IN}`.trim();
  }
  return options.note ? `${options.note} ${body}` : body;
}

function clampUpdate(update: ModelOutput["profile_update"]): ProfileUpdate {
  const clampAll = (weights: Record<string, number | undefined>) =>
    Object.fromEntries(Object.entries(weights).flatMap(([k, v]) => (v === undefined ? [] : [[k, clamp(v)]])));
  return { families: clampAll(update.families), facets: clampAll(update.facets) };
}

function safeSummary(summary: string, guard: ReplyGuard): string | null {
  if (summary === "" || summary.length > SUMMARY_MAX_CHARS) return null;
  return guard.check(summary) === "ok" ? summary : null;
}

// What the visitor sees when the model's reply failed a check: what the numbers say it
// heard, or a nudge back on topic. Built only from family and facet names.
export function fallbackReply(update: ProfileUpdate): string {
  const named = [
    ...FAMILY_NAMES.flatMap((name) => (update.families[name] === undefined ? [] : [{ name, value: update.families[name]! }])),
    ...FACET_NAMES.flatMap((name) => (update.facets[name] === undefined ? [] : [{ name, value: update.facets[name]! }])),
  ];
  const likes = named.filter((w) => w.value > 0).map((w) => w.name);
  const dislikes = named.filter((w) => w.value < 0).map((w) => w.name);
  if (likes.length === 0 && dislikes.length === 0) {
    return "Let's stay with scent: what smells do you enjoy, and which can't you stand?";
  }
  const heard = [
    likes.length > 0 ? `you enjoy ${likes.join(", ")}` : null,
    dislikes.length > 0 ? `you'd rather avoid ${dislikes.join(", ")}` : null,
  ].filter(Boolean);
  return `Noted: ${heard.join(", and ")}. I've updated your taste profile. Tell me more about scents you love or can't stand.`;
}

// Shown (and stored) when the model's answer failed validation twice. The message still
// counts: refunding it would let a visitor who can make the model ramble chat forever.
export const CONFUSED_REPLY =
  "Sorry, I lost my train of thought on that one. Could you describe it another way? Your taste profile hasn't changed.";
