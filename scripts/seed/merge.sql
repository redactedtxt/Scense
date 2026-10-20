-- Runs on the PRODUCTION database, inside one transaction (psql -1), after the dump has
-- recreated the `seed` schema there. Step 3 of scripts/seed-prod.ps1 (DECISIONS B32).
--
-- Replaces the catalogue with the one in `seed` WITHOUT deleting anything a user made.
-- The old script ran TRUNCATE ... CASCADE on fragrances, and CASCADE also empties every
-- table with a foreign key to fragrances: collection, reviews, pair_ratings. Here:
--   * fragrances are updated in place by id, and new ones are inserted. None is ever
--     deleted, so rows that point at a fragrance keep pointing at the same bottle;
--   * the tables that only the pipeline writes are emptied and refilled. Their TRUNCATE
--     has no CASCADE, so if a user table ever references one of them, the load fails
--     with an error instead of quietly emptying that user table.
--
-- Every name is schema-qualified: the pg_dump file that ran just before this one sets
-- an empty search_path.

-- 1. Every fragrance already in production must be in the seed with the same id and
--    slug. Guests' browsers and users' collections hold these ids. (seed-prod.ps1 checks
--    this first too, to fail fast; this check is the one that cannot be skipped.)
DO $$
DECLARE
  missing INTEGER;
  example TEXT;
BEGIN
  SELECT count(*), min(p.id || ',' || p.slug) INTO missing, example
    FROM public.fragrances p
   WHERE NOT EXISTS (SELECT 1 FROM seed.fragrances s WHERE s.id = p.id AND s.slug = p.slug);
  IF missing > 0 THEN
    RAISE EXCEPTION 'seed is missing % production fragrances (same id and slug), for example %. Nothing was changed.',
      missing, example;
  END IF;
END $$;

-- 2. Pipeline-only tables. Listing notes together with fragrance_notes lets TRUNCATE
--    empty notes even though fragrance_notes points at it.
TRUNCATE public.pair_scores, public.fragrance_notes, public.fragrance_accords, public.notes,
         public.brand_aliases, public.name_aliases;

-- 3. Families: always the same 14 ring positions; names and harshness may be retuned.
INSERT INTO public.families (id, name, harshness)
SELECT id, name, harshness FROM seed.families
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, harshness = EXCLUDED.harshness;

-- 4. Fragrances: update existing rows in place, then add the new ones.
UPDATE public.fragrances p
   SET slug = s.slug, name = s.name, brand = s.brand, gender = s.gender,
       release_year = s.release_year, image_url = s.image_url,
       community_rating = s.community_rating, rating_votes = s.rating_votes,
       profile = s.profile, facets = s.facets, harshness = s.harshness, strength = s.strength,
       seasons = s.seasons, daynight = s.daynight, search_vector = s.search_vector
  FROM seed.fragrances s
 WHERE s.id = p.id;

INSERT INTO public.fragrances (id, slug, name, brand, gender, release_year, image_url,
  community_rating, rating_votes, profile, facets, harshness, strength, seasons, daynight, search_vector)
SELECT s.id, s.slug, s.name, s.brand, s.gender, s.release_year, s.image_url,
       s.community_rating, s.rating_votes, s.profile, s.facets, s.harshness, s.strength,
       s.seasons, s.daynight, s.search_vector
  FROM seed.fragrances s
 WHERE NOT EXISTS (SELECT 1 FROM public.fragrances p WHERE p.id = s.id);

-- 5. Refill the pipeline-only tables. Notes keep their seed ids so the links match.
INSERT INTO public.notes (id, name, mapped, profile, facets, harshness)
SELECT id, name, mapped, profile, facets, harshness FROM seed.notes;

INSERT INTO public.fragrance_notes (fragrance_id, note_id, layer)
SELECT fragrance_id, note_id, layer FROM seed.fragrance_notes;

INSERT INTO public.fragrance_accords (fragrance_id, accord, strength)
SELECT fragrance_id, accord, strength FROM seed.fragrance_accords;

INSERT INTO public.pair_scores (base_id, partner_id, goal, score, rank)
SELECT base_id, partner_id, goal, score, rank FROM seed.pair_scores;

INSERT INTO public.brand_aliases (alias, brand) SELECT alias, brand FROM seed.brand_aliases;
INSERT INTO public.name_aliases (alias, name_word) SELECT alias, name_word FROM seed.name_aliases;

-- 6. Explicit ids were inserted above, which never advances a sequence. Move both past
--    the highest id so the pipeline's next new fragrance or note cannot reuse one.
SELECT pg_catalog.setval('public.fragrances_id_seq', (SELECT max(id) FROM public.fragrances));
SELECT pg_catalog.setval('public.notes_id_seq', (SELECT max(id) FROM public.notes));

DROP SCHEMA seed CASCADE;
