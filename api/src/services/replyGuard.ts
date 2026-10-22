import type { CatalogueSnapshot } from "./catalogueCache.js";
import { FACET_NAMES, FAMILY_NAMES } from "./taste.js";

// The server's last check on the model's free text before a visitor sees it (DECISIONS
// B34). The system prompt already tells the model never to name a product and to stay
// on topic, but a visitor's message is untrusted and a prompt is not a guarantee. So:
//
//  1. No fragrance name or brand from the catalogue, and no brand alias (YSL, TF...).
//  2. No links.
//  3. On topic: the text must mention a family, facet, note, or a scent word.
//  4. No talk about its own rules ("I won't name fragrances", "my instructions").
//
// Text that fails any check is replaced with a reply the server writes itself from the
// numbers (chat.ts), so the worst a hostile message can do is skew its own profile.

// Single-word fragrance names and brands that are also ordinary words a scent reply
// could use ("You" by Glossier, "Black", "Love", "Lush", "Nest"). Matching these would
// throw away good replies all day. Names that are note names (Vanilla, Tobacco,
// Vetiver, Milk) and family or facet words are skipped automatically. Without its
// brand, a bare "Love" or "Black" points at no particular bottle.
const ORDINARY_WORDS = new Set([
  "beautiful", "beauty", "believe", "black", "blanche", "body", "chrome", "classique", "cloud",
  "coach", "commodity", "curious", "decadence", "declaration", "devotion", "dot", "eden", "elle",
  "envy", "euphoria", "explorer", "fabulous", "fame", "fancy", "fantasy", "femme", "fierce",
  "glow", "goddess", "guidance", "heat", "icon", "imagination", "indigo", "innocent",
  "intoxicated", "karma", "knowing", "legend", "love", "lovely", "lush", "lust", "miracle",
  "naturelle", "nest", "noir", "obsession", "pardon", "perceive", "perfect", "phantom",
  "pleasures", "poison", "princess", "promise", "pulp", "reveal", "romance", "scandal",
  "sensuous", "signature", "still", "sun", "today", "truth", "ultraviolet", "wanted", "wish",
  "you", "zen", "allure", "paris", "london", "roma", "sicily",
]);

// Generic words that count as "on topic" besides the families, facets, and notes.
const SCENT_WORDS = ["scent", "scents", "smell", "smells", "fragrance", "fragrances", "note", "notes", "perfume", "perfumes"];

const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|shop|store)\b/i;

// The reply talking about its own rules or limits (DECISIONS B35): "I won't name
// fragrances", "I can't recommend specific bottles", "my instructions", "the site picks
// the bottles". A visitor should only ever hear about scent.
const RULE_TALK = [
  /\b(?:i|we)(?:\s+am|\s+are|['’]m|['’]re)?\s+(?:can(?:not|['’]t)|won['’]?t|will not|not (?:able|allowed|permitted)|do(?:n['’]t| not)|must not|never|unable)\s+(?:to\s+)?(?:\w+\s+){0,2}(?:name|recommend|suggest|mention|share|reveal|list|give)\b/i,
  /\b(?:not|never) (?:allowed|permitted) to\b/i,
  /\b(?:my|these|those|the) (?:rules|instructions|guidelines|system prompt)\b/i,
  /\bas an ai\b/i,
  /\b(?:the )?(?:website|site|server|catalogue|catalog) (?:will )?(?:picks?|chooses?|selects?|handles?) (?:the )?(?:fragrances|bottles|perfumes|recommendations|picks)\b/i,
];

export function mentionsRules(text: string): boolean {
  return RULE_TALK.some((pattern) => pattern.test(text));
}

// The text without its rule-talk sentences, so one stray "I won't name brands" doesn't
// cost the visitor a good reply. Empty if nothing else was said.
export function withoutRuleTalk(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
  return sentences.filter((sentence) => !mentionsRules(sentence)).join("").trim();
}

export type GuardResult = "ok" | "names_product" | "link" | "mentions_rules" | "off_topic";

export type ReplyGuard = { check(text: string): GuardResult };

export function createReplyGuard(snapshot: CatalogueSnapshot): ReplyGuard {
  const allowed = new Set([
    ...ORDINARY_WORDS,
    ...snapshot.noteNames.map(normalize),
    ...[...FAMILY_NAMES, ...FACET_NAMES].map(normalize),
  ]);
  const blocked = [
    ...snapshot.entries.flatMap((entry) => [entry.name, entry.brand]),
    ...snapshot.brandAliases,
  ]
    .map(normalize)
    .filter((phrase) => phrase !== "" && !(isOneWord(phrase) && (allowed.has(phrase) || phrase.length < 3)));
  const blockedSet = new Set(blocked);
  const topicWords = new Set([...allowed].filter((word) => !ORDINARY_WORDS.has(word)).concat(SCENT_WORDS));

  return {
    check(text) {
      if (LINK.test(text)) return "link";
      if (mentionsRules(text)) return "mentions_rules";
      const padded = ` ${normalize(text)} `;
      for (const phrase of blockedSet) if (padded.includes(` ${phrase} `)) return "names_product";
      for (const word of topicWords) if (padded.includes(` ${word} `)) return "ok";
      return "off_topic";
    },
  };
}

// Lower case, accents stripped, punctuation that splits phrases turned into a "|" so a
// name can't match across it ("oud, wood" is not "Oud Wood"). Apostrophes vanish
// ("J'adore" -> "jadore"); "&", hyphens and other symbols become spaces, so "Dolce &
// Gabbana" and "Dolce&Gabbana" read the same.
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[.,;:!?()[\]{}"“”]/g, " | ")
    .replace(/[^\p{L}\p{N}|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOneWord(phrase: string): boolean {
  return !phrase.includes(" ");
}

// The reply must stay under the word limit (SPEC section 8). Cutting at a word boundary
// keeps the text readable; the server never sends more than this, whatever comes back.
export function capWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}
