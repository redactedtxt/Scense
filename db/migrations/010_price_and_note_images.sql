-- Feedback round 1 (DECISIONS B42): price guidance and note pictures.
--
-- Every new column is nullable (value_votes defaults to 0), so the deploy can migrate
-- first and the old API container keeps working; the columns stay empty until the next
-- catalogue reseed (scripts/seed-prod.ps1) fills them, and the API hides what is empty.
-- Adding a nullable column or one with a constant default rewrites no rows, so the lock
-- on each table lasts milliseconds.

-- The dataset's product line ("Private Blend", "Hermessence"). tier_overrides.csv picks
-- lines by it; it is shown nowhere.
ALTER TABLE fragrances ADD COLUMN collection TEXT;

-- Approximate retail tier for 100 ml in CAD, 1 ($) to 4 ($$$$), from brand_tiers.csv and
-- tier_overrides.csv. Never a price.
ALTER TABLE fragrances ADD COLUMN price_tier SMALLINT CHECK (price_tier BETWEEN 1 AND 4);

-- The community's value-for-money votes: how many, and their mean on the dataset's
-- 1 (overpriced) to 5 (great value) scale. NULL score when there are no votes.
ALTER TABLE fragrances ADD COLUMN value_votes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fragrances ADD COLUMN value_score REAL CHECK (value_score BETWEEN 1 AND 5);

-- Fragrantica's note icon, hotlinked like the bottle photos (DECISIONS B19). NULL when the
-- dataset has no image for the note.
ALTER TABLE notes ADD COLUMN image_url TEXT;
