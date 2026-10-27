import { screen, within } from "@testing-library/react";
import { mockApi, renderAt } from "./render";

describe("home page (DECISIONS B41)", () => {
  it("welcomes the visitor and offers a card per feature, Layer first", async () => {
    mockApi([]);
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome to Scense." })).toBeInTheDocument();
    const cards = within(screen.getByRole("region", { name: "What you can do" })).getAllByRole("heading", { level: 2 });
    expect(cards.map((card) => card.textContent)).toEqual(["Layer", "Chat", "Concierge", "Browse", "Collection"]);
    expect(screen.getByRole("link", { name: "Start layering" })).toHaveAttribute("href", "/pair");
    expect(screen.getByRole("link", { name: "Start a chat" })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: "Plan an outing" })).toHaveAttribute("href", "/concierge");
    expect(screen.getByRole("link", { name: "Browse bottles" })).toHaveAttribute("href", "/browse");
    expect(screen.getByRole("link", { name: "Open collection" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "How the scoring works" })).toHaveAttribute("href", "/about");
  });

  it("links the nav's Layer item to /pair and the logo home", async () => {
    mockApi([]);
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Layer" })).toHaveAttribute("href", "/pair");
    expect(screen.getAllByRole("link", { name: "Scense" })[0]).toHaveAttribute("href", "/");
  });
});

describe("links shared before the pairing page moved to /pair", () => {
  it("sends an old notes link to /pair with its notes and goal", async () => {
    mockApi([["/api/pairing/notes", () => ({ goal: "enhance", inputs: ["Rose"], total: 0, results: [] })]]);
    renderAt("/?mode=notes&notes=Rose&goal=enhance");
    expect(await screen.findByRole("button", { name: "Remove Rose" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to Scense." })).not.toBeInTheDocument();
  });

  it("keeps the home page for a link that only carries a tracking tag", async () => {
    mockApi([]);
    renderAt("/?utm_source=linkedin");
    expect(await screen.findByRole("heading", { name: "Welcome to Scense." })).toBeInTheDocument();
  });
});
