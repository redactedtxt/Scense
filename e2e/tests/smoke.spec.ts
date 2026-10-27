import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// Four smoke tests (M11; SPEC section 13): one per thing a visitor comes for. Each walks
// the real pages, the real API, and a real Postgres holding the test catalogue. The model
// is e2e/mock-anthropic.mjs, so the chat and the concierge cost nothing.
//
// They prove the pieces are wired together, not that every rule holds: the API and web
// unit tests cover the rules.

const MOCK_CALLS = "http://localhost:4010/_calls";
type Calls = { chat: number; slots: number; reasons: number };
const mockCalls = async (page: Page): Promise<Calls> => (await page.request.get(MOCK_CALLS)).json();

// Picks a fragrance from the pairing page's base picker by typing and choosing the option.
async function pickBase(page: Page, typed: string, option: RegExp) {
  const search = page.getByRole("combobox", { name: "Search fragrances" });
  await search.fill(typed);
  await page.getByRole("option", { name: option }).first().click();
}

test("pairs a fragrance: pick a base, get a ranked list, switch the goal", async ({ page }) => {
  // Start on the home page and follow its Layer card, as a first-time visitor would.
  await page.goto("/");
  await page.getByRole("link", { name: "Start layering" }).click();
  await expect(page).toHaveURL(/\/pair$/);
  await pickBase(page, "aventus", /Aventus/);

  await expect(page).toHaveURL(/[?&]f=creed-aventus/);
  const first = page.getByText("Rank 1", { exact: true });
  await expect(first).toBeVisible();

  // Enhance lists every other bottle, so a full first page of 24 always exists.
  await page.getByRole("group", { name: "Goal" }).getByRole("button", { name: "Enhance" }).click();
  await expect(page).toHaveURL(/goal=enhance/);
  await expect(page.getByText("Rank 24", { exact: true })).toBeVisible();
});

test("signs up and saves a bottle to the account", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill("Smoke Test");
  await page.getByLabel("Password").fill("a long enough password");
  await page.getByRole("button", { name: /create account|sign up/i }).click();

  // Signed in: the header shows the name instead of "Sign in". The page holds two copies
  // (the desktop header and the phone menu); one is visible at any width.
  await expect(page.getByText("Smoke Test").filter({ visible: true })).toBeVisible();

  await page.goto("/f/creed-aventus-2010");
  await page.getByRole("button", { name: "Own", exact: true }).click();
  await expect(page.getByRole("button", { name: "Own", exact: true })).toHaveAttribute("aria-pressed", "true");

  // A reload reads the list from the account, not the browser.
  await page.goto("/me");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Aventus" })).toBeVisible();
});

test("runs one chat: a reply, picks from the catalogue, and the day's count", async ({ page }) => {
  const before = await mockCalls(page);
  await page.goto("/chat");
  await page.getByRole("textbox").fill("I love warm spicy scents with a bit of sweetness");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("warm Woody Amber with a spicy edge")).toBeVisible();
  await expect(page.getByText(/1 of 8 messages used today/)).toBeVisible();
  // The server picked bottles from the catalogue and drew them as cards.
  const picks = page.getByRole("heading", { level: 3 });
  await expect(picks.first()).toBeVisible();

  expect((await mockCalls(page)).chat).toBe(before.chat + 1);
});

test("runs one outing: the concierge asks, a chip answers, and picks appear", async ({ page }) => {
  const before = await mockCalls(page);
  await page.goto("/concierge");
  // Four of the five slots; projection is left for the concierge to ask about.
  await page.getByRole("textbox").fill("A date night dinner at 8 on a restaurant terrace in winter");
  await page.getByRole("button", { name: "Send" }).click();

  const chips = page.getByRole("group", { name: "Quick answers" });
  await expect(chips.getByRole("button", { name: "Medium" })).toBeVisible();
  await chips.getByRole("button", { name: "Medium" }).click();

  // The guest has no Own list, so the picks come from the whole catalogue.
  await expect(page.getByText("Your Own list is empty, so these come from the whole catalogue.")).toBeVisible();
  await expect(page.getByText("Easy to wear for this outing.").first()).toBeVisible();

  // One slot reading for the typed message (the chip skips the model), one sentence call.
  const after = await mockCalls(page);
  expect(after.slots).toBe(before.slots + 1);
  expect(after.reasons).toBe(before.reasons + 1);
});
