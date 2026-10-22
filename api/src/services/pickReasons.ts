import { labelOf } from "./concierge.js";
import { OCCASIONS, type ConciergeSettings } from "./occasions.js";
import type { FullSlots, OutingScore } from "./recommend.js";
import { normalize, type ReplyGuard } from "./replyGuard.js";
import { FACET_NAMES, FAMILY_NAMES } from "./taste.js";

// The one sentence under each concierge pick (SPEC section 9 step 4; DECISIONS B37).
// The model writes it from structured facts the server passes in, and never sees the
// bottle's name. Before a visitor sees it, the server checks that the sentence:
//  - names no fragrance or brand, has no link, and doesn't talk about its own rules
//    (the chat's reply guard);
//  - claims nothing outside the facts: every number, family, facet, season, time of
//    day, setting, and occasion it mentions must be one of that pick's, and it names no
//    note and none of the claims the facts can't support (hours, price, compliments).
// A sentence that fails is replaced by one the server writes from the same facts.

export type PickFacts = {
  pick: number;
  occasion: string | null; // null on a forced result with no occasion given (B38)
  occasion_fit_percent: number | null;
  season: string;
  season_vote_share_percent: number;
  time_of_day: string;
  time_vote_share_percent: number;
  setting: string;
  strength: number; // 1 to 4
  strength_scale: "1 to 4";
  projection_wanted: string;
  projection_fit: "inside the wanted range" | "one step off" | "outside the wanted range";
  projection_raised_for_outdoors: boolean;
  main_families: { family: string; percent: number }[];
  facets: string[];
};

const percent = (share: number) => Math.round(share * 100);

// The shares here are the raw vote shares ("38% of season votes"), not the rescaled
// numbers the score used: they are what a sentence can truthfully say about votes.
export function pickFacts(score: OutingScore, index: number, slots: FullSlots, settings: ConciergeSettings): PickFacts {
  const { entry, terms } = score;
  const families = FAMILY_NAMES.map((family, i) => ({ family: family as string, share: entry.vector[i]! }))
    .filter(({ share }) => share >= settings.facts.minFamilyShare)
    .sort((a, b) => b.share - a.share)
    .slice(0, settings.facts.maxFamilies);
  const fit = terms.projection === settings.fit.inside ? "inside the wanted range" : terms.projection === settings.fit.oneStep ? "one step off" : "outside the wanted range";
  return {
    pick: index + 1,
    occasion: slots.occasion ? settings.occasions[slots.occasion].label : null,
    occasion_fit_percent: slots.occasion ? percent(terms.occasion) : null,
    season: labelOf("season", slots.season, settings).toLowerCase(),
    season_vote_share_percent: percent(entry.seasons[slots.season] ?? 0),
    time_of_day: slots.time_of_day,
    time_vote_share_percent: percent(entry.daynight[slots.time_of_day] ?? 0),
    setting: slots.setting,
    strength: entry.strength,
    strength_scale: "1 to 4",
    projection_wanted: slots.projection,
    projection_fit: fit,
    projection_raised_for_outdoors: slots.setting === "outdoor" && settings.outdoorSteps > 0,
    main_families: families.map(({ family, share }) => ({ family, percent: percent(share) })),
    facets: FACET_NAMES.filter((_, i) => entry.vector[14 + i]! >= settings.facts.minFacet),
  };
}

// --- the check -----------------------------------------------------------------------

export type ReasonCheck =
  | "ok" | "empty" | "too_long" | "not_one_sentence" | "names_product" | "link" | "mentions_rules"
  | "wrong_number" | "wrong_family" | "wrong_facet" | "wrong_season" | "wrong_time" | "wrong_setting"
  | "wrong_occasion" | "names_note" | "unsupported_claim";

// Words for each value, as they appear after normalize(). "fall" is the UI's autumn.
const SEASON_WORDS: Record<string, string[]> = {
  winter: ["winter", "wintry", "wintery"],
  spring: ["spring", "springtime"],
  summer: ["summer", "summery", "summertime"],
  fall: ["fall", "autumn", "autumnal"],
};
const TIME_WORDS: Record<string, string[]> = {
  day: ["day", "daytime", "daylight", "morning", "afternoon", "sunny"],
  night: ["night", "nighttime", "evening", "evenings", "nights", "after dark"],
};
const SETTING_WORDS: Record<string, string[]> = {
  indoor: ["indoor", "indoors"],
  // Not "outside": "outside the wanted range" is about projection, not where you are.
  outdoor: ["outdoor", "outdoors", "open air"],
};
// Words that point at one occasion and no other. Each occasion's own label is also
// removed from the text before checking, so "date night" doesn't read as "night".
const OCCASION_WORDS: Record<(typeof OCCASIONS)[number], string[]> = {
  office: ["office", "workplace", "desk", "meeting", "meetings"],
  date_night: ["date", "romantic", "romance"],
  wedding: ["wedding", "weddings", "bride", "groom"],
  casual_day: ["casual", "errands"],
  gym_outdoors: ["gym", "workout", "exercise", "hike", "hiking"],
  night_out: ["night out", "club", "clubbing", "party", "bar"],
  formal_event: ["formal", "gala", "black tie"],
  interview: ["interview", "interviews"],
};
// Phrases the facts themselves use, which would otherwise read as a time of day.
const NEUTRAL_PHRASES = ["day or night", "day and night", "night or day", "time of day", "day night"];
// Claims no fact passed to the model can back up.
const UNSUPPORTED = /\b(?:hours?|longevity|long lasting|lasts?|lasting|compliments?|price[sd]?|cheap|expensive|affordable|budget|bestsell\w*|best sell\w*|awards?|award winning|celebrity|launched|released|iconic|classic|cult|signature scent)\b/;
const FACET_STEMS: Record<string, RegExp> = {
  sweet: /\bsweet\w*/, creamy: /\bcream\w*/, powdery: /\bpowder\w*/,
  spicy: /\bspic\w*/, smoky: /\bsmok\w*/, sharp: /\bsharp\w*/,
};

export type ReasonContext = {
  guard: ReplyGuard;
  noteNames: string[];
  settings: ConciergeSettings;
  maxWords: number;
};

export function checkReason(text: string, facts: PickFacts, ctx: ReasonContext): ReasonCheck {
  const shape = checkShape(text, ctx.maxWords);
  if (shape !== "ok") return shape;
  const guarded = ctx.guard.check(text);
  // The chat's on-topic test doesn't apply: "Easy to wear at a wedding." is fine here.
  if (guarded !== "ok" && guarded !== "off_topic") return guarded;
  let padded = ` ${normalize(text)} `;
  padded = removePhrases(padded, [facts.occasion ? normalize(facts.occasion) : "", ...NEUTRAL_PHRASES]);
  return checkFacts(padded, facts, ctx);
}

function checkShape(text: string, maxWords: number): ReasonCheck {
  const trimmed = text.trim();
  if (trimmed === "") return "empty";
  if (trimmed.split(/\s+/).length > maxWords) return "too_long";
  // A second sentence starts after an inner full stop, or on a new line.
  if (/[.!?]\s+\S/.test(trimmed) || /\n/.test(trimmed)) return "not_one_sentence";
  return "ok";
}

function checkFacts(padded: string, facts: PickFacts, ctx: ReasonContext): ReasonCheck {
  const allowedNumbers = new Set(
    [facts.occasion_fit_percent, facts.season_vote_share_percent, facts.time_vote_share_percent, facts.strength, 4,
      ...facts.main_families.map((f) => f.percent)].flatMap((n) => (n === null ? [] : [String(n)])),
  );
  if ((padded.match(/\d+/g) ?? []).some((n) => !allowedNumbers.has(n))) return "wrong_number";
  if (!onlyThese(padded, SEASON_WORDS, facts.season)) return "wrong_season";
  if (!onlyThese(padded, TIME_WORDS, facts.time_of_day)) return "wrong_time";
  if (!onlyThese(padded, SETTING_WORDS, facts.setting)) return "wrong_setting";
  const occasionKey = OCCASIONS.find((o) => ctx.settings.occasions[o].label === facts.occasion);
  if (!onlyThese(padded, OCCASION_WORDS, occasionKey ?? "")) return "wrong_occasion";
  if (!familiesAllowed(padded, facts)) return "wrong_family";
  if (FACET_NAMES.some((facet) => !facts.facets.includes(facet) && FACET_STEMS[facet]!.test(padded))) return "wrong_facet";
  if (UNSUPPORTED.test(padded)) return "unsupported_claim";
  if (namesNote(padded, ctx.noteNames)) return "names_note";
  return "ok";
}

function has(padded: string, phrase: string): boolean {
  return padded.includes(` ${phrase} `);
}

function removePhrases(padded: string, phrases: string[]): string {
  let text = padded;
  for (const phrase of phrases) if (phrase) text = text.split(` ${phrase} `).join(" | ");
  return text;
}

// Every word in `groups` the text uses must belong to the group named `chosen`.
function onlyThese(padded: string, groups: Record<string, string[]>, chosen: string): boolean {
  return Object.entries(groups).every(([key, words]) => key === chosen || !words.some((word) => has(padded, word)));
}

// Longest names first, each removed once matched, so "Soft Amber" isn't also read as
// "Amber". A shorter word on its own ("floral", "woods") is fine when it is part of an
// allowed family name ("Soft Floral", "Mossy Woods"): it describes the same thing.
function familiesAllowed(padded: string, facts: PickFacts): boolean {
  const allowed = facts.main_families.map((f) => normalize(f.family));
  let text = padded;
  const names = [...FAMILY_NAMES].map(normalize).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!has(text, name)) continue;
    if (!allowed.some((family) => family === name || ` ${family} `.includes(` ${name} `))) return false;
    text = removePhrases(text, [name]);
  }
  return true;
}

// Words that are note names in the dataset but also plain words a sentence about an
// outing uses ("Water" is also a family; "Skin" and "Rain" read as plain words here).
// "Smoke" is a note too, but the smoky facet check already decides whether it may appear.
const NOT_NOTES = new Set([
  ...[...FAMILY_NAMES, ...FACET_NAMES].map(normalize),
  ...Object.values(SEASON_WORDS).flat(), ...Object.values(TIME_WORDS).flat(), ...Object.values(SETTING_WORDS).flat(),
  "fresh", "green", "warm", "clean", "rain", "sea", "air", "snow", "sun", "skin", "smoke", "wood", "woody", "floral", "fruity",
]);

function namesNote(padded: string, noteNames: string[]): boolean {
  return noteNames.some((note) => {
    const name = normalize(note);
    return name.length >= 3 && !NOT_NOTES.has(name) && has(padded, name);
  });
}

// --- the server's own sentence ---------------------------------------------------------

// Written only from the facts, so it always passes checkReason, word limit included (a
// test holds it to that). For example: "Mostly Woody Amber and Amber, sweet and spicy;
// 38% of season votes say fall, 71% of day-or-night votes say night; strength 3 of 4,
// inside the medium projection range." Outdoors it adds ", raised a step for outdoors".
// It says "range", not "you asked for": on a forced result the projection may be assumed.
export function fallbackReason(facts: PickFacts): string {
  const families = facts.main_families.slice(0, 2).map((f) => f.family);
  const lead = families.length > 0 ? `Mostly ${families.join(" and ")}` : "A balanced scent";
  const side = facts.facets.length > 0 ? `, ${facts.facets.slice(0, 2).join(" and ")}` : "";
  const projection =
    facts.projection_fit === "inside the wanted range"
      ? `inside the ${facts.projection_wanted} projection range`
      : facts.projection_fit === "one step off"
        ? `one step off the ${facts.projection_wanted} projection range`
        : `well off the ${facts.projection_wanted} projection range`;
  const raised = facts.projection_raised_for_outdoors ? ", raised a step for outdoors" : "";
  return (
    `${lead}${side}; ${facts.season_vote_share_percent}% of season votes say ${facts.season}, ` +
    `${facts.time_vote_share_percent}% of day-or-night votes say ${facts.time_of_day}; ` +
    `strength ${facts.strength} of 4, ${projection}${raised}.`
  );
}
