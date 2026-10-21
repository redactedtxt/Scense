import type { Db } from "../db.js";

// AI caps (SPEC section 10). One llm_usage row per subject, feature, and Toronto day IS
// that day's conversation: its user_messages counts the messages, its token columns the
// spend. The UNIQUE (subject, feature, day) key is what makes "one conversation per day"
// hold even when two requests arrive at once.

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

export type Reservation = { conversationId: string; userMessages: number; created: boolean };
export type Refusal = "daily_limit" | "guest_cap";

// Claims the next message slot BEFORE the model is called, in one statement:
//  - no row yet today: create the conversation with 1 message, unless the subject is a
//    guest and today's guest conversations (both features) already reached the cap;
//  - a row: add 1, unless it already holds the maximum.
// Claiming first means two quick messages can't both slip in as message 8.
//
// Known gap: two brand-new guests in the same instant can both pass the site-wide count,
// so the backstop can overshoot by the number of simultaneous first messages.
export async function reserveMessage(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
  newConversationId: string,
  caps: CapSettings,
): Promise<Reservation | Refusal> {
  const isGuest = key.subject.startsWith("guest:");
  const { rows } = await db.query(
    `INSERT INTO llm_usage (subject, feature, day, conversation_id, user_messages)
     SELECT $1, $2, $3, $4, 1
      WHERE NOT $5::boolean
         OR EXISTS (SELECT 1 FROM llm_usage WHERE subject = $1 AND feature = $2 AND day = $3)
         OR (SELECT count(*) FROM llm_usage WHERE day = $3 AND subject LIKE 'guest:%') < $6
     ON CONFLICT (subject, feature, day) DO UPDATE
        SET user_messages = llm_usage.user_messages + 1
      WHERE llm_usage.user_messages < $7
     RETURNING conversation_id, user_messages, (xmax = 0) AS created`,
    // xmax = 0 is Postgres's tell for "this row was inserted, not updated".
    [key.subject, key.feature, key.day, newConversationId, isGuest, caps.guestDailyConversationCap, caps.maxUserMessages],
  );
  const row = rows[0];
  if (row) return { conversationId: row.conversation_id, userMessages: row.user_messages, created: row.created };
  // Nothing written: either today's conversation is full, or a new guest hit the cap.
  return (await todaysUsage(db, key)) ? "daily_limit" : "guest_cap";
}

// Gives the slot back when Anthropic could not be reached: the visitor shouldn't lose one
// of their 8 messages to our outage. A conversation left with no messages is deleted, so
// it no longer counts toward the guest cap either.
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
export async function addTokens(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
  tokens: { input: number; output: number },
): Promise<void> {
  await db.query(
    `UPDATE llm_usage SET input_tokens = input_tokens + $4, output_tokens = output_tokens + $5
      WHERE subject = $1 AND feature = $2 AND day = $3`,
    [key.subject, key.feature, key.day, tokens.input, tokens.output],
  );
}

export async function todaysUsage(
  db: Db,
  key: { subject: string; feature: Feature; day: string },
): Promise<{ conversationId: string; userMessages: number } | null> {
  const { rows } = await db.query(
    "SELECT conversation_id, user_messages FROM llm_usage WHERE subject = $1 AND feature = $2 AND day = $3",
    [key.subject, key.feature, key.day],
  );
  const row = rows[0];
  return row ? { conversationId: row.conversation_id, userMessages: row.user_messages } : null;
}
