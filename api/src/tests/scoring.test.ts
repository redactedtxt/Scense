import { describe, expect, it } from "vitest";
import { buildMatrix, dominantFamilyIndex, rankNotes, ringDistance, type NoteProfile } from "../services/scoring.js";
import { matrices, profileAt } from "./helpers.js";

const note = (name: string, profile: number[], harshness: number): NoteProfile => ({ name, profile, harshness });

describe("ring distance", () => {
  it("wraps round the ring (same cases as the pipeline tests)", () => {
    expect(ringDistance(13, 0)).toBe(1);
    expect(ringDistance(0, 7)).toBe(7);
    expect(ringDistance(3, 10)).toBe(7);
  });
});

describe("affinity matrices from scoring.yaml", () => {
  it("are symmetric 14 x 14 and read the table by ring distance", () => {
    const m = matrices.enhance;
    expect(m).toHaveLength(14);
    expect(m[0]![1]).toBe(m[1]![0]);
    expect(m[0]![0]).toBe(1.0);
    expect(m[13]![0]).toBe(m[0]![1]); // 13 and 0 are neighbours
  });

  it("buildMatrix places each affinity by distance", () => {
    const table = [9, 8, 7, 6, 5, 4, 3, 2];
    expect(buildMatrix(table)[0]![7]).toBe(2);
  });
});

describe("dominantFamilyIndex", () => {
  it("picks the largest share and breaks ties toward the lower position", () => {
    expect(dominantFamilyIndex(profileAt(5))).toBe(5);
    const tied = Array.from({ length: 14 }, (_, i) => (i === 3 || i === 9 ? 0.5 : 0));
    expect(dominantFamilyIndex(tied)).toBe(3);
  });
});

describe("rankNotes", () => {
  const woods = note("Cedar", profileAt(3), 0.5);
  const nearWoods = note("Sandalwood", profileAt(4), 0.3);
  const farFloral = note("Rose", profileAt(11), 0.2);
  const harsher = note("Pepper", profileAt(10), 0.9);
  const all = [woods, nearWoods, farFloral, harsher];

  it("Enhance puts the closest family first and scores it 100", () => {
    const results = rankNotes([woods], all, "enhance", matrices);
    expect(results.map((r) => r.name)[0]).toBe("Sandalwood");
    expect(results[0]).toMatchObject({ rank: 1, score: 100 });
  });

  it("never returns an input note", () => {
    const results = rankNotes([woods, nearWoods], all, "enhance", matrices);
    expect(results.map((r) => r.name)).not.toContain("Cedar");
    expect(results.map((r) => r.name)).not.toContain("Sandalwood");
  });

  it("Soften drops partners as harsh or harsher than the blend, and prefers distant families", () => {
    const results = rankNotes([woods], all, "soften", matrices);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("Pepper"); // harshness 0.9 >= 0.5
    expect(names[0]).toBe("Rose"); // ring distance 8 -> 6 from Cedar; far beats near
  });

  it("averages several input notes into one blend", () => {
    // Cedar (3) and Rose (11) average to harshness 0.35, so Sandalwood (0.3) survives and Cedar's twin does not.
    const results = rankNotes([woods, farFloral], all, "soften", matrices);
    expect(results.map((r) => r.name)).toEqual(["Sandalwood"]);
  });

  it("returns an empty list when nothing is gentler", () => {
    expect(rankNotes([note("Gentle", profileAt(0), 0.01)], all, "soften", matrices)).toEqual([]);
  });

  it("ranks are 1..n in score order and scores never exceed 100", () => {
    const results = rankNotes([woods], all, "enhance", matrices);
    expect(results.map((r) => r.rank)).toEqual(results.map((_, i) => i + 1));
    for (const r of results) expect(r.score).toBeLessThanOrEqual(100);
    for (let i = 1; i < results.length; i++) expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
  });
});
