// Guest mode (SPEC section 6): the visitor's id, Own and Want lists, and taste profile,
// kept in localStorage so they survive a reload. There is no account behind any of it.
//
// localStorage can throw at any time: some browsers block it outright (privacy settings,
// some private windows), and a full disk makes writes fail. Every read and write below
// is wrapped in try/catch. When storage fails, the store keeps working in memory for
// this tab and sets `storageBlocked`, which shows the banner in Layout.

export type CollectionStatus = "own" | "want";

// Enough to draw a card on /me without asking the API again. The id is what the API's
// `owned` parameter and the pass 2 import take; the rest is a snapshot for display.
export type SavedFragrance = {
  id: number;
  slug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  dominantFamily: string;
  status: CollectionStatus;
  addedAt: string; // ISO time, newest shown first
};

export type FragranceSnapshot = Omit<SavedFragrance, "status" | "addedAt">;

// Filled by the pass 2 chatbot. Kept here now so the stored shape is settled.
export type TasteProfile = {
  families: Record<string, number>;
  facets: Record<string, number>;
  summary: string | null;
};

export type GuestState = {
  guestId: string;
  collection: SavedFragrance[];
  tasteProfile: TasteProfile | null;
};

// The version suffix lets a later milestone change the shape without misreading old data.
export const STORAGE_KEY = "scense.guest.v1";

let state: GuestState;
let storageBlocked = false;
const listeners = new Set<() => void>();

// --- storage access: the only functions that touch localStorage ---------------------

function readStored(): GuestState | null {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text === null ? null : parseState(text);
  } catch {
    storageBlocked = true;
    return null;
  }
}

function writeStored(next: GuestState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    storageBlocked = true;
  }
}

// Stored text could be anything: an older shape, a hand edit, half a write. Keep the
// entries that make sense and drop the rest, rather than throwing the visitor's list away.
function parseState(text: string): GuestState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.guestId !== "string" || raw.guestId === "") return null;
  const collection = Array.isArray(raw.collection) ? raw.collection.filter(isSavedFragrance) : [];
  const tasteProfile = isObject(raw.tasteProfile) ? (raw.tasteProfile as TasteProfile) : null;
  return { guestId: raw.guestId, collection, tasteProfile };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSavedFragrance(value: unknown): value is SavedFragrance {
  return (
    isObject(value) &&
    Number.isInteger(value.id) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    (value.status === "own" || value.status === "want")
  );
}

// crypto.randomUUID only exists on HTTPS and localhost. Opening the dev server by its
// LAN address is plain HTTP, so fall back to building a version 4 UUID by hand.
function newGuestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- loading and changing state -----------------------------------------------------

// Reads storage, or creates a fresh guest on the first visit. Exported so tests can
// re-run it after swapping localStorage for one that throws.
export function loadGuestState(): void {
  storageBlocked = false;
  const stored = readStored();
  if (stored) {
    state = stored;
  } else {
    state = { guestId: newGuestId(), collection: [], tasteProfile: null };
    if (!storageBlocked) writeStored(state);
  }
  notify();
}

function commit(next: GuestState): void {
  state = next;
  writeStored(next);
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

// Mark a fragrance Own or Want, or pass null to remove it. A bottle is in one list at a
// time, like the pass 2 `collection` table: marking a wanted bottle Own moves it.
export function setStatus(fragrance: FragranceSnapshot, status: CollectionStatus | null): void {
  commit({ ...state, collection: withStatus(state.collection, fragrance, status) });
}

// The list after one change, newest first. Pure, so the signed-in collection (in
// collection.ts) applies its optimistic updates with the very same rule.
export function withStatus(
  list: SavedFragrance[],
  fragrance: FragranceSnapshot,
  status: CollectionStatus | null,
): SavedFragrance[] {
  const others = list.filter((item) => item.id !== fragrance.id);
  if (status === null) return others;
  return [{ ...snapshotOf(fragrance), status, addedAt: new Date().toISOString() }, ...others];
}

// After a guest import (SPEC section 6) the bottles live in the account, so the browser
// copy is emptied. The guest id stays: pass 2's LLM caps still count by it when the
// visitor signs out. The taste profile stays too, until M9 can import it.
export function clearCollection(): void {
  commit({ ...state, collection: [] });
}

// Copy only the fields we store, so a full API object doesn't end up in localStorage.
function snapshotOf(f: FragranceSnapshot): FragranceSnapshot {
  return { id: f.id, slug: f.slug, name: f.name, brand: f.brand, imageUrl: f.imageUrl, dominantFamily: f.dominantFamily };
}

// --- reading state (React reads through useSyncExternalStore in collection.ts) -------

export function getState(): GuestState {
  return state;
}

export function isStorageBlocked(): boolean {
  return storageBlocked;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab changed the collection: pick up its copy so both tabs agree.
function onStorageEvent(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || event.newValue === null) return;
  const next = parseState(event.newValue);
  if (next) {
    state = next;
    notify();
  }
}

loadGuestState();
window.addEventListener("storage", onStorageEvent);
