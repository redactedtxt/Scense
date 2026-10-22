import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { FAMILY_NAMES, type FamilyName } from "./taste.js";

// The concierge's numbers from pipeline/config/occasions.yaml (SPEC section 9; DECISIONS
// B37): the score weights, the projection bands, the Toronto season months, and each
// occasion's family weights. Read once at startup and checked here, so a typo in a
// family name or weights that don't sum to 1 stop the API instead of skewing picks.

export const OCCASIONS = [
  "office", "date_night", "wedding", "casual_day", "gym_outdoors", "night_out", "formal_event", "interview",
] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

export const PROJECTIONS = ["low", "medium", "high"] as const;
export type Projection = (typeof PROJECTIONS)[number];

const strength = z.number().int().min(1).max(4);
const band = z.tuple([strength, strength]).refine(([from, to]) => from <= to, { message: "band must run low to high" });
const months = z.array(z.number().int().min(1).max(12));
const familyWeights = z
  .record(z.string(), z.number().min(0).max(1))
  .refine((weights) => Object.keys(weights).every((name) => (FAMILY_NAMES as readonly string[]).includes(name)), {
    message: "unknown family name",
  })
  .refine((weights) => Object.values(weights).some((value) => value > 0), { message: "needs one positive weight" });
const occasion = z.strictObject({ label: z.string().min(1), families: familyWeights });

const schema = z.object({
  score_weights: z
    .strictObject({
      season: z.number().min(0),
      daynight: z.number().min(0),
      projection: z.number().min(0),
      occasion: z.number().min(0),
      taste: z.number().min(0),
    })
    .refine((w) => Math.abs(w.season + w.daynight + w.projection + w.occasion + w.taste - 1) < 1e-9, {
      message: "score_weights must sum to 1",
    }),
  projection_bands: z.strictObject({ low: band, medium: band, high: band }),
  projection_fit: z.strictObject({
    inside: z.number().min(0).max(1),
    one_step: z.number().min(0).max(1),
    beyond: z.number().min(0).max(1),
  }),
  share_scaling: z.enum(["min_max", "none"]),
  outdoor_projection_steps: z.number().int().min(0).max(3),
  defaults: z.strictObject({
    night_from_hour: z.number().int().min(0).max(23),
    projection: z.enum(PROJECTIONS),
    setting: z.enum(["indoor", "outdoor"]),
  }),
  facts: z.strictObject({
    min_family_share: z.number().min(0).max(1),
    max_families: z.number().int().min(1).max(14),
    min_facet: z.number().min(0).max(1),
  }),
  season_months: z
    .strictObject({ winter: months, spring: months, summer: months, autumn: months })
    .refine((m) => Object.values(m).flat().sort((a, b) => a - b).join() === "1,2,3,4,5,6,7,8,9,10,11,12", {
      message: "season_months must list each month once",
    }),
  occasions: z.strictObject({
    office: occasion,
    date_night: occasion,
    wedding: occasion,
    casual_day: occasion,
    gym_outdoors: occasion,
    night_out: occasion,
    formal_event: occasion,
    interview: occasion,
  }),
});

export type ConciergeSettings = {
  weights: { season: number; daynight: number; projection: number; occasion: number; taste: number };
  bands: Record<Projection, [number, number]>;
  fit: { inside: number; oneStep: number; beyond: number };
  facts: { minFamilyShare: number; maxFamilies: number; minFacet: number };
  shareScaling: "min_max" | "none";
  outdoorSteps: number;
  defaults: { nightFromHour: number; projection: Projection; setting: "indoor" | "outdoor" };
  seasonMonths: Record<Season, number[]>;
  occasions: Record<Occasion, { label: string; vector: number[] }>; // vector: 14 weights in ring order
};

export function loadConciergeSettings(path: string): ConciergeSettings {
  return conciergeSettingsFrom(parse(readFileSync(path, "utf8")));
}

export function conciergeSettingsFrom(raw: unknown): ConciergeSettings {
  const config = schema.parse(raw);
  const occasions = Object.fromEntries(
    OCCASIONS.map((o) => {
      const { label, families } = config.occasions[o];
      return [o, { label, vector: FAMILY_NAMES.map((name: FamilyName) => families[name] ?? 0) }];
    }),
  ) as ConciergeSettings["occasions"];
  return {
    weights: config.score_weights,
    bands: config.projection_bands,
    fit: { inside: config.projection_fit.inside, oneStep: config.projection_fit.one_step, beyond: config.projection_fit.beyond },
    facts: {
      minFamilyShare: config.facts.min_family_share,
      maxFamilies: config.facts.max_families,
      minFacet: config.facts.min_facet,
    },
    shareScaling: config.share_scaling,
    outdoorSteps: config.outdoor_projection_steps,
    defaults: {
      nightFromHour: config.defaults.night_from_hour,
      projection: config.defaults.projection,
      setting: config.defaults.setting,
    },
    seasonMonths: config.season_months,
    occasions,
  };
}
