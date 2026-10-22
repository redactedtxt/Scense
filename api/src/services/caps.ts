import type { Db } from "../db.js";

// AI caps (SPEC section 10). One llm_usage row per subject, feature, and Toronto day is
// that day's message budget: user_messages counts the messages, across every chat the
// visitor has (DECISIONS B36), and the token columns the spend. The UNIQUE
// (subject, feature, day) key is what lets one statement claim a slot safely even when
// two messages, from the same chat or from two chats, arrive at once.

export type Feature = "chat" | "concierge";

export type CapSettings = { maxUserMessages: number; guestDailyConversationCap: number };

// 'user:<id>' or 'guest:<uuid>' (SPEC section 5). A signed-in visitor is always counted
// as their account, so signing out and back in doesn't reset anything.
export function subjectOf(userId: number | null, guestId: string | null): string | null {
  if (userId !== null) return `user:${userId}`;
  if (guestId !== null) return `guest:${guestId}`;
  return null;
}

const TORONTO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The cap day resets at midnight America/Toronto, whatever the server's own time zone.
// en-CA formats as YYYY-MM-DD, which Postgres reads as a DATE.
export function torontoDay(ms: number): string {
  return TORONTO_DATE.format(new Date(ms));
}

export type Reservation = { userMessages: number };
export type Refusal = "daily_limit" | "guest_cap";

// Claims the next message slot BEFORE the model is called, in one statement:
//  - no row yet today: create the budget with 1 message, unless the subject is a guest
//    who hasn't used any AI feature today and today's distinct guests already reached
//    the site-wide cap;
//  - a row: add 1, unless it already holds the maximum.
// Claiming first means two quick messages can't both slip in as message 8, whichever
// chats they were sent from.
//
// The site-wide cap counts guests, not chats or features: a guest already counted today
// (in any feature) never needs a second slot, so opening new chats costs nothing.
//
// Known gap: two brand-new guests in the same instant can both pass the site-wide count,
// so the backstop can overshoot by the number of simultaneous first messages.
export async function reserveMessage(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
  caps: CapSettings,
): Promise<Reservation | Refusal> {
  const isGuest = key.subject.startsWith("guest:");
  const { rows } = await db.query(
    `INSERT INTO llm_usage (subject, feature, day, user_messages)
     SELECT $1, $2, $3, 1
      WHERE NOT $4::boolean
         OR EXISTS (SELECT 1 FROM llm_usage WHERE subject = $1 AND day = $3)
         OR (SELECT count(DISTINCT subject) FROM llm_usage WHERE day = $3 AND subject LIKE 'guest:%') < $5
     ON CONFLICT (subject, feature, day) DO UPDATE
        SET user_messages = llm_usage.user_messages + 1
      WHERE llm_usage.user_messages < $6
     RETURNING user_messages`,
    [key.subject, key.feature, key.day, isGuest, caps.guestDailyConversationCap, caps.maxUserMessages],
  );
  const row = rows[0];
  if (row) return { userMessages: row.user_messages };
  // Nothing written: either today's budget is used up, or a new guest hit the cap.
  return (await todaysUsage(db, key)) ? "daily_limit" : "guest_cap";
}

// Gives the slot back when Anthropic could not be reached: the visitor shouldn't lose one
// of their 8 messages to our outage. A budget row left with no messages is deleted, so a
// guest whose only message failed no longer counts toward the guest cap either.
export async function refundMessage(db: Db, key: { subject: string; feature: Feature; day: string }): Promise<void> {
  await db.query(
    `UPDATE llm_usage SET user_messages = user_messages - 1
      WHERE subject = $1 AND feature = $2 AND day = $3 AND user_messages > 0`,
    [key.subject, key.feature, key.day],
  );
  await db.query(
    `DELETE FROM llm_usage
      WHERE subject = $1 AND feature = $2 AND day = $3 AND user_messages = 0
        AND input_tokens = 0 AND output_tokens = 0`,
    [key.subject, key.feature, key.day],
  );
}

// Every call's tokens, valid answer or not: an invalid answer costs as much as a good one.
// Usually the day's row exists (the message claimed it), but a free concierge chip that
// completes an outing calls the model without claiming anything (DECISIONS B38), maybe
// on a day with no row yet, so the row is created here with 0 messages if need be.
export async function addTokens(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
  tokens: { input: number; output: number },
): Promise<void> {
  if (tokens.input === 0 && tokens.output === 0) return;
  await db.query(
    `INSERT INTO llm_usage (subject, feature, day, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject, feature, day) DO UPDATE
        SET input_tokens = llm_usage.input_tokens + $4, output_tokens = llm_usage.output_tokens + $5`,
    [key.subject, key.feature, key.day, tokens.input, tokens.output],
  );
}

// Messages used today, across all of the subject's chats; null before the first one.
export async function todaysUsage(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
): Promise<{ userMessages: number } | null> {
  const { rows } = await db.query(
    "SELECT user_messages FROM llm_usage WHERE subject = $1 AND feature = $2 AND day = $3",
    [key.subject, key.feature, key.day],
  );
  const row = rows[0];
  return row ? { userMessages: row.user_messages } : null;
}
