// The taste profile's shape and plain-word description (SPEC sections 8 and 11). Pure
// functions only, so guestStore and the card can both use them. The names and orders
// match api/src/services/taste.ts, which refuses any key it doesn't know.

export const FAMILIES = [
  "Soft Amber", "Amber", "Woody Amber", "Woods", "Mossy Woods", "Dry Woods", "Aromatic Fougère",
  "Citrus", "Water", "Green", "Fruity", "Floral", "Soft Floral", "Floral Amber",
] as const;

export const FACETS = ["sweet", "creamy", "powdery", "spicy", "smoky", "sharp"] as const;

export type TasteProfile = {
  families: Record<string, number>;
  facets: Record<string, number>;
  summary: string | null;
};

export const SUMMARY_MAX_CHARS = 200;

export function emptyProfile(): TasteProfile {
  return normalizeProfile({ families: {}, facets: {}, summary: null })!;
}

// Whatever was stored (an older shape, a hand edit): keep known keys, clamp every
// weight to -1..1, and fill the rest with 0. The API would refuse an unknown key, so
// none ever leaves the browser. Returns null for something that isn't a profile at all.
export function normalizeProfile(raw: unknown): TasteProfile | null {
  if (!isObject(raw) || !isObject(raw.families) || !isObject(raw.facets)) return null;
  const summary = typeof raw.summary === "string" ? raw.summary.slice(0, SUMMARY_MAX_CHARS) : null;
  return {
    families: weights(FAMILIES, raw.families),
    facets: weights(FACETS, raw.facets),
    summary: summary || null,
  };
}

function weights(names: readonly string[], raw: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(names.map((name) => [name, clampWeight(raw[name])]));
}

function clampWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Weight = { name: string; label: string; value: number };

// Every weight, strongest like first. Facets are shown capitalised ("Spicy").
export function rankedWeights(profile: TasteProfile): Weight[] {
  return [
    ...FAMILIES.map((name) => ({ name, label: name, value: profile.families[name] ?? 0 })),
    ...FACETS.map((name) => ({ name, label: capitalise(name), value: profile.facets[name] ?? 0 })),
  ].sort((a, b) => b.value - a.value);
}

// The card's two lists (SPEC section 11): top 3 likes and top 2 dislikes. A weight
// under 0.2 either way is too faint to call a like or a dislike.
export function likesAndDislikes(profile: TasteProfile): { likes: Weight[]; dislikes: Weight[] } {
  const ranked = rankedWeights(profile);
  return {
    likes: ranked.filter((w) => w.value >= 0.2).slice(0, 3),
    dislikes: ranked.filter((w) => w.value <= -0.2).reverse().slice(0, 2),
  };
}

export function isBlank(profile: TasteProfile | null): boolean {
  return profile === null || rankedWeights(profile).every((w) => w.value === 0);
}

// Rebuilt after a hand edit, so the summary never describes the old numbers. The same
// rule as the API's describeProfile.
export function describeProfile(profile: TasteProfile): string | null {
  const { likes, dislikes } = likesAndDislikes(profile);
  const words = (list: Weight[]) => joinAnd(list.map((w) => (FACETS.includes(w.name as never) ? w.name : w.label)));
  const parts: string[] = [];
  if (likes.length > 0) parts.push(`lean toward ${words(likes)} scents`);
  if (dislikes.length > 0) parts.push(`${likes.length > 0 ? "avoid" : "steer away from"} ${words(dislikes)} ones`);
  return parts.length === 0 ? null : `You ${parts.join(" and ")}.`;
}

function joinAnd(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// How strongly, in words, for the card: "loves", "likes", "leans toward".
export function strengthWord(value: number): string {
  const size = Math.abs(value);
  if (value > 0) return size >= 0.6 ? "Loves" : size >= 0.35 ? "Likes" : "Leans toward";
  return size >= 0.6 ? "Avoids" : size >= 0.35 ? "Dislikes" : "Not keen on";
}
