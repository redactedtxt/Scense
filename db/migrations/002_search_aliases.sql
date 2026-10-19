-- Up Migration
-- Search aliases (DECISIONS B23). The pipeline loads them from pipeline/config and builds
-- fragrances.search_vector from them, so "ysl myself" finds YSL MYSLF.
-- pg_trgm gives the typo-tolerant fallback (similarity() on the search vector's words).
-- unaccent folds accents on both sides of a search, so tresor finds Trésor.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE brand_aliases (
  alias TEXT NOT NULL,                -- what people type: YSL
  brand TEXT NOT NULL,                -- the brand as the dataset spells it: Yves Saint Laurent
  PRIMARY KEY (alias, brand)
);

CREATE TABLE name_aliases (
  alias TEXT NOT NULL,                -- what people type: myself
  name_word TEXT NOT NULL,            -- a word or phrase inside a fragrance name: MYSLF
  PRIMARY KEY (alias, name_word)
);

-- Down Migration
DROP TABLE IF EXISTS name_aliases;
DROP TABLE IF EXISTS brand_aliases;
DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
