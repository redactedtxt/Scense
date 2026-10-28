import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BottleImage } from "../components/BottleImage";
import { SearchIcon } from "../components/Icons";
import { BrandLink, PriceLine } from "../components/Price";
import { Notice, OutlineButton, Segmented, Tag } from "../components/ui";
import { api, ApiError, type FragranceSummary, type Sort } from "../lib/api";
import { formatCount } from "../lib/labels";
import { useFamilies } from "../lib/queries";
import { useDebounced } from "../lib/useDebounced";

const GENDER_OPTIONS = [
  { value: "", label: "All" },
  { value: "male", label: "Men" },
  { value: "female", label: "Women" },
  { value: "unisex", label: "Unisex" },
];
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "popular", label: "Most popular" },
  { value: "least-popular", label: "Least popular" },
  { value: "highest-rated", label: "Highest rated" },
];
const DEFAULT_SORT: Sort = "popular";
const PAGE_SIZE = 24;
// The first row of cards is on screen at load; the rest load their photos lazily.
const EAGER_CARDS = 4;

// "/browse": the catalogue grid. Search, filters, sort, and page live in the URL, so the
// back button and shared links restore the same view. With ?brand= it is that brand's
// page (DECISIONS B42): the same grid, filters, and sort, under the brand's name.
export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get("q") ?? "",
    gender: params.get("gender") ?? "",
    family: params.get("family") ?? "",
    brand: params.get("brand") ?? "",
    // An unknown ?sort= is ignored, like the default, which stays out of the URL.
    sort: SORT_OPTIONS.find((o) => o.value === params.get("sort"))?.value ?? ("" as const),
    page: Math.max(1, Number(params.get("page")) || 1),
  };

  // Changing any filter or the sort goes back to page 1.
  function setFilter(key: FilterKey, value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && !(key === "sort" && value === DEFAULT_SORT)) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: key === "q" },
    );
  }

  function setPage(page: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(page));
      return next;
    });
    window.scrollTo({ top: 0 });
  }

  // Same key shape as useCatalogueTotal, so the unfiltered first page is shared.
  const list = useQuery({
    queryKey: ["fragrances", filters],
    queryFn: () => api.fragrances(filters),
    placeholderData: keepPreviousData,
  });

  // The brand as the catalogue spells it, once the API has said ("ysl" is Yves Saint Laurent).
  const brandName = list.data?.brand ?? (filters.brand || null);
  const unknownBrand = list.error instanceof ApiError && list.error.code === "unknown_brand";

  return (
    <>
      <title>{brandName ? `${brandName} · Scense` : "Browse · Scense"}</title>
      {filters.brand ? <BrandHeading brand={brandName ?? filters.brand} /> : <CatalogueHeading />}
      <Filters filters={filters} onChange={setFilter} />
      <ResultCount
        total={list.data?.total}
        fuzzy={list.data?.fuzzy ?? false}
        filters={filters}
        onSortChange={(sort) => setFilter("sort", sort)}
      />
      <div aria-busy={list.isFetching} className={`transition-opacity ${list.isPlaceholderData ? "opacity-50" : ""}`}>
        {unknownBrand && <Notice role="alert">There is no brand called “{filters.brand}” in the catalogue.</Notice>}
        {list.isError && !unknownBrand && <Notice role="alert">Could not load the catalogue. Try again in a moment.</Notice>}
        {list.data?.total === 0 && <Notice>No fragrance matches. Try a shorter search or clear a filter.</Notice>}
        <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-10 p-0 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 md:gap-x-8">
          {list.isPending && Array.from({ length: PAGE_SIZE }, (_, i) => <CardSkeleton key={i} />)}
          {list.data?.items.map((f, index) => (
            <FragranceCard key={f.slug} fragrance={f} lazy={index >= EAGER_CARDS} />
          ))}
        </ul>
      </div>
      {list.data && list.data.totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-4 pt-14 pb-20">
          <OutlineButton onClick={() => setPage(filters.page - 1)} disabled={filters.page <= 1}>
            Previous
          </OutlineButton>
          <span className="text-[10px] tracking-label text-dim uppercase">
            Page {filters.page} of {list.data.totalPages}
          </span>
          <OutlineButton onClick={() => setPage(filters.page + 1)} disabled={filters.page >= list.data.totalPages}>
            Next
          </OutlineButton>
        </nav>
      )}
      {list.data && list.data.totalPages <= 1 && <div className="pb-20" />}
    </>
  );
}

function CatalogueHeading() {
  return (
    <section className="pt-[58px] pb-10 sm:pt-[72px] sm:pb-12">
      <p className="kicker">The catalogue</p>
      <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
        Browse <em className="accent">every bottle.</em>
      </h1>
      <p className="m-0 max-w-[485px] font-display text-lg leading-[1.45] text-soft sm:text-xl">
        The most-voted fragrances on Fragrantica, with notes, accords, and community ratings.
      </p>
    </section>
  );
}

// A brand page's heading: the brand's name, and a way back to every brand.
function BrandHeading({ brand }: { brand: string }) {
  return (
    <section className="pt-[58px] pb-10 sm:pt-[72px] sm:pb-12">
      <Link to="/browse" className="kicker inline-block hover:text-gold-bright">
        ← All brands
      </Link>
      <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.92] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
        {brand}
      </h1>
      <p className="m-0 max-w-[485px] font-display text-lg leading-[1.45] text-soft sm:text-xl">
        Every {brand} bottle in the catalogue, with the same search, filters, and sort.
      </p>
    </section>
  );
}

type Filters = { q: string; gender: string; family: string; brand: string; sort: Sort | ""; page: number };
type FilterKey = "q" | "gender" | "family" | "sort";

function Filters({ filters, onChange }: { filters: Filters; onChange: (key: FilterKey, v: string) => void }) {
  const families = useFamilies();
  // The box updates instantly; the URL (and so the request) waits for a typing pause.
  const [text, setText] = useState(filters.q);
  const settled = useDebounced(text, 250);
  useEffect(() => {
    if (settled !== filters.q) onChange("q", settled.trim());
    // Only a settled change of the text should trigger this, not a new onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <div className="grid grid-cols-1 gap-6 border-y border-line-strong py-6 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)_220px] md:items-end md:gap-10">
      <label className="grid min-h-[46px] grid-cols-[20px_1fr] items-center gap-3 border-b border-line-input">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search by name or brand"
          placeholder="Search by name or brand…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-full min-w-0 border-0 bg-transparent font-display text-[19px] text-text-input outline-0 placeholder:text-faint"
        />
      </label>
      <Segmented label="Gender" options={GENDER_OPTIONS} value={filters.gender} onChange={(v) => onChange("gender", v)} />
      <label className="block">
        <span className="kicker mb-2 block">Family</span>
        <select
          value={filters.family}
          onChange={(event) => onChange("family", event.target.value)}
          className="h-[46px] w-full cursor-pointer border border-line-control bg-panel px-3 font-display text-[17px] text-text-input"
        >
          <option value="">All families</option>
          {families.data?.items.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// The count on the left, the sort control on the right. Close matches (the typo fallback)
// say so, since they are ordered by closeness and the sort does not apply to them.
function ResultCount(props: {
  total: number | undefined;
  fuzzy: boolean;
  filters: Filters;
  onSortChange: (sort: string) => void;
}) {
  const { total, fuzzy, filters } = props;
  const filtered = filters.q || filters.gender || filters.family || filters.brand;
  const noun = total === 1 ? "fragrance" : "fragrances";
  const text = fuzzy
    ? `No exact match for “${filters.q}”. Showing ${formatCount(total ?? 0)} close ${total === 1 ? "match" : "matches"}.`
    : `${formatCount(total ?? 0)} ${noun}${filtered ? " match" : ""}.`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6">
      <p aria-live="polite" className="m-0 min-h-[1.6em] text-xs leading-[1.6] text-dim">
        {total === undefined ? " " : text}
      </p>
      <label className="flex items-center gap-3">
        <span className="kicker">Sort by</span>
        <select
          value={filters.sort || DEFAULT_SORT}
          onChange={(event) => props.onSortChange(event.target.value)}
          className="h-[38px] cursor-pointer border border-line-control bg-panel px-3 font-display text-[16px] text-text-input"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// One grid card: photo in a fixed 3:4 frame, then brand, a two-line name, family, rating,
// and the price guide. The name's link stretches over the whole card (its ::after), so a
// click anywhere opens the bottle, while the brand link and the tier label sit above that
// layer as their own controls (a link can't hold another link or a button).
//
// The photo shows in true colour on white with a thin accent-gold frame, brighter on hover
// and focus (DECISIONS B42); elsewhere photos keep the sepia paper look (B19).
function FragranceCard({ fragrance: f, lazy }: { fragrance: FragranceSummary; lazy: boolean }) {
  return (
    <li className="group relative">
      <BottleImage
        src={f.imageUrl}
        family={f.dominantFamily}
        tone="true"
        className="aspect-[3/4] w-full outline-1 outline-gold-pale/45 transition-[outline-color] group-focus-within:outline-gold-pale group-hover:outline-gold-pale"
        lazy={lazy}
      />
      <p className="kicker mt-4 truncate">
        <BrandLink brand={f.brand} />
      </p>
      {/* leading 1.25 makes each line of the name link 24px or more, the minimum tap height. */}
      <h2 className="mt-2 mb-3 line-clamp-2 min-h-[2.5em] font-display text-[19px] leading-[1.25] font-medium sm:text-[22px]">
        <Link to={`/f/${f.slug}`} className="after:absolute after:inset-0 group-hover:text-gold-bright">
          {f.name}
        </Link>
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tag>{f.dominantFamily}</Tag>
        {f.communityRating !== null && (
          <span className="text-[10px] text-dim">
            <span className="text-gold-bright">{f.communityRating.toFixed(2)}</span>
            <span className="sr-only"> out of 5</span> · {formatCount(f.ratingVotes ?? 0)} votes
          </span>
        )}
      </div>
      <div className="relative z-10 mt-2.5 w-fit">
        <PriceLine info={f} compact />
      </div>
    </li>
  );
}

function CardSkeleton() {
  return (
    <li aria-hidden="true">
      <div className="skeleton aspect-[3/4] w-full" />
      <div className="skeleton mt-4 h-2.5 w-20" />
      <div className="skeleton mt-1.5 mb-3 h-[2.1em] w-4/5 text-[19px] sm:text-[22px]" />
      <div className="skeleton h-[22px] w-24 rounded-full" />
    </li>
  );
}
