import { Link } from "react-router";
import { BottleImage } from "../../components/BottleImage";
import { BrandLink, PriceLine } from "../../components/Price";
import { FamilyTag, Tag } from "../../components/ui";
import type { ConciergePick } from "../../lib/api";
import { useOwnedIds } from "../../lib/collection";

// The concierge's picks: the top pick first, then the alternatives, each with the one
// sentence on why it fits (written by the model from the server's facts, or by the
// server when that sentence failed its checks). Rendered as text, never HTML.
export function PickCards({ picks }: { picks: ConciergePick[] }) {
  // The badge reads the visitor's collection now, so a bottle owned since shows it too.
  const owned = new Set(useOwnedIds());
  return (
    <ol className="m-0 mt-4 grid list-none gap-3 p-0">
      {picks.map((pick, index) => (
        <li key={pick.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border border-line p-3">
          <Link to={`/f/${pick.slug}`} tabIndex={-1} aria-hidden="true" className="block">
            <BottleImage src={pick.imageUrl} family={pick.dominantFamily} className="aspect-[3/4] w-full" lazy />
          </Link>
          <div className="min-w-0">
            <p className="kicker text-gold-kicker">{index === 0 ? "Top pick" : "Alternative"}</p>
            <h3 className="mt-1 mb-1 font-display text-[19px] leading-[1.05] font-medium">
              <Link to={`/f/${pick.slug}`} className="hover:text-gold-bright">
                {pick.name}
              </Link>
            </h3>
            <p className="m-0 mb-2 text-[11px] text-dim">
              <BrandLink brand={pick.brand} />
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <FamilyTag family={pick.dominantFamily} />
              {(pick.owned || owned.has(pick.id)) && <Tag tone="owned">Owned</Tag>}
            </div>
            <div className="mb-2">
              <PriceLine info={pick} compact />
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-text-input">{pick.reason}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
