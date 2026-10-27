import { useSearchParams } from "react-router";
import type { Goal } from "../../lib/api";

export type Mode = "fragrance" | "notes";

// Soften is the goal the page opens on: it is the problem the project started from
// (DECISIONS #3). Nothing else is preselected: with no fragrance or notes in the URL
// the page opens empty and invites the visitor to pick (DECISIONS B25).
export const DEFAULT_GOAL: Goal = "soften";
export const MAX_NOTES = 10;

// The pairing page lived at "/" until the home page took that address. Links shared
// before then (/?f=<slug>&goal=soften) carry these params; the home page sends any URL
// holding one of them on to PAIR_PATH with the same query string.
export const PAIR_PATH = "/pair";
export const PAIRING_PARAMS = ["f", "mode", "goal", "notes"] as const;

// "Pair this" links from the fragrance page and the collection.
export function pairHref(slug: string, goal?: Goal): string {
  const params = new URLSearchParams({ f: slug });
  if (goal) params.set("goal", goal);
  return `${PAIR_PATH}?${params}`;
}

// The pairing state lives in the URL (?mode=notes&notes=Rose,Vanilla&goal=enhance),
// so every result is a link you can share, and "Pair this" on a fragrance page is just
// a link to /pair?f=<slug>. A missing or empty param means "nothing picked"; a missing
// goal falls back to the default.
export function usePairingParams() {
  const [params, setParams] = useSearchParams();

  const mode: Mode = params.get("mode") === "notes" ? "notes" : "fragrance";
  const goal: Goal = params.get("goal") === "enhance" ? "enhance" : params.get("goal") === "soften" ? "soften" : DEFAULT_GOAL;
  const baseSlug = params.get("f") || null;
  const notes = (params.get("notes") ?? "").split(",").map((n) => n.trim()).filter(Boolean).slice(0, MAX_NOTES);

  // replace: toggling a goal should not fill the back button's history.
  function update(changes: Partial<{ mode: Mode; goal: Goal; f: string; notes: string[] }>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          next.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        return next;
      },
      { replace: true },
    );
  }

  return { mode, goal, baseSlug, notes, update };
}
