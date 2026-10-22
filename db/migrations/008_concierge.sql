-- M10: the concierge (SPEC section 9; DECISIONS B37).
--
-- An outing is a conversation like a chat, so it reuses chat_conversations and
-- chat_messages instead of copying them. A `feature` column tells the two apart, so the
-- chat list never shows an outing and the concierge list never shows a chat. The daily
-- budget is separate already: llm_usage has one row per subject, feature, and day.

-- Existing rows, and any row the old API container writes during a deploy, are chats.
ALTER TABLE chat_conversations
  ADD COLUMN feature TEXT NOT NULL DEFAULT 'chat' CHECK (feature IN ('chat', 'concierge'));

-- The outing's slots as the server validated them: {"occasion": "date_night", ...}, with
-- only known values (services/concierge.ts). Kept on the server so the browser can't
-- claim a slot the visitor never filled. Null for chats.
ALTER TABLE chat_conversations ADD COLUMN slots JSONB;

-- The list query now filters on feature too.
DROP INDEX chat_conversations_subject_idx;
CREATE INDEX chat_conversations_subject_idx ON chat_conversations (subject, feature, last_message_at DESC);

-- Concierge replies only (null for chat rows):
--  - options: the answer chips offered under a question ("Low", "Medium", "High");
--  - pick_reasons: one sentence per entry of `recommendations`, in the same order, as
--    shown after the server's checks.
ALTER TABLE chat_messages ADD COLUMN options TEXT[];
ALTER TABLE chat_messages ADD COLUMN pick_reasons TEXT[];
