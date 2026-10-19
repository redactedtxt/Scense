import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

// Settings for catalogue search and the Browse sort. They live in the same scoring.yaml
// as the pairing numbers (DECISIONS B23, B24), so the API image needs no extra file.
const settingsSchema = z.object({
  search: z.object({ fuzzy_min_similarity: z.number().min(0).max(1) }),
  browse: z.object({ rating_weight_votes: z.number().positive() }),
});

export interface CatalogueSettings {
  // How alike (0 to 1, pg_trgm similarity) a typed word and a catalogue word must be
  // for the typo fallback to count them as the same word.
  fuzzyMinSimilarity: number;
  // The "m" of the weighted rating: the vote count at which a bottle's own rating
  // counts as much as the catalogue average.
  ratingWeightVotes: number;
}

export function loadCatalogueSettings(path: string): CatalogueSettings {
  const { search, browse } = settingsSchema.parse(parse(readFileSync(path, "utf8")));
  return { fuzzyMinSimilarity: search.fuzzy_min_similarity, ratingWeightVotes: browse.rating_weight_votes };
}

// The URL spellings of the Browse sort control. The first is the default.
export const SORTS = ["popular", "least-popular", "highest-rated"] as const;
export type Sort = (typeof SORTS)[number];

// The ORDER BY for each sort. Chosen from this fixed list, never built from user text;
// the only number interpolated comes from our config file and was checked by zod.
// Every order ends in f.id so pages never shuffle between requests.
//
// Highest rated uses a weighted rating (DECISIONS B24):
//   (votes * rating + m * mean) / (votes + m)
// so a bottle with a perfect score and few votes is pulled toward the catalogue mean
// instead of topping the list. A bottle with no rating sorts last.
export function orderByClause(sort: Sort, settings: CatalogueSettings): string {
  switch (sort) {
    case "popular":
      return "f.rating_votes DESC NULLS LAST, f.id";
    case "least-popular":
      return "f.rating_votes ASC NULLS LAST, f.id";
    case "highest-rated": {
      const m = settings.ratingWeightVotes;
      const votes = "COALESCE(f.rating_votes, 0)";
      const mean = "(SELECT avg(community_rating) FROM fragrances)";
      const weighted = `((${votes} * f.community_rating + ${m} * ${mean}) / (${votes} + ${m}))`;
      return `${weighted} DESC NULLS LAST, f.rating_votes DESC NULLS LAST, f.id`;
    }
  }
}
