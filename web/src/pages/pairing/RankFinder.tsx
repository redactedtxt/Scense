import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Combobox, SuggestionRow } from "../../components/Combobox";
import { api, type FragranceSummary, type Goal } from "../../lib/api";
import { useFragranceSuggestions } from "../../lib/queries";

type Props = { baseSlug: string; baseName: string; goal: Goal; total: number | null };

// "Find my bottle's rank": pick any fragrance and see where it sits in this base's list,
// even if it is far below the loaded pages. Fragrance mode only (SPEC section 11).
export function RankFinder({ baseSlug, baseName, goal, total }: Props) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<FragranceSummary | null>(null);
  const suggestions = useFragranceSuggestions(text);

  return (
    <div className="mt-[55px] grid grid-cols-1 items-center gap-6 border border-line-strong bg-panel-alt px-[21px] py-[27px] sm:mt-[74px] sm:grid-cols-2 sm:gap-[45px] sm:px-[34px] sm:py-[31px] md:grid-cols-[1fr_minmax(300px,0.75fr)_minmax(160px,auto)]">
      <div>
        <p className="kicker">Already have something in mind?</p>
        <h2 className="mt-[7px] mb-0 font-display text-[30px] font-medium">Find my bottle&apos;s rank</h2>
      </div>
      <Combobox
        size="small"
        label="Find my bottle's rank"
        placeholder="Search any fragrance"
        value={text}
        onValueChange={setText}
        items={suggestions.data ?? []}
        loading={suggestions.isFetching}
        itemKey={(f) => f.slug}
        renderItem={(f) => (
          <SuggestionRow title={f.name} detail={f.brand} image={{ src: f.imageUrl, family: f.dominantFamily }} />
        )}
        onSelect={(f) => {
          setPicked(f);
          setText(f.name);
        }}
        emptyText="No fragrance in the catalogue matches."
      />
      <div aria-live="polite" className="min-h-[46px] sm:col-start-2 md:col-start-auto">
        {picked ? (
          <RankAnswer base={{ slug: baseSlug, name: baseName }} partner={picked} goal={goal} />
        ) : (
          <RankLine name="Your bottle" figure="#—" total={total} faded />
        )}
      </div>
    </div>
  );
}

function RankAnswer({
  base,
  partner,
  goal,
}: {
  base: { slug: string; name: string };
  partner: FragranceSummary;
  goal: Goal;
}) {
  const same = partner.slug === base.slug;
  const rank = useQuery({
    queryKey: ["rank", base.slug, partner.slug, goal],
    queryFn: () => api.rank(base.slug, partner.slug, goal),
    enabled: !same,
  });

  if (same) return <Message>That is the base itself, so it has no rank in its own list.</Message>;
  if (rank.isError) return <Message>Could not look up that rank. Try again in a moment.</Message>;
  if (!rank.data) return <RankLine name={partner.name} figure="#…" total={null} faded />;
  if (rank.data.status === "too_harsh") {
    return <Message>{partner.name} is too harsh to soften this base.</Message>;
  }
  return (
    <div>
      <RankLine name={partner.name} figure={`#${rank.data.rank}`} total={rank.data.total} slug={partner.slug} />
      <span className="sr-only">{`in ${base.name}'s ${goal} list`}</span>
    </div>
  );
}

// .rank-result: name on the left, "#38 of 299" on the right.
function RankLine(props: { name: string; figure: string; total: number | null; faded?: boolean; slug?: string }) {
  return (
    <div className={`flex items-center justify-between gap-5 transition-opacity duration-[180ms] ${props.faded ? "opacity-25" : ""}`}>
      <span className="min-w-0 font-display text-base text-muted">
        {props.slug ? (
          <Link to={`/f/${props.slug}`} className="hover:text-text-bright">
            {props.name}
          </Link>
        ) : (
          props.name
        )}
      </span>
      <strong className="font-display text-[30px] font-normal whitespace-nowrap text-gold-bright">
        {props.figure}{" "}
        <small className="font-sans text-[8px] tracking-[0.1em] text-faint uppercase">
          of {props.total ?? "—"}
        </small>
      </strong>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 font-display text-base leading-snug text-muted">
      {children}
    </p>
  );
}
