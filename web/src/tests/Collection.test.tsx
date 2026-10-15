import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadGuestState } from "../lib/guestStore";
import { mockApi, renderAt } from "./render";

const BANNER = "Your browser blocked storage, so your collection won't persist.";

const aventus = {
  id: 5,
  slug: "creed-aventus-2010",
  name: "Aventus",
  brand: "Creed",
  gender: "male",
  releaseYear: 2010,
  imageUrl: null,
  communityRating: 4.3,
  ratingVotes: 40000,
  strength: 2,
  dominantFamily: "Fruity",
  harshness: 0.4,
  familyProfile: [],
  facets: {},
  seasons: { winter: 0.2, spring: 0.3, summer: 0.3, autumn: 0.2 },
  daynight: { day: 0.6, night: 0.4 },
  notes: { top: [], heart: [], base: [], flat: [] },
  accords: [],
};

function fragranceApi() {
  return mockApi([["/api/fragrances/", () => aventus]]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Want and Own on the fragrance page", () => {
  it("survives a reload and shows up on /me under the right tab", async () => {
    fragranceApi();
    const page = renderAt("/f/creed-aventus-2010");
    await userEvent.click(await screen.findByRole("button", { name: "Own" }));
    expect(screen.getByRole("button", { name: "Own" })).toHaveAttribute("aria-pressed", "true");
    page.unmount();

    // A reload re-reads localStorage into the store; nothing is left in memory from before.
    loadGuestState();
    renderAt("/me");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Aventus" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Own/ })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("tab", { name: /Want/ }));
    expect(within(screen.getByRole("tabpanel")).getByText("Your Want list is empty.")).toBeInTheDocument();
  });

  it("moves a bottle from Want to Own, and a second press removes it", async () => {
    fragranceApi();
    renderAt("/f/creed-aventus-2010");
    const want = await screen.findByRole("button", { name: "Want" });
    const own = screen.getByRole("button", { name: "Own" });
    await userEvent.click(want);
    await userEvent.click(own);
    expect(want).toHaveAttribute("aria-pressed", "false");
    expect(own).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(own);
    expect(own).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the /me page", () => {
  it("opens the Want tab from the URL and empties a list from its own buttons", async () => {
    fragranceApi();
    const page = renderAt("/f/creed-aventus-2010");
    await userEvent.click(await screen.findByRole("button", { name: "Want" }));
    page.unmount();

    renderAt("/me?tab=want");
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(within(panel).getByRole("button", { name: "Want Aventus" }));
    expect(within(panel).getByText("Your Want list is empty.")).toBeInTheDocument();
  });

  it("is linked from the header as Collection", () => {
    renderAt("/me");
    expect(screen.getByRole("link", { name: "Collection" })).toHaveAttribute("href", "/me");
  });
});

describe("the storage-failure banner", () => {
  it("is hidden while storage works", () => {
    renderAt("/me");
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it("appears when localStorage throws on load, and Own still works for the visit", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    loadGuestState();
    fragranceApi();
    renderAt("/f/creed-aventus-2010");
    expect(screen.getByRole("status")).toHaveTextContent(BANNER);
    await userEvent.click(await screen.findByRole("button", { name: "Own" }));
    expect(screen.getByRole("button", { name: "Own" })).toHaveAttribute("aria-pressed", "true");
  });

  it("appears the moment a save fails", async () => {
    fragranceApi();
    renderAt("/f/creed-aventus-2010");
    const own = await screen.findByRole("button", { name: "Own" });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await userEvent.click(own);
    expect(await screen.findByText(BANNER)).toBeInTheDocument();
  });
});
