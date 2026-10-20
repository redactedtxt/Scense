import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type User } from "./api";

// Who is signed in, as TanStack Query state. The session itself is an httpOnly cookie
// that page code can't read, so the only way to know is to ask GET /api/auth/me.

export const SESSION_KEY = ["session"] as const;
export const ACCOUNT_COLLECTION_KEY = ["account-collection"] as const;

// Any failure counts as signed out: a 401 is the normal answer for a guest, and if the
// API is down the site should still work in guest mode rather than show an error.
async function fetchSession(): Promise<User | null> {
  try {
    return (await api.me()).user;
  } catch {
    return null;
  }
}

export type Session = { user: User | null; loading: boolean };

export function useSession(): Session {
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: Infinity, retry: false });
  return { user: query.data ?? null, loading: query.isPending };
}

// Called after signup or login succeeds: remember the user without another /me call.
export function setSignedIn(client: QueryClient, user: User): void {
  client.setQueryData(SESSION_KEY, user);
}

export function useSignOut() {
  const client = useQueryClient();
  return async () => {
    await api.logout().catch(() => {}); // the cookie may already be gone; sign out locally anyway
    client.setQueryData(SESSION_KEY, null);
    client.removeQueries({ queryKey: ACCOUNT_COLLECTION_KEY });
  };
}

// Where to go after signing in. Only a path on this site is accepted ("/me", not
// "https://evil.example", "//evil.example", or "/\evil.example", which some browsers
// read as "//"), so a crafted link can't bounce a visitor to another site straight
// after they type their password.
export function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) ? next : "/";
}
