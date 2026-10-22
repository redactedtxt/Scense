import type { Db } from "../db.js";

// Catalogue text search, shared by Browse (routes/fragrances.ts) and the chat, which
// looks up bottles a visitor names (DECISIONS B23, B35).

const WORD = /[\p{L}\p{N}]+/gu;
// Most words the typo fallback compares, so a pasted paragraph cannot make the query heavy.
const MAX_FUZZY_WORDS = 6;

// "cool wat" -> "cool:* & wat:*", so typing half a word still finds it. Only letters
// and digits survive, which also keeps user text from breaking tsquery syntax.
// A chunk with punctuation inside, such as "d&g", becomes a phrase ("d <-> g"): load.py
// puts the alias into the vector as the same adjacent words, and a phrase keeps "d&g"
// from matching every bottle that merely has a D word and a G word somewhere. Inside a
// phrase a one-letter word must match exactly, or "d:*" would match "di" in "Acqua di Giò".
// 'simple' must match the config load.py used to build search_vector, and the SQL
// unaccents this text because load.py unaccented the vector.
export function toPrefixQuery(text: string): string | null {
  const chunks = text.split(/\s+/).map((chunk) => chunk.match(WORD)).filter((words) => words !== null);
  if (chunks.length === 0) return null;
  const terms = chunks.map((words) => {
    const inPhrase = words.length > 1;
    const phrase = words.map((w) => (inPhrase && w.length === 1 ? w : `${w}:*`)).join(" <-> ");
    return inPhrase ? `(${phrase})` : phrase;
  });
  return terms.join(" & ");
}

// The words the typo fallback compares against the catalogue's words. One-letter words
// are left out: they can't be misspelled, and "angel's" would demand a word like "s".
export function searchWords(text: string): string[] {
  return (text.match(WORD) ?? []).filter((w) => w.length > 1).slice(0, MAX_FUZZY_WORDS);
}

// The typo fallback (DECISIONS B23). A bottle matches when EVERY typed word is close
// (pg_trgm similarity) to some word in its search vector: name, brand, and aliases.
// Results are ordered by total closeness, then votes. The catalogue is about 1,000 rows
// (about 12 ms for one typed word), so
// comparing every word needs no index; revisit if it grows by orders of magnitude.
export const FUZZY_MATCHED = `WITH scored AS (
    SELECT f.id, min(w.best) AS worst, sum(w.best) AS closeness
      FROM fragrances f
     CROSS JOIN LATERAL (
           SELECT (SELECT max(similarity(u.lexeme, unaccent(lower(word)))) FROM unnest(f.search_vector) u) AS best
             FROM unnest($1::text[]) AS word) w
     GROUP BY f.id
  )`;


// Words people put between a name's parts that the catalogue spells differently or not
// at all: "Myrrh and Tonka" is "Myrrh & Tonka". Tried only after the text as typed.
const CONNECTORS = new Set(["and", "by", "from"]);

function withoutConnectors(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => !CONNECTORS.has(word.toLowerCase()))
    .join(" ");
}

// The one bottle a visitor most likely means by `text` (a name they typed in the chat),
// or null. The same search as Browse: the prefix search with aliases, first as typed and
// then without connector words, and the typo fallback last. Several matches go to the
// most voted bottle, so "aventus" is Aventus, not one of its flankers.
export async function bestMatch(db: Db, text: string, fuzzyMinSimilarity: number): Promise<number | null> {
  for (const candidate of [text, withoutConnectors(text)]) {
    const tsquery = toPrefixQuery(candidate);
    if (tsquery === null) continue;
    const { rows } = await db.query(
      `SELECT f.id FROM fragrances f
        WHERE f.search_vector @@ to_tsquery('simple', unaccent($1))
        ORDER BY f.rating_votes DESC NULLS LAST, f.id LIMIT 1`,
      [tsquery],
    );
    if (rows[0]) return rows[0].id as number;
  }
  const words = searchWords(withoutConnectors(text));
  if (words.length === 0) return null;
  const { rows } = await db.query(
    `${FUZZY_MATCHED}
     SELECT s.id FROM scored s JOIN fragrances f ON f.id = s.id
      WHERE s.worst >= $2
      ORDER BY s.closeness DESC, f.rating_votes DESC NULLS LAST, f.id LIMIT 1`,
    [words, fuzzyMinSimilarity],
  );
  return (rows[0]?.id as number | undefined) ?? null;
}
