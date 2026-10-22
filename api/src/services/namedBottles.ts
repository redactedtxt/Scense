import type { Db } from "../db.js";
import type { CatalogueEntry } from "./catalogueCache.js";
import { normalize } from "./replyGuard.js";
import { bestMatch } from "./search.js";
import { FACET_NAMES, FAMILY_NAMES, type ProfileUpdate } from "./taste.js";

// Bottles a visitor names in the chat ("my favourites are Myrrh and Tonka, ..."), DECISIONS
// B35. The model only copies the names it saw into `mentioned_fragrances`, each marked
// liked or not; the server looks them up with the catalogue search. Liked bottles become a
// profile update; every named bottle is kept out of the picks. Nothing here is ever
// shown: the reply says how many matched, never which.

export type Mention = { name: string; liked: boolean };
export type NamedBottles = { matched: number[]; liked: number[]; unmatched: number };

// Keeps only names the visitor really typed, so the model can't slip in a bottle of its
// own choosing, then looks each one up. A name found twice counts once.
export async function matchNamedBottles(
  db: Db,
  mentions: Mention[],
  message: string,
  limits: { max: number; fuzzyMinSimilarity: number },
): Promise<NamedBottles> {
  const typed = ` ${plain(message)} `;
  const seen = new Set<string>();
  const names = mentions
    .filter((m) => plain(m.name) !== "" && typed.includes(` ${plain(m.name)} `))
    .filter((m) => !seen.has(plain(m.name)) && seen.add(plain(m.name)))
    .slice(0, limits.max);
  const matched = new Set<number>();
  const liked = new Set<number>();
  let unmatched = 0;
  for (const mention of names) {
    const id = await bestMatch(db, mention.name, limits.fuzzyMinSimilarity);
    if (id === null) {
      unmatched++;
      continue;
    }
    matched.add(id);
    if (mention.liked) liked.add(id);
  }
  return { matched: [...matched], liked: [...liked], unmatched };
}

// The named bottles as one strong update: their 20-value vectors averaged, scaled so the
// largest weight is `weight`, and only the clear parts kept (at least `minWeight` after
// scaling). Bottles' vectors are never negative, so this only ever adds likes.
export function namedBottlesUpdate(
  entries: CatalogueEntry[],
  ids: number[],
  settings: { weight: number; minWeight: number },
): ProfileUpdate {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const vectors = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!.vector] : []));
  const update: ProfileUpdate = { families: {}, facets: {} };
  if (vectors.length === 0) return update;
  const average = vectors[0]!.map((_, i) => vectors.reduce((sum, v) => sum + v[i]!, 0) / vectors.length);
  const largest = Math.max(...average);
  if (largest <= 0) return update;
  average.forEach((value, i) => {
    const scaled = Math.round((value / largest) * settings.weight * 1000) / 1000;
    if (scaled < settings.minWeight) return;
    if (i < FAMILY_NAMES.length) update.families[FAMILY_NAMES[i]!] = scaled;
    else update.facets[FACET_NAMES[i - FAMILY_NAMES.length]!] = scaled;
  });
  return update;
}

// Words only: case, accents, and punctuation ignored, so "Hawas Fire." still counts as
// typed in "... and Hawas Fire".
function plain(text: string): string {
  return normalize(text).replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}

// One server-written sentence about the names, without repeating any of them. Only liked
// bottles change the profile, so only they are "added"; a disliked one is just noted.
export function namedBottlesNote({ matched, liked, unmatched }: NamedBottles): string | null {
  const found = matched.length;
  if (found === 0 && unmatched === 0) return null;
  if (found === 0) {
    return unmatched === 1
      ? "That bottle isn't in our catalogue yet, so I went by your description."
      : "Those bottles aren't in our catalogue yet, so I went by your description.";
  }
  const what = unmatched === 0 ? (found === 1 ? "the bottle" : "the bottles") : `${found} of the bottles`;
  const added = liked.length === 0 ? "" : ` and added ${liked.length === 1 ? "its" : "their"} character to your profile`;
  const rest =
    unmatched === 0 ? "" : unmatched === 1 ? "; the other one isn't in the catalogue yet" : "; the others aren't in the catalogue yet";
  return `I found ${what} you named in our catalogue${added}${rest}.`;
}
