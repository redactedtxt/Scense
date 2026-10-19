import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ringPoint } from "../components/FamilyWheel";
import { Segmented } from "../components/ui";
import { api, type Family, type Goal } from "../lib/api";
import { familyColor } from "../lib/labels";
import { useFamilies } from "../lib/queries";

const RING_SIZE = 14;
// The project's own example pair (DECISIONS B17): a well-known Aventus alternative.
const EXAMPLE_BASE = { slug: "creed-aventus-2010", name: "Creed Aventus" };
const EXAMPLE_PARTNER = { slug: "armaf-club-de-nuit-intense-man-2015", name: "Club de Nuit Intense Man" };

// Ring distance: steps around the shorter way, 0 to 7.
export function ringDistance(i: number, j: number): number {
  const gap = Math.abs(i - j);
  return Math.min(gap, RING_SIZE - gap);
}

// "/about": how the scores work, for recruiters and curious users.
export function AboutPage() {
  const families = useFamilies();
  return (
    <>
      <title>How it works · Scense</title>
      <section className="pt-[58px] pb-12 sm:pt-[72px] sm:pb-16">
        <p className="kicker">How Scense works</p>
        <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
          Two goals, <em className="font-normal text-gold-pale">one wheel.</em>
        </h1>
        <p className="m-0 max-w-[560px] font-display text-lg leading-[1.45] text-soft sm:text-xl">
          Every layering score comes from the fragrance wheel, community votes, and a short list of tunable numbers.
          Nothing is a black box: this page walks through the whole method.
        </p>
      </section>

      <Step number="01" title="The wheel">
        <p>
          Perfumers sort scents with the Michael Edwards fragrance wheel: 14 families arranged in a ring, where
          neighbours smell alike and opposites contrast. Scense gives every fragrance a <Em>profile</Em>, the share of
          each family in its scent. The shares come from the fragrance&apos;s accords (such as &ldquo;warm
          spicy&rdquo; or &ldquo;citrus&rdquo;), weighted by how strongly the Fragrantica community voted for each one.
        </p>
        <p>
          Six <Em>facets</Em> patch what the wheel misses: sweet, creamy, powdery, spicy, smoky, and sharp. The wheel
          has no gourmand or spicy family of its own.
        </p>
      </Step>

      <Step number="02" title="Ring distance">
        <p>
          Distance is the number of steps between two families the short way round, from 0 (same family) to 7 (directly
          opposite): <code className="text-gold-bright">d = min(|i − j|, 14 − |i − j|)</code>. Pick a family to see its
          distance to every other one.
        </p>
        {families.data ? <RingDiagram families={families.data.items} /> : <div className="skeleton mt-8 aspect-square w-full max-w-[560px]" />}
      </Step>

      <Step number="03" title="Enhance: more of what you have">
        <p>
          Enhance looks for partners that sit close to your fragrance on the wheel and share its facets. Close families
          count a lot, families four or more steps away count nothing. The score is a similarity, so a fragrance matches
          itself best and its near-clones come next. A stronger partner is fine: it amplifies the base.
        </p>
        <LiveExample />
      </Step>

      <Step number="04" title="Soften: take the edge off">
        <p>
          Soften favours partners from the far side of the wheel, and it only considers partners that are{" "}
          <Em>gentler</Em> than the base. Each fragrance gets a harshness score from its families (below) plus nudges
          from its facets: sweet, creamy, and powdery calm a scent down; spicy, smoky, and sharp make it harsher.
        </p>
        <p>
          A bigger harshness gap earns a bigger boost. A partner much weaker than the base takes a penalty, because the
          base would bury it.
        </p>
        {families.data && <HarshnessList families={families.data.items} />}
      </Step>

      <Step number="05" title="Notes and fragrances">
        <p>
          Notes work the same way. The most common notes each have a reviewed wheel profile; picking several
          averages them, and the results are single notes. Notes are scored live on every request, because that list is short.
        </p>
        <p>
          Fragrance pairs are computed ahead of time: every fragrance against every other, for both goals, with a rank.
          That turns &ldquo;where does my bottle land?&rdquo; into one indexed database lookup.
        </p>
      </Step>

      <Step number="06" title="Where the data comes from">
        <p>
          The catalogue is the 1,000 most-voted fragrances in the Decant dataset on Kaggle, which collects Fragrantica
          community data: accords, notes, ratings, and longevity, sillage, season, and day/night votes. Strength (1 to
          4) comes from the longevity and sillage votes. No fragrance fact is generated by an AI.
        </p>
        <p>
          The honest limit: the wheel classifies scents, it does not prove a pair smells good. The numbers are a
          starting point, tuned by hand by spraying real combinations.
        </p>
        <p className="mt-8">
          <Link
            to="/"
            className="inline-flex h-[46px] items-center bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase hover:bg-gold"
          >
            Try a pairing
          </Link>
        </p>
      </Step>
      <div className="pb-20 sm:pb-[110px]" />
    </>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t border-line-strong py-12 sm:py-16 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] md:gap-12">
      <div>
        <p className="kicker">{number}</p>
        <h2 className="mt-2 mb-0 font-display text-[38px] leading-none font-medium tracking-heading sm:text-[clamp(38px,4.2vw,52px)]">
          {title}
        </h2>
      </div>
      <div className="max-w-[640px] text-sm leading-[1.75] text-soft [&_p]:mt-0 [&_p]:mb-4">{children}</div>
    </section>
  );
}

function Em({ children }: { children: ReactNode }) {
  return <em className="font-display text-[1.15em] text-gold-pale">{children}</em>;
}

// The 14 families on a ring. Choosing one labels every other family with its distance
// and shades it by which goal that distance favours.
function RingDiagram({ families }: { families: Family[] }) {
  const [selected, setSelected] = useState(0);
  const [goal, setGoal] = useState<Goal>("enhance");
  const size = 560;
  const c = size / 2;

  return (
    <div className="mt-8">
      <div className="mb-6 max-w-[280px]">
        <Segmented
          label="Shade by goal"
          options={[
            { value: "enhance", label: "Enhance" },
            { value: "soften", label: "Soften" },
          ]}
          value={goal}
          onChange={setGoal}
        />
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[560px]" role="group" aria-label="Fragrance wheel">
        <circle cx={c} cy={c} r={c * 0.62} fill="none" stroke="var(--color-line-strong)" />
        {families.map((family) => {
          const d = ringDistance(selected, family.id);
          return (
            <RingNode
              key={family.id}
              family={family}
              centre={c}
              distance={d}
              selected={family.id === selected}
              strength={goal === "enhance" ? Math.max(0, 1 - d / 4) : d / 7}
              onSelect={() => setSelected(family.id)}
            />
          );
        })}
        <text x={c} y={c - 6} textAnchor="middle" className="fill-text font-display text-[26px]">
          {families[selected]?.name}
        </text>
        <text x={c} y={c + 20} textAnchor="middle" className="fill-dim text-[11px] tracking-[0.13em] uppercase">
          {goal === "enhance" ? "Brighter = closer = enhances" : "Brighter = farther = softens"}
        </text>
      </svg>
    </div>
  );
}

function RingNode(props: {
  family: Family;
  centre: number;
  distance: number;
  selected: boolean;
  strength: number;
  onSelect: () => void;
}) {
  const { family, centre, distance, selected } = props;
  const node = ringPoint(centre, centre * 0.62, family.id);
  const label = ringPoint(centre, centre * 0.86, family.id);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${family.name}, distance ${distance}`}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
      className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-gold [&:focus-visible>circle]:stroke-2"
    >
      <circle
        cx={node.x}
        cy={node.y}
        r={selected ? 24 : 20}
        fill={familyColor(family.name)}
        fillOpacity={selected ? 1 : 0.15 + 0.75 * props.strength}
        stroke={selected ? "var(--color-gold-bright)" : "var(--color-ink)"}
        strokeWidth={selected ? 2 : 1}
      />
      {/* A dark outline under the digit keeps it readable on both bright and faded nodes. */}
      <text
        x={node.x}
        y={node.y + 6}
        textAnchor="middle"
        paintOrder="stroke"
        stroke="var(--color-ink)"
        strokeWidth={3}
        className="pointer-events-none fill-text-bright font-display text-[18px]"
      >
        {selected ? "0" : distance}
      </text>
      <text
        x={label.x}
        y={label.y + 4}
        textAnchor="middle"
        className={`pointer-events-none text-[11px] ${selected ? "fill-text-bright" : "fill-muted"}`}
      >
        {family.name}
      </text>
    </g>
  );
}

function HarshnessList({ families }: { families: Family[] }) {
  const sorted = [...families].sort((a, b) => a.harshness - b.harshness);
  return (
    <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-x-8 gap-y-2.5 p-0 sm:grid-cols-2">
      {sorted.map((f) => (
        <li key={f.id} className="grid grid-cols-[130px_1fr_36px] items-center gap-3 text-xs">
          <span className="text-text">{f.name}</span>
          <span className="block h-1.5 bg-line" aria-hidden="true">
            <span className="block h-full" style={{ width: `${f.harshness * 100}%`, background: familyColor(f.name) }} />
          </span>
          <span className="text-right text-dim">{f.harshness.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

// A live lookup, so the page proves the claim with the real catalogue.
function LiveExample() {
  const rank = useQuery({
    queryKey: ["rank", EXAMPLE_BASE.slug, EXAMPLE_PARTNER.slug, "enhance"],
    queryFn: () => api.rank(EXAMPLE_BASE.slug, EXAMPLE_PARTNER.slug, "enhance"),
  });
  const figure = rank.data?.status === "ranked" ? `#${rank.data.rank} of ${rank.data.total}` : "…";
  return (
    <div className="mt-6 border border-line-strong bg-panel-alt px-6 py-5">
      <p className="kicker">Live from the catalogue</p>
      <p className="mt-2 mb-0 font-display text-xl leading-snug text-text">
        {EXAMPLE_PARTNER.name}, a well-known alternative to {EXAMPLE_BASE.name}, ranks{" "}
        <span className="text-gold-bright">{figure}</span> in{" "}
        <Link to={`/?f=${EXAMPLE_BASE.slug}&goal=enhance`} className="underline decoration-gold-line underline-offset-4 hover:text-gold-bright">
          Aventus&apos;s Enhance list
        </Link>
        .
      </p>
    </div>
  );
}
