import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { BottleImage } from "../components/BottleImage";
import { FamilyWheel } from "../components/FamilyWheel";
import { ArrowIcon } from "../components/Icons";
import { FamilyTag, Notice } from "../components/ui";
import { ApiError, type FragranceDetail, type Layer } from "../lib/api";
import { familyColor, formatCount, genderLabel, percent, SEASON_ORDER, seasonLabel } from "../lib/labels";
import { useFragrance } from "../lib/queries";
import { NotFoundPage } from "./NotFoundPage";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "heart", label: "Heart" },
  { key: "base", label: "Base" },
  { key: "flat", label: "Notes" },
];
const STRENGTH_STEPS = 4;

// "/f/:slug": one fragrance. Want/Own buttons arrive with guest mode in M5, and
// written reviews in pass 2.
export function FragrancePage() {
  const { slug = "" } = useParams();
  const fragrance = useFragrance(slug);

  if (fragrance.error instanceof ApiError && fragrance.error.status === 404) {
    return <NotFoundPage message="That fragrance is not in the catalogue." />;
  }
  if (fragrance.isError) return <Notice role="alert">Could not load this fragrance. Try again in a moment.</Notice>;

  const f = fragrance.data;
  return (
    <article className="pt-10 pb-20 sm:pt-14 sm:pb-[110px]">
      <title>{f ? `${f.name} by ${f.brand} · Scense` : "Scense"}</title>
      <Link to="/browse" className="kicker inline-block hover:text-gold-bright">
        ← Catalogue
      </Link>
      <div className="mt-8 grid grid-cols-1 gap-10 sm:grid-cols-[minmax(0,300px)_1fr] sm:gap-12 md:grid-cols-[minmax(0,380px)_1fr] md:gap-16">
        {f ? (
          <BottleImage
            src={f.imageUrl}
            family={f.dominantFamily}
            alt={`${f.name} bottle`}
            className="aspect-[3/4] w-full max-w-[260px] sm:max-w-[380px]"
          />
        ) : (
          <div className="skeleton aspect-[3/4] w-full max-w-[260px] sm:max-w-[380px]" />
        )}
        {f ? <Summary f={f} /> : <SummarySkeleton />}
      </div>
      {f && <Details f={f} />}
    </article>
  );
}

function Summary({ f }: { f: FragranceDetail }) {
  const meta = [genderLabel(f.gender), f.releaseYear].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 self-center">
      <p className="kicker">{f.brand}</p>
      <h1 className="mt-4 mb-5 font-display text-[44px] leading-[0.92] font-medium tracking-heading sm:text-[clamp(44px,5vw,72px)]">
        {f.name}
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <FamilyTag family={f.dominantFamily} />
        {meta && <span className="text-[10px] tracking-tag text-dim uppercase">{meta}</span>}
      </div>
      <dl className="mt-9 grid grid-cols-2 gap-6 border-y border-line py-6 sm:max-w-[460px]">
        <div>
          <dt className="label-caps text-dim">Community rating</dt>
          <dd className="m-0 mt-2 font-display text-[34px] leading-none text-gold-bright">
            {f.communityRating?.toFixed(2) ?? "—"}
            <span className="ml-1 text-base text-dim">/ 5</span>
          </dd>
          <dd className="m-0 mt-1.5 text-[10px] text-dim">{formatCount(f.ratingVotes ?? 0)} votes</dd>
        </div>
        <div>
          <dt className="label-caps text-dim">Strength</dt>
          <dd className="m-0 mt-2 font-display text-[34px] leading-none text-gold-bright">
            {f.strength}
            <span className="ml-1 text-base text-dim">/ {STRENGTH_STEPS}</span>
          </dd>
          <dd className="m-0 mt-2.5 flex gap-1" aria-hidden="true">
            {Array.from({ length: STRENGTH_STEPS }, (_, i) => (
              <span key={i} className={`h-0.5 w-7 ${i < f.strength ? "bg-gold-bright" : "bg-line"}`} />
            ))}
          </dd>
        </div>
      </dl>
      <Link
        to={`/?f=${f.slug}`}
        className="mt-9 inline-flex h-[46px] items-center gap-3 bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold"
      >
        Pair this <ArrowIcon className="stroke-on-gold" />
      </Link>
      <p className="mt-3 mb-0 text-[10px] text-dim">Strength comes from community longevity and sillage votes.</p>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="self-center" aria-hidden="true">
      <div className="skeleton h-2.5 w-24" />
      <div className="skeleton mt-4 mb-5 h-[88px] w-4/5" />
      <div className="skeleton h-[22px] w-40 rounded-full" />
      <div className="skeleton mt-9 h-[120px] w-full max-w-[460px]" />
      <div className="skeleton mt-9 h-[46px] w-40" />
    </div>
  );
}

function Details({ f }: { f: FragranceDetail }) {
  return (
    <div className="mt-16 grid grid-cols-1 gap-px border border-line-strong bg-line-strong sm:mt-20 md:grid-cols-2">
      <Panel kicker="Notes" title="The pyramid">
        <Pyramid notes={f.notes} />
      </Panel>
      <Panel kicker="Accords" title="What it smells like">
        <Accords accords={f.accords} />
      </Panel>
      <Panel kicker="Family profile" title="On the wheel">
        <Profile f={f} />
      </Panel>
      <Panel kicker="When to wear it" title="Season and time">
        <WhenToWear f={f} />
      </Panel>
    </div>
  );
}

function Panel({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="bg-panel px-5 py-8 sm:px-[34px] sm:py-[31px]">
      <p className="kicker">{kicker}</p>
      <h2 className="mt-[7px] mb-6 font-display text-[30px] font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Pyramid({ notes }: { notes: FragranceDetail["notes"] }) {
  const layers = LAYERS.filter((layer) => notes[layer.key].length > 0);
  if (layers.length === 0) return <p className="m-0 text-xs text-dim">The dataset lists no notes for this fragrance.</p>;
  return (
    <dl className="m-0 grid gap-5">
      {layers.map((layer) => (
        <div key={layer.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[64px_1fr] sm:gap-4">
          <dt className="label-caps pt-2.5 text-dim">{layer.label}</dt>
          <dd className="m-0 flex flex-wrap gap-2">
            {notes[layer.key].map((note) => (
              <span
                key={note.name}
                className="rounded-full border border-line-control px-3 py-[7px] font-display text-[15px] text-muted"
              >
                {note.name}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Accords({ accords }: { accords: FragranceDetail["accords"] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {accords.map((a) => (
        <li key={a.accord} className="grid grid-cols-[110px_1fr] items-center gap-4 sm:grid-cols-[130px_1fr]">
          <span className="truncate font-display text-[17px] text-text capitalize">{a.accord}</span>
          <Bar share={a.strength / 100} label={`${a.accord} ${Math.round(a.strength)} of 100`} />
        </li>
      ))}
    </ul>
  );
}

// A thin labelled bar for shares from 0 to 1. The visible bar is decorative; the
// label carries the number for screen readers.
function Bar({ share, label }: { share: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="block h-1.5 bg-line">
      <span
        className="block h-full bg-linear-to-r from-gold-dark to-gold-bright"
        style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` }}
      />
    </span>
  );
}

function Profile({ f }: { f: FragranceDetail }) {
  const top = [...f.familyProfile].sort((a, b) => b.share - a.share).slice(0, 4);
  return (
    <div className="grid grid-cols-1 items-center gap-8 sm:grid-cols-[220px_1fr]">
      <FamilyWheel slices={f.familyProfile} />
      <ul className="m-0 grid list-none gap-3 p-0">
        {top.map((family) => (
          <li key={family.id} className="flex items-center justify-between gap-4 border-b border-line pb-2">
            <span className="flex items-center gap-2.5 font-display text-[17px]">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: familyColor(family.name) }} />
              {family.name}
            </span>
            <span className="text-xs text-gold-bright">{percent(family.share)}</span>
          </li>
        ))}
        <li className="text-[10px] leading-relaxed text-dim">
          Shares of the 14 fragrance-wheel families, built from the accords and their vote strengths.{" "}
          <Link to="/about" className="text-gold-kicker hover:text-gold-bright">
            How this works
          </Link>
        </li>
      </ul>
    </div>
  );
}

function WhenToWear({ f }: { f: FragranceDetail }) {
  const rows = [
    ...SEASON_ORDER.map((season) => ({ label: seasonLabel(season), share: f.seasons[season] })),
    { label: "Day", share: f.daynight.day },
    { label: "Night", share: f.daynight.night },
  ];
  return (
    <>
      <ul className="m-0 grid list-none gap-3 p-0">
        {rows.map((row, index) => (
          <li
            key={row.label}
            className={`grid grid-cols-[70px_1fr_40px] items-center gap-4 ${index === SEASON_ORDER.length ? "mt-4" : ""}`}
          >
            <span className="font-display text-[17px]">{row.label}</span>
            <Bar share={row.share} label={`${row.label} ${percent(row.share)}`} />
            <span className="text-right text-xs text-dim">{percent(row.share)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 mb-0 text-[10px] text-dim">Shares of community season and time-of-day votes.</p>
    </>
  );
}
