import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, type Goal } from "./api";
import { SESSION_KEY, useSession } from "./session";

// A signed-in user's pair ratings for one result list (one base, one goal), fetched
// once per list and shared by every card in it. Stored only: they change no score
// (decision 11). Keyed by user, so one person's stars never show for another.

export const PAIR_RATINGS_KEY = "pair-ratings";

type Ratings = Record<number, number>; // partner id -> stars

function ratingsKey(userId: number | undefined, baseId: number, goal: Goal) {
  return [PAIR_RATINGS_KEY, userId, baseId, goal] as const;
}

export function usePairRatings(baseId: number | undefined, goal: Goal) {
  const { user } = useSession();
  return useQuery({
    queryKey: ratingsKey(user?.id, baseId ?? 0, goal),
    queryFn: async (): Promise<Ratings> => {
      const { items } = await api.pairRatings(baseId!, goal);
      return Object.fromEntries(items.map((item) => [item.partnerId, item.stars]));
    },
    enabled: user !== null && baseId !== undefined,
    staleTime: Infinity, // only this tab changes them, and it updates the cache itself
  });
}

// Ratings for one pair are sent one after another, like collection clicks: clicking 3
// then 5 quickly must not let the 3 land last.
const queues = new Map<string, Promise<unknown>>();

// Optimistic: the stars light up at once, then the request goes out. On failure the
// list is fetched again so the card shows what the server really has, and the error is
// passed on so the card can say what went wrong (a rate limit, say).
export function useRatePair() {
  const client = useQueryClient();
  const { user } = useSession();
  return async (baseId: number, partnerId: number, goal: Goal, stars: number) => {
    const key = ratingsKey(user?.id, baseId, goal);
    client.setQueryData<Ratings>(key, (old) => ({ ...old, [partnerId]: stars }));
    const send = () => api.ratePair({ baseId, partnerId, goal, stars });
    const queueKey = `${baseId}:${partnerId}:${goal}`;
    const request = (queues.get(queueKey) ?? Promise.resolve()).then(send, send);
    queues.set(queueKey, request);
    try {
      await request;
    } catch (err) {
      await recover(client, key, err);
      throw err;
    } finally {
      if (queues.get(queueKey) === request) queues.delete(queueKey);
    }
  };
}

async function recover(client: QueryClient, key: readonly unknown[], err: unknown) {
  if (err instanceof ApiError && err.status === 401) client.setQueryData(SESSION_KEY, null);
  else await client.invalidateQueries({ queryKey: key });
}
