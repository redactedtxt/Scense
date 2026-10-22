-- Builds the small test catalogue (M11; DECISIONS B39). Runs on the LOCAL database,
-- which the pipeline has loaded with the full catalogue; scripts/build-test-catalogue.ps1
-- runs it, dumps the `seed` schema to db/test-catalogue.sql.gz, and drops the schema.
--
-- The output has the same shape as scripts/seed/stage.sql, so CI loads it with the same
-- scripts/seed/merge.sql that seeds production. CI has no Kaggle files and can't run
-- the pipeline, and the full catalogue's 1.5 million pair rows are 44 MB.
--
-- Which bottles: the 100 most voted, ids 1 to 10 (tests address those by id), and every
-- bottle the API integration tests and the Playwright smoke tests look up by name. Ids
-- and slugs are the real ones, so a failing test can be checked against the dev site.
DROP SCHEMA IF EXISTS seed CASCADE;
CREATE SCHEMA seed;

CREATE TABLE seed.keep AS
SELECT id FROM (SELECT id FROM public.fragrances ORDER BY rating_votes DESC, id LIMIT 100) AS most_voted
UNION
SELECT id FROM public.fragrances
 WHERE id <= 10
    -- api/src/tests/integration.test.ts: search, aliases, accents, typos, ranks.
    OR name LIKE 'Cool Water%' OR name LIKE '%MYSLF%' OR name LIKE 'Bleu de Chanel%'
    OR name LIKE 'Acqua di Gi%' OR name = 'Club de Nuit Intense Man' OR name = 'Tobacco Vanille'
    OR name LIKE 'Le Male%' OR name = 'Ultra Male' OR (brand = 'Dior' AND name LIKE 'Sauvage%')
    OR name LIKE 'Baccarat Rouge 540%' OR name LIKE 'Trésor%' OR name = 'Wood Sage & Sea Salt'
    -- api/src/tests/chat.integration.test.ts: named bottles.
    OR name = 'Myrrh & Tonka' OR name LIKE '%Stronger With You%' OR (brand = 'Creed' AND name = 'Aventus')
    OR name LIKE 'Hawas%'
UNION
-- Brands the alias and accent tests search for: their two most voted bottles each.
SELECT id FROM (
  SELECT id, row_number() OVER (PARTITION BY brand ORDER BY rating_votes DESC, id) AS n
    FROM public.fragrances
   WHERE brand IN ('Yves Saint Laurent', 'Jean Paul Gaultier', 'Maison Francis Kurkdjian',
                   'Dolce&Gabbana', 'Maison Martin Margiela', 'Chloé', 'Hermès', 'Lancôme',
                   'Estée Lauder', 'Comme des Garcons')
) AS by_brand
 WHERE n <= 2;

CREATE TABLE seed.families AS TABLE public.families;
CREATE TABLE seed.fragrances AS
SELECT * FROM public.fragrances WHERE id IN (SELECT id FROM seed.keep);
-- Every note, mapped or not: note pairing scores the 167 mapped notes whatever the
-- catalogue holds, and the "unmapped notes never autocomplete" test needs unmapped ones.
CREATE TABLE seed.notes AS TABLE public.notes;
CREATE TABLE seed.fragrance_notes AS
SELECT * FROM public.fragrance_notes WHERE fragrance_id IN (SELECT id FROM seed.keep);
CREATE TABLE seed.fragrance_accords AS
SELECT * FROM public.fragrance_accords WHERE fragrance_id IN (SELECT id FROM seed.keep);

-- Pairs inside the subset only, re-ranked 1..N per list and rescaled so each list's best
-- partner is 100 again (the stored score is the display score; DECISIONS B13). The
-- order inside a list is the full catalogue's order, so no pair is rescored.
CREATE TABLE seed.pair_scores AS
SELECT base_id, partner_id, goal,
       (score * 100 / max(score) OVER (PARTITION BY base_id, goal))::real AS score,
       (row_number() OVER (PARTITION BY base_id, goal ORDER BY rank))::int AS rank
  FROM public.pair_scores
 WHERE base_id IN (SELECT id FROM seed.keep) AND partner_id IN (SELECT id FROM seed.keep);

CREATE TABLE seed.brand_aliases AS TABLE public.brand_aliases;
CREATE TABLE seed.name_aliases AS TABLE public.name_aliases;

DROP TABLE seed.keep;
