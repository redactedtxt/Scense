import { Router } from "express";
import { z } from "zod";
import type { AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { optionalUser, requireUser, userIdOf } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { byUser, createLimiter, rateLimit } from "../middleware/rateLimit.js";
import { parseInput } from "../middleware/validate.js";

// Written reviews (SPEC section 7, M8). Anyone can read them; only a signed-in user can
// write, and only one per fragrance (the table's UNIQUE (user_id, fragrance_id)). PUT and
// DELETE need no review id: they act on the caller's own review of that fragrance.
//
// The body is stored exactly as typed. It is never turned into HTML on the server or in
// the browser: React puts it on the page as text, so "<script>" shows up as those
// characters and never runs (DECISIONS B33).

export const REVIEWS_PAGE_SIZE = 10;
export const MAX_REVIEW_CHARS = 2000;

const idParams = z.object({ fragranceId: z.coerce.number().int().positive() });
const listQuery = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) });

// Postgres's char_length counts characters (code points); JavaScript's .length counts
// UTF-16 units, so an emoji is 2 there and 1 here. Counting with the spread operator
// matches the database, so a 2,000-character review with emoji isn't wrongly refused.
const reviewBody = z.object({
  stars: z.number().int().min(1).max(5),
  body: z
    .string()
    .trim()
    .min(1, "write a few words")
    .refine((text) => [...text].length <= MAX_REVIEW_CHARS, `use at most ${MAX_REVIEW_CHARS} characters`)
    // Postgres text can't hold a NUL byte; refuse it here instead of failing with a 500.
    .refine((text) => !text.includes("\0"), "remove the NUL character"),
});

// Selected from a row source `r` (the reviews table, or a CTE returning its columns).
const REVIEW_COLUMNS = "r.id, r.user_id, r.stars, r.body, r.created_at, r.updated_at, u.display_name";

function review(row: Record<string, unknown>, viewerId: number | null) {
  return {
    id: row.id,
    stars: row.stars,
    body: row.body,
    authorName: row.display_name,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    mine: viewerId !== null && row.user_id === viewerId,
  };
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

export function reviewsRouter(db: Db, settings: AuthSettings, now: () => number = Date.now): Router {
  const router = Router();
  const path = "/fragrances/:fragranceId/reviews";
  // requireUser runs first, so the limiter can count per user. It runs before
  // validation, so a script sending malformed reviews is counted too.
  const writer = [requireUser(settings), rateLimit(createLimiter(settings.reviewLimit, now), byUser)];

  router.get(path, optionalUser(settings), async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    const { page } = parseInput(listQuery, req.query);
    res.json(await listReviews(db, fragranceId, page, res.locals.userId as number | null));
  });

  router.post(path, ...writer, async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    const input = parseInput(reviewBody, req.body);
    const row = await insertReview(db, userIdOf(res), fragranceId, input);
    res.status(201).json(review(row, userIdOf(res)));
  });

  router.put(path, ...writer, async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    const input = parseInput(reviewBody, req.body);
    const { rows } = await db.query(
      `WITH r AS (
         UPDATE reviews SET stars = $3, body = $4, updated_at = now()
          WHERE user_id = $1 AND fragrance_id = $2
         RETURNING *)
       SELECT ${REVIEW_COLUMNS} FROM r JOIN users u ON u.id = r.user_id`,
      [userIdOf(res), fragranceId, input.stars, input.body],
    );
    if (!rows[0]) throw new ApiError(404, "no_review", "You have not reviewed this fragrance yet.");
    res.json(review(rows[0], userIdOf(res)));
  });

  // Deleting a review that isn't there is still a success: the end state is the same.
  router.delete(path, ...writer, async (req, res) => {
    const { fragranceId } = parseInput(idParams, req.params);
    await db.query("DELETE FROM reviews WHERE user_id = $1 AND fragrance_id = $2", [userIdOf(res), fragranceId]);
    res.status(204).end();
  });

  return router;
}

// One page of a fragrance's reviews, newest first, plus the viewer's own review wherever
// it falls in the list, so the page can offer Edit without paging to find it.
async function listReviews(db: Db, fragranceId: number, page: number, viewerId: number | null) {
  const counts = await db.query(
    `SELECT EXISTS (SELECT 1 FROM fragrances WHERE id = $1) AS found,
            (SELECT count(*)::int FROM reviews WHERE fragrance_id = $1) AS total`,
    [fragranceId],
  );
  if (!counts.rows[0]?.found) throw new ApiError(404, "not_found", "No such fragrance.");
  const total = counts.rows[0].total as number;
  const { rows } = await db.query(
    `SELECT ${REVIEW_COLUMNS} FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.fragrance_id = $1
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${REVIEWS_PAGE_SIZE} OFFSET $2`,
    [fragranceId, (page - 1) * REVIEWS_PAGE_SIZE],
  );
  const mine = viewerId === null ? [] : (await db.query(
    `SELECT ${REVIEW_COLUMNS} FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.fragrance_id = $1 AND r.user_id = $2`,
    [fragranceId, viewerId],
  )).rows;
  return {
    items: rows.map((row) => review(row, viewerId)),
    mine: mine[0] ? review(mine[0], viewerId) : null,
    page,
    pageSize: REVIEWS_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / REVIEWS_PAGE_SIZE),
  };
}

type ReviewInput = z.infer<typeof reviewBody>;

// A second review of the same bottle is a 409, so the client knows to edit instead.
async function insertReview(db: Db, userId: number, fragranceId: number, input: ReviewInput) {
  try {
    const { rows } = await db.query(
      `WITH r AS (
         INSERT INTO reviews (user_id, fragrance_id, stars, body) VALUES ($1, $2, $3, $4)
         RETURNING *)
       SELECT ${REVIEW_COLUMNS} FROM r JOIN users u ON u.id = r.user_id`,
      [userId, fragranceId, input.stars, input.body],
    );
    return rows[0] as Record<string, unknown>;
  } catch (err) {
    if (errorCode(err) === UNIQUE_VIOLATION) {
      throw new ApiError(409, "review_exists", "You have already reviewed this fragrance. Edit your review instead.");
    }
    if (errorCode(err) === FOREIGN_KEY_VIOLATION) throw new ApiError(404, "not_found", "No such fragrance.");
    throw err;
  }
}
