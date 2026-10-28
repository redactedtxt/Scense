import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "../services/catalogueCache.js";
import { budgetFrom, budgetNote } from "../services/chat.js";
import { budgetOf, chipAfterPicks, emptySlots, NEW_PICKS_CHIP } from "../services/concierge.js";
import { budgetFactor, describeBudget, priceOf, storedBudget, tierFit, valueOf, type Tier } from "../services/price.js";
import { conciergePicks, recommend, type FullSlots } from "../services/recommend.js";
import { statesPrice } from "../services/replyGuard.js";
import { emptyProfile } from "../services/taste.js";
import { concierge, profileAt, settings } from "./helpers.js";

// Price guidance (DECISIONS B42): tiers, value votes, budgets, and the guard on prices.
const price = settings.price; // scoring.yaml: edges 75 / 150 / 300, 100 votes, pull 0.3

describe("tiers and value votes", () => {
  it("gives each tier its band from scoring.yaml, open at both ends", () => {
    expect(price.tierEdgesCad).toEqual([75, 150, 300]);
    expect(priceOf(1, price)).toEqual({ tier: 1, minCad: null, maxCad: 75 });
    expect(priceOf(3, price)).toEqual({ tier: 3, minCad: 150, maxCad: 300 });
    expect(priceOf(4, price)).toEqual({ tier: 4, minCad: 300, maxCad: null });
    expect(priceOf(null, price)).toBeNull(); // not filled until the reseed
  });

  it("hides the value indicator under the vote threshold (100)", () => {
    expect(valueOf(3.2468, 1873, price)).toEqual({ score: 3.25, votes: 1873 });
    expect(valueOf(4.9, 99, price)).toBeNull();
    expect(valueOf(null, 0, price)).toBeNull();
  });
});

describe("budgets", () => {
  const under100 = { kind: "max", maxCad: 100 } as const;

  it("favours $ and the cheaper end of $$ for 'under $100'", () => {
    expect(([1, 2, 3, 4] as Tier[]).map((t) => tierFit(t, under100, price))).toEqual([1, 1 / 3, 0, 0]);
    expect(describeBudget(under100, price)).toBe("$ and the cheaper end of $$");
  });

  it("favours $ and $$ for 'affordable', $$$$ for 'luxury', and up to a tier for a chip", () => {
    const fits = (budget: Parameters<typeof tierFit>[1]) => ([1, 2, 3, 4] as Tier[]).map((t) => tierFit(t, budget, price));
    expect(fits({ kind: "affordable" })).toEqual([1, 1, 0, 0]);
    expect(fits({ kind: "luxury" })).toEqual([0, 0, 0, 1]);
    expect(fits({ kind: "upTo", tier: 2 })).toEqual([1, 1, 0, 0]);
  });

  it("pulls rather than filters: outside the budget a bottle keeps 70% of its score", () => {
    expect(budgetFactor(4, { kind: "affordable" }, price)).toBeCloseTo(0.7);
    expect(budgetFactor(1, { kind: "affordable" }, price)).toBe(1);
    expect(budgetFactor(null, { kind: "affordable" }, price)).toBe(1); // no tier, no penalty
    expect(budgetFactor(4, null, price)).toBe(1);
  });

  it("reads a stored budget back only through the known shapes", () => {
    expect(storedBudget({ budget: { kind: "luxury" } })).toEqual({ kind: "luxury" });
    expect(storedBudget({ budget: { kind: "max", maxCad: -5 } })).toBeNull();
    expect(storedBudget(null)).toBeNull();
  });
});

describe("the chat's budget", () => {
  const said = (kind: string, evidence: string, maxCad: number | null = null) =>
    ({ kind, max_cad: maxCad, evidence }) as Parameters<typeof budgetFrom>[0];

  it("keeps a budget only when the visitor's own words say it", () => {
    expect(budgetFrom(said("max", "under $100", 100), "Something fresh, under $100 please")).toEqual({
      budget: { kind: "max", maxCad: 100 },
    });
    expect(budgetFrom(said("luxury", "luxury"), "fresh citrus")).toBeNull(); // the model made it up
    expect(budgetFrom(said("none", ""), "fresh citrus")).toBeNull();
    expect(budgetFrom(said("any", "price doesn't matter"), "Price doesn't matter!")).toEqual({ budget: null });
    expect(budgetFrom(said("max", "under 0", 0), "under 0")).toBeNull();
  });

  it("says what it heard in tier symbols, never an amount", () => {
    const note = budgetNote({ kind: "max", maxCad: 100 }, price);
    expect(note).toBe("Noted your budget: picks now lean toward $ and the cheaper end of $$ bottles (approximate tiers).");
    expect(statesPrice(note)).toBe(true); // the guard would refuse it from the model, so only the server writes it
  });

  it("ranks bottles the visitor doesn't own by budget, but never drops a much better match", () => {
    const entry = (id: number, tier: Tier, family: number): CatalogueEntry => ({
      id, slug: `s${id}`, name: `N${id}`, brand: "B", imageUrl: null, dominantFamily: "x",
      vector: [...profileAt(family), 0, 0, 0, 0, 0, 0], seasons: {}, daynight: {}, strength: 2,
      priceTier: tier, price: priceOf(tier, price), value: null,
    });
    const profile = { ...emptyProfile(), families: { ...emptyProfile().families, Woods: 1, "Woody Amber": 0.9 } };
    // 1 and 2 match equally (Woods); 3 is weaker (Woody Amber) but cheap.
    const entries = [entry(1, 4, 3), entry(2, 1, 3), entry(3, 1, 2)];
    const plain = recommend(entries, profile, new Set(), { ownedMinMatch: 0.6 }).map((r) => r.id);
    // Woods match: 1 / sqrt(1 + 0.81) = 0.743; Woody Amber: 0.9 / sqrt(1.81) = 0.669.
    const cheap = recommend(entries, profile, new Set(), { ownedMinMatch: 0.6, budget: { kind: "affordable" }, price });
    expect(plain).toEqual([1, 2, 3]);
    // The cheap, slightly weaker match moves above the $$$$ one, which still appears.
    expect(cheap.map((r) => r.id)).toEqual([2, 3, 1]);
    expect(cheap.find((r) => r.id === 1)!.match).toBe(74); // the match shown is unscaled
    expect(cheap[0]!.price).toEqual({ tier: 1, minCad: null, maxCad: 75 });
  });
});

describe("the concierge's budget and catalogue picks", () => {
  const slots: FullSlots = {
    occasion: null, time_of_day: "night", season: "autumn", setting: "indoor", projection: "medium", budget: null, source: null,
  };
  const bottle = (id: number, tier: Tier): CatalogueEntry => ({
    id, slug: `b${id}`, name: `B${id}`, brand: "M", imageUrl: null, dominantFamily: "x",
    vector: [...profileAt(1), 0, 0, 0, 0, 0, 0], seasons: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 },
    daynight: { day: 0.5, night: 0.5 }, strength: 2, priceTier: tier, price: priceOf(tier, price), value: null,
  });
  const entries = [bottle(1, 4), bottle(2, 4), bottle(3, 1)];

  it("leaves out owned bottles once the visitor asks for new ones", () => {
    const own = conciergePicks(entries, new Set([1]), slots, null, concierge);
    expect(own).toMatchObject({ fromCatalogue: false, skippedOwned: false });
    const fresh = conciergePicks(entries, new Set([1]), { ...slots, source: "catalogue" }, null, concierge);
    expect(fresh.picks.map((p) => p.entry.id)).toEqual([2, 3]);
    expect(fresh.skippedOwned).toBe(true);
  });

  it("lets a budget chip reorder catalogue picks, and ignores it on Own-list picks", () => {
    const withBudget = { ...slots, budget: "$" as const };
    const pricing = { budget: budgetOf(withBudget), price };
    expect(conciergePicks(entries, new Set(), withBudget, null, concierge, pricing).picks[0]!.entry.id).toBe(3);
    expect(conciergePicks(entries, new Set([1, 2]), withBudget, null, concierge, pricing).picks[0]!.entry.id).toBe(1);
  });

  it("knows which chip a message is once the picks are shown", () => {
    const full = { ...emptySlots(), ...slots, occasion: "office" as const };
    expect(chipAfterPicks(full, NEW_PICKS_CHIP, true)).toEqual({ slot: "source", value: "catalogue" });
    expect(chipAfterPicks(full, "$$", true)).toBeNull(); // Own-list picks offer no budget yet
    expect(chipAfterPicks({ ...full, source: "catalogue" }, "Any", true)).toEqual({ slot: "budget", value: "any" });
    expect(chipAfterPicks(full, "$$$", false)).toEqual({ slot: "budget", value: "$$$" });
  });
});

describe("the reply guard and prices", () => {
  it("catches amounts and tier symbols, and leaves ordinary text alone", () => {
    for (const text of ["It costs $120.", "about 90 dollars", "CAD 150", "120$ well spent", "a $$$ pick", "€80"]) {
      expect(statesPrice(text)).toBe(true);
    }
    for (const text of ["Warm amber with 3 notes of spice.", "A 10 out of 10 for vanilla lovers."]) {
      expect(statesPrice(text)).toBe(false);
    }
  });
});
