import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { api, ApiError, type ImportItem } from "./api";
import {
  clearCollection,
  getState,
  isStorageBlocked,
  setStatus,
  subscribe,
  withStatus,
  type CollectionStatus,
  type FragranceSnapshot,
  type SavedFragrance,
} from "./guestStore";
import { ACCOUNT_COLLECTION_KEY, SESSION_KEY, useSession } from "./session";

// React's view of the visitor's Own and Want lists, and the one place that decides
// where they live: the browser (guestStore) for a guest, the account (the collection
// API) once signed in. Pages read and change the collection only through these hooks,
// so no page knows or cares which one it is (DECISIONS B31).

const NOTHING: SavedFragrance[] = [];

// useSyncExternalStore re-renders every subscriber when guestStore changes, so a click
// on a result card updates the fragrance page, the /me list, and the "Owned" badges.
function useGuestState() {
  return useSyncExternalStore(subscribe, getState);
}

// The guest's own list, even while signed in: /me uses it to offer the import.
export function useGuestCollection(): SavedFragrance[] {
  return useGuestState().collection;
}

export type CollectionView = { items: SavedFragrance[]; ready: boolean; signedIn: boolean };

// `ready` is false until we know who is signed in and, for a user, their list has
// arrived. Until then the lists read as empty and the buttons are disabled, so a
// signed-in visitor never sees (or clicks) the browser's list by mistake.
export function useCollectionView(): CollectionView {
  const session = useSession();
  const guest = useGuestCollection();
  const account = useQuery({
    queryKey: ACCOUNT_COLLECTION_KEY,
    queryFn: async () => (await api.collection()).items,
    enabled: session.user !== null,
    staleTime: Infinity, // only this tab changes it, and it updates the cache itself
  });
  if (session.loading) return { items: NOTHING, ready: false, signedIn: false };
  if (!session.user) return { items: guest, ready: true, signedIn: false };
  return { items: account.data ?? NOTHING, ready: account.isSuccess, signedIn: true };
}

export function useCollection(): SavedFragrance[] {
  return useCollectionView().items;
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

// Storage only matters to a guest; a signed-in collection is saved by the server.
export function useStorageBlocked(): boolean {
  const blocked = useSyncExternalStore(subscribe, isStorageBlocked);
  const { user } = useSession();
  return blocked && !user;
}

// Pressing the button that is already on turns it off; pressing the other one moves
// the bottle between lists.
export function useToggleStatus() {
  const client = useQueryClient();
  const { user } = useSession();
  return (fragrance: FragranceSnapshot, current: CollectionStatus | null, pressed: CollectionStatus) => {
    const next = current === pressed ? null : pressed;
    if (user) void saveToAccount(client, fragrance, next);
    else setStatus(fragrance, next);
  };
}

// Requests for one bottle are sent one after another. Two quick clicks (Own, then Own
// again to remove) would otherwise race, and the server could apply them out of order.
const queues = new Map<number, Promise<unknown>>();

// Optimistic: the button lights up at once, then the request goes out. If it fails,
// the list is fetched again so the screen shows what the server really has.
async function saveToAccount(client: QueryClient, fragrance: FragranceSnapshot, status: CollectionStatus | null) {
  client.setQueryData<SavedFragrance[]>(ACCOUNT_COLLECTION_KEY, (list) => withStatus(list ?? [], fragrance, status));
  const send = (): Promise<unknown> =>
    status === null ? api.removeFromCollection(fragrance.id) : api.setCollectionStatus(fragrance.id, status);
  const request = (queues.get(fragrance.id) ?? Promise.resolve<unknown>(undefined)).then(send, send);
  queues.set(fragrance.id, request);
  try {
    await request;
  } catch (err) {
    // An expired session: drop back to guest mode instead of failing every click.
    if (err instanceof ApiError && err.status === 401) client.setQueryData(SESSION_KEY, null);
    else await client.invalidateQueries({ queryKey: ACCOUNT_COLLECTION_KEY });
  } finally {
    if (queues.get(fragrance.id) === request) queues.delete(fragrance.id);
  }
}

// Guest import (SPEC section 6): send the browser's list to the account, then empty the
// browser's copy. Bottles already in the account keep the account's status (the server
// decides). The taste profile is not imported yet; M9 adds it.
export async function importGuestCollection(client: QueryClient) {
  const items: ImportItem[] = getState().collection.map((item) => ({
    fragranceId: item.id,
    status: item.status,
    addedAt: validTime(item.addedAt),
  }));
  const result = await api.importCollection(items);
  clearCollection();
  await client.invalidateQueries({ queryKey: ACCOUNT_COLLECTION_KEY });
  return result;
}

// Saved times come from localStorage and could be anything; send only real ones.
function validTime(text: string): string | undefined {
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
