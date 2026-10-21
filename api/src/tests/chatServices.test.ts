import { describe, expect, it, vi } from "vitest";
import { torontoDay } from "../services/caps.js";
import type { CatalogueEntry, CatalogueSnapshot } from "../services/catalogueCache.js";
import { anthropicLlm, causeChain, LlmUnavailableError, type MessagesClient } from "../services/llm.js";
import { OUTPUT_SCHEMA } from "../services/prompt.js";
import { cosine, recommend } from "../services/recommend.js";
import { capWords, createReplyGuard, normalize } from "../services/replyGuard.js";
import { completeProfile, describeProfile, emptyProfile, mergeProfile, profileInput } from "../services/taste.js";
import { profileAt } from "./helpers.js";

// The pure parts of the chat: the merge rule, the reply guard, recommendations, the cap
// day, and the Anthropic client wrapper (with the SDK replaced by a stand-in).

describe("taste profile merge (SPEC section 8 step 4)", () => {
  it("is clamp(0.6 × old + 0.4 × update), and leaves unmentioned weights alone", () => {
    const old = completeProfile({ families: { Amber: 0.5, Citrus: -0.5 }, facets: { sweet: 1 } });
    const next = mergeProfile(old, { families: { Amber: 1 }, facets: { sweet: -1 } }, null);
    expect(next.families.Amber).toBe(0.7);
    expect(next.facets.sweet).toBe(0.2);
    expect(next.families.Citrus).toBe(-0.5);
  });

  it("clamps an out-of-range update before and after blending", () => {
    const next = mergeProfile(completeProfile({ families: { Amber: 1 }, facets: {} }), { families: { Amber: 9 }, facets: {} }, null);
    expect(next.families.Amber).toBe(1);
  });

  it("describes a profile in plain words: top 3 likes, top 2 dislikes", () => {
    const profile = completeProfile({
      families: { "Woody Amber": 0.8, Amber: 0.5, Green: -0.6, Water: 0.1 },
      facets: { spicy: 0.7, smoky: -0.9, sweet: 0.3 },
    });
    expect(describeProfile(profile)).toBe("You lean toward Woody Amber, spicy and Amber scents and avoid smoky and Green ones.");
    expect(describeProfile(emptyProfile())).toBeNull();
  });

  it("accepts only known keys and weights from -1 to 1", () => {
    expect(profileInput.safeParse({ families: { Amber: 1 }, facets: { spicy: -1 } }).success).toBe(true);
    expect(profileInput.safeParse({ families: { Amber: 1.01 }, facets: {} }).success).toBe(false);
    expect(profileInput.safeParse({ families: { amber: 1 }, facets: {} }).success).toBe(false);
    expect(profileInput.safeParse({ families: {}, facets: { salty: 1 } }).success).toBe(false);
  });
});

const entry = (id: number, name: string, brand: string, family: number, facets = [0, 0, 0, 0, 0, 0]): CatalogueEntry => ({
  id, slug: `s${id}`, name, brand, imageUrl: null, dominantFamily: "x", vector: [...profileAt(family), ...facets],
});

const snapshot: CatalogueSnapshot = {
  entries: [
    entry(1, "Aventus", "Creed", 10),
    entry(2, "Black Opium", "Yves Saint Laurent", 2),
    entry(3, "You", "Glossier", 12),
    entry(4, "Vanilla", "Kayali Fragrances", 0),
    entry(5, "Le Male Le Parfum", "Jean Paul Gaultier", 13),
    entry(6, "J'adore", "Dior", 11),
    entry(7, "Acqua di Giò", "Giorgio Armani", 8),
    entry(8, "Love, Don't Be Shy", "By Kilian", 0),
  ],
  brandAliases: ["YSL", "TF", "D&G"],
  noteNames: ["Vanilla", "Pink Pepper", "Bergamot"],
};

describe("the reply guard", () => {
  const guard = createReplyGuard(snapshot);

  it("blocks catalogue names and brands, however they are typed", () => {
    for (const text of [
      "Try Aventus for that smoky pineapple feel.",
      "the creed house does warm woods well",
      "Black Opium leans sweet.",
      "something like LE MALE le parfum, sweet lavender",
      "jadore has floral notes",
      "J’adore has floral notes",
      "Acqua di Gio is aquatic",
      "YSL makes sweet amber",
      "a D&G citrus",
    ]) {
      expect(guard.check(text), text).toBe("names_product");
    }
  });

  it("lets ordinary words through even when a bottle shares the name", () => {
    expect(guard.check("You love vanilla and warm amber, and black pepper suits you.")).toBe("ok");
    expect(guard.check("A soft floral with bergamot.")).toBe("ok");
  });

  it("does not match a name across punctuation", () => {
    const g = createReplyGuard({ ...snapshot, entries: [entry(9, "Oud Wood", "Tom Ford", 3)] });
    expect(g.check("Oud, wood, and a little smoky leather.")).toBe("ok");
    expect(g.check("Oud Wood is lovely and smoky.")).toBe("names_product");
  });

  it("blocks links and anything without a scent word", () => {
    expect(guard.check("See www.example.org for amber.")).toBe("link");
    expect(guard.check("Here is a poem about the ocean waves at night.")).toBe("off_topic");
    expect(guard.check("I can only help describe scent preferences.")).toBe("ok");
  });

  it("normalises accents, case, and symbols", () => {
    expect(normalize("Acqua di Giò!")).toBe("acqua di gio |");
    expect(normalize("Dolce&Gabbana")).toBe("dolce gabbana");
  });

  it("caps text at a word count", () => {
    expect(capWords("a b c d", 3)).toBe("a b c…");
    expect(capWords("  a b  ", 3)).toBe("a b");
  });
});

describe("recommendations (SPEC section 8 step 5)", () => {
  const entries = [entry(1, "A", "x", 10), entry(2, "B", "x", 7), entry(3, "C", "x", 2), entry(4, "D", "x", 10), entry(5, "E", "x", 11)];
  const fruity = completeProfile({ families: { Fruity: 1, Citrus: 0.2 }, facets: {} });

  it("scores by cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it("with nothing owned, returns the 3 best positive matches", () => {
    expect(recommend(entries, fruity, new Set()).map((r) => r.id)).toEqual([1, 4, 2]);
  });

  it("puts owned matches first, then only new bottles that beat the best owned one", () => {
    const recs = recommend(entries, fruity, new Set([2]));
    expect(recs.map((r) => [r.id, r.owned])).toEqual([[2, true], [1, false], [4, false]]);
    // Owning the best match leaves nothing new that beats it.
    expect(recommend(entries, fruity, new Set([1])).map((r) => r.id)).toEqual([1]);
  });

  it("returns nothing for a blank profile or one that matches nothing", () => {
    expect(recommend(entries, emptyProfile(), new Set())).toEqual([]);
    expect(recommend(entries, completeProfile({ families: { Fruity: -1 }, facets: {} }), new Set())).toEqual([]);
  });
});

describe("the cap day", () => {
  it("turns over at midnight in Toronto, not UTC", () => {
    // 03:30 UTC on 22 October is 23:30 on 21 October in Toronto (EDT, UTC-4).
    expect(torontoDay(Date.UTC(2026, 9, 22, 3, 30))).toBe("2026-10-21");
    expect(torontoDay(Date.UTC(2026, 9, 22, 4, 30))).toBe("2026-10-22");
  });
});

describe("the Anthropic client wrapper", () => {
  function fakeClient(create: (...args: unknown[]) => unknown) {
    return { messages: { create: vi.fn(create) } } as unknown as MessagesClient & { messages: { create: ReturnType<typeof vi.fn> } };
  }

  it("sends max_tokens 400, no thinking, and the JSON schema; returns text and usage", async () => {
    const client = fakeClient(async () => ({
      content: [{ type: "text", text: '{"a":1}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 812, output_tokens: 140 },
    }));
    const llm = anthropicLlm(client, "claude-haiku-5-5", 400);
    const res = await llm.complete({ system: "sys", messages: [{ role: "user", content: "hi" }], schema: OUTPUT_SCHEMA });
    expect(res).toEqual({ text: '{"a":1}', stopReason: "end_turn", inputTokens: 812, outputTokens: 140 });
    expect(client.messages.create).toHaveBeenCalledWith({
      model: "claude-haiku-5-5",
      max_tokens: 400,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });
  });

  it("turns any SDK failure into LlmUnavailableError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const llm = anthropicLlm(fakeClient(async () => { throw new Error("402 billing"); }), "m", 400);
    await expect(llm.complete({ system: "", messages: [], schema: {} })).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("logs the cause chain of a failure, with anything key-shaped masked", () => {
    const dns = Object.assign(new Error("getaddrinfo ENOTFOUND api.anthropic.com"), { code: "ENOTFOUND" });
    const fetchFailed = new TypeError("fetch failed", { cause: dns });
    const outer = new Error("Connection error. key sk-ant-api03-abc_DEF-123", { cause: fetchFailed });
    expect(causeChain(outer)).toBe(
      "Error Connection error. key sk-ant-[redacted] <- TypeError fetch failed <- Error ENOTFOUND getaddrinfo ENOTFOUND api.anthropic.com",
    );
  });
});
