import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { priceOf, valueOf, type PriceSettings } from "../services/price.js";
import { GOALS, rankNotes, type Matrices, type NoteProfile } from "../services/scoring.js";
import { dominantFamilyId } from "../services/sql.js";
import { PAGE_SIZE } from "./fragrances.js";

const goalSchema = z.enum(GOALS);
const MAX_INPUT_NOTES = 10;
// One id per bottle in the catalogue (1,000 today), with room to grow. A guest cannot own more bottles than exist.
const MAX_OWNED_IDS = 2000;

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
  .pipe(z.array(wholeId).max(MAX_OWNED_IDS));

// z.coerce.boolean() would turn the string "false" into true, so spell the values out.
const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((text) => text === "true");

const listQuery = z.object({
  goal: goalSchema,
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  owned: ownedIds,
  ownedOnly: flag,
});

const rankQuery = z.object({ goal: goalSchema });
const slugParam = z.string().min(1).max(200);
const listParams = z.object({ slug: slugParam });
const rankParams = z.object({ slug: slugParam, partnerSlug: slugParam });

const round1 = (n: number) => Math.round(n * 10) / 10;

export function pairingRouter(db: Db, matrices: Matrices, price: PriceSettings): Router {
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
      score: round1(r.score as number),
      dominantFamily: familyNames[r.dominantFamilyIndex],
    }));
    res.json({ goal, inputs: inputs.map((n) => n.name), total: results.length, results });
  });

  router.get("/pairing/fragrances/:slug", async (req, res) => {
    const { slug } = parseInput(listParams, req.params);
    const { goal, page, owned, ownedOnly } = parseInput(listQuery, req.query);
    const base = await findFragrance(db, slug);
    const ownedSet = new Set(owned);

    // "Owned only" filters in SQL, so it covers the whole ranked list, not just the
    // pages the browser has loaded (DECISIONS B21). Ranks stay the full-list ranks.
    const onlyIds = ownedOnly ? owned : null;
    const total = await listSize(db, base.id, goal);
    const matching = ownedOnly ? await ownedListSize(db, base.id, goal, owned) : total;
    const { rows } = await db.query(
      `SELECT ps.rank, ps.score, p.id, p.slug, p.name, p.brand, p.image_url,
              p.price_tier, p.value_score, p.value_votes, fam.name AS family
         FROM pair_scores ps
         JOIN fragrances p ON p.id = ps.partner_id
         JOIN families fam ON fam.id = ${dominantFamilyId("p.profile")}
        WHERE ps.base_id = $1 AND ps.goal = $2
          AND ($4::int[] IS NULL OR ps.partner_id = ANY($4))
        ORDER BY ps.rank
        LIMIT ${PAGE_SIZE} OFFSET $3`,
      [base.id, goal, (page - 1) * PAGE_SIZE, onlyIds],
    );
    res.json({
      base: { id: base.id, slug: base.slug, name: base.name, brand: base.brand, dominantFamily: base.family },
      goal,
      page,
      pageSize: PAGE_SIZE,
      // total is always the whole list ("of 214"); matching is what this filter returns.
      total,
      matching,
      totalPages: Math.ceil(matching / PAGE_SIZE),
      items: rows.map((r) => partnerItem(r, ownedSet, price)),
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

function partnerItem(r: Record<string, unknown>, ownedSet: Set<number>, price: PriceSettings) {
  return {
    id: r.id,
    rank: r.rank,
    score: round1(r.score as number),
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    imageUrl: r.image_url,
    dominantFamily: r.family,
    price: priceOf(r.price_tier, price),
    value: valueOf(r.value_score, r.value_votes, price),
    owned: ownedSet.has(r.id as number),
  };
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

// The real size of this base's list: every other fragrance for Enhance, fewer for Soften.
async function listSize(db: Db, baseId: number, goal: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS total FROM pair_scores WHERE base_id = $1 AND goal = $2",
    [baseId, goal],
  );
  return rows[0].total;
}

// How many of the guest's owned bottles appear in this base's list. Soften leaves out
// partners as harsh as the base, so an owned bottle can be missing from it.
async function ownedListSize(db: Db, baseId: number, goal: string, owned: number[]): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS total FROM pair_scores WHERE base_id = $1 AND goal = $2 AND partner_id = ANY($3)",
    [baseId, goal, owned],
  );
  return rows[0].total;
}

async function loadFamilyNames(db: Db): Promise<string[]> {
  const { rows } = await db.query("SELECT name FROM families ORDER BY id");
  return rows.map((r) => r.name);
}

// The mapped notes are a short list (167 today): cheap enough to read on every request (see DECISIONS #21).
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
