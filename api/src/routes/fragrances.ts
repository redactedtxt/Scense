import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { dominantFamilyId } from "../services/sql.js";

export const PAGE_SIZE = 24;
const GENDERS = ["male", "female", "unisex"] as const;

const listQuery = z.object({
  q: z.string().trim().max(100).default(""),
  gender: z.enum(GENDERS).optional(),
  family: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const slugParams = z.object({ slug: z.string().min(1).max(200) });

// "cool wat" -> "cool:* & wat:*", so typing half a word still finds it. Only letters
// and digits survive, which also keeps user text from breaking tsquery syntax.
// 'simple' must match the config load.py used to build search_vector.
export function toPrefixQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((w) => `${w}:*`).join(" & ") : null;
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

export function fragrancesRouter(db: Db): Router {
  const router = Router();

  router.get("/fragrances", async (req, res) => {
    const query = parseInput(listQuery, req.query);
    const familyId = query.family ? await findFamilyId(db, query.family) : null;
    const filters = [toPrefixQuery(query.q), query.gender ?? null, familyId];
    // Each filter switches itself off when its value is null.
    const from = `FROM fragrances f
         JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
        WHERE ($1::text IS NULL OR f.search_vector @@ to_tsquery('simple', $1))
          AND ($2::text IS NULL OR f.gender = $2)
          AND ($3::int IS NULL OR fam.id = $3)`;

    const count = await db.query(`SELECT count(*)::int AS total ${from}`, filters);
    const total: number = count.rows[0].total;
    const { rows } = await db.query(
      `SELECT f.id, f.slug, f.name, f.brand, f.gender, f.release_year, f.image_url,
              f.community_rating, f.rating_votes, f.strength, fam.name AS family
         ${from}
        ORDER BY f.rating_votes DESC, f.id
        LIMIT ${PAGE_SIZE} OFFSET $4`,
      [...filters, (query.page - 1) * PAGE_SIZE],
    );
    res.json({
      items: rows.map(summary),
      page: query.page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
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

function groupByLayer(rows: { layer: string; name: string; mapped: boolean }[]) {
  const layers: Record<string, { name: string; mapped: boolean }[]> = { top: [], heart: [], base: [], flat: [] };
  for (const r of rows) layers[r.layer]!.push({ name: r.name, mapped: r.mapped });
  return layers;
}
