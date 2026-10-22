import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setStatus, setTasteProfile } from "../lib/guestStore";
import { emptyProfile, normalizeProfile } from "../lib/tasteProfile";
import { mockApi, renderAt } from "./render";

// The concierge page (M10; DECISIONS B37). The API is mocked, so no request ever reaches
// the server, let alone Anthropic.

const emptyState = { available: true, messagesUsed: 0, messagesLimit: 8, conversations: [] };
const OUTING = "dddddddd-0000-4000-8000-000000000004";
const summary = (title: string) => ({ id: OUTING, title, createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString() });
const DISCLAIMER =
  "Up to 8 typed messages a day, shared across all your outings; tapping an answer is free. Picks come from your Own list, or from our catalogue when it's empty.";

const slots = (values: (string | null)[]) =>
  ["occasion", "time_of_day", "season", "setting", "projection"].map((slot, i) => ({ slot, value: values[i] ?? null }));

const pick = (id: number, name: string, reason: string) => ({
  id, slug: `slug-${id}`, name, brand: "Maker", imageUrl: null, dominantFamily: "Amber", owned: false, reason,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function postBodies(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).includes("/api/concierge") && init?.method === "POST")
    .map(([, init]) => JSON.parse(init!.body as string));
}

describe("the concierge page", () => {
  it("is in the nav, explains itself, and shows an empty outing and the disclaimer", async () => {
    mockApi([["/api/concierge", () => emptyState]]);
    renderAt("/concierge");
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Concierge" })).toHaveAttribute("href", "/concierge");
    expect(await screen.findByLabelText("Your message")).toBeInTheDocument();
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(/0 of 8 messages used today/)).toBeInTheDocument();
    expect(screen.getByText(/or from the whole catalogue while that list is empty/)).toBeInTheDocument();
    const card = within(screen.getByRole("region", { name: "Your outing" }));
    expect(card.getAllByLabelText("Not known yet")).toHaveLength(5);
    expect(card.getByText(/is empty, so picks come from the whole catalogue/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New outing" })).toBeInTheDocument();
  });

  it("asks one question with chips, sends a tapped chip as the answer, then shows the picks with their sentences", async () => {
    setStatus({ id: 5, slug: "x", name: "Aventus", brand: "Creed", imageUrl: null, dominantFamily: "Fruity" }, "own");
    setTasteProfile({ ...emptyProfile(), ...normalizeProfile({ families: { Amber: 0.5 }, facets: {}, summary: null })! });
    const first = {
      conversation: summary("Date night, dinner at 8"), reply: "Will you be mostly indoors or outdoors?",
      options: ["Indoor", "Outdoor"], picks: [], outing: slots(["Date night", "Night", "Fall"]),
      degraded: false, messagesUsed: 1, messagesLimit: 8,
    };
    const second = {
      ...first, reply: "How much projection do you want: low, medium, or high?", options: ["Low", "Medium", "High"],
      outing: slots(["Date night", "Night", "Fall", "Outdoor"]), messagesUsed: 2,
    };
    const third = {
      ...first, reply: "Your outing: Date night, night, fall, outdoor, high projection. Here is your top pick and one alternative.",
      options: [], outing: slots(["Date night", "Night", "Fall", "Outdoor", "High"]), messagesUsed: 3,
      picks: [pick(5, "Aventus", "Fruity and bright for a fall night outdoors."), pick(6, "Second", "<script>alert(1)</script>")],
    };
    const answers = [first, second, third];
    const fetchMock = mockApi([
      ["/api/concierge", (_url, init) => (init?.method === "POST" ? answers.shift() : emptyState)],
    ]);
    renderAt("/concierge");
    await userEvent.type(await screen.findByLabelText("Your message"), "Date night, dinner at 8{Enter}");

    expect(await screen.findByText("Will you be mostly indoors or outdoors?")).toBeInTheDocument();
    const card = within(screen.getByRole("region", { name: "Your outing" }));
    expect(card.getByText("Date night")).toBeInTheDocument();
    expect(card.getAllByLabelText("Not known yet")).toHaveLength(2);
    await userEvent.click(within(screen.getByRole("group", { name: "Quick answers" })).getByRole("button", { name: "Outdoor" }));
    await userEvent.click(await screen.findByRole("button", { name: "High" }));

    expect(await screen.findByText("Top pick")).toBeInTheDocument();
    expect(screen.getByText("Alternative")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aventus" })).toHaveAttribute("href", "/f/slug-5");
    expect(screen.getByText("Fruity and bright for a fall night outdoors.")).toBeInTheDocument();
    // A sentence is text, never markup.
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("li script")).toBeNull();
    // Only the latest question has chips; once picked, none are left.
    expect(screen.queryByRole("group", { name: "Quick answers" })).not.toBeInTheDocument();
    expect(screen.getByText(/3 of 8 messages used today/)).toBeInTheDocument();

    const [a, b, c] = postBodies(fetchMock);
    expect(a).toMatchObject({ message: "Date night, dinner at 8", owned: [5] });
    expect(a).not.toHaveProperty("conversationId");
    expect(a.tasteProfile.families.Amber).toBe(0.5);
    expect(b).toMatchObject({ message: "Outdoor", conversationId: OUTING });
    expect(c).toMatchObject({ message: "High", conversationId: OUTING });
  });

  it("reopens a saved outing with its slots, and offers chips only under its last question", async () => {
    const saved = {
      conversation: summary("Office tomorrow"),
      outing: slots(["Office", "Day"]),
      messages: [
        { role: "user", content: "Office tomorrow", options: [], picks: [] },
        { role: "assistant", content: "Will you be out during the day or at night?", options: ["Day", "Night"], picks: [] },
        { role: "user", content: "Day", options: [], picks: [] },
        { role: "assistant", content: "What season is it for?", options: ["Fall", "Winter", "Spring", "Summer"], picks: [] },
      ],
    };
    mockApi([
      [`/api/concierge/${OUTING}`, () => saved],
      ["/api/concierge", () => ({ ...emptyState, messagesUsed: 2, conversations: [saved.conversation] })],
    ]);
    renderAt(`/concierge?o=${OUTING}`);
    expect(await screen.findByText("What season is it for?")).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "Quick answers" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["Fall", "Winter", "Spring", "Summer"]);
    expect(screen.queryByRole("button", { name: "Night" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Your outing" })).getByText("Office")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Your outings" })).getByRole("button", { name: /^Office tomorrow/ }))
      .toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "Office tomorrow" })).toBeInTheDocument();
    // On phones these buttons show only icons; their accessible names keep the words.
    expect(screen.getByRole("button", { name: "Outings (1)" })).toHaveAttribute("aria-controls", "outing-list");
    expect(screen.getByRole("button", { name: "New outing" })).toBeEnabled();
  });

  it("closes the input at the daily limit, but chip answers still send, for free (B38)", async () => {
    const saved = {
      conversation: summary("Wedding"), outing: slots(["Wedding"]),
      messages: [{ role: "assistant", content: "Day or night?", options: ["Day", "Night"], picks: [] }],
    };
    const answer = {
      conversation: summary("Wedding"), reply: "What season is it for?", options: ["Fall", "Winter", "Spring", "Summer"],
      picks: [], outing: slots(["Wedding", "Night"]), degraded: false, messagesUsed: 8, messagesLimit: 8,
    };
    const fetchMock = mockApi([
      [`/api/concierge/${OUTING}`, () => saved],
      ["/api/concierge", (_url, init) => (init?.method === "POST" ? answer : { ...emptyState, messagesUsed: 8, conversations: [saved.conversation] })],
    ]);
    renderAt(`/concierge?o=${OUTING}`);
    expect(await screen.findByText(/You've used today's typed messages. You can still tap an answer/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
    const night = await screen.findByRole("button", { name: "Night" });
    expect(night).toBeEnabled();
    await userEvent.click(night);
    expect(await screen.findByText("What season is it for?")).toBeInTheDocument();
    expect(postBodies(fetchMock)).toEqual([expect.objectContaining({ message: "Night", conversationId: OUTING })]);
  });

  it("says the concierge is unavailable before anyone types", async () => {
    mockApi([["/api/concierge", () => ({ ...emptyState, available: false })]]);
    renderAt("/concierge");
    expect(await screen.findByText(/concierge is unavailable right now/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
  });

  it("deletes an outing from the list", async () => {
    const fetchMock = mockApi([
      [`/api/concierge/${OUTING}`, (_url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : { conversation: summary("Gym"), outing: slots([]), messages: [] })],
      ["/api/concierge", () => ({ ...emptyState, conversations: [summary("Gym")] })],
    ]);
    renderAt(`/concierge?o=${OUTING}`);
    const list = within(await screen.findByRole("navigation", { name: "Your outings" }));
    await userEvent.click(list.getByRole("button", { name: "Delete outing: Gym" }));
    expect(list.getByText("Delete this outing?")).toBeInTheDocument();
    await userEvent.click(list.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(list.queryByRole("button", { name: /^Gym/ })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith(`/api/concierge/${OUTING}`) && init?.method === "DELETE")).toBe(true);
    // The open outing was the one deleted, so the panel moves to a new outing.
    expect(await screen.findByRole("heading", { name: "New outing" })).toBeInTheDocument();
  });
});
