import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getState, setStatus, setTasteProfile } from "../lib/guestStore";
import { describeProfile, emptyProfile, normalizeProfile } from "../lib/tasteProfile";
import { chatDate } from "../pages/chat/ChatList";
import { errorResponse, mockApi, renderAt } from "./render";

// The chat page, the taste profile card, and the profile's guest import (M9). The API
// is mocked, so no request ever reaches the server, let alone Anthropic.

const ana = { id: 1, email: "ana@example.com", displayName: "Ana" };
const emptyChat = { available: true, messagesUsed: 0, messagesLimit: 8, conversations: [] };
const DISCLAIMER = "Up to 8 messages a day, shared across all your chats. Recommendations come from our catalogue only.";

// Two saved chats, newest first, as GET /api/chat lists them (DECISIONS B36).
const CHAT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CHAT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const summary = (id: string, title: string, lastMessageAt: string) => ({ id, title, createdAt: lastMessageAt, lastMessageAt });
const twoChats = {
  ...emptyChat,
  messagesUsed: 5,
  conversations: [
    summary(CHAT_B, "fresh citrus for summer", new Date().toISOString()),
    summary(CHAT_A, "smoky leather and vanilla", "2026-09-14T15:00:00Z"),
  ],
};
const chatWith = (id: string, title: string, messages: { role: string; content: string }[]) => ({
  conversation: summary(id, title, new Date().toISOString()),
  messages: messages.map((m) => ({ ...m, recommendations: [] })),
});
const newChat = summary("cccccccc-0000-4000-8000-000000000003", "fresh lemony woods", new Date().toISOString());

const profile = (families: Record<string, number>, facets: Record<string, number> = {}, summary: string | null = null) =>
  ({ ...emptyProfile(), ...normalizeProfile({ families, facets, summary })! });

const sauvage = {
  id: 2, slug: "dior-sauvage-2015", name: "Sauvage", brand: "Dior", imageUrl: null,
  dominantFamily: "Citrus", owned: false, match: 91,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bodyOf(fetchMock: ReturnType<typeof mockApi>, path: string) {
  const call = fetchMock.mock.calls.find(([input, init]) => String(input).includes(path) && init?.method);
  return JSON.parse(call![1]!.body as string);
}

describe("the chat page", () => {
  it("is in the nav and shows the spec's disclaimer under the input", async () => {
    mockApi([["/api/chat", () => emptyChat]]);
    renderAt("/chat");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chat");
    expect(await screen.findByLabelText("Your message")).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(/0 of 8 messages used today/)).toBeInTheDocument();
  });

  it("sends a guest's profile and Own list, shows the reply and the server's picks, and saves the profile", async () => {
    setStatus({ id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", imageUrl: null, dominantFamily: "Fruity" }, "own");
    setTasteProfile(profile({ Citrus: 0.2 }));
    const next = profile({ Citrus: 0.52, "Woody Amber": 0.4 }, {}, "You lean toward Citrus scents.");
    const fetchMock = mockApi([
      ["/api/chat", (_url, init) => init?.method === "POST"
        ? { conversation: newChat, reply: "Bright Citrus with a woody base.", profile: next, recommendations: [sauvage], degraded: false, messagesUsed: 1, messagesLimit: 8 }
        : emptyChat],
    ]);
    renderAt("/chat");
    await userEvent.type(await screen.findByLabelText("Your message"), "fresh lemony woods{Enter}");

    expect(await screen.findByText("Bright Citrus with a woody base.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sauvage" })).toHaveAttribute("href", "/f/dior-sauvage-2015");
    expect(screen.getByText("91% match")).toBeInTheDocument();
    expect(screen.getByText(/1 of 8 messages used today/)).toBeInTheDocument();

    const sent = bodyOf(fetchMock, "/api/chat");
    expect(sent).toMatchObject({ message: "fresh lemony woods", owned: [5] });
    expect(sent).not.toHaveProperty("conversationId"); // a first message starts a new chat
    // The new chat joins the list, titled from the visitor's words.
    expect(within(screen.getByRole("navigation", { name: "Your chats" })).getByRole("button", { name: /^fresh lemony woods/ }))
      .toHaveAttribute("aria-current", "true");
    expect(sent.tasteProfile.families.Citrus).toBe(0.2);
    // The card beside the chat updates from the browser store.
    expect(getState().tasteProfile?.families["Woody Amber"]).toBe(0.4);
    expect(await screen.findByText("You lean toward Citrus scents.")).toBeInTheDocument();
  });

  it("says the assistant is unavailable before anyone types, and the page still works", async () => {
    mockApi([["/api/chat", () => ({ ...emptyChat, available: false })]]);
    renderAt("/chat");
    expect(await screen.findByText(/assistant is unavailable right now/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What you like" })).toBeInTheDocument();
  });

  it("shows the friendly message when a send fails, and gives the words back", async () => {
    mockApi([
      ["/api/chat", (_url, init) => init?.method === "POST"
        ? errorResponse(503, "assistant_unavailable", "down")
        : emptyChat],
    ]);
    renderAt("/chat");
    const box = await screen.findByLabelText("Your message");
    await userEvent.type(box, "warm vanilla{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/assistant is unavailable right now/);
    expect(box).toHaveValue("warm vanilla");
  });

  it("closes the input with the server's words at the guest cap", async () => {
    const message = "Today's guest demos are used up. Sign up or come back tomorrow.";
    mockApi([["/api/chat", (_url, init) => (init?.method === "POST" ? errorResponse(429, "guest_cap", message) : emptyChat)]]);
    renderAt("/chat");
    await userEvent.type(await screen.findByLabelText("Your message"), "hello{Enter}");
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
  });

  it("closes the input once today's 8 messages are used, and shows the saved conversation", async () => {
    mockApi([
      [`/api/chat/${CHAT_A}`, () => ({
        conversation: twoChats.conversations[1],
        messages: [
          { role: "user", content: "<script>alert(1)</script> smoky", recommendations: [] },
          { role: "assistant", content: "Smoky Dry Woods.", recommendations: [sauvage] },
        ],
      })],
      ["/api/chat", () => ({ ...twoChats, messagesUsed: 8 })],
    ]);
    renderAt(`/chat?c=${CHAT_A}`);
    expect(await screen.findByText(/used today's messages/)).toBeInTheDocument();
    expect(await screen.findByText("Smoky Dry Woods.")).toBeInTheDocument();
    // A visitor's text is shown as text: the tag is visible, nothing ran.
    expect(screen.getByText("<script>alert(1)</script> smoky")).toBeInTheDocument();
    expect(document.querySelector("main script")).toBeNull();
  });
});

describe("several chats (DECISIONS B36)", () => {
  it("lists chats newest first with a title and date, and opens one with the shared count", async () => {
    mockApi([
      [`/api/chat/${CHAT_A}`, () => chatWith(CHAT_A, "smoky leather and vanilla", [
        { role: "user", content: "smoky leather and vanilla" },
        { role: "assistant", content: "Smoky Dry Woods with a sweet edge." },
      ])],
      ["/api/chat", () => twoChats],
    ]);
    renderAt("/chat");
    const list = await screen.findByRole("navigation", { name: "Your chats" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getAllByRole("button")[0]!.textContent)).toEqual([
      "fresh citrus for summerToday",
      "smoky leather and vanilla" + chatDate("2026-09-14T15:00:00Z"),
    ]);
    // A new chat is open: the introduction shows, and the count is the day's.
    expect(screen.getByRole("heading", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByText(/Describe scents you love/)).toBeInTheDocument();
    expect(screen.getByText(/5 of 8 messages used today/)).toBeInTheDocument();

    await userEvent.click(within(list).getByRole("button", { name: /^smoky leather/ }));
    expect(await screen.findByText("Smoky Dry Woods with a sweet edge.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "smoky leather and vanilla" })).toBeInTheDocument();
    expect(screen.getByText(/5 of 8 messages used today/)).toBeInTheDocument();
  });

  it("continues an open chat with its id, and New chat starts one without", async () => {
    const reply = (conversation: object, used: number) => ({
      conversation, reply: "Noted: Citrus.", profile: emptyProfile(), recommendations: [], degraded: false,
      messagesUsed: used, messagesLimit: 8,
    });
    const fetchMock = mockApi([
      [`/api/chat/${CHAT_B}`, () => chatWith(CHAT_B, "fresh citrus for summer", [{ role: "user", content: "fresh citrus" }])],
      ["/api/chat", (_url, init) => {
        if (init?.method !== "POST") return twoChats;
        const sent = JSON.parse(init.body as string);
        return sent.conversationId ? reply(twoChats.conversations[0]!, 6) : reply(newChat, 7);
      }],
    ]);
    renderAt(`/chat?c=${CHAT_B}`);
    await userEvent.type(await screen.findByLabelText("Your message"), "and some grapefruit{Enter}");
    expect(await screen.findByText(/6 of 8 messages used today/)).toBeInTheDocument();
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string));
    expect(posts()[0]).toMatchObject({ message: "and some grapefruit", conversationId: CHAT_B });

    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: "New chat" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your message"), "fresh lemony woods{Enter}");
    expect(await screen.findByText(/7 of 8 messages used today/)).toBeInTheDocument();
    expect(posts()[1]).not.toHaveProperty("conversationId");
    expect(await screen.findByRole("heading", { name: "fresh lemony woods" })).toBeInTheDocument();
  });

  it("deletes a chat after one confirm, and leaves the count alone", async () => {
    const fetchMock = mockApi([
      [`/api/chat/${CHAT_A}`, (_url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : chatWith(CHAT_A, "smoky leather and vanilla", []))],
      ["/api/chat", () => twoChats],
    ]);
    renderAt(`/chat?c=${CHAT_A}`);
    const list = await screen.findByRole("navigation", { name: "Your chats" });
    await userEvent.click(within(list).getByRole("button", { name: "Delete chat: smoky leather and vanilla" }));
    expect(within(list).getByText("Delete this chat?")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(within(list).queryByText("smoky leather and vanilla")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith(`/api/chat/${CHAT_A}`) && init?.method === "DELETE")).toBe(true);
    // The open chat was the one deleted, so a new chat takes its place (the URL changes a
    // moment after the list does).
    expect(await screen.findByRole("heading", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByText(/5 of 8 messages used today/)).toBeInTheDocument();
  });

  it("says so when an opened chat is gone (deleted elsewhere, or expired)", async () => {
    mockApi([
      [`/api/chat/${CHAT_A}`, () => errorResponse(404, "no_chat", "gone")],
      ["/api/chat", () => twoChats],
    ]);
    renderAt(`/chat?c=${CHAT_A}`);
    expect(await screen.findByText(/That chat is gone/)).toBeInTheDocument();
  });

  it("shows a chat title as text, whatever the visitor typed", async () => {
    mockApi([["/api/chat", () => ({ ...emptyChat, conversations: [summary(CHAT_A, "<img src=x onerror=alert(1)>", "2026-10-21T15:00:00Z")] })]]);
    renderAt("/chat");
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("main img[src='x']")).toBeNull();
  });

  it("folds the taste profile behind a button on phones", async () => {
    mockApi([["/api/chat", () => emptyChat]]);
    renderAt("/chat");
    const toggle = await screen.findByRole("button", { name: /Your taste profile/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("dates chats as Today, Yesterday, or a short date", () => {
    const now = new Date(2026, 9, 21, 12);
    expect(chatDate(new Date(2026, 9, 21, 1).toISOString(), now)).toBe("Today");
    expect(chatDate(new Date(2026, 9, 20, 23).toISOString(), now)).toBe("Yesterday");
    expect(chatDate(new Date(2026, 8, 14).toISOString(), now)).toBe("Sep 14");
    expect(chatDate(new Date(2025, 8, 14).toISOString(), now)).toBe("Sep 14, 2025");
  });
});

describe("the taste profile card", () => {
  it("shows the top likes and dislikes in plain words and the summary", async () => {
    setTasteProfile(profile({ "Woody Amber": 0.8, Amber: 0.4, Green: -0.7, Water: 0.1 }, { spicy: 0.5, smoky: -0.3 }, "You like warm spice."));
    mockApi([]);
    renderAt("/me");
    const card = await screen.findByRole("region", { name: "What you like" });
    expect(await within(card).findByText("You like warm spice.")).toBeInTheDocument();
    const likes = within(card).getByText("Drawn to").nextElementSibling as HTMLElement;
    expect(within(likes).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Woody AmberLoves", "SpicyLikes", "AmberLikes",
    ]);
    const dislikes = within(card).getByText("Steers clear of").nextElementSibling as HTMLElement;
    expect(within(dislikes).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["GreenAvoids", "SmokyNot keen on"]);
  });

  it("edits with sliders from -1 to 1 and saves a guest's profile in the browser", async () => {
    mockApi([]);
    renderAt("/me");
    await userEvent.click(await screen.findByRole("button", { name: "Set it by hand" }));
    const citrus = screen.getByLabelText("Citrus");
    expect(citrus).toHaveAttribute("min", "-1");
    expect(citrus).toHaveAttribute("max", "1");
    expect(screen.getAllByRole("slider")).toHaveLength(20);
    fireEvent.change(citrus, { target: { value: "0.7" } });
    fireEvent.change(screen.getByLabelText("Smoky"), { target: { value: "-0.5" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(getState().tasteProfile).toMatchObject({
      families: expect.objectContaining({ Citrus: 0.7 }),
      facets: expect.objectContaining({ smoky: -0.5 }),
      summary: "You lean toward Citrus scents and avoid smoky ones.",
    });
    expect(await screen.findByText("You lean toward Citrus scents and avoid smoky ones.")).toBeInTheDocument();
  });

  it("saves a signed-in user's edits to the account", async () => {
    const fetchMock = mockApi([
      ["/api/auth/me", () => ({ user: ana })],
      ["/api/collection", () => ({ items: [] })],
      ["/api/profile/taste", (_url, init) => init?.method === "PUT"
        ? { profile: profile({ Water: 0.6 }, {}, "You lean toward Water scents.") }
        : { profile: null }],
    ]);
    renderAt("/me");
    await userEvent.click(await screen.findByRole("button", { name: "Set it by hand" }));
    fireEvent.change(screen.getByLabelText("Water"), { target: { value: "0.6" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You lean toward Water scents.")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "/api/profile/taste").families.Water).toBe(0.6);
    expect(getState().tasteProfile).toBeNull(); // nothing written to the browser
  });
});

describe("importing a guest's taste profile", () => {
  it("offers a profile on its own, sends it with the import, and clears it from the browser", async () => {
    setTasteProfile(profile({ Amber: 0.6 }, {}, "You lean toward Amber scents."));
    const fetchMock = mockApi([
      ["/api/auth/login", () => ({ user: ana })],
      ["/api/collection/import", () => ({ imported: 0, skipped: 0, tasteProfile: "imported" })],
      ["/api/collection", () => ({ items: [] })],
      ["/api/profile/taste", () => ({ profile: profile({ Amber: 0.6 }, {}, "You lean toward Amber scents.") })],
    ]);
    renderAt("/login?next=/me");
    await userEvent.type(screen.getByLabelText("Email"), ana.email);
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Bring your taste profile along?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add taste profile" }));
    await waitFor(() => expect(getState().tasteProfile).toBeNull());
    expect(bodyOf(fetchMock, "/api/collection/import")).toMatchObject({ items: [], tasteProfile: { families: { Amber: 0.6 } } });
    expect(await screen.findByText("You lean toward Amber scents.")).toBeInTheDocument();
  });
});

describe("the stored taste profile", () => {
  it("keeps known keys only and clamps weights, so the API never sees a bad one", () => {
    const cleaned = normalizeProfile({ families: { Amber: 3, Bogus: 1 }, facets: { sweet: -2, spicy: "x" }, summary: 7 });
    expect(cleaned!.families.Amber).toBe(1);
    expect(cleaned!.families).not.toHaveProperty("Bogus");
    expect(cleaned!.facets).toMatchObject({ sweet: -1, spicy: 0 });
    expect(cleaned!.summary).toBeNull();
    expect(normalizeProfile("nope")).toBeNull();
  });

  it("describes a profile the same way the API does", () => {
    expect(describeProfile(profile({ "Woody Amber": 0.8, Amber: 0.5, Green: -0.6 }, { spicy: 0.7, smoky: -0.9 })))
      .toBe("You lean toward Woody Amber, spicy and Amber scents and avoid smoky and Green ones.");
  });
});
