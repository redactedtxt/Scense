import { familyColor, genderLabel, joinWords, seasonLabel } from "../lib/labels";
import { ringDistance } from "../pages/AboutPage";

describe("display labels", () => {
  it("shows Men, Women, Unisex, and Fall for the stored values", () => {
    expect(genderLabel("male")).toBe("Men");
    expect(genderLabel("female")).toBe("Women");
    expect(genderLabel("unisex")).toBe("Unisex");
    expect(seasonLabel("autumn")).toBe("Fall");
  });

  it("turns a family name into its theme colour variable, accents dropped", () => {
    expect(familyColor("Aromatic Fougère")).toBe("var(--color-family-aromatic-fougere)");
    expect(familyColor("Soft Amber")).toBe("var(--color-family-soft-amber)");
  });

  it("joins note names the way the results summary reads", () => {
    expect(joinWords(["Bergamot"])).toBe("Bergamot");
    expect(joinWords(["Bergamot", "Vanilla"])).toBe("Bergamot and Vanilla");
  });

  it("measures ring distance the short way round, as SPEC 3.6 does", () => {
    expect(ringDistance(13, 0)).toBe(1);
    expect(ringDistance(0, 7)).toBe(7);
    expect(ringDistance(3, 10)).toBe(7);
  });
});
