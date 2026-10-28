import { useId, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { Price, PriceInfo, Value } from "../lib/api";
import { formatCount } from "../lib/labels";

// Price guidance (DECISIONS B42). The dataset has no prices, so a bottle shows an
// approximate tier ($ to $$$$) and the community's value-for-money votes. The tier is
// always labelled approximate and never written as a price; its band sits in a tooltip.

const SYMBOLS = ["$", "$$", "$$$", "$$$$"] as const;

// "about 150 to 300 CAD", "under 75 CAD", "over 300 CAD".
export function bandText(price: Price): string {
  if (price.minCad === null) return `under ${price.maxCad} CAD`;
  if (price.maxCad === null) return `over ${price.minCad} CAD`;
  return `about ${price.minCad} to ${price.maxCad} CAD`;
}

// The tier label. A button only so keyboard and touch can open the tooltip (hover opens
// it for a mouse); pressing it does nothing else. Escape closes it by moving focus away.
export function PriceTier({ price }: { price: Price }) {
  const tipId = useId();
  const symbol = SYMBOLS[price.tier - 1];
  const close = (event: KeyboardEvent<HTMLButtonElement>) => event.key === "Escape" && event.currentTarget.blur();
  return (
    <span className="group/tier relative inline-flex">
      <button
        type="button"
        // One name for every browser, and it holds the visible text ("$$$ approx.").
        aria-label={`Approximate price tier ${symbol} approx.`}
        aria-describedby={tipId}
        onKeyDown={close}
        className="inline-flex min-h-6 cursor-help items-center gap-1.5 rounded-full border border-line-control px-[9px] py-[5px] text-[8px] tracking-tag text-dim uppercase hover:border-gold-line"
      >
        <span className="text-[10px] font-semibold tracking-normal text-gold-bright">{symbol}</span>
        <span>approx.</span>
      </button>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-max max-w-[240px] border border-line-strong bg-ink-raised px-3 py-2 text-[11px] leading-snug normal-case tracking-normal text-soft shadow-lg group-focus-within/tier:block group-hover/tier:block"
      >
        A 100 ml bottle is usually {bandText(price)}. A rough tier, not a price.
      </span>
    </span>
  );
}

// "Value for money 3.2/5 · 1,873 votes". Hidden by the API under 100 votes.
export function ValueVotes({ value, compact = false }: { value: Value; compact?: boolean }) {
  const score = value.score.toFixed(1);
  const votes = formatCount(value.votes);
  return (
    <span className="inline-flex items-baseline gap-1.5 text-[11px] text-dim">
      <span className="sr-only">{`Value for money: ${score} out of 5, from ${votes} community votes`}</span>
      <span aria-hidden="true">
        {compact ? "Value" : "Value for money"} <strong className="font-semibold text-text-input">{score}</strong>/5
        <span className="text-faint"> · </span>
        {votes} votes
      </span>
    </span>
  );
}

// Both, side by side, wherever a bottle is shown. Nothing when the catalogue has neither.
export function PriceLine({ info, compact = false }: { info: PriceInfo; compact?: boolean }) {
  if (!info.price && !info.value) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {info.price && <PriceTier price={info.price} />}
      {info.value && <ValueVotes value={info.value} compact={compact} />}
    </span>
  );
}

// A brand's page: Browse filtered to that brand (DECISIONS B42).
export function brandHref(brand: string): string {
  return `/browse?${new URLSearchParams({ brand })}`;
}

// Small text, so WCAG 2.5.8's spacing exception is what makes it easy to tap: nothing else
// to click within 12px of its centre. Where a name link follows, keep at least 8px between
// them (mt-2). `relative z-10` lifts it above a card's stretched name link (Browse).
export function BrandLink({ brand, className = "" }: { brand: string; className?: string }) {
  return (
    <Link to={brandHref(brand)} className={`relative z-10 transition-colors hover:text-gold-bright ${className}`}>
      {brand}
    </Link>
  );
}

// A shopping search for the bottle, in a new tab. We hold no prices, so this is where a
// visitor finds today's.
export function pricesHref(brand: string, name: string): string {
  return `https://www.google.com/search?${new URLSearchParams({ tbm: "shop", q: `${brand} ${name}` })}`;
}

export function CheckPricesLink({ brand, name }: { brand: string; name: string }) {
  return (
    <a
      href={pricesHref(brand, name)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Check current prices (opens in a new tab)"
      className="border-b border-gold-line pb-0.5 text-[11px] font-medium tracking-[0.11em] text-muted uppercase hover:text-text-bright"
    >
      Check current prices
    </a>
  );
}
