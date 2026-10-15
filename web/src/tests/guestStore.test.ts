import { afterEach, describe, expect, it, vi } from "vitest";
import * as store from "../lib/guestStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const aventus = { id: 5, slug: "creed-aventus-2010", name: "Aventus", brand: "Creed", imageUrl: null, dominantFamily: "Fruity" };
const cdnim = { id: 9, slug: "armaf-cdnim", name: "Club de Nuit Intense Man", brand: "Armaf", imageUrl: null, dominantFamily: "Citrus" };

// A page reload starts every module from scratch. vi.resetModules() plus a fresh
// import does the same for guestStore: the new copy has nothing in memory and can
// only know the collection by reading localStorage.
async function reloadStore(): Promise<typeof store> {
  vi.resetModules();
  return import("../lib/guestStore");
}

function stored() {
  return JSON.parse(window.localStorage.getItem(store.STORAGE_KEY)!);
}

afterEach(() => vi.restoreAllMocks());

describe("guestStore, storage working", () => {
  it("creates a UUID on the first visit and saves it", () => {
    expect(store.getState().guestId).toMatch(UUID);
    expect(stored().guestId).toBe(store.getState().guestId);
    expect(store.isStorageBlocked()).toBe(false);
  });

  it("keeps Own and Want across a reload, with the same guest id", async () => {
    store.setStatus(aventus, "own");
    store.setStatus(cdnim, "want");
    const before = store.getState();

    const fresh = await reloadStore();
    const after = fresh.getState();
    expect(after.guestId).toBe(before.guestId);
    expect(after.collection.map((i) => [i.slug, i.status])).toEqual([
      ["armaf-cdnim", "want"],
      ["creed-aventus-2010", "own"],
    ]);
  });

  it("keeps a bottle in one list at a time, and null removes it", () => {
    store.setStatus(aventus, "want");
    store.setStatus(aventus, "own");
    expect(store.getState().collection).toHaveLength(1);
    expect(store.getState().collection[0]!.status).toBe("own");
    store.setStatus(aventus, null);
    expect(store.getState().collection).toEqual([]);
    expect(stored().collection).toEqual([]);
  });

  it("stores only the snapshot fields, not a whole API object", () => {
    store.setStatus({ ...aventus, notes: { top: [] }, harshness: 0.4 } as never, "own");
    expect(Object.keys(stored().collection[0]).sort()).toEqual(
      ["addedAt", "brand", "dominantFamily", "id", "imageUrl", "name", "slug", "status"],
    );
  });

  it("starts fresh from unreadable JSON and drops malformed entries from readable JSON", () => {
    window.localStorage.setItem(store.STORAGE_KEY, "{not json");
    store.loadGuestState();
    expect(store.getState().collection).toEqual([]);
    expect(store.getState().guestId).toMatch(UUID);

    const good = { ...aventus, status: "own", addedAt: "2026-10-15T00:00:00Z" };
    const bad = { id: "seven", status: "own" };
    window.localStorage.setItem(store.STORAGE_KEY, JSON.stringify({ guestId: "g-1", collection: [good, bad] }));
    store.loadGuestState();
    expect(store.getState()).toMatchObject({ guestId: "g-1", tasteProfile: null });
    expect(store.getState().collection.map((i) => i.id)).toEqual([5]);
  });

  it("tells subscribers about every change", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setStatus(aventus, "own");
    unsubscribe();
    store.setStatus(aventus, null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("guestStore, storage failing", () => {
  it("falls back to memory when reading localStorage throws", () => {
    // Blocked site data: even touching window.localStorage throws a SecurityError.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      store.loadGuestState();
      expect(store.isStorageBlocked()).toBe(true);
      expect(store.getState().guestId).toMatch(UUID);
      store.setStatus(aventus, "own"); // still works for this tab
      expect(store.getState().collection).toHaveLength(1);
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("flags storage as blocked when a write throws (for example, a full disk)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(store.isStorageBlocked()).toBe(false);
    store.setStatus(aventus, "own");
    expect(store.isStorageBlocked()).toBe(true);
    expect(store.getState().collection[0]!.slug).toBe("creed-aventus-2010");
  });
});
