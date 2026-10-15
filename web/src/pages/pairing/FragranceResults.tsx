import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Notice, OutlineButton } from "../../components/ui";
import { api, type FragranceDetail, type Goal } from "../../lib/api";
import { useOwnedIds } from "../../lib/collection";
import { formatCount } from "../../lib/labels";
import { RankFinder } from "./RankFinder";
import { ResultsHead, Switch } from "./ResultsHead";
import { MatchCard, MatchCardSkeleton } from "./rows";

const SKELETON_ROWS = 5;
// Rows above this index are usually on screen when the list first renders; later
// rows load their photos lazily as you scroll.
const EAGER_ROWS = 3;

type Props = { base: FragranceDetail | undefined; baseSlug: string; goal: Goal };

export function FragranceResults({ base, baseSlug, goal }: Props) {
  const owned = useOwnedIds();
  const [ownedOnly, setOwnedOnly] = useState(false);

  // "Owned only" sends the owned ids and lets the server filter the whole ranked list
  // (DECISIONS B21). Without the filter the ids stay out of the request and the key,
  // so pressing Own on a card doesn't refetch every loaded page; the card's badge
  // reads the guest store instead.
  const ownedFilter = ownedOnly ? owned : null;

  // One API page is 24 partners; "Show more" fetches the next page and appends it.
  // keepPreviousData keeps the old list on screen while a new goal loads, so the
  // list never collapses to nothing and back.
  const pairing = useInfiniteQuery({
    queryKey: ["pairing", baseSlug, goal, ownedFilter],
    queryFn: ({ pageParam }) => api.pairFragrance(baseSlug, goal, pageParam, ownedFilter ?? [], ownedOnly),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });

  const first = pairing.data?.pages[0];
  const matches = pairing.data?.pages.flatMap((page) => page.items) ?? [];
  const baseName = base?.name ?? first?.base.name ?? "";

  const ranked = first
    ? `${formatCount(first.total)} fragrances ranked to ${goal === "soften" ? "tone down" : "strengthen"} ${first.base.name}.`
    : null;
  const summary = ranked && ownedOnly ? `${ranked} Showing the ${formatCount(first!.matching)} you own.` : ranked;

  return (
    <>
      <ResultsHead
        goal={goal}
        summary={pairing.isError ? "" : summary}
        aside={<Switch label="Owned only" checked={ownedOnly} onChange={setOwnedOnly} />}
      />
      <div
        className={`border-t border-line-strong transition-opacity ${pairing.isPlaceholderData ? "opacity-50" : ""}`}
        aria-busy={pairing.isFetching}
      >
        {pairing.isError && <Notice role="alert">Could not load partners for this fragrance. Try again in a moment.</Notice>}
        {pairing.isPending && Array.from({ length: SKELETON_ROWS }, (_, i) => <MatchCardSkeleton key={i} />)}
        {first && first.total === 0 && (
          <Notice>
            Nothing in the catalogue is gentler than {first.base.name}, so there is nothing to soften it with. Try
            Enhance.
          </Notice>
        )}
        {first && first.total > 0 && first.matching === 0 && <Notice>{emptyOwnedMessage(owned.length, goal)}</Notice>}
        {matches.map((match, index) => (
          <MatchCard key={match.slug} match={match} goal={goal} lazy={index >= EAGER_ROWS} />
        ))}
      </div>
      {pairing.hasNextPage && (
        <div className="mt-10 flex justify-center">
          <OutlineButton onClick={() => pairing.fetchNextPage()} disabled={pairing.isFetchingNextPage}>
            {pairing.isFetchingNextPage ? "Loading…" : `Show more (${formatCount(first!.matching - matches.length)} left)`}
          </OutlineButton>
        </div>
      )}
      <RankFinder key={baseSlug} baseSlug={baseSlug} baseName={baseName} goal={goal} total={first?.total ?? null} />
    </>
  );
}

// "Owned only" came back empty. Soften leaves out partners as harsh as the base, so
// owning bottles is not enough for one to appear there.
function emptyOwnedMessage(ownedCount: number, goal: Goal): string {
  if (ownedCount === 0) return "You have not marked any bottles as Owned yet.";
  return goal === "soften"
    ? "None of your owned bottles are gentle enough to soften this one."
    : "None of your owned bottles are in this list.";
}
