import { LlmUnavailableError, type Llm, type LlmMessage } from "./llm.js";
import { modelOutput, OUTPUT_SCHEMA, type ModelOutput } from "./prompt.js";
import { capWords, type ReplyGuard } from "./replyGuard.js";
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

export type ModelResult =
  | { kind: "ok"; output: ModelOutput; tokens: Tokens }
  | { kind: "invalid"; tokens: Tokens } // two answers in a row failed the schema
  | { kind: "unavailable"; tokens: Tokens }; // Anthropic could not answer at all

const ATTEMPTS = 2; // the first try plus one retry

export async function askModel(llm: Llm, system: string, messages: LlmMessage[]): Promise<ModelResult> {
  const tokens: Tokens = { input: 0, output: 0 };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let response;
    try {
      response = await llm.complete({ system, messages, schema: OUTPUT_SCHEMA });
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { kind: "unavailable", tokens };
      throw err;
    }
    tokens.input += response.inputTokens;
    tokens.output += response.outputTokens;
    const output = parseOutput(response.text, response.stopReason);
    if (output) return { kind: "ok", output, tokens };
  }
  return { kind: "invalid", tokens };
}

// A refusal or a reply cut off at max_tokens can't be trusted to be whole, even if it
// happens to parse, so both count as invalid.
export function parseOutput(text: string, stopReason: string | null): ModelOutput | null {
  if (stopReason === "refusal" || stopReason === "max_tokens") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = modelOutput.safeParse(json);
  return result.success ? result.data : null;
}

export type Turn = { reply: string; profile: TasteProfile; replaced: boolean };

// The model's answer, made safe to show and store:
//  - the profile update is clamped to -1..1 and merged (unknown keys never got past Zod);
//  - the reply is capped at maxWords, and replaced by a server-written one if the guard
//    finds a product name, a link, or nothing about scent;
//  - the summary gets the same checks, falling back to one built from the numbers.
export function composeTurn(
  output: ModelOutput,
  old: TasteProfile,
  guard: ReplyGuard,
  maxWords: number,
): Turn {
  const update = clampUpdate(output.profile_update);
  const merged = mergeProfile(old, update, null);
  const summary = safeSummary(output.summary, guard) ?? describeProfile(merged);
  const profile = { ...merged, summary };
  const reply = capWords(output.reply, maxWords);
  if (guard.check(reply) === "ok") return { reply, profile, replaced: false };
  return { reply: fallbackReply(update), profile, replaced: true };
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
    return "I can only help describe the scents you like and dislike. What smells do you enjoy, or can't stand?";
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
