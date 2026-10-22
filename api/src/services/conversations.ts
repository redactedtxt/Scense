import type { Db } from "../db.js";

// A visitor's chats (DECISIONS B36). Each chat belongs to one subject ('user:<id>' or
// 'guest:<uuid>'), and every query here filters on it, so nobody can read, continue, or
// delete someone else's chat by guessing its id. The daily message budget is not here:
// it lives in llm_usage and is shared by all of a visitor's chats (services/caps.ts).

export type ConversationSummary = { id: string; title: string; createdAt: string; lastMessageAt: string };

const TITLE_MAX_CHARS = 60;

// A chat's title is the visitor's own first message: whitespace collapsed, and at most 60
// characters, cut at a word break. It never comes from the model, so a title can't carry a
// fragrance name the model wrote. Migration 007 titles old chats with the same rule.
export function titleFrom(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length <= TITLE_MAX_CHARS) return text;
  const cut = text.slice(0, TITLE_MAX_CHARS).lastIndexOf(" ");
  return `${text.slice(0, cut > 0 ? cut : TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

// Most recently used first, so the chat someone was just in sits at the top.
export async function listConversations(db: Db, subject: string): Promise<ConversationSummary[]> {
  const { rows } = await db.query(
    `SELECT id, title, created_at, last_message_at FROM chat_conversations
      WHERE subject = $1 ORDER BY last_message_at DESC, id`,
    [subject],
  );
  return rows.map(summaryOf);
}

// The chat, if it exists and belongs to this subject; null otherwise (one answer for
// "no such chat" and "not yours", so ids can't be probed).
export async function findConversation(db: Db, subject: string, id: string): Promise<ConversationSummary | null> {
  const { rows } = await db.query(
    "SELECT id, title, created_at, last_message_at FROM chat_conversations WHERE id = $1 AND subject = $2",
    [id, subject],
  );
  return rows[0] ? summaryOf(rows[0]) : null;
}

// Deletes the chat and, by ON DELETE CASCADE, its messages. Today's budget is untouched:
// deleting a chat gives no messages back. Someone else's id deletes nothing.
export async function deleteConversation(db: Db, subject: string, id: string): Promise<void> {
  await db.query("DELETE FROM chat_conversations WHERE id = $1 AND subject = $2", [id, subject]);
}

// Visitors' words are kept only as long as the chat list needs them: a chat goes
// `retentionDays` after its last message, messages and all.
export async function purgeExpiredConversations(db: Db, retentionDays: number): Promise<void> {
  await db.query("DELETE FROM chat_conversations WHERE last_message_at < now() - make_interval(days => $1)", [
    retentionDays,
  ]);
}

function summaryOf(row: Record<string, unknown>): ConversationSummary {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: new Date(row.created_at as Date).toISOString(),
    lastMessageAt: new Date(row.last_message_at as Date).toISOString(),
  };
}
