import { Router } from "express";
import { z } from "zod";
import type { AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { requireUser, userIdOf } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { importProfile } from "../services/profileStore.js";
import { dominantFamilyId } from "../services/sql.js";
import { completeProfile, profileInput } from "../services/taste.js";

// A signed-in user's Own and Want lists (SPEC section 7; moved from M8 into M7, see
// DECISIONS B31). Each fragrance is in at most one list, like the guest store: the
// table's primary key is (user_id, fragrance_id) and `status` says which list.

const STATUSES = ["own", "want"] as const;
// More ids than the catalogue holds would mean a broken client, not a big collection.
const MAX_IMPORT = 2000;

const idParams = z.object({ fragranceId: z.coerce.number().int().positive() });
const putBody = z.object({ status: z.enum(STATUSES) });
const importBody = z.object({
  items: z
    .array(
      z.object({
        fragranceId: z.number().int().positive(),
        status: z.enum(STATUSES),
        // The time the guest saved it, so /me keeps the guest's newest-first order.
        addedAt: z.iso.datetime().optional(),
      }),
    )
    .max(MAX_IMPORT),
  // The guest's taste profile from the chatbot (M9). It only fills an empty account
  // profile; an account that already has one keeps it.
  tasteProfile: profileInput.nullable().optional(),
});

// The same fields the guest store keeps per bottle, so /me draws both from one shape.
const ITEM_SQL = `
  SELECT f.id, f.slug, f.name, f.brand, f.image_url, fam.name AS family, c.status, c.added_at
    FROM collection c
    JOIN fragrances f ON f.id = c.fragrance_id
    JOIN families fam ON fam.id = ${dominantFamilyId("f.profile")}
   WHERE c.user_id = $1`;

function item(r: Record<string, unknown>) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    imageUrl: r.image_url,
    dominantFamily: r.family,
    status: r.status,
    addedAt: new Date(r.added_at as string).toISOString(),
  };
}

// Foreign key violation: the fragrance id does not exist.
const FOREIGN_KEY_VIOLATION = "23503";

export function collectionRouter(db: Db, settings: AuthSettings): Router {
  const router = Router();
  router.use("/collection", requireUser(settings));

  router.get("/collection", async (_req, res) => {
    const { rows } = await db.query(`${ITEM_SQL} ORDER BY c.added_at DESC, f.id`, [userIdOf(res)]);
    res.json({ items: rows.map(item) });
  });

  // Must come before "/collection/:fragranceId", or "import" would be read as an id.
  router.post("/collection/import", async (req, res) => {
    const body = parseInput(importBody, req.body);
    const imported = await importItems(db, userIdOf(res), body.items);
    const tasteProfile = body.tasteProfile
      ? await importProfile(db, userIdOf(res), completeProfile(body.tasteProfile))
      : "none";
    res.json({ imported, skipped: body.items.length - imported, tasteProfile });
  });

  router.get("/collection/:fragranceId", async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    const { rows } = await db.query(`${ITEM_SQL} AND c.fragrance_id = $2`, [userIdOf(res), fragranceId]);
    res.json({ fragranceId, status: rows[0]?.status ?? null });
  });

  // Saves or moves the bottle; the response is the saved row in the GET list's shape.
  router.put("/collection/:fragranceId", async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    const { status } = parseInput(putBody, req.body);
    try {
      await db.query(
        `INSERT INTO collection (user_id, fragrance_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, fragrance_id) DO UPDATE SET status = EXCLUDED.status, added_at = now()`,
        [userIdOf(res), fragranceId, status],
      );
    } catch (err) {
      if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new ApiError(404, "not_found", "No such fragrance.");
      }
      throw err;
    }
    const { rows } = await db.query(`${ITEM_SQL} AND c.fragrance_id = $2`, [userIdOf(res), fragranceId]);
    res.json(item(rows[0]));
  });

  router.delete("/collection/:fragranceId", async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    await db.query("DELETE FROM collection WHERE user_id = $1 AND fragrance_id = $2", [userIdOf(res), fragranceId]);
    res.status(204).end();
  });

  return router;
}

type ImportItem = z.infer<typeof importBody>["items"][number];

// One INSERT for the whole guest list. Rules (DECISIONS B31):
//  - a bottle already in the account keeps the account's status (ON CONFLICT DO NOTHING);
//  - an id that is not in the catalogue is skipped (the JOIN drops it);
//  - a saved time in the future is clamped to now;
//  - the same bottle twice in one list: the first entry wins. DISTINCT ON picks it by
//    its position in the list (ORDINALITY). Without it the winner depended on the order
//    the JOIN happened to return rows in, which changes with the query plan (M11 found
//    this when the test catalogue's smaller table got a different plan).
// Returns how many rows were added.
async function importItems(db: Db, userId: number, items: ImportItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const { rows } = await db.query(
    `INSERT INTO collection (user_id, fragrance_id, status, added_at)
     SELECT DISTINCT ON (i.fragrance_id) $1::int, i.fragrance_id, i.status, LEAST(coalesce(i.added_at, now()), now())
       FROM unnest($2::int[], $3::text[], $4::timestamptz[]) WITH ORDINALITY AS i(fragrance_id, status, added_at, position)
       JOIN fragrances f ON f.id = i.fragrance_id
      ORDER BY i.fragrance_id, i.position
     ON CONFLICT (user_id, fragrance_id) DO NOTHING
     RETURNING fragrance_id`,
    [userId, items.map((i) => i.fragranceId), items.map((i) => i.status), items.map((i) => i.addedAt ?? null)],
  );
  return rows.length;
}
