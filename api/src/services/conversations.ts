import type { Db } from "../db.js";
import type { Feature } from "./caps.js";
import type { LlmMessage } from "./llm.js";

// A visitor's chats (DECISIONS B36) and concierge outings (B37). Both are conversations
// in chat_conversations, told apart by `feature`. Each belongs to one subject
// ('user:<id>' or 'guest:<uuid>'), and every query here filters on the subject and the
// feature, so nobody can read, continue, or delete someone else's conversation by
// guessing its id, and a chat id never opens as an outing. The daily message budget is
// not here: it lives in llm_usage, one per feature (services/caps.ts).

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
export async function listConversations(db: Db, subject: string, feature: Feature = "chat"): Promise<ConversationSummary[]> {
  const { rows } = await db.query(
    `SELECT id, title, created_at, last_message_at FROM chat_conversations
      WHERE subject = $1 AND feature = $2 ORDER BY last_message_at DESC, id`,
    [subject, feature],
  );
  return rows.map(summaryOf);
}

// The chat, if it exists and belongs to this subject; null otherwise (one answer for
// "no such chat" and "not yours", so ids can't be probed).
// `slots` is the outing's stored slots (concierge), null for a chat.
export async function findConversation(
  db: Db,
  subject: string,
  id: string,
  feature: Feature = "chat",
): Promise<{ summary: ConversationSummary; slots: unknown } | null> {
  const { rows } = await db.query(
    "SELECT id, title, created_at, last_message_at, slots FROM chat_conversations WHERE id = $1 AND subject = $2 AND feature = $3",
    [id, subject, feature],
  );
  return rows[0] ? { summary: summaryOf(rows[0]), slots: rows[0].slots ?? null } : null;
}

// Deletes the chat and, by ON DELETE CASCADE, its messages. Today's budget is untouched:
// deleting a chat gives no messages back. Someone else's id deletes nothing.
export async function deleteConversation(db: Db, subject: string, id: string, feature: Feature = "chat"): Promise<void> {
  await db.query("DELETE FROM chat_conversations WHERE id = $1 AND subject = $2 AND feature = $3", [id, subject, feature]);
}

// Visitors' words are kept only as long as the lists need them: a chat or an outing goes
// `retentionDays` after its last message, messages and all.
export async function purgeExpiredConversations(db: Db, retentionDays: number): Promise<void> {
  await db.query("DELETE FROM chat_conversations WHERE last_message_at < now() - make_interval(days => $1)", [
    retentionDays,
  ]);
}

// The last `turns` messages, oldest first (SPEC section 10). The model needs no more:
// the taste profile (chat) or the slots (concierge) in the system prompt carry what
// earlier turns taught it. A history must start with a user message, so a leading
// assistant one is dropped.
export async function recentHistory(db: Db, conversationId: string, turns: number): Promise<LlmMessage[]> {
  if (turns === 0) return [];
  const { rows } = await db.query(
    `SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2`,
    [conversationId, turns],
  );
  const history = rows.reverse().map((r) => ({ role: r.role, content: r.content }) as LlmMessage);
  return history[0]?.role === "assistant" ? history.slice(1) : history;
}

export type StoredReply = {
  content: string;
  recommendations: number[];
  options?: string[] | null; // concierge: the answer chips under a question
  reasons?: string[] | null; // concierge: one sentence per recommendation, same order
};

// Both sides of an exchange, in one statement. A new conversation's row is created here,
// after its first message was answered, titled from that message; an existing one only
// moves its last_message_at (and, for an outing, stores its new slots). The user row
// keeps the ids of bottles they named, so later chat picks can leave them out.
export async function storeExchange(
  db: Db,
  conversation: { id: string; subject: string; feature: Feature; slots?: unknown },
  user: { message: string; named: number[] },
  reply: StoredReply,
): Promise<ConversationSummary> {
  const { rows } = await db.query(
    `WITH conversation AS (
       INSERT INTO chat_conversations (id, subject, title, feature, slots) VALUES ($1, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET last_message_at = now(), slots = EXCLUDED.slots
       RETURNING id, title, created_at, last_message_at
     ), stored AS (
       INSERT INTO chat_messages
              (conversation_id, seq, role, content, recommendations, named_fragrances, options, pick_reasons)
       SELECT $1, base.n + v.n, v.role, v.content, v.recs, v.named, v.options, v.reasons
         FROM (SELECT COALESCE(max(seq), 0) AS n FROM chat_messages WHERE conversation_id = $1) AS base,
              (VALUES (1, 'user', $2, NULL::int[], $5::int[], NULL::text[], NULL::text[]),
                      (2, 'assistant', $3, $4::int[], NULL::int[], $10::text[], $11::text[]))
              AS v(n, role, content, recs, named, options, reasons)
     )
     SELECT * FROM conversation`,
    [
      conversation.id, user.message, reply.content, reply.recommendations, user.named, conversation.subject,
      titleFrom(user.message), conversation.feature,
      conversation.slots === undefined ? null : JSON.stringify(conversation.slots),
      reply.options ?? null, reply.reasons ?? null,
    ],
  );
  return summaryOf(rows[0]);
}

function summaryOf(row: Record<string, unknown>): ConversationSummary {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: new Date(row.created_at as Date).toISOString(),
    lastMessageAt: new Date(row.last_message_at as Date).toISOString(),
  };
}
