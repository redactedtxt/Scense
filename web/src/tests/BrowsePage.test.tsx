import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "./render";

const item = (id: number, name: string) => ({
  id, slug: `brand-${name.toLowerCase()}`, name, brand: "Brand", gender: "male", releaseYear: 2020, imageUrl: null,
  communityRating: 4.1, ratingVotes: 9000, strength: 3, dominantFamily: "Woods",
});

// Echoes the requested sort back in the first item's name, so a test can see which
// request produced the list on screen.
function browseApi(extra: Record<string, unknown> = {}) {
  return mockApi([
    ["/api/families", () => ({ items: [] })],
    [
      "/api/fragrances",
      (url) => ({
        items: [item(1, `Sort-${url.searchParams.get("sort") ?? "default"}`)],
        page: 1, pageSize: 24, total: 1, totalPages: 1, fuzzy: false, ...extra,
      }),
    ],
  ]);
}

const listRequests = (fetchMock: ReturnType<typeof browseApi>) =>
  fetchMock.mock.calls.map(([input]) => new URL(input, "http://test")).filter((u) => u.pathname === "/api/fragrances");

afterEach(() => vi.unstubAllGlobals());

describe("Browse sort control (DECISIONS B24)", () => {
  it("offers the three sorts and opens on Most popular without a sort in the request", async () => {
    const fetchMock = browseApi();
    renderAt("/browse");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    expect(select).toHaveValue("popular");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Most popular", "Least popular", "Highest rated",
    ]);
    await screen.findByText("Sort-default");
    expect(listRequests(fetchMock).every((u) => !u.searchParams.has("sort"))).toBe(true);
  });

  it.each([
    ["Least popular", "least-popular"],
    ["Highest rated", "highest-rated"],
  ])("sends sort=%s to the API when chosen", async (label, value) => {
    const fetchMock = browseApi();
    renderAt("/browse");
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Sort by" }), label);
    expect(await screen.findByText(`Sort-${value}`)).toBeInTheDocument();
    expect(listRequests(fetchMock).at(-1)!.searchParams.get("sort")).toBe(value);
  });

  it("restores the sort from the URL, and going back to Most popular drops it again", async () => {
    const fetchMock = browseApi();
    renderAt("/browse?sort=highest-rated&gender=male");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    expect(select).toHaveValue("highest-rated");
    expect(await screen.findByText("Sort-highest-rated")).toBeInTheDocument();
    expect(listRequests(fetchMock).at(-1)!.searchParams.get("gender")).toBe("male"); // other filters kept

    await userEvent.selectOptions(select, "Most popular");
    expect(await screen.findByText("Sort-default")).toBeInTheDocument();
    expect(listRequests(fetchMock).at(-1)!.searchParams.has("sort")).toBe(false);
  });

  it("ignores an unknown sort in the URL", async () => {
    const fetchMock = browseApi();
    renderAt("/browse?sort=cheapest");
    expect(await screen.findByRole("combobox", { name: "Sort by" })).toHaveValue("popular");
    await screen.findByText("Sort-default");
    expect(listRequests(fetchMock).every((u) => !u.searchParams.has("sort"))).toBe(true);
  });

  it("goes back to page 1 when the sort changes", async () => {
    const fetchMock = browseApi({ totalPages: 3 });
    renderAt("/browse?page=2");
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Sort by" }), "Least popular");
    await waitFor(() => expect(listRequests(fetchMock).at(-1)!.searchParams.get("sort")).toBe("least-popular"));
    expect(listRequests(fetchMock).at(-1)!.searchParams.get("page")).toBe("1");
  });
});

describe("Browse typo fallback notice (DECISIONS B23)", () => {
  it("says the matches are close matches, not exact ones", async () => {
    browseApi({ fuzzy: true });
    renderAt("/browse?q=sauvge");
    expect(await screen.findByText("No exact match for “sauvge”. Showing 1 close match.")).toBeInTheDocument();
  });

  it("keeps the normal count for an exact search", async () => {
    browseApi();
    renderAt("/browse?q=sauvage");
    expect(await screen.findByText("1 fragrance match.")).toBeInTheDocument();
  });
});
