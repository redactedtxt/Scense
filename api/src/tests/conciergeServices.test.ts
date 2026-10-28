import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "../services/catalogueCache.js";
import {
  applyExtraction,
  assumedLine,
  assumeMissing,
  chipAnswer,
  chipsFor,
  emptySlots,
  missingSlots,
  outingLine,
  slotsFrom,
  torontoHour,
  torontoSeason,
  type Extracted,
} from "../services/concierge.js";
import { conciergeSettingsFrom, OCCASIONS } from "../services/occasions.js";
import { checkReason, fallbackReason, pickFacts, type PickFacts } from "../services/pickReasons.js";
import { conciergePicks, projectionBand, projectionFit, scoreOuting, shareRanges, type FullSlots } from "../services/recommend.js";
import { createReplyGuard } from "../services/replyGuard.js";
import { emptyProfile } from "../services/taste.js";
import { concierge, OCCASIONS_PATH, profileAt } from "./helpers.js";

// The concierge's pure parts (SPEC section 9; DECISIONS B37): occasions.yaml, the slots,
// the chips, the evidence rule, the score, and the check on each pick's sentence.
// No database and no model.

const OCT_22 = Date.UTC(2026, 9, 22, 16); // noon in Toronto

describe("occasions.yaml", () => {
  const raw = () => parse(readFileSync(OCCASIONS_PATH, "utf8"));

  it("loads all 8 occasions from the spec, with weights that sum to 1", () => {
    expect(Object.keys(concierge.occasions).sort()).toEqual([...OCCASIONS].sort());
    const w = concierge.weights;
    expect(w).toEqual({ season: 0.3, daynight: 0.2, projection: 0.2, occasion: 0.2, taste: 0.1 });
    expect(concierge.bands).toEqual({ low: [1, 2], medium: [2, 3], high: [3, 4] });
    for (const o of OCCASIONS) expect(concierge.occasions[o].vector).toHaveLength(14);
  });

  it("refuses an unknown family, weights that don't sum to 1, and a missing occasion", () => {
    const typo = raw();
    typo.occasions.office.families["Woody amber"] = 0.5;
    expect(() => conciergeSettingsFrom(typo)).toThrow(/unknown family/);
    const heavy = raw();
    heavy.score_weights.taste = 0.2;
    expect(() => conciergeSettingsFrom(heavy)).toThrow(/sum to 1/);
    const short = raw();
    delete short.occasions.interview;
    expect(() => conciergeSettingsFrom(short)).toThrow();
  });
});

describe("slots and chips", () => {
  it("knows the season in Toronto, not in UTC", () => {
    expect(torontoSeason(OCT_22, concierge)).toBe("autumn");
    // 03:00 UTC on December 1 is still November 30 in Toronto.
    expect(torontoSeason(Date.UTC(2026, 11, 1, 3), concierge)).toBe("autumn");
    expect(torontoSeason(Date.UTC(2026, 11, 1, 12), concierge)).toBe("winter");
    expect(torontoSeason(Date.UTC(2027, 6, 1), concierge)).toBe("summer");
  });

  it("offers the spec's chips, with the current season first", () => {
    const labels = (slot: Parameters<typeof chipsFor>[0], now = OCT_22) => chipsFor(slot, concierge, now).map((c) => c.label);
    expect(labels("projection")).toEqual(["Low", "Medium", "High"]);
    expect(labels("time_of_day")).toEqual(["Day", "Night"]);
    expect(labels("setting")).toEqual(["Indoor", "Outdoor"]);
    expect(labels("season")).toEqual(["Fall", "Winter", "Spring", "Summer"]);
    expect(labels("season", Date.UTC(2027, 3, 10))).toEqual(["Spring", "Summer", "Fall", "Winter"]);
    expect(labels("occasion")).toContain("Gym or outdoors");
  });

  it("reads a typed or tapped chip as that slot's answer, and nothing longer", () => {
    expect(chipAnswer("time_of_day", "Night", concierge)).toBe("night");
    expect(chipAnswer("time_of_day", "  night. ", concierge)).toBe("night");
    expect(chipAnswer("season", "Fall", concierge)).toBe("autumn");
    expect(chipAnswer("season", "autumn", concierge)).toBe("autumn");
    expect(chipAnswer("occasion", "gym or outdoors", concierge)).toBe("gym_outdoors");
    expect(chipAnswer("projection", "high please", concierge)).toBeNull();
    expect(chipAnswer("setting", "night", concierge)).toBeNull();
  });

  it("asks in a fixed order and reads stored slots through the known values", () => {
    expect(missingSlots(emptySlots())).toEqual(["occasion", "time_of_day", "season", "setting", "projection"]);
    const stored = slotsFrom({ occasion: "wedding", time_of_day: "dusk", season: "autumn", setting: 3 });
    expect(stored).toEqual({
      occasion: "wedding", time_of_day: null, season: "autumn", setting: null, projection: null, budget: null, source: null,
    });
    expect(missingSlots(stored)).toEqual(["time_of_day", "setting", "projection"]);
    expect(slotsFrom(null)).toEqual(emptySlots());
  });
});

describe("applyExtraction: a slot needs the visitor's own words", () => {
  const none = { value: null, evidence: "" };
  const extracted = (over: Partial<Extracted>): Extracted => ({
    occasion: none, time_of_day: none, season: none, setting: none, projection: none, budget: none, source: none, ...over,
  });

  it("fills a slot that follows directly from a quote ('dinner at 8' means night)", () => {
    const slots = applyExtraction(
      emptySlots(),
      extracted({ occasion: { value: "date_night", evidence: "Date night" }, time_of_day: { value: "night", evidence: "dinner at 8" } }),
      ["Date night, dinner at 8!"],
    );
    expect(slots).toMatchObject({ occasion: "date_night", time_of_day: "night", season: null });
  });

  it("drops a value whose quote the visitor never typed, or that has no quote", () => {
    const slots = applyExtraction(
      emptySlots(),
      extracted({
        season: { value: "winter", evidence: "it's freezing" }, // invented
        setting: { value: "indoor", evidence: "" }, // a guess with no quote
        projection: { value: "high", evidence: "a" }, // too short to be a quote
      }),
      ["Dinner with friends tonight"],
    );
    expect(slots).toEqual(emptySlots());
  });

  it("keeps earlier slots, lets the visitor change one, and refuses unknown values", () => {
    const old = { ...emptySlots(), setting: "indoor" as const, occasion: "office" as const };
    const slots = applyExtraction(
      old,
      extracted({
        setting: { value: "outdoor", evidence: "actually it's on the patio" },
        occasion: { value: "brunch", evidence: "brunch" },
      }),
      ["office thing", "Actually it's on the patio, brunch"],
    );
    expect(slots).toMatchObject({ setting: "outdoor", occasion: "office" });
  });

  it("matches quotes without caring about case, accents, curly quotes, or end punctuation", () => {
    const slots = applyExtraction(
      emptySlots(),
      extracted({ season: { value: "winter", evidence: "“Snowy evening”" } }),
      ["A SNOWY EVENING at the café"],
    );
    expect(slots.season).toBe("winter");
  });
});

// A bottle with every fact the concierge reads.
function bottle(id: number, family: number, over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id, slug: `b${id}`, name: `Bottle ${id}`, brand: "Maker", imageUrl: null, dominantFamily: "x",
    vector: [...profileAt(family), 0, 0, 0, 0, 0, 0],
    seasons: { winter: 0.25, spring: 0.25, summer: 0.25, autumn: 0.25 },
    daynight: { day: 0.5, night: 0.5 },
    strength: 2,
    priceTier: null,
    price: null,
    value: null,
    ...over,
  };
}

const DATE_NIGHT: FullSlots = {
  occasion: "date_night", time_of_day: "night", season: "autumn", setting: "indoor", projection: "medium", budget: null, source: null,
};

describe("the concierge score (SPEC section 9 step 3)", () => {
  it("gives full projection credit inside the band, half one step out, none beyond", () => {
    const fit = concierge.fit;
    expect([1, 2, 3, 4].map((s) => projectionFit(s, concierge.bands.low, fit))).toEqual([1, 1, 0.5, 0]);
    expect([1, 2, 3, 4].map((s) => projectionFit(s, concierge.bands.medium, fit))).toEqual([0.5, 1, 1, 0.5]);
    expect([1, 2, 3, 4].map((s) => projectionFit(s, concierge.bands.high, fit))).toEqual([0, 0.5, 1, 1]);
  });

  it("moves the band up one step outdoors, capped at 4, and leaves indoor alone (B38)", () => {
    const band = (projection: FullSlots["projection"], setting: FullSlots["setting"]) =>
      projectionBand({ ...DATE_NIGHT, projection, setting }, concierge);
    expect([band("low", "indoor"), band("medium", "indoor"), band("high", "indoor")]).toEqual([[1, 2], [2, 3], [3, 4]]);
    expect([band("low", "outdoor"), band("medium", "outdoor"), band("high", "outdoor")]).toEqual([[2, 3], [3, 4], [4, 4]]);
    // A strength-2 bottle is inside medium indoors, one step short of it outdoors.
    const two = bottle(1, 1, { strength: 2 });
    const ranges = shareRanges([two]);
    expect(scoreOuting(two, DATE_NIGHT, null, concierge, ranges).terms.projection).toBe(1);
    expect(scoreOuting(two, { ...DATE_NIGHT, setting: "outdoor" }, null, concierge, ranges).terms.projection).toBe(0.5);
  });

  it("rescales each season's share and each of day and night to 0..1 across the catalogue (B38)", () => {
    const low = bottle(1, 1, { seasons: { autumn: 0.1 }, daynight: { night: 0.2 } });
    const mid = bottle(2, 1, { seasons: { autumn: 0.25 }, daynight: { night: 0.5 } });
    const high = bottle(3, 1, { seasons: { autumn: 0.4 }, daynight: { night: 0.8 } });
    const ranges = shareRanges([low, mid, high]);
    expect(ranges["season:autumn"]).toEqual([0.1, 0.4]);
    expect(ranges["time:night"]).toEqual([0.2, 0.8]);
    const terms = (entry: CatalogueEntry) => scoreOuting(entry, DATE_NIGHT, null, concierge, ranges).terms;
    expect(terms(low).season).toBe(0);
    expect(terms(mid).season).toBeCloseTo(0.5, 10);
    expect(terms(high).season).toBe(1);
    expect(terms(mid).daynight).toBeCloseTo(0.5, 10);
    // `none` scores the raw vote shares instead.
    const raw = { ...concierge, shareScaling: "none" as const };
    expect(scoreOuting(mid, DATE_NIGHT, null, raw, ranges).terms).toMatchObject({ season: 0.25, daynight: 0.5 });
    // The facts a sentence may quote stay the raw vote shares.
    expect(pickFacts(scoreOuting(mid, DATE_NIGHT, null, concierge, ranges), 0, DATE_NIGHT, concierge))
      .toMatchObject({ season_vote_share_percent: 25, time_vote_share_percent: 50 });
  });

  it("is 0.30 season + 0.20 day/night + 0.20 projection + 0.20 occasion + 0.10 taste", () => {
    // All of its weight on Amber (ring 1), which date_night weights 0.8. Its rescaled
    // autumn share is 0.75 and its night share 1 against the two other bottles below.
    const amber = bottle(1, 1, { seasons: { autumn: 0.4 }, daynight: { night: 0.7 }, strength: 4 });
    const others = [bottle(2, 7, { seasons: { autumn: 0.0 }, daynight: { night: 0.2 } }), bottle(3, 7, { seasons: { autumn: 0.5 } })];
    const ranges = shareRanges([amber, ...others]);
    const profile = { ...emptyProfile(), families: { ...emptyProfile().families, Amber: 1 } };
    const { score, terms } = scoreOuting(amber, DATE_NIGHT, profile, concierge, ranges);
    const occasion = concierge.occasions.date_night.vector;
    const cos = occasion[1]! / Math.hypot(...occasion);
    expect(terms.season).toBeCloseTo(0.8, 10);
    expect(terms).toMatchObject({ daynight: 1, projection: 0.5, taste: 1 });
    expect(terms.occasion).toBeCloseTo(cos, 10);
    expect(score).toBeCloseTo(0.3 * 0.8 + 0.2 * 1 + 0.2 * 0.5 + 0.2 * cos + 0.1 * 1, 10);
    // No profile: the taste term adds nothing. No occasion (a forced result): nor does it.
    expect(scoreOuting(amber, DATE_NIGHT, null, concierge, ranges).terms.taste).toBe(0);
    expect(scoreOuting(amber, { ...DATE_NIGHT, occasion: null }, null, concierge, ranges).terms.occasion).toBe(0);
  });

  it("picks from the Own list only, top pick first, and says when it used the catalogue", () => {
    const entries = [bottle(1, 7), bottle(2, 1, { daynight: { night: 0.9 } }), bottle(3, 13), bottle(4, 1), bottle(5, 2)];
    const own = conciergePicks(entries, new Set([1, 2, 3, 4]), DATE_NIGHT, null, concierge);
    expect(own.fromCatalogue).toBe(false);
    expect(own.picks.map((p) => p.entry.id)).toEqual([2, 3, 4]);
    // A citrus bottle on its own is still the pick when it is all they own.
    expect(conciergePicks(entries, new Set([1]), DATE_NIGHT, null, concierge).picks.map((p) => p.entry.id)).toEqual([1]);
    // Nothing owned, or only ids the catalogue doesn't hold: the whole catalogue.
    for (const owned of [new Set<number>(), new Set([999])]) {
      const all = conciergePicks(entries, owned, DATE_NIGHT, null, concierge);
      expect(all.fromCatalogue).toBe(true);
      expect(all.picks).toHaveLength(3);
    }
  });

  it("scales against the whole catalogue, so what else you own doesn't change a bottle's score", () => {
    const entries = [bottle(1, 1, { seasons: { autumn: 0.3 } }), bottle(2, 1, { seasons: { autumn: 0.35 } }), bottle(3, 1, { seasons: { autumn: 0.1 } })];
    const alone = conciergePicks(entries, new Set([1]), DATE_NIGHT, null, concierge).picks[0]!;
    const withTwo = conciergePicks(entries, new Set([1, 2]), DATE_NIGHT, null, concierge).picks.find((p) => p.entry.id === 1)!;
    expect(alone.score).toBe(withTwo.score);
  });
});

describe("the day's last message: assumed slots (B38)", () => {
  const evening = Date.UTC(2026, 9, 22, 22); // 6 p.m. in Toronto
  const afternoon = Date.UTC(2026, 9, 22, 20); // 4 p.m. in Toronto

  it("knows the hour in Toronto", () => {
    expect(torontoHour(evening)).toBe(18);
    expect(torontoHour(Date.UTC(2026, 9, 23, 3))).toBe(23);
  });

  it("fills the missing slots with the current season, the time, medium, and indoor, and lists them", () => {
    const { full, assumed } = assumeMissing({ ...emptySlots(), occasion: "office" }, concierge, evening);
    expect(full).toEqual({
      occasion: "office", time_of_day: "night", season: "autumn", setting: "indoor", projection: "medium", budget: null, source: null,
    });
    expect(assumed).toEqual(["night", "fall season", "indoor", "medium projection"]);
    expect(assumeMissing({ ...emptySlots(), occasion: "office" }, concierge, afternoon).full.time_of_day).toBe("day");
    expect(assumedLine(assumed)).toBe(
      "This was today's last message, so I assumed night, fall season, indoor, and medium projection.",
    );
  });

  it("keeps what the visitor said, leaves a missing occasion out, and says nothing when nothing was assumed", () => {
    const said = {
      occasion: null, time_of_day: "day" as const, season: "winter" as const, setting: "outdoor" as const, projection: null,
      budget: null, source: null,
    };
    const { full, assumed } = assumeMissing(said, concierge, evening);
    expect(full).toEqual({ ...said, projection: "medium" });
    expect(assumedLine(assumed)).toBe(
      "This was today's last message, so I assumed no occasion, so occasion fit isn't scored, and medium projection.",
    );
    expect(assumedLine([])).toBeNull();
  });
});

describe("checkReason: one sentence, the pick's facts only (DECISIONS B37)", () => {
  // Black Opium-like facts: Woody Amber and Amber, spicy and sweet.
  const entry = bottle(3, 2, {
    vector: [0, 0.3, 0.5, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0.4, 0, 0],
    seasons: { autumn: 0.38 }, daynight: { night: 0.71 }, strength: 3,
  });
  const facts: PickFacts = pickFacts(scoreOuting(entry, DATE_NIGHT, null, concierge, shareRanges([entry])), 0, DATE_NIGHT, concierge);
  const snapshot = {
    entries: [{ ...entry, name: "Black Opium", brand: "Yves Saint Laurent" }, bottle(9, 10, { name: "Aventus", brand: "Creed" })],
    brandAliases: ["YSL"],
    noteNames: ["Vanilla", "Oud", "Pink Pepper", "Amber", "Coffee", "Smoke", "Skin"],
  };
  const ctx = { guard: createReplyGuard(snapshot), noteNames: snapshot.noteNames, settings: concierge, maxWords: 40 };
  const check = (text: string) => checkReason(text, facts, ctx);

  it("passes the facts the server gave it", () => {
    expect(facts).toMatchObject({
      occasion: "Date night", season: "fall", season_vote_share_percent: 38, time_of_day: "night",
      time_vote_share_percent: 71, strength: 3, projection_fit: "inside the wanted range",
      main_families: [{ family: "Woody Amber", percent: 50 }, { family: "Amber", percent: 30 }, { family: "Woods", percent: 20 }],
      facets: ["sweet", "spicy"],
    });
    expect(check("A warm Woody Amber with a sweet, spicy edge that suits a date night, and 71% of day-or-night votes say night.")).toBe("ok");
    expect(check("Rich amber warmth for a fall night indoors, at strength 3 of 4.")).toBe("ok");
    // "Smoke" is a dataset note, but on a smoky bottle it is the facet, not an invented note.
    expect(checkReason("A smoke-tinged Woody Amber that sits close to the skin.", { ...facts, facets: ["smoky"] }, ctx)).toBe("ok");
  });

  it("refuses a sentence that names a bottle or a brand", () => {
    expect(check("Like Aventus, it is warm and spicy for a date night.")).toBe("names_product");
    expect(check("A Creed-style woody amber for the night.")).toBe("names_product");
    expect(check("The YSL warmth suits a date night.")).toBe("names_product");
  });

  it("refuses invented facts: numbers, notes, other families, facets, seasons, times, places, claims", () => {
    expect(check("62% of season votes say fall, so it suits tonight.")).toBe("wrong_number");
    expect(check("A woody amber that lasts 8 hours on a date night.")).toBe("wrong_number");
    expect(check("A woody amber that lasts all night.")).toBe("unsupported_claim");
    expect(check("Warm coffee and vanilla make it right for a date night.")).toBe("names_note");
    expect(check("A fresh Citrus opening for a date night.")).toBe("wrong_family");
    expect(check("A smoky Woody Amber for a date night.")).toBe("wrong_facet");
    expect(check("A woody amber that shines in summer.")).toBe("wrong_season");
    expect(check("A woody amber made for a sunny afternoon.")).toBe("wrong_time");
    expect(check("A woody amber that carries well outdoors.")).toBe("wrong_setting");
    expect(check("A woody amber polished enough for the office.")).toBe("wrong_occasion");
    expect(check("Everyone gets compliments in this woody amber.")).toBe("unsupported_claim");
  });

  it("refuses more than one sentence, a long one, links, and rule talk", () => {
    expect(check("Warm Woody Amber. Great for a date night.")).toBe("not_one_sentence");
    expect(check(Array.from({ length: 41 }, () => "amber").join(" "))).toBe("too_long");
    expect(check("See scents.com for a woody amber.")).toBe("link");
    expect(check("I can't name the bottle, but it is a warm woody amber.")).toBe("mentions_rules");
    expect(check("  ")).toBe("empty");
  });

  it("reads the occasion's own words as the occasion, not as a time or another occasion", () => {
    const slots: FullSlots = { ...DATE_NIGHT, time_of_day: "day", occasion: "night_out" };
    const day = pickFacts(scoreOuting(entry, slots, null, concierge, shareRanges([entry])), 0, slots, concierge);
    expect(checkReason("A spicy Woody Amber for a night out.", day, ctx)).toBe("ok");
    expect(checkReason("A spicy Woody Amber for a romantic night out.", day, ctx)).toBe("wrong_occasion");
  });

  it("writes a fallback that always passes the same check", () => {
    const variants: PickFacts[] = [
      facts,
      { ...facts, facets: [], projection_fit: "one step off" },
      { ...facts, main_families: [], projection_fit: "outside the wanted range", time_of_day: "day", season: "winter" },
      { ...facts, setting: "outdoor", projection_raised_for_outdoors: true },
      { ...facts, occasion: null, occasion_fit_percent: null },
    ];
    for (const variant of variants) {
      const text = fallbackReason(variant);
      expect(checkReason(text, variant, ctx), text).toBe("ok");
    }
    expect(fallbackReason(facts)).toBe(
      "Mostly Woody Amber and Amber, sweet and spicy; 38% of season votes say fall, 71% of day-or-night votes say night; strength 3 of 4, inside the medium projection range.",
    );
  });
});

describe("outingLine", () => {
  it("describes the outing in the server's words", () => {
    expect(outingLine(DATE_NIGHT, concierge)).toBe("Your outing: Date night, night, fall, indoor, medium projection.");
  });
});
