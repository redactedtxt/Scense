import { Link } from "react-router";
import { BottleImage } from "../../components/BottleImage";
import { CollectionButtons } from "../../components/CollectionButtons";
import { ArrowIcon } from "../../components/Icons";
import { ScoreBar, Tag } from "../../components/ui";
import type { Goal, PairingMatch } from "../../lib/api";
import { useCollectionStatus } from "../../lib/collection";
import { padRank } from "../../lib/labels";
import { PairRating } from "./PairRating";

// Result rows from the Figma export (.match-card, .note-match-row) at its three widths:
// phone (to 640px), tablet (641 to 900px), desktop (901px up). Skeleton rows reuse the
// same grids and frame sizes, so swapping skeletons for results moves nothing.

const ROW_BASE =
  "grid items-center border-b border-line transition-[background,padding] duration-[180ms] sm:hover:bg-sunken sm:hover:px-3.5";

const MATCH_GRID = `${ROW_BASE} grid-cols-[32px_76px_1fr] gap-[13px] py-[18px]
  sm:grid-cols-[48px_88px_1fr_38px] sm:gap-[clamp(18px,2.6vw,42px)] sm:min-h-[142px] sm:py-0
  md:grid-cols-[65px_104px_minmax(260px,1.2fr)_minmax(230px,0.8fr)_45px]`;

const NOTE_GRID = `${ROW_BASE} grid-cols-[32px_minmax(0,1fr)] gap-[13px] py-[18px]
  sm:grid-cols-[48px_1fr_minmax(210px,0.8fr)] sm:gap-[clamp(18px,2.6vw,42px)] sm:min-h-[124px] sm:py-0
  md:grid-cols-[65px_minmax(260px,1.2fr)_minmax(230px,0.8fr)]`;

const BOTTLE_FRAME = "h-[90px] w-[76px] self-start sm:h-[94px] sm:w-[88px] sm:self-center md:size-[104px]";
const SCORE_CELL = "col-span-2 col-start-2 sm:col-span-1 sm:col-start-3 sm:pb-4 md:col-start-auto md:pb-0";
const NOTE_SCORE_CELL = "col-start-2 w-full sm:col-start-auto";

export function goalCaption(goal: Goal): string {
  return goal === "enhance" ? "Enhances" : "Softens";
}

function RankNumber({ rank }: { rank: number }) {
  return (
    <div
      aria-label={`Rank ${rank}`}
      className="self-start pt-[5px] font-display text-2xl leading-none text-gold-rank sm:self-center sm:pt-0 md:text-[31px]"
    >
      <span aria-hidden="true" className="mb-[5px] block font-sans text-[7px] font-semibold tracking-[0.16em] text-faint">
        NO.
      </span>
      <span aria-hidden="true">{padRank(rank)}</span>
    </div>
  );
}

type MatchCardProps = {
  match: PairingMatch;
  goal: Goal;
  lazy: boolean;
  // The base bottle, for the pair rating. Undefined only for a moment while it loads.
  baseId: number | undefined;
  baseName: string;
};

export function MatchCard({ match, goal, lazy, baseId, baseName }: MatchCardProps) {
  const href = `/f/${match.slug}`;
  // The badge reads the guest store, not the API's `owned` flag, so it appears the
  // moment Own is pressed instead of after the list refetches.
  const owned = useCollectionStatus(match.id) === "own";
  return (
    <article className={`group ${MATCH_GRID}`}>
      <RankNumber rank={match.rank} />
      <BottleImage src={match.imageUrl} family={match.dominantFamily} className={BOTTLE_FRAME} lazy={lazy} />
      <div className="min-w-0 self-start pt-[3px] sm:self-center sm:pt-0">
        <p className="kicker truncate">{match.brand}</p>
        <h3 className="mt-[5px] mb-[9px] font-display text-[21px] leading-[1.05] font-medium md:mb-2.5 md:text-[clamp(22px,2vw,29px)]">
          <Link to={href} className="hover:text-gold-bright">
            {match.name}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{match.dominantFamily}</Tag>
          {owned && <Tag tone="owned">Owned</Tag>}
        </div>
        <div className="mt-2.5">
          <CollectionButtons fragrance={match} size="compact" name={match.name} />
        </div>
      </div>
      <div className={SCORE_CELL}>
        <ScoreBar score={match.score} caption={goalCaption(goal)} />
        <PairRating baseId={baseId} baseName={baseName} partnerId={match.id} partnerName={match.name} goal={goal} />
      </div>
      {/* Same destination as the name link, so it is skipped by Tab and screen readers. */}
      <Link
        to={href}
        tabIndex={-1}
        aria-hidden="true"
        className="col-start-4 row-span-2 row-start-1 hidden size-[38px] place-items-center rounded-full border border-line-control stroke-gold-icon transition-colors duration-[180ms] hover:border-gold-deep hover:bg-gold-deep hover:stroke-on-gold sm:grid md:col-start-auto md:row-span-1 md:row-start-auto"
      >
        <ArrowIcon />
      </Link>
    </article>
  );
}

export function MatchCardSkeleton() {
  return (
    <div className={MATCH_GRID} aria-hidden="true">
      <div className="skeleton h-6 w-6 self-start sm:self-center" />
      <div className={`skeleton ${BOTTLE_FRAME}`} />
      <div className="min-w-0 self-start pt-[3px] sm:self-center sm:pt-0">
        <div className="skeleton h-2.5 w-24" />
        <div className="skeleton mt-[9px] mb-[11px] h-[21px] w-3/4 md:h-7" />
        <div className="skeleton h-[22px] w-24 rounded-full" />
        <div className="skeleton mt-2.5 h-[26px] w-[132px] rounded-full" />
      </div>
      <div className={SCORE_CELL}>
        <div className="skeleton h-[52px] w-full" />
        <div className="skeleton mt-3 h-[34px] w-[120px]" />
      </div>
    </div>
  );
}

export type NoteMatch = { note: string; rank: number; score: number; dominantFamily: string };

export function NoteMatchRow({ match, goal }: { match: NoteMatch; goal: Goal }) {
  return (
    <article className={NOTE_GRID}>
      <RankNumber rank={match.rank} />
      <div className="min-w-0">
        <p className="kicker">Layering note</p>
        <h3 className="mt-[5px] mb-[9px] font-display text-[23px] leading-[1.05] font-medium md:text-[clamp(25px,2.2vw,32px)]">
          {match.note}
        </h3>
        <Tag>{match.dominantFamily}</Tag>
      </div>
      <div className={NOTE_SCORE_CELL}>
        <ScoreBar score={match.score} caption={goalCaption(goal)} />
      </div>
    </article>
  );
}

export function NoteMatchSkeleton() {
  return (
    <div className={NOTE_GRID} aria-hidden="true">
      <div className="skeleton h-6 w-6" />
      <div className="min-w-0">
        <div className="skeleton h-2.5 w-24" />
        <div className="skeleton mt-[9px] mb-[11px] h-[23px] w-1/2 md:h-8" />
        <div className="skeleton h-[22px] w-24 rounded-full" />
      </div>
      <div className={NOTE_SCORE_CELL}>
        <div className="skeleton h-[52px] w-full" />
      </div>
    </div>
  );
}
