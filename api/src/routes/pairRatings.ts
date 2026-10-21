import { Router } from "express";
import { z } from "zod";
import type { AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { requireUser, userIdOf } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { byUser, createLimiter, rateLimit } from "../middleware/rateLimit.js";
import { parseInput } from "../middleware/validate.js";

// Pair ratings (SPEC section 7, M8): how well a layering pair worked for one user, for
// one goal. Stored only. Nothing reads them into a score (decision 11); they are the
// dataset for a later learning step (DECISIONS B30). One rating per user, base, partner,
// and goal (the table's primary key), so rating again replaces the old one.

const GOALS = ["enhance", "soften"] as const;
const id = z.coerce.number().int().positive();

const putBody = z
  .object({ baseId: id, partnerId: id, goal: z.enum(GOALS), stars: z.number().int().min(1).max(5) })
  .refine((body) => body.baseId !== body.partnerId, "a fragrance is not its own partner");

// The ratings for one result list: one base and one goal, the way the pairing page asks.
const listQuery = z.object({ baseId: id, goal: z.enum(GOALS) });

const FOREIGN_KEY_VIOLATION = "23503";

export function pairRatingsRouter(db: Db, settings: AuthSettings, now: () => number = Date.now): Router {
  const router = Router();
  router.use("/pair-ratings", requireUser(settings));
  const limit = rateLimit(createLimiter(settings.pairRatingLimit, now), byUser);

  // SPEC section 7 lists PUT only; this GET is what lets a card show the user's own
  // rating when they come back (DECISIONS B33).
  router.get("/pair-ratings", async (req, res) => {
    const { baseId, goal } = parseInput(listQuery, req.query);
    const { rows } = await db.query(
      `SELECT partner_id, stars FROM pair_ratings
        WHERE user_id = $1 AND base_id = $2 AND goal = $3
        ORDER BY partner_id`,
      [userIdOf(res), baseId, goal],
    );
    res.json({ baseId, goal, items: rows.map((r) => ({ partnerId: r.partner_id, stars: r.stars })) });
  });

  router.put("/pair-ratings", limit, async (req, res) => {
    const body = parseInput(putBody, req.body);
    try {
      await db.query(
        `INSERT INTO pair_ratings (user_id, base_id, partner_id, goal, stars) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, base_id, partner_id, goal)
         DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
        [userIdOf(res), body.baseId, body.partnerId, body.goal, body.stars],
      );
    } catch (err) {
      if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        throw new ApiError(404, "not_found", "No such fragrance.");
      }
      throw err;
    }
    res.json(body);
  });

  return router;
}
