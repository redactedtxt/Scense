import { z } from "zod";

// A taste profile (SPEC sections 5 and 8): a weight from -1 (avoid) to 1 (love) for each
// of the 14 wheel families and the 6 facets, plus one plain-English summary line.

// Ring order, the same as pipeline/config/families.yaml. A fragrance's `profile` array
// uses this order, which is what lets recommend.ts line the two vectors up.
export const FAMILY_NAMES = [
  "Soft Amber", "Amber", "Woody Amber", "Woods", "Mossy Woods", "Dry Woods", "Aromatic Fougère",
  "Citrus", "Water", "Green", "Fruity", "Floral", "Soft Floral", "Floral Amber",
] as const;

// The order of pipeline/config/facets.yaml.
export const FACET_NAMES = ["sweet", "creamy", "powdery", "spicy", "smoky", "sharp"] as const;

export type FamilyName = (typeof FAMILY_NAMES)[number];
export type FacetName = (typeof FACET_NAMES)[number];

export type TasteProfile = {
  families: Record<FamilyName, number>;
  facets: Record<FacetName, number>;
  summary: string | null;
};

export const SUMMARY_MAX_CHARS = 200;

const weight = z.number().finite().min(-1).max(1);

// An object with exactly these keys, each optional. Unknown keys are refused rather than
// dropped, so a typo ("Woody amber") is an error instead of a silent no-op.
export function weightsFor<T extends string, V extends z.ZodType<number>>(names: readonly T[], value: V = weight as unknown as V) {
  const shape = Object.fromEntries(names.map((name) => [name, value.optional()])) as Record<T, z.ZodOptional<V>>;
  return z.strictObject(shape);
}

// A whole profile as a client sends it (PUT /api/profile/taste, a guest's chat request,
// the guest import). Missing keys count as 0. The summary is display text only: it is
// never sent to the model, so a guest cannot smuggle instructions in through it.
export const profileInput = z.object({
  families: weightsFor(FAMILY_NAMES),
  facets: weightsFor(FACET_NAMES),
  summary: z.string().trim().max(SUMMARY_MAX_CHARS).nullable().optional(),
});

export type ProfileInput = z.infer<typeof profileInput>;

// Fill in every key, so the stored and returned shape is always complete.
export function completeProfile(input: ProfileInput): TasteProfile {
  return {
    families: fill(FAMILY_NAMES, input.families),
    facets: fill(FACET_NAMES, input.facets),
    summary: input.summary || null,
  };
}

export function emptyProfile(): TasteProfile {
  return completeProfile({ families: {}, facets: {} });
}

function fill<T extends string>(names: readonly T[], weights: Partial<Record<T, number | undefined>>) {
  return Object.fromEntries(names.map((name) => [name, weights[name] ?? 0])) as Record<T, number>;
}

export function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export type ProfileUpdate = {
  families: Partial<Record<FamilyName, number>>;
  facets: Partial<Record<FacetName, number>>;
};

// SPEC section 8 step 4: new = clamp(0.6 × old + 0.4 × update, -1, 1), for each weight
// the model mentioned. Weights it did not mention keep their old value: "no opinion
// this turn" must not drift the profile toward zero.
export function mergeProfile(old: TasteProfile, update: ProfileUpdate, summary: string | null): TasteProfile {
  const blend = <T extends string>(oldWeights: Record<T, number>, changes: Partial<Record<T, number>>) => {
    const next = { ...oldWeights };
    for (const [name, value] of Object.entries(changes) as [T, number | undefined][]) {
      if (value === undefined || !(name in next)) continue;
      next[name] = round(clamp(0.6 * next[name] + 0.4 * clamp(value)));
    }
    return next;
  };
  return {
    families: blend(old.families, update.families),
    facets: blend(old.facets, update.facets),
    summary: summary ?? old.summary,
  };
}

// Three decimals is finer than any slider and keeps stored JSON readable.
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// The 20 weights in ring order then facet order: the taste side of recommend.ts.
export function tasteVector(profile: TasteProfile): number[] {
  return [...FAMILY_NAMES.map((name) => profile.families[name]), ...FACET_NAMES.map((name) => profile.facets[name])];
}

export function isBlank(profile: TasteProfile): boolean {
  return tasteVector(profile).every((value) => value === 0);
}

// Every weight with its name, strongest first. Used to describe a profile in words.
export function rankedWeights(profile: TasteProfile): { name: string; value: number }[] {
  return [
    ...FAMILY_NAMES.map((name) => ({ name, value: profile.families[name] })),
    ...FACET_NAMES.map((name) => ({ name, value: profile.facets[name] })),
  ].sort((a, b) => b.value - a.value);
}

// A plain summary built from the numbers alone. Used when the model's own summary is
// missing or fails the reply checks, so the card never shows text the server distrusts.
export function describeProfile(profile: TasteProfile): string | null {
  const ranked = rankedWeights(profile);
  const likes = ranked.filter((w) => w.value >= 0.2).slice(0, 3).map((w) => w.name);
  const dislikes = ranked.filter((w) => w.value <= -0.2).reverse().slice(0, 2).map((w) => w.name);
  if (likes.length === 0 && dislikes.length === 0) return null;
  const parts: string[] = [];
  if (likes.length > 0) parts.push(`lean toward ${list(likes)} scents`);
  if (dislikes.length > 0) parts.push(`${likes.length > 0 ? "avoid" : "steer away from"} ${list(dislikes)} ones`);
  return `You ${parts.join(" and ")}.`;
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
