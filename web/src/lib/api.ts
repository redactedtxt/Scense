// Typed wrappers around the pass 1 API (SPEC section 7). Field names match the JSON the
// API sends (camelCase); stored values stay as the dataset has them ("male", "autumn").

import { getState, type CollectionStatus, type SavedFragrance } from "./guestStore";
import type { TasteProfile } from "./tasteProfile";

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

export type User = { id: number; email: string; displayName: string };

export type Review = {
  id: number;
  stars: number;
  body: string; // plain text as typed; always rendered as text, never as HTML
  authorName: string;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
};

export type ReviewPage = {
  items: Review[];
  mine: Review | null; // the viewer's own review, wherever it sits in the list
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ReviewInput = { stars: number; body: string };

export type PairRating = { partnerId: number; stars: number };

export type ImportItem = { fragranceId: number; status: CollectionStatus; addedAt?: string };

export type ImportResult = { imported: number; skipped: number; tasteProfile: "imported" | "kept" | "none" };

// A bottle the server picked for the chat (M9). The model never names one.
export type ChatRecommendation = {
  id: number;
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  dominantFamily: string;
  owned: boolean;
  match?: number; // 0-100; only on a fresh reply, not on a reloaded transcript
};

export type ChatMessage = { role: "user" | "assistant"; content: string; recommendations: ChatRecommendation[] };

// One of the visitor's chats in the list (DECISIONS B36). The title is the visitor's own
// first message, trimmed by the server; never the model's words.
export type ChatSummary = { id: string; title: string; createdAt: string; lastMessageAt: string };

// The day's budget is shared by every chat, so it comes with the list, not with a chat.
export type ChatState = {
  available: boolean; // false when the server has no model configured
  messagesUsed: number;
  messagesLimit: number;
  conversations: ChatSummary[]; // most recently used first
};

export type ChatConversation = { conversation: ChatSummary; messages: ChatMessage[] };

export type ChatReply = {
  conversation: ChatSummary; // the chat the message went to; new on a first message
  reply: string;
  profile: TasteProfile;
  recommendations: ChatRecommendation[];
  degraded: boolean; // the model's answer failed validation; the reply is an apology
  messagesUsed: number;
  messagesLimit: number;
};

// --- the concierge (M10; DECISIONS B37) ---

export type OutingSlotName = "occasion" | "time_of_day" | "season" | "setting" | "projection";

// One of the outing's five slots as the server describes it: its label ("Date night",
// "Fall"), or null while it's still missing.
export type OutingSlot = { slot: OutingSlotName; value: string | null };

// A bottle the concierge picked, with the one sentence on why it fits. The first pick of
// a reply is the top pick; the others are alternatives.
export type ConciergePick = Omit<ChatRecommendation, "match"> & { reason: string };

export type ConciergeMessage = {
  role: "user" | "assistant";
  content: string;
  options: string[]; // the answer chips under a question; [] otherwise
  picks: ConciergePick[];
};

// The concierge's own budget (separate from the chat's) and the visitor's outings.
export type ConciergeState = ChatState;

export type ConciergeOuting = { conversation: ChatSummary; outing: OutingSlot[]; messages: ConciergeMessage[] };

export type ConciergeReply = {
  conversation: ChatSummary; // the outing the message went to; new on a first message
  reply: string;
  options: string[];
  picks: ConciergePick[];
  outing: OutingSlot[];
  degraded: boolean;
  messagesUsed: number;
  messagesLimit: number;
};

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
// LLM caps count messages and guests with it. The session cookie rides along on its
// own: these are same-origin requests, and fetch sends cookies to its own origin.
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
  // 204 No Content (logout, delete) has no body; callers of those expect nothing.
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

  // --- accounts (pass 2, M7) ---
  me: () => request<{ user: User }>("/auth/me"),

  signup: (body: { email: string; displayName: string; password: string }) =>
    request<{ user: User }>("/auth/signup", { method: "POST", body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  // --- a signed-in user's collection; items have the guest store's shape ---
  collection: () => request<{ items: SavedFragrance[] }>("/collection"),

  setCollectionStatus: (fragranceId: number, status: CollectionStatus) =>
    request<SavedFragrance>(`/collection/${fragranceId}`, { method: "PUT", body: JSON.stringify({ status }) }),

  removeFromCollection: (fragranceId: number) => request<void>(`/collection/${fragranceId}`, { method: "DELETE" }),

  // The guest's taste profile rides along (M9); the account keeps its own if it has one.
  importCollection: (items: ImportItem[], tasteProfile: TasteProfile | null) =>
    request<ImportResult>("/collection/import", {
      method: "POST",
      body: JSON.stringify({ items, tasteProfile }),
    }),

  // --- reviews and pair ratings (pass 2, M8) ---
  reviews: (fragranceId: number, page: number) =>
    request<ReviewPage>(`/fragrances/${fragranceId}/reviews${query({ page })}`),

  // POST creates the user's one review of this fragrance; PUT edits it.
  saveReview: (fragranceId: number, input: ReviewInput, isEdit: boolean) =>
    request<Review>(`/fragrances/${fragranceId}/reviews`, {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),

  deleteReview: (fragranceId: number) => request<void>(`/fragrances/${fragranceId}/reviews`, { method: "DELETE" }),

  pairRatings: (baseId: number, goal: Goal) =>
    request<{ items: PairRating[] }>(`/pair-ratings${query({ baseId, goal })}`),

  ratePair: (body: { baseId: number; partnerId: number; goal: Goal; stars: number }) =>
    request<unknown>("/pair-ratings", { method: "PUT", body: JSON.stringify(body) }),

  // --- chat and taste profile (pass 2, M9) ---
  chat: () => request<ChatState>("/chat"),

  chatConversation: (id: string) => request<ChatConversation>(`/chat/${encodeURIComponent(id)}`),

  // No conversationId starts a new chat. A guest sends their profile (numbers only
  // matter; the server never shows the model the summary) and owned ids; a signed-in
  // user's come from the account.
  sendChat: (body: {
    message: string;
    conversationId?: string;
    tasteProfile?: TasteProfile | null;
    owned?: number[];
  }) => request<ChatReply>("/chat", { method: "POST", body: JSON.stringify(body) }),

  // Gives no messages back: today's count stays as it is.
  deleteChat: (id: string) => request<void>(`/chat/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // --- the concierge (pass 2, M10) ---
  concierge: () => request<ConciergeState>("/concierge"),

  conciergeOuting: (id: string) => request<ConciergeOuting>(`/concierge/${encodeURIComponent(id)}`),

  // Like sendChat: no conversationId starts a new outing, and a guest sends their Own list
  // (the candidates) and taste profile; a signed-in user's come from the account.
  sendConcierge: (body: {
    message: string;
    conversationId?: string;
    tasteProfile?: TasteProfile | null;
    owned?: number[];
  }) => request<ConciergeReply>("/concierge", { method: "POST", body: JSON.stringify(body) }),

  deleteOuting: (id: string) => request<void>(`/concierge/${encodeURIComponent(id)}`, { method: "DELETE" }),

  tasteProfile: () => request<{ profile: TasteProfile | null }>("/profile/taste"),

  saveTasteProfile: (profile: TasteProfile) =>
    request<{ profile: TasteProfile }>("/profile/taste", { method: "PUT", body: JSON.stringify(profile) }),
};
