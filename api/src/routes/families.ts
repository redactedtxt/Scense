import { Router } from "express";
import type { Db } from "../db.js";

// The 14 wheel families in ring order, for the About page and the profile card.
export function familiesRouter(db: Db): Router {
  const router = Router();

  router.get("/families", async (_req, res) => {
    const { rows } = await db.query("SELECT id, name, harshness FROM families ORDER BY id");
    res.json({
      items: rows.map((r) => ({ id: r.id, name: r.name, harshness: r.harshness })),
    });
  });

  return router;
}
