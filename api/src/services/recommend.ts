import type { CatalogueEntry } from "./catalogueCache.js";
import { tasteVector, type TasteProfile } from "./taste.js";

// Chat recommendations (SPEC section 8 step 5). The server picks every fragrance:
// cosine similarity between the taste vector (14 families + 6 facets, -1 to 1) and
// each fragrance's vector (its family shares + its facets).

export type Recommendation = {
  id: number;
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  dominantFamily: string;
  owned: boolean;
  match: number; // 0-100, the cosine similarity as a percentage
};

const PER_GROUP = 3;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}

// Up to 3 owned matches first, then up to 3 bottles the visitor doesn't own that score
// higher than their best owned match: "reach for what you have, unless something new
// suits you better". With nothing owned, that is simply the 3 best.
//
// A bottle needs a positive score to count as a match at all. Otherwise someone who owns
// only bottles they would hate is still shown one of them as a "match".
export function recommend(entries: CatalogueEntry[], profile: TasteProfile, ownedIds: Set<number>): Recommendation[] {
  const taste = tasteVector(profile);
  const scored = entries
    .map((entry) => ({ entry, score: cosine(taste, entry.vector) }))
    .filter(({ score }) => score > 0)
    // Ties go to the lower id (the more voted original catalogue), so results are stable.
    .sort((a, b) => b.score - a.score || a.entry.id - b.entry.id);

  const owned = scored.filter(({ entry }) => ownedIds.has(entry.id)).slice(0, PER_GROUP);
  const bestOwned = owned[0]?.score ?? 0;
  const others = scored
    .filter(({ entry, score }) => !ownedIds.has(entry.id) && score > bestOwned)
    .slice(0, PER_GROUP);

  return [...owned, ...others].map(({ entry, score }) => ({
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    brand: entry.brand,
    imageUrl: entry.imageUrl,
    dominantFamily: entry.dominantFamily,
    owned: ownedIds.has(entry.id),
    match: Math.round(score * 100),
  }));
}
