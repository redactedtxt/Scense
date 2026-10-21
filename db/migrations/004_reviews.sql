-- Up Migration
-- M8: written reviews and pair ratings (DECISIONS B33). Migration 003 already created
-- both tables and is live, so this only adds what M8 needs on top.

-- When a review or rating was last changed. Reviews show "Edited" when it differs from
-- created_at; pair ratings keep it for the later learning step (decision 11, B30), which
-- will want to know how recent a rating is.
ALTER TABLE reviews ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE pair_ratings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- The fragrance page lists a bottle's reviews newest first, a page at a time. The
-- UNIQUE (user_id, fragrance_id) index starts with user_id, so it can't serve that.
CREATE INDEX reviews_fragrance_newest_idx ON reviews (fragrance_id, created_at DESC, id DESC);

-- Down Migration
DROP INDEX IF EXISTS reviews_fragrance_newest_idx;
ALTER TABLE pair_ratings DROP COLUMN IF EXISTS updated_at;
ALTER TABLE reviews DROP COLUMN IF EXISTS updated_at;
