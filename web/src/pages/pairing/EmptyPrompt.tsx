import { Notice } from "../../components/ui";
import type { Goal } from "../../lib/api";
import { ResultsHead } from "./ResultsHead";
import type { Mode } from "./usePairingParams";

// What the results area shows before anything is picked (DECISIONS B25). It keeps the
// results heading, so the page looks the same before and after a pick. In Notes mode the
// wording stays about notes only (SPEC section 11).
export function EmptyPrompt({ mode, goal }: { mode: Mode; goal: Goal }) {
  const text =
    mode === "fragrance"
      ? "Pick a fragrance above to see what to layer with it, or switch to Notes to start from a note or two."
      : "Pick a note or two above to see which notes layer with them.";
  return (
    <>
      <ResultsHead goal={goal} summary="Nothing to rank yet." />
      <div className="border-t border-line-strong">
        <Notice role="status">{text}</Notice>
      </div>
    </>
  );
}
