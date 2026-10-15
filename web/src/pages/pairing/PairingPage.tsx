import { formatCount } from "../../lib/labels";
import { useCatalogueTotal, useFragrance } from "../../lib/queries";
import { FragranceResults } from "./FragranceResults";
import { NoteResults } from "./NoteResults";
import { PairingDesk } from "./PairingDesk";
import { usePairingParams } from "./usePairingParams";

// "/": the pairing page, built to design/figma-make/src/App.tsx.
export function PairingPage() {
  const { mode, goal, baseSlug, notes, update } = usePairingParams();
  const base = useFragrance(baseSlug);

  return (
    <>
      <title>Scense · Fragrance layering</title>
      <Hero />
      <PairingDesk
        mode={mode}
        goal={goal}
        base={{ data: base.data, isError: base.isError }}
        notes={notes}
        onModeChange={(next) => update({ mode: next })}
        onGoalChange={(next) => update({ goal: next })}
        onBaseChange={(slug) => update({ f: slug })}
        onNotesChange={(next) => update({ notes: next })}
      />
      <section aria-label="Results" className="pt-20 pb-20 sm:pt-[105px] sm:pb-[110px]">
        {mode === "fragrance" ? (
          base.isError ? null : <FragranceResults base={base.data} baseSlug={baseSlug} goal={goal} />
        ) : (
          <NoteResults notes={notes} goal={goal} />
        )}
      </section>
    </>
  );
}

// .hero: headline on the left, decorative rings, and the catalogue count bottom right.
function Hero() {
  const total = useCatalogueTotal();
  return (
    <section className="relative flex items-center pt-[58px] pb-12 sm:min-h-[405px] sm:pt-[72px] sm:pb-[58px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-2 -right-1/2 size-[260px] rounded-full border border-[rgba(154,116,61,0.12)] shadow-[0_0_0_48px_rgba(154,116,61,0.025),0_0_0_98px_rgba(154,116,61,0.018)] sm:top-[42px] sm:right-[11%] sm:size-[330px]"
      />
      <div className="relative z-[1]">
        <p className="kicker">The art of fragrance layering</p>
        <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:mt-[18px] sm:text-[clamp(54px,6.2vw,88px)]">
          Find your perfect
          <br />
          <em className="font-normal text-gold-pale">second scent.</em>
        </h1>
        <p className="m-0 max-w-[320px] font-display text-lg leading-[1.45] text-soft sm:max-w-[485px] sm:text-xl">
          Start from a bottle you own or a few notes you love. Scense ranks what to layer with them, to amplify the
          scent or soften its edge.
        </p>
      </div>
      <div className="absolute right-0 bottom-[60px] z-[1] hidden w-[215px] grid-cols-[auto_auto] gap-x-[18px] gap-y-1 border-y border-line-control py-[15px] text-[8px] tracking-[0.16em] text-dim sm:grid">
        <span>CATALOGUE</span>
        <strong className="row-span-2 self-center font-display text-[28px] font-normal tracking-normal text-gold-kicker">
          {total.data ? formatCount(total.data) : "—"}
        </strong>
        <span>FRAGRANCES RANKED</span>
      </div>
    </section>
  );
}
