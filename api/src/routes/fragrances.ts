import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { orderByClause, SORTS, type CatalogueSettings } from "../services/catalogue.js";
import { dominantFamilyId } from "../services/sql.js";

export const PAGE_SIZE = 24;
const GENDERS = ["male", "female", "unisex"] as const;

const listQuery = z.object({
  q: z.string().trim().max(100).default(""),
  gender: z.enum(GENDERS).optional(),
  family: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  sort: z.enum(SORTS).default(SORTS[0]),
});

const slugParams = z.object({ slug: z.string().min(1).max(200) });

const WORD = /[\p{L}\p{N}]+/gu;
// Most words the typo fallback compares, so a pasted paragraph cannot make the query heavy.
const MAX_FUZZY_WORDS = 6;

// "cool wat" -> "cool:* & wat:*", so typing half a word still finds it. Only letters
// and digits survive, which also keeps user text from breaking tsquery syntax.
// A chunk with punctuation inside, such as "d&g", becomes a phrase ("d <-> g"): load.py
// puts the alias into the vector as the same adjacent words, and a phrase keeps "d&g"
// from matching every bottle that merely has a D word and a G word somewhere. Inside a
// phrase a one-letter word must match exactly, or "d:*" would match "di" in "Acqua di Giò".
// 'simple' must match the config load.py used to build search_vector, and the SQL
// unaccents this text because load.py unaccented the vector.
export function toPrefixQuery(text: string): string | null {
  const chunks = text.split(/\s+/).map((chunk) => chunk.match(WORD)).filter((words) => words !== null);
  if (chunks.length === 0) return null;
  const terms = chunks.map((words) => {
    const inPhrase = words.length > 1;
    const phrase = words.map((w) => (inPhrase && w.length === 1 ? w : `${w}:*`)).join(" <-> ");
    return inPhrase ? `(${phrase})` : phrase;
  });
  return terms.join(" & ");
}

// The words the typo fallback compares against the catalogue's words. One-letter words
// are left out: they can't be misspelled, and "angel's" would demand a word like "s".
export function searchWords(text: string): string[] {
  return (text.match(WORD) ?? []).filter((w) => w.length > 1).slice(0, MAX_FUZZY_WORDS);
}

function summary(r: Record<string, unknown>) {
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
  };
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
    const tsquery = toPrefixQuery(query.q);
    const filters = [tsquery, query.gender ?? null, familyId];
    const offset = (query.page - 1) * PAGE_SIZE;
    let list = await exactList(db, filters, orderByClause(query.sort, settings), offset);
    let fuzzy = false;

    // Full-text search found nothing for words that no bottle has: try near-misses.
    if (list.total === 0 && tsquery !== null && !(await anyTextMatch(db, tsquery))) {
      list = await fuzzyList(db, searchWords(query.q), filters.slice(1), offset, settings);
      fuzzy = true;
    }
    res.json({
      items: list.rows.map(summary),
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
        `SELECT fn.layer, n.name, n.mapped
           FROM fragrance_notes fn JOIN notes n ON n.id = fn.note_id
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
      ...summary(row),
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
              f.community_rating, f.rating_votes, f.strength, fam.name AS family`;

type Rows = Record<string, unknown>[];

// The normal search: a prefix text search plus the gender and family filters, ordered
// by the chosen sort. Each filter switches itself off when its value is null.
async function exactList(db: Db, filters: unknown[], order: string, offset: number) {
  const from = `FROM fragrances f
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE ($1::text IS NULL OR f.search_vector @@ to_tsquery('simple', unaccent($1)))
          AND ($2::text IS NULL OR f.gender = $2)
          AND ($3::int IS NULL OR fam.id = $3)`;
  const count = await db.query(`SELECT count(*)::int AS total ${from}`, filters);
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS} ${from} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET $4`,
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

// The typo fallback (DECISIONS B23). A bottle matches when EVERY typed word is close
// (pg_trgm similarity) to some word in its search vector: name, brand, and aliases.
// Results are ordered by total closeness, then votes. The catalogue is 300 rows, so
// comparing every word needs no index; revisit if it grows by orders of magnitude.
const FUZZY_MATCHED = `WITH scored AS (
    SELECT f.id, min(w.best) AS worst, sum(w.best) AS closeness
      FROM fragrances f
     CROSS JOIN LATERAL (
           SELECT (SELECT max(similarity(u.lexeme, unaccent(lower(word)))) FROM unnest(f.search_vector) u) AS best
             FROM unnest($1::text[]) AS word) w
     GROUP BY f.id
  )`;

async function fuzzyList(db: Db, words: string[], filters: unknown[], offset: number, settings: CatalogueSettings) {
  const from = `FROM scored s
         JOIN fragrances f ON f.id = s.id
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE s.worst >= $2
          AND ($3::text IS NULL OR f.gender = $3)
          AND ($4::int IS NULL OR fam.id = $4)`;
  const params = [words, settings.fuzzyMinSimilarity, ...filters];
  const count = await db.query(`${FUZZY_MATCHED} SELECT count(*)::int AS total ${from}`, params);
  const { rows } = await db.query(
    `${FUZZY_MATCHED} SELECT ${SUMMARY_COLUMNS} ${from}
      ORDER BY s.closeness DESC, f.rating_votes DESC NULLS LAST, f.id
      LIMIT ${PAGE_SIZE} OFFSET $5`,
    [...params, offset],
  );
  return { rows: rows as Rows, total: count.rows[0].total as number };
}

function groupByLayer(rows: { layer: string; name: string; mapped: boolean }[]) {
  const layers: Record<string, { name: string; mapped: boolean }[]> = { top: [], heart: [], base: [], flat: [] };
  for (const r of rows) layers[r.layer]!.push({ name: r.name, mapped: r.mapped });
  return layers;
}
