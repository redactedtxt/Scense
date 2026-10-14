import { Router } from "express";
import type { Db } from "../db.js";

// The deploy check calls this, so it must prove the database is reachable,
// not just that the process is up.
export function healthRouter(db: Db): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    } catch (err) {
      console.error("health check failed:", err);
      res.status(503).json({ error: { code: "db_unavailable", message: "Database is unreachable." } });
    }
  });

  return router;
}
