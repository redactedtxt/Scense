import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { getState, setTasteProfile, subscribe } from "./guestStore";
import { ACCOUNT_TASTE_KEY, useSession } from "./session";
import type { TasteProfile } from "./tasteProfile";

// Where the taste profile lives, decided in one place like the collection (DECISIONS
// B31): the browser for a guest, taste_profiles once signed in (SPEC section 6).

export type TasteView = { profile: TasteProfile | null; ready: boolean; signedIn: boolean };

export function useTasteProfile(): TasteView {
  const session = useSession();
  const guest = useSyncExternalStore(subscribe, () => getState().tasteProfile);
  const account = useQuery({
    queryKey: ACCOUNT_TASTE_KEY,
    queryFn: async () => (await api.tasteProfile()).profile,
    enabled: session.user !== null,
    staleTime: Infinity, // only this tab changes it, and it updates the cache itself
  });
  if (session.loading) return { profile: null, ready: false, signedIn: false };
  if (!session.user) return { profile: guest, ready: true, signedIn: false };
  return { profile: account.data ?? null, ready: account.isSuccess, signedIn: true };
}

// The card's Save. A guest's profile goes to the browser; a user's to the API, which
// answers with the stored copy (its summary rebuilt from the numbers if we sent none).
export function useSaveTasteProfile() {
  const client = useQueryClient();
  const { user } = useSession();
  return async (profile: TasteProfile) => {
    if (!user) {
      setTasteProfile(profile);
      return;
    }
    const saved = await api.saveTasteProfile(profile);
    client.setQueryData(ACCOUNT_TASTE_KEY, saved.profile);
  };
}

// A chat reply carries the updated profile. The server already saved a user's, so only
// the cache changes; a guest's is saved here, since only the browser keeps it.
export function storeChatProfile(client: QueryClient, signedIn: boolean, profile: TasteProfile): void {
  if (signedIn) client.setQueryData(ACCOUNT_TASTE_KEY, profile);
  else setTasteProfile(profile);
}
