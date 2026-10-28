import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router";
import { api, type OutingSlot, type OutingSlotName } from "../../lib/api";
import { conciergeOutingKey } from "../../lib/session";

const SLOT_LABELS: Record<OutingSlotName, string> = {
  occasion: "Occasion",
  time_of_day: "Time of day",
  season: "Season",
  setting: "Setting",
  projection: "Projection",
  budget: "Budget", // optional: set by the visitor's words or a chip under the picks (DECISIONS B42)
};

const EMPTY: OutingSlot[] = (Object.keys(SLOT_LABELS) as OutingSlotName[]).map((slot) => ({ slot, value: null }));

// Beside the panel: the open outing's five slots as the server has them, plus its optional
// budget ("Any" until one is set; DECISIONS B42), so the visitor sees what the concierge
// understood and what it still needs, and where the picks come from. It reads the open
// outing from the same cache as the conversation.
export function OutingCard({ userId, outingId, ownedCount }: { userId: number | null; outingId: string | null; ownedCount: number }) {
  const headingId = useId();
  const outing = useQuery({
    queryKey: conciergeOutingKey(userId, outingId ?? ""),
    queryFn: () => api.conciergeOuting(outingId!),
    enabled: outingId !== null,
    staleTime: Infinity,
  });
  const slots = (outingId !== null && outing.data?.outing) || EMPTY;
  const beyondOwn = outingId !== null && outing.data?.beyondOwn === true;
  return (
    <section aria-labelledby={headingId} className="border border-line-strong bg-panel p-6 sm:p-7">
      <p className="kicker">Concierge</p>
      <h2 id={headingId} className="mt-3 mb-4 font-display text-[28px] leading-none font-medium tracking-heading">
        Your outing
      </h2>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5">
        {slots.map(({ slot, value }) => (
          <div key={slot} className="contents">
            <dt className="label-caps text-[9px] leading-[22px] font-semibold text-gold-kicker">{SLOT_LABELS[slot]}</dt>
            <dd className={`m-0 font-display text-lg leading-snug ${value ? "text-text" : "text-dim"}`}>
              {value ?? (slot === "budget" ? "Any" : <span aria-label="Not known yet">—</span>)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-5 border-t border-line pt-4 text-[13px] leading-snug text-dim">
        {beyondOwn && ownedCount > 0 ? (
          <>
            Picks come from the catalogue, leaving out the {ownedCount} {ownedCount === 1 ? "bottle" : "bottles"} on
            your{" "}
            <Link to="/me" className="text-chip-on-text underline underline-offset-2 hover:text-gold-bright">
              Own list
            </Link>
            .
          </>
        ) : ownedCount > 0 ? (
          <>
            Picks come from the {ownedCount} {ownedCount === 1 ? "bottle" : "bottles"} on your{" "}
            <Link to="/me" className="text-chip-on-text underline underline-offset-2 hover:text-gold-bright">
              Own list
            </Link>
            .
          </>
        ) : (
          <>
            Your{" "}
            <Link to="/me" className="text-chip-on-text underline underline-offset-2 hover:text-gold-bright">
              Own list
            </Link>{" "}
            is empty, so picks come from the whole catalogue.
          </>
        )}
      </p>
    </section>
  );
}
