import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setStatus } from "../lib/guestStore";
import { mockApi, renderAt } from "./render";

const base = {
  id: 1,
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
const partner = { ...base, id: 2, slug: "hermes-terre-d-hermes-2006", name: "Terre d'Hermès", brand: "Hermès" };

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

// Page 1 of a 280-partner list holds Eclaire. "Deep Cut" sits at rank 150, far past
// page 1, so only a server-side "Owned only" filter can find it.
const eclaire = { id: 11, rank: 1, score: 100, slug: "eclaire", name: "Eclaire", brand: "Lattafa", imageUrl: null, dominantFamily: "Soft Amber", owned: false };
const deepCut = { id: 42, rank: 150, score: 40, slug: "deep-cut", name: "Deep Cut", brand: "Niche", imageUrl: null, dominantFamily: "Floral", owned: true };

const fragrancePairing = (url: URL) => {
  const ownedOnly = url.searchParams.get("ownedOnly") === "true";
  const owned = (url.searchParams.get("owned") ?? "").split(",").filter(Boolean).map(Number);
  const items = ownedOnly ? [deepCut].filter((item) => owned.includes(item.id)) : [eclaire];
  return {
    base: { id: base.id, slug: base.slug, name: base.name, brand: base.brand, dominantFamily: base.dominantFamily },
    goal: url.searchParams.get("goal"),
    page: 1,
    pageSize: 24,
    total: 280,
    matching: ownedOnly ? items.length : 280,
    totalPages: ownedOnly ? 1 : 12,
    items,
  };
};

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

const BASE_URL = `/?f=${base.slug}`;

describe("pairing page, nothing picked yet (DECISIONS B25)", () => {
  it("opens with an empty search box and a prompt, and asks the API for no partners", async () => {
    const fetchMock = standardApi();
    renderAt("/");
    expect(await screen.findByText(/Pick a fragrance above to see what to layer with it/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search fragrances" })).toHaveValue("");
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Find my bottle's rank" })).not.toBeInTheDocument();
    const paths = fetchMock.mock.calls.map(([input]) => new URL(input, "http://test").pathname);
    expect(paths.filter((path) => path.includes("/pairing/") || path.includes("/fragrances/"))).toEqual([]);
  });

  it("prompts in Notes mode with notes-only wording and no notes preselected", async () => {
    standardApi();
    renderAt("/?mode=notes");
    expect(await screen.findByText("Pick a note or two above to see which notes layer with them.")).toBeInTheDocument();
    expect(screen.getByText("No notes picked yet.")).toBeInTheDocument();
    // SPEC section 11: the notes-mode results area never talks about fragrances.
    expect(within(screen.getByRole("region", { name: "Results" })).queryByText(/fragrance/i)).not.toBeInTheDocument();
  });

  it("still preloads a shared ?f= link", async () => {
    standardApi();
    renderAt(`/?f=${base.slug}&goal=enhance`);
    expect(await screen.findByDisplayValue("Club de Nuit Intense Man")).toBeInTheDocument();
    expect(await screen.findByText(/280 fragrances ranked to strengthen Club de Nuit Intense Man/)).toBeInTheDocument();
    expect(screen.queryByText(/Pick a fragrance above/)).not.toBeInTheDocument();
  });

  it("replaces the prompt with results once a fragrance is picked", async () => {
    standardApi();
    renderAt("/");
    await userEvent.type(await screen.findByRole("combobox", { name: "Search fragrances" }), "club");
    await userEvent.click(await screen.findByRole("option", { name: /Terre d'Hermès/ }));
    expect(await screen.findByRole("heading", { name: "Eclaire" })).toBeInTheDocument();
    expect(screen.queryByText(/Pick a fragrance above/)).not.toBeInTheDocument();
  });
});

describe("bottle thumbnails in the search dropdowns (DECISIONS B26)", () => {
  const withPhoto = { ...partner, imageUrl: "https://img.test/terre.jpg" };

  function listApi(items: unknown[]) {
    mockApi([
      [`/api/pairing/fragrances/${base.slug}/rank`, () => ({ status: "too_harsh", total: 280 })],
      ["/api/pairing/fragrances/", fragrancePairing],
      ["/api/fragrances/", () => ({ ...base, harshness: 0.6 })],
      ["/api/fragrances", () => ({ items, page: 1, pageSize: 24, total: items.length, totalPages: 1, fuzzy: false })],
    ]);
  }

  it("shows the photo in the base picker, in a frame whose size is fixed before it loads", async () => {
    listApi([withPhoto]);
    renderAt("/");
    await userEvent.type(await screen.findByRole("combobox", { name: "Search fragrances" }), "terre");
    const option = await screen.findByRole("option", { name: /Terre d'Hermès/ });
    const photo = option.querySelector("img");
    expect(photo).toHaveAttribute("src", "https://img.test/terre.jpg");
    expect(photo).toHaveAttribute("alt", ""); // the name is right next to it
    // The frame (not the image) carries the size, so nothing moves when the photo arrives.
    expect(photo!.parentElement).toHaveClass("h-10", "w-[30px]");
  });

  it("draws the placeholder bottle when a bottle has no photo, like the result cards", async () => {
    listApi([partner]); // imageUrl: null
    renderAt(BASE_URL);
    await pickRankPartner("terre"); // also covers the rank finder's dropdown
    const input = screen.getByRole("combobox", { name: "Find my bottle's rank" });
    await userEvent.clear(input);
    await userEvent.type(input, "terre");
    const option = await screen.findByRole("option", { name: /Terre d'Hermès/ });
    expect(within(option).getByTestId("placeholder-bottle")).toBeInTheDocument();
    expect(option.querySelector("img")).toBeNull();
  });

  it("falls back to the placeholder when the photo fails to load", async () => {
    listApi([withPhoto]);
    renderAt(BASE_URL);
    const box = await screen.findByRole("combobox", { name: "Find my bottle's rank" });
    await userEvent.type(box, "terre");
    const option = await screen.findByRole("option", { name: /Terre d'Hermès/ });
    fireEvent.error(option.querySelector("img")!);
    expect(within(option).getByTestId("placeholder-bottle")).toBeInTheDocument();
  });

  it("keeps note suggestions as text, since notes have no bottle", async () => {
    mockApi([["/api/notes", () => ({ items: [{ name: "Rose", dominantFamily: "Floral" }] })]]);
    renderAt("/?mode=notes");
    await userEvent.type(await screen.findByRole("combobox", { name: "Search notes" }), "ro");
    const option = await screen.findByRole("option", { name: /Rose/ });
    expect(option.querySelector("img")).toBeNull();
    expect(within(option).queryByTestId("placeholder-bottle")).not.toBeInTheDocument();
  });
});

describe("pairing page, Fragrance mode", () => {
  it("lists partners with their family and no concentration label", async () => {
    standardApi();
    renderAt(BASE_URL);
    expect(await screen.findByText("280 fragrances ranked to tone down Club de Nuit Intense Man.")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Eclaire" }).closest("article")!;
    expect(within(card).getByText("Soft Amber")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/eau de/i);
  });

  it("filters Owned only on the server, finding owned partners past the loaded page", async () => {
    setStatus({ ...deepCut, imageUrl: null }, "own");
    const fetchMock = standardApi();
    renderAt(BASE_URL);
    await screen.findByRole("heading", { name: "Eclaire" });
    expect(screen.queryByRole("heading", { name: "Deep Cut" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Owned only" }));
    const card = (await screen.findByRole("heading", { name: "Deep Cut" })).closest("article")!;
    expect(within(card).getByText("Rank 150")).toBeInTheDocument(); // the full-list rank
    expect(within(card).getByText("Owned")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Eclaire" })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the 1 you own\./)).toBeInTheDocument();

    const filtered = fetchMock.mock.calls.map(([input]) => new URL(input, "http://test")).find((u) => u.searchParams.get("ownedOnly"));
    expect(filtered?.searchParams.get("owned")).toBe("42");
  });

  it("says so when Owned only is on but nothing is owned", async () => {
    standardApi();
    renderAt(BASE_URL);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Owned only" }));
    expect(await screen.findByText("You have not marked any bottles as Owned yet.")).toBeInTheDocument();
  });

  it("marks a result card Own, showing the badge at once", async () => {
    standardApi();
    renderAt(BASE_URL);
    const card = (await screen.findByRole("heading", { name: "Eclaire" })).closest("article")!;
    expect(within(card).queryByText("Owned")).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Own Eclaire" }));
    expect(within(card).getByRole("button", { name: "Own Eclaire" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText("Owned")).toBeInTheDocument();
  });

  it("sends the guest id in an X-Guest-Id header", async () => {
    const fetchMock = standardApi();
    renderAt(BASE_URL);
    await screen.findByRole("heading", { name: "Eclaire" });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Guest-Id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("answers 'too harsh' in the rank finder instead of a missing rank", async () => {
    standardApi();
    renderAt(BASE_URL);
    await pickRankPartner("terre");
    expect(await screen.findByText("Terre d'Hermès is too harsh to soften this base.")).toBeInTheDocument();
  });

  it("shows '#N of total' for a ranked bottle, picked with the keyboard", async () => {
    standardApi({ status: "ranked", rank: 38, total: 280, score: 61.2 });
    renderAt(`${BASE_URL}&goal=enhance`);
    await pickRankPartner("terre");
    expect(await screen.findByText("#38")).toBeInTheDocument();
    expect(screen.getByText("of 280")).toBeInTheDocument();
  });
});
