import type { Db } from "../db.js";
import { dominantFamilyId } from "./sql.js";
import { FACET_NAMES } from "./taste.js";

// The parts of the catalogue the chat and the concierge need on every message: each
// fragrance's 20-value vector and vote shares (recommend.ts) and every name, brand, and
// note (replyGuard.ts).
// The catalogue only changes when the pipeline reseeds it, so one copy in memory,
// refreshed hourly, beats reading 1,000 rows per chat message.

export type CatalogueEntry = {
  id: number;
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  dominantFamily: string;
  vector: number[]; // 14 family shares in ring order, then the 6 facets
  // The concierge's facts (SPEC section 9): vote shares from 0 to 1, and strength 1-4.
  seasons: Record<string, number>; // winter, spring, summer, autumn; they sum to 1
  daynight: Record<string, number>; // day, night; they sum to 1
  strength: number;
};

export type CatalogueSnapshot = {
  entries: CatalogueEntry[];
  brandAliases: string[];
  noteNames: string[];
};

const REFRESH_MS = 60 * 60 * 1000;

export function createCatalogueCache(db: Db, now: () => number = Date.now) {
  let snapshot: Promise<CatalogueSnapshot> | null = null;
  let loadedAt = 0;

  // Concurrent callers share one load. A failed load is forgotten, so the next
  // message tries again instead of failing until the hour is up.
  function get(): Promise<CatalogueSnapshot> {
    if (snapshot && now() - loadedAt < REFRESH_MS) return snapshot;
    loadedAt = now();
    snapshot = load(db).catch((err) => {
      snapshot = null;
      throw err;
    });
    return snapshot;
  }

  return { get };
}

export type CatalogueCache = ReturnType<typeof createCatalogueCache>;

async function load(db: Db): Promise<CatalogueSnapshot> {
  const fragrances = await db.query(
    `SELECT f.id, f.slug, f.name, f.brand, f.image_url, f.profile, f.facets, f.seasons, f.daynight, f.strength,
            fam.name AS family
       FROM fragrances f
       JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
      ORDER BY f.id`,
  );
  const aliases = await db.query("SELECT DISTINCT alias FROM brand_aliases");
  const notes = await db.query("SELECT name FROM notes");
  return {
    entries: fragrances.rows.map(entryOf),
    brandAliases: aliases.rows.map((r) => r.alias as string),
    noteNames: notes.rows.map((r) => r.name as string),
  };
}

function entryOf(r: Record<string, unknown>): CatalogueEntry {
  const facets = r.facets as Record<string, number>;
  return {
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    brand: r.brand as string,
    imageUrl: (r.image_url as string | null) ?? null,
    dominantFamily: r.family as string,
    vector: [...(r.profile as number[]), ...FACET_NAMES.map((name) => facets[name] ?? 0)],
    seasons: r.seasons as Record<string, number>,
    daynight: r.daynight as Record<string, number>,
    strength: r.strength as number,
  };
}
