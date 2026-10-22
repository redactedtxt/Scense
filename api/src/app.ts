import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { aiDefaults, type AiSettings, type AuthSettings } from "./config.js";
import type { Db } from "./db.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { collectionRouter } from "./routes/collection.js";
import { familiesRouter } from "./routes/families.js";
import { fragrancesRouter } from "./routes/fragrances.js";
import { healthRouter } from "./routes/health.js";
import { notesRouter } from "./routes/notes.js";
import { pairingRouter } from "./routes/pairing.js";
import { pairRatingsRouter } from "./routes/pairRatings.js";
import { profileRouter } from "./routes/profile.js";
import { reviewsRouter } from "./routes/reviews.js";
import type { CatalogueSettings } from "./services/catalogue.js";
import { createCatalogueCache } from "./services/catalogueCache.js";
import type { Llm } from "./services/llm.js";
import type { Matrices } from "./services/scoring.js";

// The AI side of the app: its settings, and the model client, or null when no API key
// is configured (the chat then says the assistant is unavailable).
export type AiDeps = { settings: AiSettings; llm: Llm | null };

// Built from its dependencies (not module globals) so tests can pass a fake db, a
// short bcrypt cost, a clock they control, and a fake model.
export function createApp(
  db: Db,
  matrices: Matrices,
  settings: CatalogueSettings,
  auth: AuthSettings,
  now: () => number = Date.now,
  ai: AiDeps = { settings: aiDefaults(), llm: null },
): express.Express {
  const app = express();
  // Caddy is the one proxy in front of us. Trusting exactly that many hops makes req.ip
  // the address Caddy saw (the rightmost X-Forwarded-For entry), not one a visitor typed
  // into their own X-Forwarded-For header. `true` would trust the leftmost, forgeable one.
  app.set("trust proxy", auth.trustProxyHops);
  app.use(helmet());
  // Same-origin in production (Caddy serves both), so this mostly matters in dev; it
  // still keeps other sites from reading our responses with the visitor's cookie.
  app.use(cors({ origin: auth.corsOrigins, credentials: true }));
  // 200 kB fits a guest import of the whole catalogue (2,000 items) with room to spare.
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use("/api", healthRouter(db));
  app.use("/api", familiesRouter(db));
  app.use("/api", fragrancesRouter(db, settings));
  app.use("/api", notesRouter(db));
  app.use("/api", pairingRouter(db, matrices));
  app.use("/api", authRouter(db, auth, now));
  app.use("/api", collectionRouter(db, auth));
  app.use("/api", reviewsRouter(db, auth, now));
  app.use("/api", pairRatingsRouter(db, auth, now));
  app.use("/api", profileRouter(db, auth));
  const catalogue = createCatalogueCache(db, now);
  app.use(
    "/api",
    chatRouter({ db, auth, ai: ai.settings, llm: ai.llm, catalogue, fuzzyMinSimilarity: settings.fuzzyMinSimilarity, now }),
  );
  app.use("/api", adminRouter(db, ai.settings, now));
  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
