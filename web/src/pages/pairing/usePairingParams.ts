import { useSearchParams } from "react-router";
import type { Goal } from "../../lib/api";

export type Mode = "fragrance" | "notes";

// What the page opens on when the URL says nothing. Club de Nuit Intense Man with
// Soften is the problem the project started from (DECISIONS #3); Bergamot and Vanilla
// are two mapped notes most people can picture.
export const DEFAULT_BASE_SLUG = "armaf-club-de-nuit-intense-man-2015";
export const DEFAULT_NOTES = ["Bergamot", "Vanilla"];
export const DEFAULT_GOAL: Goal = "soften";
export const MAX_NOTES = 10;

// The pairing state lives in the URL (?mode=notes&notes=Rose,Vanilla&goal=enhance),
// so every result is a link you can share, and "Pair this" on a fragrance page is just
// a link to /?f=<slug>. A missing param falls back to the default; an empty one
// (notes=) means "nothing picked".
export function usePairingParams() {
  const [params, setParams] = useSearchParams();

  const mode: Mode = params.get("mode") === "notes" ? "notes" : "fragrance";
  const goal: Goal = params.get("goal") === "enhance" ? "enhance" : params.get("goal") === "soften" ? "soften" : DEFAULT_GOAL;
  const baseSlug = params.get("f") || DEFAULT_BASE_SLUG;
  const notesParam = params.get("notes");
  const notes =
    notesParam === null ? DEFAULT_NOTES : notesParam.split(",").map((n) => n.trim()).filter(Boolean).slice(0, MAX_NOTES);

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
