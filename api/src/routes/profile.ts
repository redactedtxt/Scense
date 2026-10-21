import { Router } from "express";
import type { AuthSettings } from "../config.js";
import type { Db } from "../db.js";
import { requireUser, userIdOf } from "../middleware/auth.js";
import { parseInput } from "../middleware/validate.js";
import { loadProfile, saveProfile } from "../services/profileStore.js";
import { completeProfile, describeProfile, profileInput } from "../services/taste.js";

// GET/PUT /api/profile/taste (SPEC section 7): a signed-in user's taste profile, read by
// the profile card and replaced by its Edit mode. Guests keep theirs in the browser.
export function profileRouter(db: Db, settings: AuthSettings): Router {
  const router = Router();
  router.use("/profile", requireUser(settings));

  // `profile` is null until the user has chatted or saved one.
  router.get("/profile/taste", async (_req, res) => {
    res.json({ profile: await loadProfile(db, userIdOf(res)) });
  });

  // Sliders send every weight. A summary the client doesn't send is rebuilt from the
  // numbers, so an edited profile never keeps a summary that no longer describes it.
  router.put("/profile/taste", async (req, res) => {
    const input = parseInput(profileInput, req.body);
    const profile = completeProfile(input);
    if (!input.summary) profile.summary = describeProfile(profile);
    await saveProfile(db, userIdOf(res), profile);
    res.json({ profile });
  });

  return router;
}
