import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { GOALS, rankNotes, type Matrices, type NoteProfile } from "../services/scoring.js";
import { dominantFamilyId } from "../services/sql.js";
import { PAGE_SIZE } from "./fragrances.js";

const goalSchema = z.enum(GOALS);
const MAX_INPUT_NOTES = 10;

const notesBody = z.object({
  notes: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_INPUT_NOTES),
  goal: goalSchema,
});

// "owned" arrives as "3,17,42". A bad id is a 400, not a silently ignored one.
const wholeId = z.string().regex(/^[1-9]\d*$/, "must be a comma-separated list of ids").transform(Number);
const ownedIds = z
  .string()
  .default("")
  .transform((text) => (text === "" ? [] : text.split(",")))
  .pipe(z.array(wholeId).max(300));

const listQuery = z.object({
  goal: goalSchema,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  owned: ownedIds,
});

const rankQuery = z.object({ goal: goalSchema });
const slugParam = z.string().min(1).max(200);
const listParams = z.object({ slug: slugParam });
const rankParams = z.object({ slug: slugParam, partnerSlug: slugParam });

const round1 = (n: number) => Math.round(n * 10) / 10;

export function pairingRouter(db: Db, matrices: Matrices): Router {
  const router = Router();

  // Notes use MAPPED notes only: an unmapped note has no wheel profile to score.
  router.post("/pairing/notes", async (req, res) => {
    const { notes, goal } = parseInput(notesBody, req.body);
    const mapped = await loadMappedNotes(db);
    const inputs = await resolveInputs(db, notes, mapped);
    const familyNames = await loadFamilyNames(db);

    const results = rankNotes(inputs, mapped, goal, matrices).map((r) => ({
      note: r.name,
      rank: r.rank,
      score: round1(r.score),
      dominantFamily: familyNames[r.dominantFamilyIndex],
    }));
    res.json({ goal, inputs: inputs.map((n) => n.name), total: results.length, results });
  });

  router.get("/pairing/fragrances/:slug", async (req, res) => {
    const { slug } = parseInput(listParams, req.params);
    const { goal, page, owned } = parseInput(listQuery, req.query);
    const base = await findFragrance(db, slug);
    const ownedSet = new Set(owned);

    const total = await listSize(db, base.id, goal);
    const { rows } = await db.query(
      `SELECT ps.rank, ps.score, p.id, p.slug, p.name, p.brand, p.image_url, fam.name AS family
         FROM pair_scores ps
         JOIN fragrances p ON p.id = ps.partner_id
         JOIN families fam ON fam.id = ${dominantFamilyId("p.profile")}
        WHERE ps.base_id = $1 AND ps.goal = $2
        ORDER BY ps.rank
        LIMIT ${PAGE_SIZE} OFFSET $3`,
      [base.id, goal, (page - 1) * PAGE_SIZE],
    );
    res.json({
      base: { slug: base.slug, name: base.name, brand: base.brand, dominantFamily: base.family },
      goal,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
      items: rows.map((r) => ({
        rank: r.rank,
        score: round1(r.score),
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        imageUrl: r.image_url,
        dominantFamily: r.family,
        owned: ownedSet.has(r.id),
      })),
    });
  });

  router.get("/pairing/fragrances/:slug/rank/:partnerSlug", async (req, res) => {
    const { slug, partnerSlug } = parseInput(rankParams, req.params);
    const { goal } = parseInput(rankQuery, req.query);
    if (slug === partnerSlug) {
      throw new ApiError(400, "same_fragrance", "A fragrance cannot be paired with itself.");
    }
    const base = await findFragrance(db, slug);
    const partner = await findFragrance(db, partnerSlug);
    const total = await listSize(db, base.id, goal);

    const { rows } = await db.query(
      "SELECT rank, score FROM pair_scores WHERE base_id = $1 AND goal = $2 AND partner_id = $3",
      [base.id, goal, partner.id],
    );
    // Soften drops partners that are as harsh or harsher than the base. That is an
    // answer ("too harsh"), not a missing rank or a 404.
    if (!rows[0]) {
      res.json({ status: "too_harsh", total });
      return;
    }
    res.json({ status: "ranked", rank: rows[0].rank, total, score: round1(rows[0].score) });
  });

  return router;
}

async function findFragrance(db: Db, slug: string) {
  const { rows } = await db.query(
    `SELECT f.id, f.slug, f.name, f.brand, fam.name AS family
       FROM fragrances f JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
      WHERE f.slug = $1`,
    [slug],
  );
  if (!rows[0]) throw new ApiError(404, "not_found", `No fragrance with slug "${slug}".`);
  return rows[0];
}

// The real size of this base's list: 299 for Enhance, fewer for Soften.
async function listSize(db: Db, baseId: number, goal: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS total FROM pair_scores WHERE base_id = $1 AND goal = $2",
    [baseId, goal],
  );
  return rows[0].total;
}

async function loadFamilyNames(db: Db): Promise<string[]> {
  const { rows } = await db.query("SELECT name FROM families ORDER BY id");
  return rows.map((r) => r.name);
}

// 150 mapped notes: cheap enough to read on every request (see DECISIONS #21).
async function loadMappedNotes(db: Db): Promise<NoteProfile[]> {
  const { rows } = await db.query("SELECT name, profile, harshness FROM notes WHERE mapped ORDER BY name");
  return rows.map((r) => ({ name: r.name, profile: r.profile, harshness: r.harshness }));
}

// Match typed names to mapped notes, ignoring case. A name that fails gets one of two
// errors so the client can tell "typo" (unknown_note) from "real note, but it has no
// wheel profile and cannot be paired" (unmapped_note).
async function resolveInputs(db: Db, typed: string[], mapped: NoteProfile[]): Promise<NoteProfile[]> {
  const byName = new Map(mapped.map((n) => [n.name.toLowerCase(), n]));
  const picked = new Map<string, NoteProfile>();
  for (const name of typed) {
    const note = byName.get(name.toLowerCase());
    if (!note) throw await missingNoteError(db, name);
    picked.set(note.name, note); // typing the same note twice counts once
  }
  return [...picked.values()];
}

async function missingNoteError(db: Db, name: string): Promise<ApiError> {
  const { rows } = await db.query("SELECT 1 FROM notes WHERE lower(name) = lower($1)", [name]);
  return rows[0]
    ? new ApiError(400, "unmapped_note", `"${name}" is not a mapped note, so it cannot be paired.`)
    : new ApiError(400, "unknown_note", `"${name}" is not a note in the catalogue.`);
}
