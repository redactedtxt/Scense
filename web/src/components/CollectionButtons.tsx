import { toggleStatus, useCollectionStatus } from "../lib/collection";
import type { CollectionStatus, FragranceSnapshot } from "../lib/guestStore";

const BUTTONS: { status: CollectionStatus; label: string }[] = [
  { status: "want", label: "Want" },
  { status: "own", label: "Own" },
];

// "compact" sits in a result card's tag row; "large" sits beside "Pair this".
const SIZES = {
  compact: "h-[26px] px-2.5 text-[8px] tracking-tag",
  large: "h-[46px] px-5 text-[10px] tracking-label",
};

// Two toggle buttons. The label never changes (screen readers announce "pressed"
// instead), and a tick shows the pressed one. `name` goes into the accessible name so a
// list of cards reads "Own Eclaire", not ten identical "Own" buttons.
export function CollectionButtons({
  fragrance,
  size,
  name,
}: {
  fragrance: FragranceSnapshot;
  size: keyof typeof SIZES;
  name?: string;
}) {
  const current = useCollectionStatus(fragrance.id);
  return (
    <div role="group" aria-label="Collection" className="flex gap-2">
      {BUTTONS.map(({ status, label }) => {
        const pressed = current === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={pressed}
            aria-label={name ? `${label} ${name}` : undefined}
            onClick={() => toggleStatus(fragrance, current, status)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border font-semibold uppercase transition-colors duration-[180ms] ${SIZES[size]} ${
              pressed
                ? "border-gold-deep bg-gold-deep text-on-gold hover:bg-gold"
                : "border-line-control text-muted hover:border-gold-deep hover:text-text-bright"
            }`}
          >
            <span aria-hidden="true" className="inline-block w-[1ch] text-center">
              {pressed ? "✓" : "+"}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
