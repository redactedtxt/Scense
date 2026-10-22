// Diagnostic: how well the catalogue matches a few sample taste profiles, to sanity-check
// CHAT_OWNED_MIN_MATCH. Run inside the api container: `npx tsx scripts/match-check.ts`.
import pg from "pg";
import { createCatalogueCache } from "../src/services/catalogueCache.js";
import { cosine } from "../src/services/recommend.js";
import { completeProfile, tasteVector } from "../src/services/taste.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { entries } = await createCatalogueCache(pool).get();
const samples = {
  "spicy with an edge": completeProfile({ families: { "Woody Amber": 0.4 }, facets: { spicy: 0.5, sharp: 0.3 } }),
  "warm vanilla and smoke": completeProfile({ families: { Amber: 0.32, "Dry Woods": 0.24 }, facets: { sweet: 0.3, smoky: 0.3 } }),
  "fresh citrus": completeProfile({ families: { Citrus: 0.6, Water: 0.3 }, facets: {} }),
};
for (const [label, profile] of Object.entries(samples)) {
  const scores = entries.map((e) => ({ e, s: cosine(tasteVector(profile), e.vector) })).sort((a, b) => b.s - a.s);
  const bleu = scores.find(({ e }) => e.name === "Bleu de Chanel");
  const top = scores.slice(0, 3).map(({ e, s }) => `${e.name} ${Math.round(s * 100)}%`).join(", ");
  const over = scores.filter(({ s }) => s >= 0.6).length;
  console.log(`${label}: top ${top}; ${over} bottles >= 60%; Bleu de Chanel ${Math.round((bleu?.s ?? 0) * 100)}%`);
}
await pool.end();
