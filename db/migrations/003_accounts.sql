-- Up Migration
-- Pass 2 accounts (SPEC section 5). Every pass 2 table is created here, even the ones
-- M8 and M9 fill (reviews, pair ratings, taste profiles), so the schema is settled once
-- and the reseed test (pipeline/tests/test_seed_merge.py) can prove none of them is
-- touched by a catalogue reload.
-- citext makes email comparisons case-insensitive, so Ana@x.com and ana@x.com are one account.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email CITEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('own','want')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fragrance_id)
);

CREATE TABLE taste_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  families JSONB NOT NULL,            -- 14 weights, -1 to 1
  facets JSONB NOT NULL,              -- 6 weights, -1 to 1
  summary TEXT,                       -- one plain-English line
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fragrance_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fragrance_id)
);

CREATE TABLE pair_ratings (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  base_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES fragrances(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (goal IN ('enhance','soften')),
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, base_id, partner_id, goal)
);

-- Down Migration
DROP TABLE IF EXISTS pair_ratings;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS taste_profiles;
DROP TABLE IF EXISTS collection;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS citext;
