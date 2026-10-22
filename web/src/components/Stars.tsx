import { useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { loginHref } from "../lib/session";
import { StarIcon } from "./Icons";

// Star ratings (M8): a read-only row for reviews, and an input for writing a review or
// rating a pair. Both use the same icon, so a 4 looks the same everywhere.

const STARS = [1, 2, 3, 4, 5] as const;

const SIZES = {
  small: "size-[15px]",
  large: "size-[24px]",
};

function starClass(lit: boolean, size: keyof typeof SIZES): string {
  return `${SIZES[size]} ${lit ? "fill-gold-bright stroke-gold-bright" : "fill-none stroke-line-input"}`;
}

// "4 of 5 stars" for screen readers; the icons are decoration.
export function StarDisplay({ stars, size = "small" }: { stars: number; size?: keyof typeof SIZES }) {
  return (
    <span role="img" aria-label={`${stars} of 5 stars`} className="inline-flex gap-[3px]">
      {STARS.map((n) => (
        <StarIcon key={n} className={starClass(n <= stars, size)} />
      ))}
    </span>
  );
}

// Five radio buttons drawn as stars. Native radios give one Tab stop and arrow keys for
// free, and a screen reader announces "3 stars, radio, 3 of 5". Hovering lights the stars
// up to the pointer so you can see what a click would choose.
export function StarInput({
  legend,
  value,
  onChange,
  disabled = false,
  size = "large",
  legendHidden = false,
}: {
  legend: string;
  value: number | null;
  onChange: (stars: number) => void;
  disabled?: boolean;
  size?: keyof typeof SIZES;
  legendHidden?: boolean;
}) {
  const name = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = disabled ? (value ?? 0) : (hovered ?? value ?? 0);
  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0" onMouseLeave={() => setHovered(null)}>
      <legend className={legendHidden ? "sr-only" : "label-caps mb-2 p-0 text-[9px] font-semibold text-gold-kicker"}>
        {legend}
      </legend>
      <div className={`flex ${disabled ? "opacity-50" : ""}`}>
        {STARS.map((n) => (
          <span key={n} className="relative">
            <input
              id={`${name}-${n}`}
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${name}-${n}`}
              onMouseEnter={() => setHovered(n)}
              className={`block p-1 peer-focus-visible:outline-2 peer-focus-visible:outline-gold ${
                disabled ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <StarIcon className={`${starClass(n <= shown, size)} transition-colors duration-[120ms]`} />
              <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
            </label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}

// What a guest gets in place of a working control (SPEC section 6): it looks like a
// disabled button, but it is a link to /login?next=<this page>, so signing in comes
// straight back here.
export function SignInPrompt({ label, compact = false }: { label: string; compact?: boolean }) {
  const location = useLocation();
  const href = loginHref(location.pathname + location.search);
  if (compact) {
    return (
      <Link to={href} className="border-b border-gold-line pb-px text-[10px] text-muted hover:text-text-bright">
        {label}
      </Link>
    );
  }
  return (
    <Link
      to={href}
      className="inline-flex h-[46px] items-center border border-line-control px-6 text-[10px] font-semibold tracking-label text-dim uppercase transition-colors hover:border-gold-deep hover:text-text-bright"
    >
      {label}
    </Link>
  );
}
