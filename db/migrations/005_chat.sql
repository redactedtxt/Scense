-- M9: the chatbot's transcript (DECISIONS B34).
--
-- The conversation lives on the server, not in the browser, for two reasons:
--  1. The model's earlier replies come from here, so a visitor cannot forge an
--     "assistant" turn and put words in the model's mouth.
--  2. One conversation per day (SPEC section 10) means a reload must bring today's
--     chat back instead of showing an empty page that can no longer be used.
--
-- conversation_id matches llm_usage.conversation_id. llm_usage has no unique key on
-- that column, so there is no foreign key; the route writes both together.
CREATE TABLE chat_messages (
  conversation_id UUID NOT NULL,
  seq SMALLINT NOT NULL,                 -- 1, 2, 3... in the order sent
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,                 -- assistant rows hold the reply as shown, after the server's checks
  recommendations INTEGER[],             -- fragrance ids the server picked; assistant rows only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq)
);

-- Old transcripts are deleted after CHAT_RETENTION_DAYS (api/src/config.ts).
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at);

-- The site-wide guest cap counts today's guest conversations, and the admin report
-- sums by day. The UNIQUE (subject, feature, day) index starts with subject, so it
-- can't serve either.
CREATE INDEX llm_usage_day_idx ON llm_usage (day);
