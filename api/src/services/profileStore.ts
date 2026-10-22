import type { Db } from "../db.js";
import { completeProfile, profileInput, type TasteProfile } from "./taste.js";

// What the AI features read from a signed-in user's account: the taste profile in
// taste_profiles (SPEC section 5) and the Own list. Guests keep both in the browser and
// send them with each chat or concierge message instead.

export async function loadProfile(db: Db, userId: number): Promise<TasteProfile | null> {
  const { rows } = await db.query("SELECT families, facets, summary FROM taste_profiles WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  // Rows are only ever written through profileInput, but reading through it too means a
  // hand-edited row can't put a bad weight in front of the model or the page.
  const parsed = profileInput.safeParse(rows[0]);
  return parsed.success ? completeProfile(parsed.data) : null;
}

export async function saveProfile(db: Db, userId: number, profile: TasteProfile): Promise<void> {
  await db.query(
    `INSERT INTO taste_profiles (user_id, families, facets, summary, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE
       SET families = EXCLUDED.families, facets = EXCLUDED.facets, summary = EXCLUDED.summary, updated_at = now()`,
    [userId, JSON.stringify(profile.families), JSON.stringify(profile.facets), profile.summary],
  );
}

// The guest import (SPEC section 6): the browser's profile goes in only if the account
// has none yet. An account's own profile wins, as an account's bottles do (DECISIONS B31).
export async function importProfile(db: Db, userId: number, profile: TasteProfile): Promise<"imported" | "kept"> {
  const { rows } = await db.query(
    `INSERT INTO taste_profiles (user_id, families, facets, summary) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [userId, JSON.stringify(profile.families), JSON.stringify(profile.facets), profile.summary],
  );
  return rows.length > 0 ? "imported" : "kept";
}

// The Own list: the chat's owned picks and the concierge's candidates.
export async function ownedIds(db: Db, userId: number): Promise<number[]> {
  const { rows } = await db.query("SELECT fragrance_id FROM collection WHERE user_id = $1 AND status = 'own'", [userId]);
  return rows.map((r) => r.fragrance_id as number);
}
