-- Up Migration
CREATE TABLE families (
  id SMALLINT PRIMARY KEY,            -- ring position 0-13
  name TEXT NOT NULL UNIQUE,
  harshness REAL NOT NULL
);

CREATE TABLE fragrances (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,          -- built by ingest: brand-name-year, see section 4
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  gender TEXT,                        -- male, female, unisex (dataset values; UI shows Men, Women, Unisex)
  release_year SMALLINT,
  image_url TEXT,
  community_rating REAL,
  rating_votes INTEGER,
  profile REAL[14] NOT NULL,
  facets JSONB NOT NULL,              -- {"sweet":0.3,...}
  harshness REAL NOT NULL,
  strength SMALLINT NOT NULL CHECK (strength BETWEEN 1 AND 4),
  seasons JSONB NOT NULL,             -- {"winter":0.4,"spring":..,"summer":..,"autumn":..}; UI shows "Fall"
  daynight JSONB NOT NULL,            -- {"day":0.3,"night":0.7}
  search_vector TSVECTOR
);
CREATE INDEX fragrances_search_idx ON fragrances USING GIN (search_vector);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mapped BOOLEAN NOT NULL,            -- true = in note_map.csv; only mapped notes are paired and autocompleted
  profile REAL[14],                   -- null when not mapped
  facets JSONB,                       -- null when not mapped
  harshness REAL,                     -- null when not mapped
  CHECK (mapped = (profile IS NOT NULL AND facets IS NOT NULL AND harshness IS NOT NULL))
);

CREATE TABLE fragrance_notes (
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id),
  layer TEXT NOT NULL CHECK (layer IN ('top','heart','base','flat')),
  PRIMARY KEY (fragrance_id, note_id, layer)
);

CREATE TABLE fragrance_accords (
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  accord TEXT NOT NULL,
  strength REAL NOT NULL,
  PRIMARY KEY (fragrance_id, accord)
);

CREATE TABLE pair_scores (
  base_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (goal IN ('enhance','soften')),
  score REAL NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (base_id, goal, partner_id)
);
CREATE INDEX pair_scores_rank_idx ON pair_scores (base_id, goal, rank);

CREATE TABLE llm_usage (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL,              -- 'user:<id>' or 'guest:<uuid>'
  feature TEXT NOT NULL CHECK (feature IN ('chat','concierge')),
  day DATE NOT NULL,                  -- America/Toronto date
  conversation_id UUID NOT NULL,
  user_messages SMALLINT NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subject, feature, day)
);

-- Down Migration
DROP TABLE IF EXISTS llm_usage;
DROP TABLE IF EXISTS pair_scores;
DROP TABLE IF EXISTS fragrance_accords;
DROP TABLE IF EXISTS fragrance_notes;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS fragrances;
DROP TABLE IF EXISTS families;
