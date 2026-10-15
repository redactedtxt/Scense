import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { parseInput } from "../middleware/validate.js";
import { dominantFamilyId } from "../services/sql.js";

const querySchema = z.object({
  q: z.string().trim().max(60).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Escape LIKE wildcards so a typed "%" or "_" is matched literally.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Autocomplete for the note picker. Mapped notes only: the other notes have no
// wheel profile, so they cannot be paired.
export function notesRouter(db: Db): Router {
  const router = Router();

  router.get("/notes", async (req, res) => {
    const { q, limit } = parseInput(querySchema, req.query);
    // Names that start with the text come first, then names that merely contain it.
    const { rows } = await db.query(
      `SELECT n.name, fam.name AS family
         FROM notes n
         JOIN families fam ON fam.id = ${dominantFamilyId("n.profile")}
        WHERE n.mapped AND n.name ILIKE '%' || $1 || '%'
        ORDER BY (n.name ILIKE $1 || '%') DESC, n.name
        LIMIT $2`,
      [escapeLike(q), limit],
    );
    res.json({ items: rows.map((r) => ({ name: r.name, dominantFamily: r.family })) });
  });

  return router;
}
