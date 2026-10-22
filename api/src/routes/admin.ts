import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AiSettings } from "../config.js";
import type { Db } from "../db.js";
import { ApiError } from "../middleware/errors.js";
import { parseInput } from "../middleware/validate.js";
import { torontoDay } from "../services/caps.js";

// GET /api/admin/usage (SPEC section 10): AI usage per day for Tejas, behind the
// ADMIN_TOKEN secret sent in an X-Admin-Token header. With no token configured the
// endpoint does not exist (404), so a forgotten secret can't leave it open.

const query = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

export function adminRouter(db: Db, ai: AiSettings, now: () => number = Date.now): Router {
  const router = Router();
  router.use("/admin", requireAdmin(ai.adminToken));

  router.get("/admin/usage", async (req, res) => {
    const { days } = parseInput(query, req.query);
    const today = torontoDay(now());
    // The last `days` days, and separately this calendar month (Toronto), which is what
    // Anthropic's monthly spend limit compares against.
    const perDay = (await usageByDay(db, "u.day > $1::date - $2::int", [today, days])).map((r) => withCost(r, ai));
    const month = (await usageByDay(db, "u.day >= date_trunc('month', $1::date)", [today])).map((r) => withCost(r, ai));
    res.json({
      model: ai.model,
      today,
      // Distinct guests per day, despite the name (kept for the existing secret).
      guestDailyConversationCap: ai.guestDailyConversationCap,
      pricesUsdPerMillionTokens: { input: ai.inputUsdPerMTok, output: ai.outputUsdPerMTok },
      monthToDate: total(month),
      days: perDay,
    });
  });

  return router;
}

// `where` is one of the two fixed strings above, never request text.
// Per day (DECISIONS B36): distinct visitors and distinct guests who used an AI feature
// (the guest cap counts the second), chats started, messages, and tokens. Chats started
// are counted from chat_conversations, so days older than CHAT_RETENTION_DAYS undercount
// as their chats are deleted; the other columns come from llm_usage, which keeps no text
// and is never purged.
async function usageByDay(db: Db, where: string, params: unknown[]) {
  const { rows } = await db.query(
    `SELECT u.day::text AS day,
            count(DISTINCT u.subject)::int AS visitors,
            count(DISTINCT u.subject) FILTER (WHERE u.subject LIKE 'guest:%')::int AS guests,
            (SELECT count(*) FROM chat_conversations c
              WHERE (c.created_at AT TIME ZONE 'America/Toronto')::date = u.day)::int AS chats_started,
            sum(u.user_messages)::int AS user_messages,
            sum(u.input_tokens)::bigint AS input_tokens,
            sum(u.output_tokens)::bigint AS output_tokens
       FROM llm_usage u
      WHERE ${where}
      GROUP BY u.day ORDER BY u.day DESC`,
    params,
  );
  return rows;
}

function withCost(r: Record<string, unknown>, ai: AiSettings) {
  const inputTokens = Number(r.input_tokens);
  const outputTokens = Number(r.output_tokens);
  return {
    day: r.day as string,
    visitors: r.visitors as number,
    guests: r.guests as number,
    chatsStarted: r.chats_started as number,
    userMessages: r.user_messages as number,
    inputTokens,
    outputTokens,
    estimatedUsd: cost(inputTokens, outputTokens, ai),
  };
}

type DayUsage = ReturnType<typeof withCost>;

function total(days: DayUsage[]) {
  const sum = (pick: (d: DayUsage) => number) => days.reduce((acc, d) => acc + pick(d), 0);
  return {
    // Visitors aren't summed: one person on three days is not three visitors.
    chatsStarted: sum((d) => d.chatsStarted),
    userMessages: sum((d) => d.userMessages),
    inputTokens: sum((d) => d.inputTokens),
    outputTokens: sum((d) => d.outputTokens),
    estimatedUsd: round(sum((d) => d.estimatedUsd)),
  };
}

// An estimate at list prices; Anthropic's console is the bill.
function cost(inputTokens: number, outputTokens: number, ai: AiSettings): number {
  return round((inputTokens * ai.inputUsdPerMTok + outputTokens * ai.outputUsdPerMTok) / 1_000_000);
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

// Compares hashes so the check takes the same time whatever the guess, and
// timingSafeEqual never sees two buffers of different lengths.
function requireAdmin(token: string): RequestHandler {
  const expected = createHash("sha256").update(token).digest();
  return (req, _res, next) => {
    if (token === "") return next(new ApiError(404, "not_found", "No such endpoint."));
    const given = createHash("sha256").update(req.get("X-Admin-Token") ?? "").digest();
    if (!timingSafeEqual(given, expected)) return next(new ApiError(401, "unauthorized", "Wrong or missing admin token."));
    next();
  };
}
