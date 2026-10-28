import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, noReviews, renderAt } from "./render";

// Feedback round 1 (DECISIONS B42): price guidance, brand pages, and the note pyramid.

const note = (name: string, family: string | null, imageUrl: string | null = null) => ({ name, mapped: family !== null, imageUrl, family });

const aventus = {
  id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", gender: "male", releaseYear: 2010, imageUrl: null,
  communityRating: 4.3, ratingVotes: 40000, strength: 2, dominantFamily: "Fruity", harshness: 0.4, familyProfile: [],
  facets: {}, seasons: { winter: 0.2, spring: 0.3, summer: 0.3, autumn: 0.2 }, daynight: { day: 0.6, night: 0.4 }, accords: [],
  price: { tier: 4, minCad: 300, maxCad: null },
  value: { score: 2.4, votes: 6210 },
  notes: {
    top: [note("Bergamot", "Citrus", "https://fimgs.net/mdimg/sastojci/t.75.jpg"), note("Pineapple", "Fruity")],
    heart: [note("Birch", "Dry Woods")],
    base: [note("Oakmoss", "Mossy Woods"), note("Ambroxan", null)],
    flat: [],
  },
};

const card = (id: number, name: string, brand = "Yves Saint Laurent") => ({
  id, slug: `s-${id}`, name, brand, gender: "female", releaseYear: 2014, imageUrl: null, communityRating: 4,
  ratingVotes: 9000, strength: 3, dominantFamily: "Woody Amber",
  price: { tier: 3, minCad: 150, maxCad: 300 }, value: null,
});

afterEach(() => vi.unstubAllGlobals());

describe("price guidance on the fragrance page", () => {
  it("labels the tier approximate, with its band in a tooltip, and shows the value votes", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => aventus]]);
    renderAt("/f/creed-aventus-2010");
    const tier = await screen.findByRole("button", { name: "Approximate price tier $$$$ approx." });
    expect(tier).toHaveAccessibleDescription("A 100 ml bottle is usually over 300 CAD. A rough tier, not a price.");
    expect(screen.getByText("Value for money: 2.4 out of 5, from 6,210 community votes")).toBeInTheDocument();
    // Never a price on its own.
    expect(screen.queryByText(/^\$\d/)).not.toBeInTheDocument();
  });

  it("links to a shopping search for the brand and name, in a new tab", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => aventus]]);
    renderAt("/f/creed-aventus-2010");
    const link = await screen.findByRole("link", { name: "Check current prices (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://www.google.com/search?tbm=shop&q=Creed+Aventus");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links the brand to its page", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => aventus]]);
    renderAt("/f/creed-aventus-2010");
    expect(await screen.findByRole("link", { name: "Creed" })).toHaveAttribute("href", "/browse?brand=Creed");
  });

  it("says so, and still offers today's prices, when the catalogue has no tier yet", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => ({ ...aventus, price: null, value: null })]]);
    renderAt("/f/creed-aventus-2010");
    expect(await screen.findByText("No price guide yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /price tier/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Check current prices/ })).toBeInTheDocument();
  });
});

describe("the note pyramid", () => {
  it("shows three tiers from top to base, each with when you smell it", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => aventus]]);
    renderAt("/f/creed-aventus-2010");
    const pyramid = await screen.findByRole("list", { name: "Note pyramid, from first impression to dry-down" });
    const tiers = within(pyramid).getAllByRole("region");
    expect(tiers.map((t) => t.getAttribute("aria-label"))).toEqual(["Top notes", "Heart notes", "Base notes"]);
    expect(within(tiers[0]!).getByText(/first 15 to 30 minutes/)).toBeInTheDocument();
    expect(within(tiers[1]!).getByText(/next few hours/)).toBeInTheDocument();
    expect(within(tiers[2]!).getByText(/lasts longest/)).toBeInTheDocument();
    expect(within(tiers[2]!).getByText("Ambroxan")).toBeInTheDocument();
  });

  it("shows a note's picture, and a family-tinted drop when it has none or it fails", async () => {
    mockApi([noReviews, ["/api/fragrances/", () => aventus]]);
    renderAt("/f/creed-aventus-2010");
    await screen.findByText("Bergamot");
    const photos = screen.getAllByTestId("note-photo");
    expect(photos).toHaveLength(1);
    expect(photos[0]).toHaveAttribute("src", "https://fimgs.net/mdimg/sastojci/t.75.jpg");
    expect(photos[0]).toHaveAttribute("width", "28"); // the frame is reserved before it loads
    expect(screen.getAllByTestId("note-placeholder")).toHaveLength(4);
    fireEvent.error(photos[0]!);
    expect(screen.queryByTestId("note-photo")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("note-placeholder")).toHaveLength(5);
  });

  it("gives a fragrance without layers one clear row", async () => {
    const flat = { ...aventus, notes: { top: [], heart: [], base: [], flat: [note("Rose", "Floral"), note("Oud", "Woody Amber")] } };
    mockApi([noReviews, ["/api/fragrances/", () => flat]]);
    renderAt("/f/creed-aventus-2010");
    const row = await screen.findByRole("region", { name: "All notes" });
    expect(within(row).getByText(/without layers/)).toBeInTheDocument();
    expect(within(row).getByText("Oud")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Note pyramid/ })).not.toBeInTheDocument();
  });
});

describe("brand pages", () => {
  const brandApi = () =>
    mockApi([
      ["/api/families", () => ({ items: [] })],
      [
        "/api/fragrances",
        (url) =>
          url.searchParams.get("brand") === "Nobody"
            ? new Response(JSON.stringify({ error: { code: "unknown_brand", message: "No brand" } }), { status: 404 })
            : { items: [card(1, "Black Opium")], page: 1, pageSize: 24, total: 1, totalPages: 1, fuzzy: false, brand: url.searchParams.get("brand") ? "Yves Saint Laurent" : null },
      ],
    ]);

  it("titles the page with the brand as the catalogue spells it, and asks for that brand", async () => {
    const fetchMock = brandApi();
    renderAt("/browse?brand=YSL");
    expect(await screen.findByRole("heading", { level: 1, name: "Yves Saint Laurent" })).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([input]) => new URL(input, "http://test")).filter((u) => u.pathname === "/api/fragrances");
    expect(urls.every((u) => u.searchParams.get("brand") === "YSL")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← All brands" })).toHaveAttribute("href", "/browse");
  });

  it("says so for a brand the catalogue doesn't have", async () => {
    brandApi();
    renderAt("/browse?brand=Nobody");
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no brand called “Nobody” in the catalogue.");
  });

  it("makes each Browse card's brand a link and its tier a control of its own", async () => {
    brandApi();
    renderAt("/browse");
    const brand = await screen.findByRole("link", { name: "Yves Saint Laurent" });
    expect(brand).toHaveAttribute("href", "/browse?brand=Yves+Saint+Laurent");
    expect(screen.getByRole("link", { name: "Black Opium" })).toHaveAttribute("href", "/f/s-1");
    const tier = screen.getByRole("button", { name: "Approximate price tier $$$ approx." });
    await userEvent.hover(tier);
    expect(tier).toHaveAccessibleDescription(/about 150 to 300 CAD/);
  });
});
