import { Link, useSearchParams } from "react-router";
import { BottleImage } from "../components/BottleImage";
import { CollectionButtons } from "../components/CollectionButtons";
import { ArrowIcon } from "../components/Icons";
import { Notice, Tag, TextTabs } from "../components/ui";
import { useCollection } from "../lib/collection";
import type { CollectionStatus, SavedFragrance } from "../lib/guestStore";

const PANEL_ID = "collection-panel";
const EMPTY_MESSAGES: Record<CollectionStatus, string> = {
  own: "You have not marked any bottles as Owned yet.",
  want: "Your Want list is empty.",
};

// "/me": the guest's Own and Want lists, read from guestStore (no API call: each saved
// entry carries the name, brand, and image it needs). The taste profile card joins
// this page with the pass 2 chatbot. The open tab lives in the URL (?tab=want).
export function MePage() {
  const [params, setParams] = useSearchParams();
  const tab: CollectionStatus = params.get("tab") === "want" ? "want" : "own";
  const collection = useCollection();
  const shown = collection.filter((item) => item.status === tab);
  const count = (status: CollectionStatus) => collection.filter((item) => item.status === status).length;

  const tabs = [
    { value: "own" as const, label: <TabLabel text="Own" count={count("own")} /> },
    { value: "want" as const, label: <TabLabel text="Want" count={count("want")} /> },
  ];

  return (
    <>
      <title>Collection · Scense</title>
      <section className="pt-[58px] pb-10 sm:pt-[72px] sm:pb-12">
        <p className="kicker">Your collection</p>
        <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
          Own <em className="font-normal text-gold-pale">and want.</em>
        </h1>
        <p className="m-0 max-w-[485px] font-display text-lg leading-[1.45] text-soft sm:text-xl">
          Saved in this browser, no account needed. Mark bottles from any fragrance page or pairing result.
        </p>
      </section>
      <div className="border-b border-line-strong pb-1">
        <TextTabs
          label="Collection"
          tabs={tabs}
          value={tab}
          onChange={(next) => setParams(next === "own" ? {} : { tab: next }, { replace: true })}
          panelId={PANEL_ID}
        />
      </div>
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-10 pb-20">
        {shown.length === 0 ? (
          <EmptyState status={tab} />
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-12 p-0 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 md:gap-x-8">
            {shown.map((item) => (
              <CollectionCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <>
      {text}
      <span className="ml-2 align-super font-sans text-[10px] tracking-label text-dim">{count}</span>
    </>
  );
}

function EmptyState({ status }: { status: CollectionStatus }) {
  return (
    <div>
      <Notice>{EMPTY_MESSAGES[status]}</Notice>
      <Link to="/browse" className="kicker inline-flex items-center gap-2 hover:text-gold-bright">
        Browse the catalogue <ArrowIcon className="stroke-current" />
      </Link>
    </div>
  );
}

// Like a Browse card, but only the photo and name are links, so the Want/Own buttons
// and "Pair this" can sit underneath as their own controls.
function CollectionCard({ item }: { item: SavedFragrance }) {
  const href = `/f/${item.slug}`;
  return (
    <li>
      <Link to={href} tabIndex={-1} aria-hidden="true" className="block">
        <BottleImage src={item.imageUrl} family={item.dominantFamily} className="aspect-[3/4] w-full" lazy />
      </Link>
      <p className="kicker mt-4 truncate">{item.brand}</p>
      <h2 className="mt-1.5 mb-3 line-clamp-2 min-h-[2.1em] font-display text-[19px] leading-[1.05] font-medium sm:text-[22px]">
        <Link to={href} className="hover:text-gold-bright">
          {item.name}
        </Link>
      </h2>
      <Tag>{item.dominantFamily}</Tag>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <CollectionButtons fragrance={item} size="compact" name={item.name} />
        <Link
          to={`/?f=${item.slug}`}
          className="inline-flex items-center gap-1.5 text-[9px] font-semibold tracking-label text-gold-kicker uppercase hover:text-gold-bright"
        >
          Pair this <ArrowIcon className="stroke-current" />
        </Link>
      </div>
    </li>
  );
}
