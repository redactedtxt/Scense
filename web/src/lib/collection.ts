import { useMemo, useSyncExternalStore } from "react";
import {
  getState,
  isStorageBlocked,
  setStatus,
  subscribe,
  type CollectionStatus,
  type FragranceSnapshot,
  type SavedFragrance,
} from "./guestStore";

// React's view of the guest's Own and Want lists. Pages read the collection only
// through these hooks, so pass 2 can swap the guest store for the account's
// collection API in this one file.

// useSyncExternalStore re-renders every subscriber when guestStore changes, so a click
// on a result card updates the fragrance page, the /me list, and the "Owned" badges.
function useGuestState() {
  return useSyncExternalStore(subscribe, getState);
}

export function useCollection(): SavedFragrance[] {
  return useGuestState().collection;
}

// The owned ids, for the pairing API's `owned` parameter. Memoised so the array keeps
// its identity (and the query key stays the same) until the Own list really changes.
export function useOwnedIds(): number[] {
  const collection = useCollection();
  return useMemo(
    () => collection.filter((item) => item.status === "own").map((item) => item.id).sort((a, b) => a - b),
    [collection],
  );
}

export function useCollectionStatus(id: number | undefined): CollectionStatus | null {
  const collection = useCollection();
  return collection.find((item) => item.id === id)?.status ?? null;
}

export function useStorageBlocked(): boolean {
  return useSyncExternalStore(subscribe, isStorageBlocked);
}

// Pressing the button that is already on turns it off; pressing the other one moves
// the bottle between lists.
export function toggleStatus(fragrance: FragranceSnapshot, current: CollectionStatus | null, pressed: CollectionStatus) {
  setStatus(fragrance, current === pressed ? null : pressed);
}
