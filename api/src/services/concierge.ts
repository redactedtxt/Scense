import { z } from "zod";
import { OCCASIONS, PROJECTIONS, SEASONS, type ConciergeSettings, type Occasion, type Projection, type Season } from "./occasions.js";

// The concierge's slots (SPEC section 9; DECISIONS B37): what an outing needs before the
// server can pick a bottle. No database and no model here; routes/concierge.ts does that.
//
// The model may only fill a slot with words the visitor really typed: each value it
// returns comes with `evidence`, a quote from the visitor's messages, and the server
// drops any value whose quote isn't there. A chip tap ("Night") fills its slot directly,
// with no model call at all.

export const SLOT_NAMES = ["occasion", "time_of_day", "season", "setting", "projection"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export const TIMES = ["day", "night"] as const;
export const SETTINGS = ["indoor", "outdoor"] as const;

export type Slots = {
  occasion: Occasion | null;
  time_of_day: (typeof TIMES)[number] | null;
  season: Season | null;
  setting: (typeof SETTINGS)[number] | null;
  projection: Projection | null;
};

export const SLOT_VALUES: Record<SlotName, readonly string[]> = {
  occasion: OCCASIONS,
  time_of_day: TIMES,
  season: SEASONS,
  setting: SETTINGS,
  projection: PROJECTIONS,
};

// What the page and the server's own sentences call each value. Occasion labels come
// from occasions.yaml; "autumn" is stored as the dataset spells it and shown as "Fall".
const VALUE_LABELS: Record<string, string> = {
  day: "Day", night: "Night",
  winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Fall",
  indoor: "Indoor", outdoor: "Outdoor",
  low: "Low", medium: "Medium", high: "High",
};

export function labelOf(slot: SlotName, value: string, settings: ConciergeSettings): string {
  return slot === "occasion" ? settings.occasions[value as Occasion].label : (VALUE_LABELS[value] ?? value);
}

export function emptySlots(): Slots {
  return { occasion: null, time_of_day: null, season: null, setting: null, projection: null };
}

// Stored slots, read back through the same known values, so a hand-edited row can't put
// an unknown value in front of the scorer.
const storedSlots = z.object({
  occasion: z.enum(OCCASIONS).nullable().catch(null),
  time_of_day: z.enum(TIMES).nullable().catch(null),
  season: z.enum(SEASONS).nullable().catch(null),
  setting: z.enum(SETTINGS).nullable().catch(null),
  projection: z.enum(PROJECTIONS).nullable().catch(null),
});

export function slotsFrom(stored: unknown): Slots {
  const parsed = storedSlots.safeParse(stored ?? {});
  return parsed.success ? parsed.data : emptySlots();
}

// Missing slots in the order the concierge asks about them, one at a time.
export function missingSlots(slots: Slots): SlotName[] {
  return SLOT_NAMES.filter((name) => slots[name] === null);
}

// --- the question and its chips ------------------------------------------------------

// The server's own wording for each question, used when the model's question fails a
// check or there was no model call (a chip tap).
export const QUESTIONS: Record<SlotName, string> = {
  occasion: "What's the occasion?",
  time_of_day: "Will you be out during the day or at night?",
  season: "What season is it for?",
  setting: "Will you be mostly indoors or outdoors?",
  projection: "How much projection do you want: low, medium, or high?",
};

const TORONTO_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "numeric" });

// The season in Toronto right now, by the whole months listed in occasions.yaml.
export function torontoSeason(ms: number, settings: ConciergeSettings): Season {
  const month = Number(TORONTO_MONTH.format(new Date(ms)));
  return SEASONS.find((season) => settings.seasonMonths[season].includes(month)) ?? "winter";
}

export type Chip = { label: string; value: string };

// The answer chips for a slot. Season starts with the current Toronto season, then the
// ones that follow it through the year (Fall, Winter, Spring, Summer in October).
export function chipsFor(slot: SlotName, settings: ConciergeSettings, nowMs: number): Chip[] {
  let values = [...SLOT_VALUES[slot]];
  if (slot === "season") {
    const order = ["winter", "spring", "summer", "autumn"];
    const start = order.indexOf(torontoSeason(nowMs, settings));
    values = [...order.slice(start), ...order.slice(0, start)];
  }
  return values.map((value) => ({ value, label: labelOf(slot, value, settings) }));
}

// A message that is exactly one of the open question's chips ("night", "Fall", "Gym or
// outdoors"), typed or tapped. Anything longer goes to the model.
export function chipAnswer(slot: SlotName, message: string, settings: ConciergeSettings): string | null {
  const said = simplify(message);
  const chips = chipsFor(slot, settings, 0);
  const match = chips.find((chip) => simplify(chip.label) === said || simplify(chip.value) === said);
  if (match) return match.value;
  return slot === "season" && said === "autumn" ? "autumn" : null;
}

// --- what the model extracted ---------------------------------------------------------

export type ExtractedSlot = { value: string | null; evidence: string };
export type Extracted = Record<SlotName, ExtractedSlot>;

// The old slots plus every value the model found, but only where its evidence is a
// quote from the visitor's own messages in this outing. A value the model returns with no
// quote, or with words the visitor never typed, is dropped: the slot stays as it was.
// The model can't clear a slot; it can only fill or change one.
export function applyExtraction(old: Slots, extracted: Extracted, visitorTexts: string[]): Slots {
  const said = ` ${visitorTexts.map(simplify).join(" | ")} `;
  const next = { ...old } as Record<SlotName, string | null>;
  for (const name of SLOT_NAMES) {
    const { value, evidence } = extracted[name];
    if (value === null || !SLOT_VALUES[name].includes(value)) continue;
    const quote = simplify(evidence);
    if (quote.length >= 2 && said.includes(quote)) next[name] = value;
  }
  return next as Slots;
}

// Lower case, accents and curly quotes straightened, punctuation at the ends and runs of
// spaces dropped, so "Dinner at 8!" quotes as "dinner at 8".
export function simplify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'.,!?;:]+|[\s"'.,!?;:]+$/g, "");
}

// The server's line above the picks: the outing as the slots describe it.
export function outingLine(slots: Slots, settings: ConciergeSettings): string {
  const parts = SLOT_NAMES.flatMap((name) => {
    const value = slots[name];
    if (value === null) return [];
    const label = labelOf(name, value, settings);
    return [name === "projection" ? `${label.toLowerCase()} projection` : name === "occasion" ? label : label.toLowerCase()];
  });
  return `Your outing: ${parts.join(", ")}.`;
}

// --- the day's last message (DECISIONS B38) ------------------------------------------

const TORONTO_HOUR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" });

export function torontoHour(ms: number): number {
  return Number(TORONTO_HOUR.format(new Date(ms)));
}

// On the day's last typed message the visitor gets a result even with slots missing:
// the current Toronto season, night from `nightFromHour` (day before it), and the
// configured projection and setting. A missing occasion stays null (it isn't scored).
// `assumed` lists what was filled in, in the server's words, for the line on the result.
export function assumeMissing(slots: Slots, settings: ConciergeSettings, nowMs: number) {
  const defaults = settings.defaults;
  const full = {
    occasion: slots.occasion,
    time_of_day: slots.time_of_day ?? (torontoHour(nowMs) >= defaults.nightFromHour ? "night" : "day"),
    season: slots.season ?? torontoSeason(nowMs, settings),
    setting: slots.setting ?? defaults.setting,
    projection: slots.projection ?? defaults.projection,
  } as const;
  const assumed = missingSlots(slots).map((name) => {
    if (name === "occasion") return "no occasion, so occasion fit isn't scored";
    const label = labelOf(name, full[name], settings).toLowerCase();
    return name === "projection" ? `${label} projection` : name === "season" ? `${label} season` : label;
  });
  return { full, assumed };
}

// The line on a forced result: "I assumed fall season, night, and medium projection."
export function assumedLine(assumed: string[]): string | null {
  if (assumed.length === 0) return null;
  const list = assumed.length === 1 ? assumed[0] : `${assumed.slice(0, -1).join(", ")}, and ${assumed[assumed.length - 1]}`;
  return `This was today's last message, so I assumed ${list}.`;
}
