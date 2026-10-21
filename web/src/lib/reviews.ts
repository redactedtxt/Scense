import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Review, type ReviewInput } from "./api";
import { SESSION_KEY, useSession } from "./session";

// Reviews on a fragrance page (M8), a page of 10 at a time, newest first.
// The key includes the viewer, because the API marks "mine" per viewer: signing in or
// out must not show the last person's "Your review" flags.

export const REVIEWS_KEY = "reviews";

export function useReviews(fragranceId: number) {
  const session = useSession();
  const viewer = session.user?.id ?? null;
  const query = useInfiniteQuery({
    queryKey: [REVIEWS_KEY, fragranceId, viewer],
    queryFn: ({ pageParam }) => api.reviews(fragranceId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    // Wait until we know who is asking, or the guest answer would flash first.
    enabled: !session.loading,
  });
  // A review posted while someone pages through would shift the next page by one, and
  // the same review could then arrive twice. Keep the first copy of each.
  const seen = new Set<number>();
  const items: Review[] = [];
  for (const review of query.data?.pages.flatMap((page) => page.items) ?? []) {
    if (!seen.has(review.id)) items.push(review);
    seen.add(review.id);
  }
  const first = query.data?.pages[0];
  return { query, items, total: first?.total ?? 0, mine: first?.mine ?? null };
}

// After any write, every cached page of this fragrance's reviews is out of date (the new
// review goes on page 1 and pushes the rest along), so refetch them all.
function useRefresh(fragranceId: number) {
  const client = useQueryClient();
  return async (err?: unknown) => {
    // An expired session: drop back to guest mode instead of failing every click.
    if (err instanceof ApiError && err.status === 401) client.setQueryData(SESSION_KEY, null);
    await client.invalidateQueries({ queryKey: [REVIEWS_KEY, fragranceId] });
  };
}

export function useSaveReview(fragranceId: number) {
  const refresh = useRefresh(fragranceId);
  return async (input: ReviewInput, isEdit: boolean) => {
    try {
      await api.saveReview(fragranceId, input, isEdit);
    } catch (err) {
      // 409: they already have one (another tab, say). Refresh so Edit appears.
      if (err instanceof ApiError && (err.status === 409 || err.status === 401)) await refresh(err);
      throw err;
    }
    await refresh();
  };
}

export function useDeleteReview(fragranceId: number) {
  const refresh = useRefresh(fragranceId);
  return async () => {
    try {
      await api.deleteReview(fragranceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) await refresh(err);
      throw err;
    }
    await refresh();
  };
}
