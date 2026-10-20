-- Runs on the LOCAL database, step 1 of scripts/seed-prod.ps1 (DECISIONS B32).
-- Copies the catalogue tables into a separate `seed` schema, so pg_dump can ship them
-- under names that cannot collide with production's real tables. The server loads the
-- dump (which recreates the `seed` schema there) and runs merge.sql on it.
-- The local `seed` schema is dropped again right after the dump.
DROP SCHEMA IF EXISTS seed CASCADE;
CREATE SCHEMA seed;
CREATE TABLE seed.families AS TABLE public.families;
CREATE TABLE seed.fragrances AS TABLE public.fragrances;
CREATE TABLE seed.notes AS TABLE public.notes;
CREATE TABLE seed.fragrance_notes AS TABLE public.fragrance_notes;
CREATE TABLE seed.fragrance_accords AS TABLE public.fragrance_accords;
CREATE TABLE seed.pair_scores AS TABLE public.pair_scores;
CREATE TABLE seed.brand_aliases AS TABLE public.brand_aliases;
CREATE TABLE seed.name_aliases AS TABLE public.name_aliases;
