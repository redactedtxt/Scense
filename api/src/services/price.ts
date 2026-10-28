import { z } from "zod";

// Price guidance (DECISIONS B42). The dataset has no prices. Each bottle has an
// approximate tier, 1 ($) to 4 ($$$$), from pipeline/config/brand_tiers.csv and
// tier_overrides.csv, and the community's value-for-money votes. scoring.yaml's `price`
// section says what the tiers mean and when the votes are too few to show.
//
// Nothing here is ever a price: a tier is a band of typical retail for a 100 ml bottle in
// CAD, and the page says "approximate" wherever it shows one.

export type PriceSettings = {
  // [e1, e2, e3]: $ is under e1, $$ e1 to e2, $$$ e2 to e3, $$$$ over e3.
  tierEdgesCad: [number, number, number];
  // Fewer value votes than this and the value indicator is hidden.
  minValueVotes: number;
  // How much a budget pulls the picks, 0 to 1: a bottle outside the budget keeps
  // (1 - budgetPull) of its score. A preference, not a filter.
  budgetPull: number;
};

export type Tier = 1 | 2 | 3 | 4;

// The tier and its band, so the page can say "about 150 to 300 CAD for 100 ml". The
// cheapest band has no lower edge and the dearest no upper one.
export type Price = { tier: Tier; minCad: number | null; maxCad: number | null };

// The mean of the votes on the dataset's 1 (overpriced) to 5 (great value) scale.
export type Value = { score: number; votes: number };

export function priceOf(tier: unknown, settings: PriceSettings): Price | null {
  if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4) return null;
  const [minCad, maxCad] = bandOf(tier, settings);
  return { tier, minCad, maxCad };
}

function bandOf(tier: Tier, settings: PriceSettings): [number | null, number | null] {
  const edges = settings.tierEdgesCad;
  return [tier === 1 ? null : edges[tier - 2]!, tier === 4 ? null : edges[tier - 1]!];
}

export function valueOf(score: unknown, votes: unknown, settings: PriceSettings): Value | null {
  if (typeof score !== "number" || typeof votes !== "number" || votes < settings.minValueVotes) return null;
  return { score: Math.round(score * 100) / 100, votes };
}

// --- budgets --------------------------------------------------------------------------

// What a visitor said about spending:
//  - max: "under $100" (the chat)
//  - affordable: "cheap", "affordable"
//  - luxury: "luxury", "niche"
//  - upTo: a concierge budget chip, "$$" meaning up to that tier
export type Budget =
  | { kind: "max"; maxCad: number }
  | { kind: "affordable" }
  | { kind: "luxury" }
  | { kind: "upTo"; tier: Tier };

// How well a tier fits the budget, 0 to 1. Under a max, a tier wholly below it fits
// fully, one wholly above it not at all, and the band that straddles it by the share
// of the band under it: under $100, $ is 1 and $$ (75 to 150) is 1/3, its cheaper end.
// A bottle with no tier is never penalised.
export function tierFit(tier: Tier | null, budget: Budget, settings: PriceSettings): number {
  if (tier === null) return 1;
  switch (budget.kind) {
    case "affordable":
      return tier <= 2 ? 1 : 0;
    case "luxury":
      return tier === 4 ? 1 : 0;
    case "upTo":
      return tier <= budget.tier ? 1 : 0;
    case "max": {
      const [low, high] = bandOf(tier, settings);
      const from = low ?? 0;
      if (high !== null && high <= budget.maxCad) return 1;
      if (from >= budget.maxCad) return 0;
      // The open-ended top band has no width to share; a max inside it barely reaches it.
      return high === null ? 0 : (budget.maxCad - from) / (high - from);
    }
  }
}

// The multiplier on a bottle's score: 1 inside the budget, down to (1 - budgetPull)
// outside it, so a much better match can still win.
export function budgetFactor(tier: Tier | null, budget: Budget | null, settings: PriceSettings): number {
  if (budget === null) return 1;
  return 1 - settings.budgetPull * (1 - tierFit(tier, budget, settings));
}

// A budget as stored with a chat (chat_conversations.slots), read back through the same
// shapes, so a hand-edited row can't put anything else in front of the scorer.
const tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const budgetShape: z.ZodType<Budget> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("max"), maxCad: z.number().positive().max(100_000) }),
  z.object({ kind: z.literal("affordable") }),
  z.object({ kind: z.literal("luxury") }),
  z.object({ kind: z.literal("upTo"), tier }),
]);

export function storedBudget(slots: unknown): Budget | null {
  const parsed = z.object({ budget: budgetShape }).safeParse(slots);
  return parsed.success ? parsed.data.budget : null;
}

const SYMBOLS = ["$", "$$", "$$$", "$$$$"] as const;

export function tierSymbol(tier: Tier): string {
  return SYMBOLS[tier - 1]!;
}

// The server's own words for a budget, for the line it adds when one is set. Only tier
// symbols, never an amount the model wrote.
export function describeBudget(budget: Budget, settings: PriceSettings): string {
  switch (budget.kind) {
    case "affordable":
      return "$ and $$";
    case "luxury":
      return "$$$$";
    case "upTo":
      return budget.tier === 1 ? "$" : `$ to ${tierSymbol(budget.tier)}`;
    case "max": {
      const tiers = ([1, 2, 3, 4] as Tier[]).filter((t) => tierFit(t, budget, settings) > 0);
      const partial = tiers.at(-1);
      if (partial === undefined) return "$";
      const full = tiers.filter((t) => tierFit(t, budget, settings) === 1).map(tierSymbol);
      const last = tierFit(partial, budget, settings) < 1 ? `the cheaper end of ${tierSymbol(partial)}` : null;
      return [...full, last].filter(Boolean).join(" and ") || "$";
    }
  }
}
