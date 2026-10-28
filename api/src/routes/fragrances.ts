import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { orderByClause, SORTS, type CatalogueSettings } from "../services/catalogue.js";
import { priceOf, valueOf, type PriceSettings } from "../services/price.js";
import { FUZZY_MATCHED, searchWords, toPrefixQuery } from "../services/search.js";
import { dominantFamilyId } from "../services/sql.js";

export const PAGE_SIZE = 24;
const GENDERS = ["male", "female", "unisex"] as const;

const listQuery = z.object({
  q: z.string().trim().max(100).default(""),
  gender: z.enum(GENDERS).optional(),
  family: z.string().trim().min(1).max(40).optional(),
  // A brand page (DECISIONS B42): the brand as the dataset spells it, or an alias (YSL).
  brand: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  sort: z.enum(SORTS).default(SORTS[0]),
});

const slugParams = z.object({ slug: z.string().min(1).max(200) });

function summary(r: Record<string, unknown>, price: PriceSettings) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    gender: r.gender,
    releaseYear: r.release_year,
    imageUrl: r.image_url,
    communityRating: r.community_rating,
    ratingVotes: r.rating_votes,
    strength: r.strength,
    dominantFamily: r.family,
    // Approximate tier and its band (never a price), and the value-for-money votes
    // (null under scoring.yaml's min_value_votes). DECISIONS B42.
    price: priceOf(r.price_tier, price),
    value: valueOf(r.value_score, r.value_votes, price),
  };
}

// The brand a brand page asked for, as the catalogue spells it: an exact brand (case and
// accents ignored, so "hermes" is Hermès) or a search alias from brand_aliases.csv ("YSL"
// is Yves Saint Laurent). One brand page for every spelling.
async function findBrand(db: Db, typed: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT brand FROM (
       SELECT DISTINCT f.brand, 0 AS how FROM fragrances f WHERE unaccent(lower(f.brand)) = unaccent(lower($1))
       UNION
       SELECT DISTINCT a.brand, 1 AS how FROM brand_aliases a
        WHERE unaccent(lower(a.alias)) = unaccent(lower($1))
          AND EXISTS (SELECT 1 FROM fragrances f WHERE f.brand = a.brand)
     ) AS found ORDER BY how, brand LIMIT 1`,
    [typed],
  );
  if (!rows[0]) throw new ApiError(404, "unknown_brand", `No brand called "${typed}" in the catalogue.`);
  return rows[0].brand as string;
}

async function findFamilyId(db: Db, name: string): Promise<number> {
  const { rows } = await db.query("SELECT id FROM families WHERE lower(name) = lower($1)", [name]);
  if (!rows[0]) throw new ApiError(400, "invalid_request", `family: unknown family "${name}"`);
  return rows[0].id;
}

export function fragrancesRouter(db: Db, settings: CatalogueSettings): Router {
  const router = Router();

  router.get("/fragrances", async (req, res) => {
    const query = parseInput(listQuery, req.query);
    const familyId = query.family ? await findFamilyId(db, query.family) : null;
    const brand = query.brand ? await findBrand(db, query.brand) : null;
    const tsquery = toPrefixQuery(query.q);
    const filters = [tsquery, query.gender ?? null, familyId, brand];
    const offset = (query.page - 1) * PAGE_SIZE;
    let list = await exactList(db, filters, orderByClause(query.sort, settings), offset);
    let fuzzy = false;

    // Full-text search found nothing for words that no bottle has: try near-misses.
    if (list.total === 0 && tsquery !== null && !(await anyTextMatch(db, tsquery))) {
      list = await fuzzyList(db, searchWords(query.q), filters.slice(1), offset, settings);
      fuzzy = true;
    }
    res.json({
      items: list.rows.map((row) => summary(row, settings.price)),
      // The brand page's heading: the brand as the catalogue spells it, or null.
      brand,
      page: query.page,
      pageSize: PAGE_SIZE,
      total: list.total,
      totalPages: Math.ceil(list.total / PAGE_SIZE),
      // True when these are close matches for the text, ordered by closeness (not by `sort`).
      fuzzy,
    });
  });

  router.get("/fragrances/:slug", async (req, res) => {
    const { slug } = parseInput(slugParams, req.params);
    const found = await db.query(
      `SELECT f.*, fam.name AS family
         FROM fragrances f
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE f.slug = $1`,
      [slug],
    );
    const row = found.rows[0];
    if (!row) throw new ApiError(404, "not_found", "No fragrance with that slug.");

    const [families, notes, accords] = await Promise.all([
      db.query("SELECT id, name FROM families ORDER BY id"),
      db.query(
        `SELECT fn.layer, n.name, n.mapped, n.image_url, fam.name AS family
           FROM fragrance_notes fn JOIN notes n ON n.id = fn.note_id
           LEFT JOIN families fam ON n.mapped AND fam.id = ${dominantFamilyId("n.profile")}
          WHERE fn.fragrance_id = $1
          ORDER BY n.name`,
        [row.id],
      ),
      db.query(
        "SELECT accord, strength FROM fragrance_accords WHERE fragrance_id = $1 ORDER BY strength DESC, accord",
        [row.id],
      ),
    ]);

    res.json({
      ...summary(row, settings.price),
      harshness: row.harshness,
      // All 14 shares in ring order, ready for the wheel chart.
      familyProfile: families.rows.map((f) => ({ id: f.id, name: f.name, share: row.profile[f.id] })),
      facets: row.facets,
      seasons: row.seasons,
      daynight: row.daynight,
      // Unmapped notes are included: they have no wheel profile but belong in the pyramid.
      notes: groupByLayer(notes.rows),
      accords: accords.rows.map((a) => ({ accord: a.accord, strength: a.strength })),
    });
  });

  return router;
}

const SUMMARY_COLUMNS = `f.id, f.slug, f.name, f.brand, f.gender, f.release_year, f.image_url,
              f.community_rating, f.rating_votes, f.strength, f.price_tier, f.value_score,
              f.value_votes, fam.name AS family`;

type Rows = Record<string, unknown>[];

// The normal search: a prefix text search plus the gender, family, and brand filters,
// ordered by the chosen sort. Each filter switches itself off when its value is null.
async function exactList(db: Db, filters: unknown[], order: string, offset: number) {
  const from = `FROM fragrances f
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE ($1::text IS NULL OR f.search_vector @@ to_tsquery('simple', unaccent($1)))
          AND ($2::text IS NULL OR f.gender = $2)
          AND ($3::int IS NULL OR fam.id = $3)
          AND ($4::text IS NULL OR f.brand = $4)`;
  const count = await db.query(`SELECT count(*)::int AS total ${from}`, filters);
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS} ${from} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET $5`,
    [...filters, offset],
  );
  return { rows: rows as Rows, total: count.rows[0].total as number };
}

// Does the text match any bottle at all, ignoring gender and family? If it does, an
// empty list means the filters excluded everything, and a typo search would be wrong.
async function anyTextMatch(db: Db, tsquery: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT EXISTS (SELECT 1 FROM fragrances f WHERE f.search_vector @@ to_tsquery('simple', unaccent($1))) AS found",
    [tsquery],
  );
  return rows[0].found === true;
}

async function fuzzyList(db: Db, words: string[], filters: unknown[], offset: number, settings: CatalogueSettings) {
  const from = `FROM scored s
         JOIN fragrances f ON f.id = s.id
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE s.worst >= $2
          AND ($3::text IS NULL OR f.gender = $3)
          AND ($4::int IS NULL OR fam.id = $4)
          AND ($5::text IS NULL OR f.brand = $5)`;
  const params = [words, settings.fuzzyMinSimilarity, ...filters];
  const count = await db.query(`${FUZZY_MATCHED} SELECT count(*)::int AS total ${from}`, params);
  const { rows } = await db.query(
    `${FUZZY_MATCHED} SELECT ${SUMMARY_COLUMNS} ${from}
      ORDER BY s.closeness DESC, f.rating_votes DESC NULLS LAST, f.id
      LIMIT ${PAGE_SIZE} OFFSET $6`,
    [...params, offset],
  );
  return { rows: rows as Rows, total: count.rows[0].total as number };
}

type NoteRow = { layer: string; name: string; mapped: boolean; image_url: string | null; family: string | null };

// Each note with its Fragrantica icon (null when the dataset has none) and its dominant
// family for the chip's tint (null for an unmapped note, which has no wheel profile).
function groupByLayer(rows: NoteRow[]) {
  type Note = { name: string; mapped: boolean; imageUrl: string | null; family: string | null };
  const layers: Record<string, Note[]> = { top: [], heart: [], base: [], flat: [] };
  for (const r of rows) {
    layers[r.layer]!.push({ name: r.name, mapped: r.mapped, imageUrl: r.image_url, family: r.family });
  }
  return layers;
}
