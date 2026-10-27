import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "./render";

const NAMES = [
  "Soft Amber", "Amber", "Woody Amber", "Woods", "Mossy Woods", "Dry Woods", "Aromatic Fougère",
  "Citrus", "Water", "Green", "Fruity", "Floral", "Soft Floral", "Floral Amber",
];
const families = NAMES.map((name, id) => ({ id, name, harshness: 0.3 }));

function renderAbout() {
  mockApi([
    ["/api/families", () => ({ items: families })],
    ["/api/pairing/fragrances/", () => ({ status: "ranked", rank: 2, total: 999, score: 97 })],
  ]);
  renderAt("/about");
}

// The ring's node for a family (the phone list has a button of the same family too).
const ringNode = (name: string) => within(screen.getByRole("group", { name: /Fragrance wheel/ })).getByRole("button", { name: new RegExp(`^${name},`) });
const example = () => screen.getByText("Worked example").parentElement!;

describe("About page, ring distance (DECISIONS B41)", () => {
  it("typesets the formula and works an example that needs the short way round", async () => {
    renderAbout();
    await screen.findByRole("group", { name: /Fragrance wheel/ });
    expect(document.querySelector('math[display="block"]')?.textContent).toBe("d(i,j)=min(|i−j|,14−|i−j|)");
    expect(example()).toHaveTextContent("Soft Amber (0) to Fruity (10): |0 − 10| = 10 steps one way, 14 − 10 = 4 the other, so 4 steps the short way round.");
  });

  it("measures from a clicked family and pairs the example with the one pointed at", async () => {
    renderAbout();
    await userEvent.click(await screen.findByRole("button", { name: /^Citrus, position 7, 7 steps from Soft Amber/ }));
    expect(ringNode("Citrus")).toHaveAttribute("aria-pressed", "true");
    expect(ringNode("Soft Amber")).toHaveAccessibleName("Soft Amber, position 0, 7 steps from Citrus");
    await userEvent.hover(ringNode("Water"));
    expect(example()).toHaveTextContent("Citrus (7) to Water (8): |7 − 8| = 1 step one way, 14 − 1 = 13 the other, so 1 step the short way round.");
  });

  it("selects a family from the keyboard", async () => {
    renderAbout();
    await screen.findByRole("group", { name: /Fragrance wheel/ });
    ringNode("Green").focus();
    await userEvent.keyboard("{Enter}");
    expect(ringNode("Green")).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the legend's wording with the goal", async () => {
    renderAbout();
    const legend = await screen.findByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("closer on the ring, so they enhance more");
    await userEvent.click(screen.getByRole("button", { name: "Soften" }));
    expect(legend).toHaveTextContent("farther round the ring, so they soften more");
  });

  it("ranks the phone list by the goal: closest first for Enhance, farthest first for Soften", async () => {
    renderAbout();
    await screen.findByRole("group", { name: /Fragrance wheel/ });
    const names = () =>
      within(screen.getByRole("list", { name: /^Distances from/ }))
        .getAllByRole("button")
        .map((b) => b.textContent!.split(" (")[0]);
    expect(names().slice(0, 2)).toEqual(["Amber", "Floral Amber"]);
    await userEvent.click(screen.getByRole("button", { name: "Soften" }));
    expect(names()[0]).toBe("Citrus");
  });
});
