-- Multiple chats (DECISIONS B36).
--
-- Until now one llm_usage row per subject, feature, and day was both the day's message
-- budget and the day's only conversation. Visitors can now keep several chats, so the
-- two come apart:
--  - llm_usage stays the daily budget and token ledger. Its UNIQUE (subject, feature, day)
--    key is unchanged: the 8 messages are one shared budget per subject per day, and the
--    atomic slot claim (services/caps.ts) still runs against that single row.
--  - chat_conversations is new: one row per chat, owned by its subject.

CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY,
  subject TEXT NOT NULL,                 -- 'user:<id>' or 'guest:<uuid>', the owner
  title TEXT NOT NULL,                   -- the visitor's first message, trimmed; never the model's text
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The chat list: one visitor's chats, most recently used first.
CREATE INDEX chat_conversations_subject_idx ON chat_conversations (subject, last_message_at DESC);
-- Retention: chats are deleted CHAT_RETENTION_DAYS after their last message.
CREATE INDEX chat_conversations_last_idx ON chat_conversations (last_message_at);

-- Every stored transcript becomes a chat. Its owner is the llm_usage row that shares its
-- conversation_id, its title its first user message (the same trimming as the API's
-- titleFrom: whitespace collapsed, at most 60 characters, cut at a word break), and its
-- dates its first and last messages.
INSERT INTO chat_conversations (id, subject, title, created_at, last_message_at)
SELECT m.conversation_id,
       u.subject,
       COALESCE(
         (SELECT CASE
                   WHEN char_length(t.text) <= 60 THEN t.text
                   -- A first word longer than 59 characters has no break to cut at.
                   ELSE COALESCE(rtrim(substring(t.text FROM '^(.{1,59})\s')), left(t.text, 59)) || '…'
                 END
            FROM (SELECT btrim(regexp_replace(first.content, '\s+', ' ', 'g')) AS text
                    FROM chat_messages first
                   WHERE first.conversation_id = m.conversation_id AND first.role = 'user'
                   ORDER BY first.seq LIMIT 1) AS t),
         'Untitled chat'),
       min(m.created_at),
       max(m.created_at)
  FROM chat_messages m
  JOIN llm_usage u ON u.conversation_id = m.conversation_id AND u.feature = 'chat'
 GROUP BY m.conversation_id, u.subject;

-- A transcript with no llm_usage row has no owner, so nobody could open it. The route
-- always wrote both together, so this is expected to delete nothing.
DELETE FROM chat_messages WHERE conversation_id NOT IN (SELECT id FROM chat_conversations);

-- Deleting a chat (by its owner, or by the retention purge) deletes its messages.
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_conversation_fk
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE;

-- One budget row now spans many chats, so the column no longer means anything. It is made
-- nullable rather than dropped so the old API container, which still writes it, can keep
-- claiming slots in the seconds between "migrate" and "up -d" during a deploy. (The old
-- container's first message of a brand-new conversation would still fail the foreign key
-- above in that window, since it never writes chat_conversations; continuing an existing
-- conversation works.) A later migration drops the column (SPEC section 13, M11).
ALTER TABLE llm_usage ALTER COLUMN conversation_id DROP NOT NULL;
