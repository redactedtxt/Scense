import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "./render";

// M8 on the web side: reviews on the fragrance page and pair ratings on result cards.

const ana = { id: 1, email: "ana@example.com", displayName: "Ana" };

const aventus = {
  id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", gender: "male", releaseYear: 2010,
  imageUrl: null, communityRating: 4.3, ratingVotes: 40000, strength: 2, dominantFamily: "Fruity",
  harshness: 0.4, familyProfile: [], facets: {}, seasons: { winter: 0.2, spring: 0.3, summer: 0.3, autumn: 0.2 },
  daynight: { day: 0.6, night: 0.4 }, notes: { top: [], heart: [], base: [], flat: [] }, accords: [],
};

const SCRIPT = `<script>window.__pwned = true</script><img src="x" onerror="window.__pwned = true">`;

function review(id: number, authorName: string, body: string, extra: object = {}) {
  return {
    id, stars: 4, body, authorName, mine: false,
    createdAt: `2026-10-${10 + id}T12:00:00.000Z`, updatedAt: `2026-10-${10 + id}T12:00:00.000Z`, ...extra,
  };
}

function page(items: object[], extra: object = {}) {
  return { items, mine: null, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...extra };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { __pwned?: boolean }).__pwned;
});

function requests(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.map(([input, init]) => {
    const url = new URL(input, "http://t");
    return `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
  });
}

describe("reviews for a guest", () => {
  it("lists reviews in the API's order (newest first) with name and date, and links to sign in", async () => {
    mockApi([
      ["/api/fragrances/5/reviews", () => page([review(2, "Ben", "Newer."), review(1, "Cleo", "Older.")])],
      ["/api/fragrances/", () => aventus],
    ]);
    renderAt("/f/creed-aventus-2010");
    const list = await screen.findByRole("list", { name: "Reviews" });
    const items = within(list).getAllByRole("article");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual(["Review by Ben", "Review by Cleo"]);
    expect(within(items[0]!).getByText("Oct 12, 2026")).toBeInTheDocument();
    expect(within(items[0]!).getByRole("img", { name: "4 of 5 stars" })).toBeInTheDocument();
    expect(screen.getByText(/2 reviews on Scense/)).toBeInTheDocument();

    const prompt = screen.getByRole("link", { name: "Sign in to review" });
    expect(prompt).toHaveAttribute("href", "/login?next=%2Ff%2Fcreed-aventus-2010");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a script tag in a review as text and never runs it", async () => {
    mockApi([
      ["/api/fragrances/5/reviews", () => page([review(1, "Mallory", SCRIPT)])],
      ["/api/fragrances/", () => aventus],
    ]);
    const { container } = renderAt("/f/creed-aventus-2010");
    // The exact characters are on the page as text...
    expect(await screen.findByText(SCRIPT)).toBeInTheDocument();
    // ...and none of it became an element: no script, no img with the onerror handler.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("pages through with Show more", async () => {
    const fetchMock = mockApi([
      ["/api/fragrances/5/reviews", (url) =>
        url.searchParams.get("page") === "2"
          ? page([review(3, "Page Two", "Later.")], { page: 2, total: 11, totalPages: 2 })
          : page([review(1, "Page One", "First.")], { total: 11, totalPages: 2 })],
      ["/api/fragrances/", () => aventus],
    ]);
    renderAt("/f/creed-aventus-2010");
    await userEvent.click(await screen.findByRole("button", { name: "Show more (10 left)" }));
    expect(await screen.findByText("Later.")).toBeInTheDocument();
    expect(requests(fetchMock)).toContain("GET /api/fragrances/5/reviews?page=2");
  });
});

describe("reviews for a signed-in user", () => {
  it("posts a new review with stars and text, and asks for stars first", async () => {
    let posted: unknown = null;
    mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/fragrances/5/reviews", (_url, init) => {
        if (init?.method === "POST") posted = JSON.parse(String(init.body));
        return init?.method === "POST" ? review(9, "Ana", "Lovely.", { mine: true }) : page([]);
      }],
      ["/api/fragrances/", () => aventus],
    ]);
    renderAt("/f/creed-aventus-2010");
    const text = await screen.findByRole("textbox", { name: "Your review" });
    await userEvent.type(text, "Lovely in the cold.");
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose from 1 to 5 stars.");
    expect(posted).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() => expect(posted).toEqual({ stars: 4, body: "Lovely in the cold." }));
  });

  it("counts characters like the database and blocks a review over 2,000", async () => {
    mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/fragrances/5/reviews", () => page([])],
      ["/api/fragrances/", () => aventus],
    ]);
    renderAt("/f/creed-aventus-2010");
    const text = await screen.findByRole("textbox", { name: "Your review" });
    // Typing 2,001 characters with userEvent is slow; paste them instead.
    await userEvent.click(text);
    await userEvent.paste("🌹".repeat(2000));
    expect(screen.getByText("2,000 / 2,000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post review" })).toBeEnabled();
    await userEvent.paste("a");
    expect(screen.getByRole("button", { name: "Post review" })).toBeDisabled();
  });

  it("edits and deletes the user's own review", async () => {
    const mine = review(4, "Ana", "First take.", { mine: true, stars: 3 });
    const fetchMock = mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/fragrances/5/reviews", (_url, init) =>
        init?.method === "DELETE" ? new Response(null, { status: 204 })
          : init?.method === "PUT" ? { ...mine, ...JSON.parse(String(init.body)) }
            : page([mine], { mine })],
      ["/api/fragrances/", () => aventus],
    ]);
    renderAt("/f/creed-aventus-2010");
    expect(await screen.findByText("Your review")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const text = screen.getByRole("textbox", { name: "Your review" });
    expect(text).toHaveValue("First take.");
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
    await userEvent.clear(text);
    await userEvent.type(text, "Grew on me.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(requests(fetchMock)).toContain("PUT /api/fragrances/5/reviews"));

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(requests(fetchMock)).toContain("DELETE /api/fragrances/5/reviews"));
  });
});

describe("pair ratings on result cards", () => {
  const base = { ...aventus, id: 1, slug: "base-bottle", name: "Base Bottle" };
  const partner = { id: 11, rank: 1, score: 100, slug: "eclaire", name: "Eclaire", brand: "Lattafa", imageUrl: null, dominantFamily: "Soft Amber", owned: false };
  const pairing = () => ({
    base: { id: 1, slug: "base-bottle", name: "Base Bottle", brand: "Creed", dominantFamily: "Fruity" },
    goal: "soften", page: 1, pageSize: 24, total: 1, matching: 1, totalPages: 1, items: [partner],
  });

  it("guests see the stars disabled and a link to sign in", async () => {
    mockApi([
      ["/api/pairing/fragrances/", pairing],
      ["/api/fragrances/", () => base],
    ]);
    renderAt("/?f=base-bottle&goal=soften");
    const group = await screen.findByRole("group", { name: "Rate how well Eclaire softened Base Bottle for you" });
    for (const radio of within(group).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByRole("link", { name: "Sign in to rate" })).toHaveAttribute(
      "href",
      "/login?next=%2F%3Ff%3Dbase-bottle%26goal%3Dsoften",
    );
  });

  it("shows the user's saved rating for this goal and stores a change", async () => {
    let put: unknown = null;
    const fetchMock = mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/collection", () => ({ items: [] })],
      ["/api/pair-ratings", (_url, init) => {
        if (init?.method === "PUT") put = JSON.parse(String(init.body));
        return init?.method === "PUT" ? put : { items: [{ partnerId: 11, stars: 2 }] };
      }],
      ["/api/pairing/fragrances/", pairing],
      ["/api/fragrances/", () => base],
    ]);
    renderAt("/?f=base-bottle&goal=soften");
    const group = await screen.findByRole("group", { name: /Eclaire softened Base Bottle/ });
    await waitFor(() => expect(within(group).getByRole("radio", { name: "2 stars" })).toBeChecked());
    expect(requests(fetchMock)).toContain("GET /api/pair-ratings?baseId=1&goal=soften");

    await userEvent.click(within(group).getByRole("radio", { name: "5 stars" }));
    await waitFor(() => expect(put).toEqual({ baseId: 1, partnerId: 11, goal: "soften", stars: 5 }));
    expect(within(group).getByRole("radio", { name: "5 stars" })).toBeChecked();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
