import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

// Runtime note scoring. This mirrors pipeline/src/scoring.py for notes: the same
// ring distance, the same affinity tables (read from the same scoring.yaml), the
// same Enhance and Soften rules. Fragrance pairs are NOT scored here: they are
// precomputed into pair_scores.

export const GOALS = ["enhance", "soften"] as const;
export type Goal = (typeof GOALS)[number];

const FAMILY_COUNT = 14;
const RING_DISTANCES = 8; // d runs 0..7 on a 14-family ring

export type Matrices = Record<Goal, number[][]>;

// Only the part of scoring.yaml the API needs. Failing here at startup beats a
// wrong score at request time.
const scoringSchema = z.object({
  affinity: z.object({
    enhance: z.array(z.number()).length(RING_DISTANCES),
    soften: z.array(z.number()).length(RING_DISTANCES),
  }),
});

export function loadMatrices(path: string): Matrices {
  const { affinity } = scoringSchema.parse(parse(readFileSync(path, "utf8")));
  return { enhance: buildMatrix(affinity.enhance), soften: buildMatrix(affinity.soften) };
}

export function ringDistance(i: number, j: number, size = FAMILY_COUNT): number {
  const gap = Math.abs(i - j);
  return Math.min(gap, size - gap);
}

// M[i][j] = affinity at the ring distance between families i and j.
export function buildMatrix(affinity: number[], size = FAMILY_COUNT): number[][] {
  return Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => affinity[ringDistance(i, j, size)]!),
  );
}

// pA . M . pB
function bilinear(a: number[], matrix: number[][], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) total += a[i]! * matrix[i]![j]! * b[j]!;
  }
  return total;
}

// Index of the largest share; a tie goes to the lower ring position (same rule as the pipeline).
export function dominantFamilyIndex(profile: number[]): number {
  let best = 0;
  profile.forEach((share, i) => {
    if (share > profile[best]!) best = i;
  });
  return best;
}

export interface NoteProfile {
  name: string;
  profile: number[];
  harshness: number;
}

export interface ScoredNote {
  name: string;
  rank: number;
  score: number; // 0-100, best partner = 100
  dominantFamilyIndex: number;
}

// Several input notes act as one blend: average their profiles and harshness.
export function blend(notes: NoteProfile[]): { profile: number[]; harshness: number } {
  const profile = Array.from({ length: FAMILY_COUNT }, (_, i) => mean(notes.map((n) => n.profile[i]!)));
  return { profile, harshness: mean(notes.map((n) => n.harshness)) };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Enhance: cosine-style similarity, so a note scores 1 with itself and less with anything else.
// Soften: raw affinity, dropped unless gentler, boosted by the harshness gap.
// Notes have no strength, so Soften's "buried partner" penalty does not apply to them.
function scoreOne(
  base: { profile: number[]; harshness: number },
  partner: NoteProfile,
  goal: Goal,
  matrix: number[][],
): number | null {
  const raw = bilinear(base.profile, matrix, partner.profile);
  if (goal === "enhance") {
    const own = bilinear(base.profile, matrix, base.profile) * bilinear(partner.profile, matrix, partner.profile);
    return raw / Math.sqrt(own);
  }
  if (partner.harshness >= base.harshness) return null;
  return raw * (1 + base.harshness - partner.harshness);
}

export function rankNotes(
  inputs: NoteProfile[],
  candidates: NoteProfile[],
  goal: Goal,
  matrices: Matrices,
): ScoredNote[] {
  const base = blend(inputs);
  const inputNames = new Set(inputs.map((n) => n.name));
  const scored = candidates
    .filter((c) => !inputNames.has(c.name))
    .flatMap((c) => {
      const score = scoreOne(base, c, goal, matrices[goal]);
      return score === null ? [] : [{ note: c, score }];
    })
    // Ties break by name so the same request always returns the same order.
    .sort((a, b) => b.score - a.score || a.note.name.localeCompare(b.note.name));

  const best = scored[0]?.score ?? 0;
  return scored.map(({ note, score }, index) => ({
    name: note.name,
    rank: index + 1,
    score: best > 0 ? (score / best) * 100 : 0,
    dominantFamilyIndex: dominantFamilyIndex(note.profile),
  }));
}
