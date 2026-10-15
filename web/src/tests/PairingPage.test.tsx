import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "./render";

const base = {
  slug: "armaf-club-de-nuit-intense-man-2015",
  name: "Club de Nuit Intense Man",
  brand: "Armaf",
  gender: "male",
  releaseYear: 2015,
  imageUrl: null,
  communityRating: 4.07,
  ratingVotes: 29183,
  strength: 4,
  dominantFamily: "Citrus",
};
const partner = { ...base, slug: "hermes-terre-d-hermes-2006", name: "Terre d'Hermès", brand: "Hermès" };

const notePairing = (_url: URL, init?: RequestInit) => {
  const { notes, goal } = JSON.parse(String(init?.body));
  return {
    goal,
    inputs: notes,
    total: 2,
    results: [
      { note: "Rose", rank: 1, score: 100, dominantFamily: "Floral" },
      { note: "Iris", rank: 2, score: 88.5, dominantFamily: "Soft Floral" },
    ],
  };
};

const fragrancePairing = (url: URL) => ({
  base: { slug: base.slug, name: base.name, brand: base.brand, dominantFamily: base.dominantFamily },
  goal: url.searchParams.get("goal"),
  page: 1,
  pageSize: 24,
  total: 280,
  totalPages: 12,
  items: [
    { rank: 1, score: 100, slug: "eclaire", name: "Eclaire", brand: "Lattafa", imageUrl: null, dominantFamily: "Soft Amber", owned: false },
  ],
});

// Order matters: the first matching prefix answers, so specific paths come first.
function standardApi(rank: unknown = { status: "too_harsh", total: 280 }) {
  return mockApi([
    ["/api/pairing/notes", notePairing],
    [`/api/pairing/fragrances/${base.slug}/rank`, () => rank],
    ["/api/pairing/fragrances/", fragrancePairing],
    ["/api/fragrances/", () => ({ ...base, harshness: 0.6 })],
    ["/api/fragrances", () => ({ items: [partner], page: 1, pageSize: 24, total: 300, totalPages: 13 })],
  ]);
}

async function pickRankPartner(keys: string) {
  const box = await screen.findByRole("combobox", { name: "Find my bottle's rank" });
  await userEvent.type(box, keys);
  await screen.findByRole("option", { name: /Terre d'Hermès/ });
  await userEvent.keyboard("{ArrowDown}{Enter}");
}

afterEach(() => vi.unstubAllGlobals());

describe("pairing page, Notes mode (SPEC section 11 overrides)", () => {
  it("summarises in notes only and hides the rank finder and Owned switch", async () => {
    standardApi();
    renderAt("/?mode=notes&notes=Bergamot,Vanilla&goal=soften");
    expect(await screen.findByText("2 notes ranked to soften Bergamot and Vanilla.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rose" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Find my bottle's rank" })).not.toBeInTheDocument();
    expect(screen.queryByText("Owned only")).not.toBeInTheDocument();
  });

  it("removes a note when its chip is pressed", async () => {
    standardApi();
    renderAt("/?mode=notes&notes=Bergamot,Vanilla");
    await userEvent.click(await screen.findByRole("button", { name: "Remove Vanilla" }));
    const chips = screen.getByRole("list", { name: "Selected notes" });
    expect(within(chips).queryByText(/Vanilla/)).not.toBeInTheDocument();
    expect(await screen.findByText(/ranked to soften Bergamot\.$/)).toBeInTheDocument();
  });
});

describe("pairing page, Fragrance mode", () => {
  it("lists partners with their family and no concentration label", async () => {
    standardApi();
    renderAt("/");
    expect(await screen.findByText("280 fragrances ranked to tone down Club de Nuit Intense Man.")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Eclaire" }).closest("article")!;
    expect(within(card).getByText("Soft Amber")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/eau de/i);
  });

  it("hides the Owned only switch until Own buttons exist (M5)", async () => {
    standardApi();
    renderAt("/");
    await screen.findByText("280 fragrances ranked to tone down Club de Nuit Intense Man.");
    expect(screen.queryByText("Owned only")).not.toBeInTheDocument();
  });

  it("answers 'too harsh' in the rank finder instead of a missing rank", async () => {
    standardApi();
    renderAt("/");
    await pickRankPartner("terre");
    expect(await screen.findByText("Terre d'Hermès is too harsh to soften this base.")).toBeInTheDocument();
  });

  it("shows '#N of total' for a ranked bottle, picked with the keyboard", async () => {
    standardApi({ status: "ranked", rank: 38, total: 280, score: 61.2 });
    renderAt("/?goal=enhance");
    await pickRankPartner("terre");
    expect(await screen.findByText("#38")).toBeInTheDocument();
    expect(screen.getByText("of 280")).toBeInTheDocument();
  });
});
