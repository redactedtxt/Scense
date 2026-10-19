// Typed wrappers around the pass 1 API (SPEC section 7). Field names match the JSON the
// API sends (camelCase); stored values stay as the dataset has them ("male", "autumn").

import { getState } from "./guestStore";

export type Goal = "enhance" | "soften";
export type Gender = "male" | "female" | "unisex";

export type FragranceSummary = {
  id: number;
  slug: string;
  name: string;
  brand: string;
  gender: Gender | null;
  releaseYear: number | null;
  imageUrl: string | null;
  communityRating: number | null;
  ratingVotes: number | null;
  strength: number;
  dominantFamily: string;
};

export type FragranceList = {
  items: FragranceSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  // True when the search text matched nothing exactly and these are close matches.
  fuzzy: boolean;
};

// The Browse sort control's URL values. "popular" is the default and stays out of the URL.
export type Sort = "popular" | "least-popular" | "highest-rated";

export type NoteRef = { name: string; mapped: boolean };
export type Layer = "top" | "heart" | "base" | "flat";

export type FragranceDetail = FragranceSummary & {
  harshness: number;
  familyProfile: { id: number; name: string; share: number }[];
  facets: Record<string, number>;
  seasons: Record<"winter" | "spring" | "summer" | "autumn", number>;
  daynight: Record<"day" | "night", number>;
  notes: Record<Layer, NoteRef[]>;
  accords: { accord: string; strength: number }[];
};

export type NoteSuggestion = { name: string; dominantFamily: string };

export type NotePairing = {
  goal: Goal;
  inputs: string[];
  total: number;
  results: { note: string; rank: number; score: number; dominantFamily: string }[];
};

export type PairingMatch = {
  id: number;
  rank: number;
  score: number;
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  dominantFamily: string;
  owned: boolean;
};

export type FragrancePairing = {
  base: { id: number; slug: string; name: string; brand: string; dominantFamily: string };
  goal: Goal;
  page: number;
  pageSize: number;
  total: number; // the whole ranked list
  matching: number; // partners this request's filter returns (total unless ownedOnly)
  totalPages: number;
  items: PairingMatch[];
};

export type RankResult =
  | { status: "ranked"; rank: number; total: number; score: number }
  | { status: "too_harsh"; total: number };

export type Family = { id: number; name: string; harshness: number };

// Carries the API's error code so pages can tell "not found" from "server down".
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Every request carries the guest id (SPEC section 6). Pass 1 ignores it; pass 2's
// LLM caps count conversations per guest with it.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Guest-Id": getState().guestId,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error ?? {};
    throw new ApiError(res.status, error.code ?? "network_error", error.message ?? "Something went wrong.");
  }
  return body as T;
}

// Builds "?a=1&b=2", leaving out empty values so the API applies its defaults.
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  fragrances: (params: { q?: string; gender?: string; family?: string; sort?: string; page?: number }) =>
    request<FragranceList>(`/fragrances${query(params)}`),

  fragrance: (slug: string) => request<FragranceDetail>(`/fragrances/${encodeURIComponent(slug)}`),

  notes: (q: string, limit = 8) => request<{ items: NoteSuggestion[] }>(`/notes${query({ q, limit })}`),

  families: () => request<{ items: Family[] }>("/families"),

  pairNotes: (notes: string[], goal: Goal) =>
    request<NotePairing>("/pairing/notes", { method: "POST", body: JSON.stringify({ notes, goal }) }),

  // With ownedOnly, the server returns only the partners whose ids are in `owned`,
  // searched across the whole ranked list.
  pairFragrance: (slug: string, goal: Goal, page: number, owned: number[], ownedOnly = false) =>
    request<FragrancePairing>(
      `/pairing/fragrances/${encodeURIComponent(slug)}${query({
        goal,
        page,
        owned: owned.join(","),
        ownedOnly: ownedOnly ? "true" : undefined,
      })}`,
    ),

  rank: (slug: string, partnerSlug: string, goal: Goal) =>
    request<RankResult>(
      `/pairing/fragrances/${encodeURIComponent(slug)}/rank/${encodeURIComponent(partnerSlug)}${query({ goal })}`,
    ),
};
