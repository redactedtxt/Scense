import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Notice, OutlineButton } from "../../components/ui";
import { api, ApiError, type Goal } from "../../lib/api";
import { formatCount, joinWords } from "../../lib/labels";
import { EmptyPrompt } from "./EmptyPrompt";
import { ResultsHead } from "./ResultsHead";
import { NoteMatchRow, NoteMatchSkeleton } from "./rows";

// The API returns every ranked note at once (at most 149); show them a page at a time.
const PAGE = 24;
const SKELETON_ROWS = 5;

// Notes mode results. Per SPEC section 11 the summary talks about notes only, never a
// base bottle, and there is no rank finder or "Owned only" switch here.
export function NoteResults({ notes, goal }: { notes: string[]; goal: Goal }) {
  const [shown, setShown] = useState(PAGE);
  const pairing = useQuery({
    queryKey: ["pair-notes", notes, goal],
    queryFn: () => api.pairNotes(notes, goal),
    enabled: notes.length > 0,
    placeholderData: keepPreviousData,
  });

  if (notes.length === 0) return <EmptyPrompt mode="notes" goal={goal} />;

  const data = pairing.data;
  const summary = data
    ? `${formatCount(data.total)} ${data.total === 1 ? "note" : "notes"} ranked to ${goal} ${joinWords(data.inputs)}.`
    : null;

  return (
    <>
      <ResultsHead goal={goal} summary={pairing.isError ? "" : summary} />
      <div
        className={`border-t border-line-strong transition-opacity ${pairing.isPlaceholderData ? "opacity-50" : ""}`}
        aria-busy={pairing.isFetching}
      >
        {pairing.isError && <Notice role="alert">{errorText(pairing.error)}</Notice>}
        {pairing.isPending && Array.from({ length: SKELETON_ROWS }, (_, i) => <NoteMatchSkeleton key={i} />)}
        {data && data.total === 0 && (
          <Notice>No mapped note is gentler than {joinWords(data.inputs)}, so there is nothing to soften with. Try Enhance.</Notice>
        )}
        {data?.results.slice(0, shown).map((match) => (
          <NoteMatchRow key={match.note} match={match} goal={goal} />
        ))}
      </div>
      {data && data.results.length > shown && (
        <div className="mt-10 flex justify-center">
          <OutlineButton onClick={() => setShown((n) => n + PAGE)}>
            {`Show more (${formatCount(data.results.length - shown)} left)`}
          </OutlineButton>
        </div>
      )}
    </>
  );
}

// A note typed into the URL by hand can be unknown or unmapped; say which.
function errorText(error: Error): string {
  if (error instanceof ApiError && (error.code === "unknown_note" || error.code === "unmapped_note")) {
    return `${error.message} Remove it to see results.`;
  }
  return "Could not rank notes right now. Try again in a moment.";
}
