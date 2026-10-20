import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getState, setStatus } from "../lib/guestStore";
import { safeNext } from "../lib/session";
import { errorResponse, mockApi, renderAt } from "./render";

// Accounts on the web side (M7): the sign-up and log-in pages, the header, the guest
// import, and the collection switching from the browser to the account once signed in.

const ana = { id: 1, email: "ana@example.com", displayName: "Ana" };

const aventus = {
  id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", gender: "male", releaseYear: 2010,
  imageUrl: null, communityRating: 4.3, ratingVotes: 40000, strength: 2, dominantFamily: "Fruity",
  harshness: 0.4, familyProfile: [], facets: {}, seasons: { winter: 0.2, spring: 0.3, summer: 0.3, autumn: 0.2 },
  daynight: { day: 0.6, night: 0.4 }, notes: { top: [], heart: [], base: [], flat: [] }, accords: [],
};

const saved = (id: number, name: string, status: "own" | "want") => ({
  id, slug: `brand-${id}`, name, brand: "Brand", imageUrl: null, dominantFamily: "Woods", status,
  addedAt: "2026-10-18T10:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Every request the mock saw, as "METHOD /path".
function requests(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${new URL(input, "http://t").pathname}`);
}

describe("the sign-up page", () => {
  it("says in one line that there is no email verification or password reset", () => {
    mockApi([]);
    renderAt("/signup");
    expect(screen.getByText(/no email verification or password reset/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "10");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("offers the guest's bottles to the new account, imports them, and empties the browser list", async () => {
    setStatus(saved(5, "Aventus", "own"), "own");
    setStatus(saved(7, "Eclaire", "want"), "want");
    const fetchMock = mockApi([
      ["/api/auth/signup", () => ({ user: ana })],
      ["/api/collection/import", () => ({ imported: 2, skipped: 0 })],
      ["/api/collection", () => ({ items: [saved(7, "Eclaire", "want"), saved(5, "Aventus", "own")] })],
    ]);
    renderAt("/signup?next=/me");

    await userEvent.type(screen.getByLabelText("Email"), ana.email);
    await userEvent.type(screen.getByLabelText("Display name"), "Ana");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Bring your 2 bottles along?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add 2 bottles" }));

    // Lands on ?next= (/me), showing the account's list, and the browser copy is gone.
    expect(await screen.findByRole("heading", { name: "Aventus" })).toBeInTheDocument();
    expect(getState().collection).toEqual([]);
    const importCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/import"))!;
    expect(JSON.parse(importCall[1]!.body as string).items).toEqual([
      { fragranceId: 7, status: "want", addedAt: expect.any(String) },
      { fragranceId: 5, status: "own", addedAt: expect.any(String) },
    ]);
  });

  it("'Not now' keeps the guest list in the browser, and /me offers the import again", async () => {
    setStatus(saved(5, "Aventus", "own"), "own");
    mockApi([
      ["/api/auth/signup", () => ({ user: ana })],
      ["/api/collection", () => ({ items: [] })],
    ]);
    renderAt("/signup?next=/me");
    await userEvent.type(screen.getByLabelText("Email"), ana.email);
    await userEvent.type(screen.getByLabelText("Display name"), "Ana");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));

    expect(await screen.findByRole("heading", { name: "Bring your 1 bottle along?" })).toBeInTheDocument();
    expect(getState().collection).toHaveLength(1);
  });
});

describe("the log-in page", () => {
  it("shows the API's message when the password is wrong, and stays signed out", async () => {
    mockApi([["/api/auth/login", () => errorResponse(401, "invalid_credentials", "That email and password don't match.")]]);
    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), ana.email);
    await userEvent.type(screen.getByLabelText("Password"), "wrong password");
    await userEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match.");
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
  });

  it("turns the API's field errors into sentences", async () => {
    mockApi([["/api/auth/login", () => errorResponse(400, "invalid_request", "email: enter a valid email address")]]);
    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Enter a valid email address\.$/);
  });

  it("goes straight to ?next= when there is nothing to import", async () => {
    mockApi([
      ["/api/auth/login", () => ({ user: ana })],
      ["/api/collection", () => ({ items: [] })],
    ]);
    renderAt("/login?next=/me");
    await userEvent.type(screen.getByLabelText("Email"), ana.email);
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Saved to your account.", { exact: false })).toBeInTheDocument();
  });
});

describe("the header", () => {
  it("shows Sign in to a guest, with ?next= pointing back at the page", async () => {
    mockApi([]);
    renderAt("/me?tab=want");
    const links = await screen.findAllByRole("link", { name: "Sign in" });
    expect(links[0]).toHaveAttribute("href", "/login?next=%2Fme%3Ftab%3Dwant");
  });

  it("shows the user's name and signs out back to guest mode", async () => {
    const fetchMock = mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/auth/logout", () => new Response(null, { status: 204 })],
      ["/api/collection", () => ({ items: [] })],
    ]);
    renderAt("/about");
    expect((await screen.findAllByText("Ana"))[0]).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);
    expect((await screen.findAllByRole("link", { name: "Sign in" }))[0]).toBeInTheDocument();
    expect(requests(fetchMock)).toContain("POST /api/auth/logout");
  });
});

describe("signed in, Own and Want save to the account", () => {
  it("sends PUT and DELETE to the collection API and leaves the browser list alone", async () => {
    const fetchMock = mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/fragrances/", () => aventus],
      ["/api/collection/5", (_url, init) =>
        init?.method === "DELETE" ? new Response(null, { status: 204 }) : saved(5, "Aventus", "own")],
      ["/api/collection", () => ({ items: [] })],
    ]);
    renderAt("/f/creed-aventus-2010");
    const own = await screen.findByRole("button", { name: "Own" });
    await waitFor(() => expect(own).toBeEnabled());

    await userEvent.click(own);
    expect(own).toHaveAttribute("aria-pressed", "true"); // optimistic: lit before the reply
    await waitFor(() => expect(requests(fetchMock)).toContain("PUT /api/collection/5"));
    await userEvent.click(own);
    await waitFor(() => expect(requests(fetchMock)).toContain("DELETE /api/collection/5"));
    expect(own).toHaveAttribute("aria-pressed", "false");
    expect(getState().collection).toEqual([]);
  });

  it("shows the account's list on /me, not the browser's", async () => {
    setStatus(saved(9, "Guest Bottle", "own"), "own");
    mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/collection", () => ({ items: [saved(5, "Aventus", "own")] })],
    ]);
    renderAt("/me");
    const panel = screen.getByRole("tabpanel");
    expect(await within(panel).findByRole("heading", { name: "Aventus" })).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: "Guest Bottle" })).not.toBeInTheDocument();
    // ...and the guest bottle is offered for import instead.
    expect(screen.getByRole("heading", { name: "Bring your 1 bottle along?" })).toBeInTheDocument();
  });
});

describe("safeNext", () => {
  it("accepts paths on this site only", () => {
    expect(safeNext("/me?tab=want")).toBe("/me?tab=want");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "me"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
