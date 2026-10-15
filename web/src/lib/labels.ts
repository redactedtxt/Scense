import type { Gender } from "./api";

// The database keeps the dataset's values; only the UI translates them (DECISIONS B6).
const GENDER_LABELS: Record<Gender, string> = { male: "Men", female: "Women", unisex: "Unisex" };
const SEASON_LABELS: Record<string, string> = {
  winter: "Winter",
  spring: "Spring",
  summer: "Summer",
  autumn: "Fall",
};

export const SEASON_ORDER = ["winter", "spring", "summer", "autumn"] as const;

export function genderLabel(gender: Gender | null): string | null {
  return gender ? GENDER_LABELS[gender] : null;
}

export function seasonLabel(season: string): string {
  return SEASON_LABELS[season] ?? season;
}

// "Soft Amber" -> "var(--color-family-soft-amber)"; "Aromatic Fougère" drops its accent.
export function familyColor(family: string): string {
  const key = family
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `var(--color-family-${key})`;
}

// "Bergamot and Vanilla", "Bergamot, Rose, and Vanilla".
export function joinWords(words: string[]): string {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(words);
}

export function padRank(rank: number): string {
  return String(rank).padStart(2, "0");
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
