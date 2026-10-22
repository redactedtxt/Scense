import type { CatalogueEntry, CatalogueSnapshot } from "./catalogueCache.js";
import type { Slots } from "./concierge.js";
import type { ConciergeSettings } from "./occasions.js";
import { tasteVector, type TasteProfile } from "./taste.js";

// The server picks every fragrance, for the chat and for the concierge.
// Chat (SPEC section 8 step 5): cosine similarity between the taste vector (14 families
// + 6 facets, -1 to 1) and each fragrance's vector (its family shares + its facets).
// Concierge (section 9 step 3): a weighted score of the outing's slots, below.

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
// An owned bottle must match at least `ownedMinMatch` (config, DECISIONS B35) to be
// shown: owning a 41% match is no reason to put it first. If none clears it, the picks
// are the best bottles the visitor doesn't own. Any bottle needs a positive score to
// count as a match at all. `exclude` holds bottles the visitor named in the chat: they
// already know those, so they are never picked.
export function recommend(
  entries: CatalogueEntry[],
  profile: TasteProfile,
  ownedIds: Set<number>,
  options: { ownedMinMatch: number; exclude?: Set<number> },
): Recommendation[] {
  const taste = tasteVector(profile);
  const exclude = options.exclude ?? new Set<number>();
  const scored = entries
    .filter((entry) => !exclude.has(entry.id))
    .map((entry) => ({ entry, score: cosine(taste, entry.vector) }))
    .filter(({ score }) => score > 0)
    // Ties go to the lower id (the more voted original catalogue), so results are stable.
    .sort((a, b) => b.score - a.score || a.entry.id - b.entry.id);

  const owned = scored
    .filter(({ entry, score }) => ownedIds.has(entry.id) && score >= options.ownedMinMatch)
    .slice(0, PER_GROUP);
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

// Cards for stored picks (a reopened chat or outing), rebuilt from their ids. A bottle
// the catalogue no longer holds is left out. `owned` marks the badge.
export function cardsFor(ids: number[], snapshot: CatalogueSnapshot, owned: Set<number>): Omit<Recommendation, "match">[] {
  const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    if (!entry) return [];
    const { slug, name, brand, imageUrl, dominantFamily } = entry;
    return [{ id, slug, name, brand, imageUrl, dominantFamily, owned: owned.has(id) }];
  });
}

// --- the concierge (SPEC section 9 step 3) --------------------------------------------

// An outing ready to score. Every slot is filled, except that the occasion can be null
// on a forced result (the day's last message, DECISIONS B38): occasion fit is then left
// out, for every bottle alike.
export type FullSlots = { [K in Exclude<keyof Slots, "occasion">]: NonNullable<Slots[K]> } & {
  occasion: Slots["occasion"];
};

export type OutingTerms = { season: number; daynight: number; projection: number; occasion: number; taste: number };
export type OutingScore = { entry: CatalogueEntry; score: number; terms: OutingTerms };

// The lowest and highest share across the catalogue, per season and per day/night.
export type ShareRanges = Record<string, [number, number]>;

const PICKS = 3; // the top pick and 2 alternatives

// Full credit inside the projection's strength band, `oneStep` one step outside it,
// `beyond` further out. Low wants 1-2, medium 2-3, high 3-4 (occasions.yaml).
export function projectionFit(strength: number, band: [number, number], fit: ConciergeSettings["fit"]): number {
  const [from, to] = band;
  const steps = strength < from ? from - strength : strength > to ? strength - to : 0;
  if (steps === 0) return fit.inside;
  return steps === 1 ? fit.oneStep : fit.beyond;
}

// The band an outing wants. Outdoors a scent carries less, so the band moves up
// `outdoorSteps` strength steps, capped at 4 (B38): outdoor medium wants 3-4.
export function projectionBand(slots: FullSlots, settings: ConciergeSettings): [number, number] {
  const [from, to] = settings.bands[slots.projection];
  const steps = slots.setting === "outdoor" ? settings.outdoorSteps : 0;
  return [Math.min(4, from + steps), Math.min(4, to + steps)];
}

// Every season and day/night share's range across the whole catalogue (not just the
// candidates), so a bottle's rescaled share doesn't change with what else you own.
export function shareRanges(entries: CatalogueEntry[]): ShareRanges {
  const ranges: ShareRanges = {};
  const widen = (key: string, value: number) => {
    const [low, high] = ranges[key] ?? [value, value];
    ranges[key] = [Math.min(low, value), Math.max(high, value)];
  };
  for (const entry of entries) {
    for (const [season, share] of Object.entries(entry.seasons)) widen(`season:${season}`, share);
    for (const [time, share] of Object.entries(entry.daynight)) widen(`time:${time}`, share);
  }
  return ranges;
}

// min_max: 0 for the catalogue's lowest share, 1 for its highest (B38). With no spread
// at all there is nothing to tell bottles apart by, so every bottle gets 0.
function scaled(share: number, range: [number, number] | undefined, settings: ConciergeSettings): number {
  if (settings.shareScaling === "none") return share;
  if (!range || range[1] <= range[0]) return 0;
  return (share - range[0]) / (range[1] - range[0]);
}

// score = 0.30 × season share + 0.20 × day/night share + 0.20 × projection fit
//       + 0.20 × occasion fit + 0.10 × taste similarity (weights from occasions.yaml),
// with both shares rescaled across the catalogue first. Both cosines are floored at 0,
// so a bottle opposite to the visitor's taste scores no worse than having no profile.
export function scoreOuting(
  entry: CatalogueEntry,
  slots: FullSlots,
  profile: TasteProfile | null,
  settings: ConciergeSettings,
  ranges: ShareRanges,
): OutingScore {
  const occasion = slots.occasion ? settings.occasions[slots.occasion].vector : null;
  const terms: OutingTerms = {
    season: scaled(entry.seasons[slots.season] ?? 0, ranges[`season:${slots.season}`], settings),
    daynight: scaled(entry.daynight[slots.time_of_day] ?? 0, ranges[`time:${slots.time_of_day}`], settings),
    projection: projectionFit(entry.strength, projectionBand(slots, settings), settings.fit),
    occasion: occasion ? Math.max(0, cosine(occasion, entry.vector.slice(0, 14))) : 0,
    taste: profile ? Math.max(0, cosine(tasteVector(profile), entry.vector)) : 0,
  };
  const w = settings.weights;
  const score =
    w.season * terms.season + w.daynight * terms.daynight + w.projection * terms.projection +
    w.occasion * terms.occasion + w.taste * terms.taste;
  return { entry, score, terms };
}

// The top pick and 2 alternatives from the visitor's Own list. With nothing owned (or
// only ids the catalogue doesn't hold) the whole catalogue is the candidate list, and
// `fromCatalogue` says so, so the page can tell the visitor in one line.
export function conciergePicks(
  entries: CatalogueEntry[],
  ownedIds: Set<number>,
  slots: FullSlots,
  profile: TasteProfile | null,
  settings: ConciergeSettings,
): { picks: OutingScore[]; fromCatalogue: boolean } {
  const ranges = shareRanges(entries);
  const owned = entries.filter((entry) => ownedIds.has(entry.id));
  const candidates = owned.length > 0 ? owned : entries;
  const picks = candidates
    .map((entry) => scoreOuting(entry, slots, profile, settings, ranges))
    // Ties go to the lower id (the more voted original catalogue), as in the chat.
    .sort((a, b) => b.score - a.score || a.entry.id - b.entry.id)
    .slice(0, PICKS);
  return { picks, fromCatalogue: owned.length === 0 };
}
