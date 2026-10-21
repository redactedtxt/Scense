import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createQueryClient, routes } from "../App";

type Responder = (url: URL, init?: RequestInit) => unknown;

// Replaces fetch with a table of [path prefix, answer] pairs, so page tests run
// without the API. The first prefix that matches the request path answers it. An answer
// that is already a Response (say a 401) is sent as it is; anything else becomes JSON.
// Unmatched paths get a 404, which also makes GET /api/auth/me read as "signed out".
export function mockApi(table: [string, Responder][]) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://test");
    const match = table.find(([prefix]) => url.pathname.startsWith(prefix));
    if (!match) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "no mock" } }), { status: 404 });
    }
    const answer = match[1](url, init);
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Renders the real route table at `path` with a fresh cache and no retries.
export function renderAt(path: string) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// A fragrance page also asks for its reviews (M8). Tests about other parts of the page
// list this before their "/api/fragrances/" answer so the reviews request gets the
// right shape.
export const noReviews: [string, Responder] = [
  "/api/fragrances/5/reviews",
  () => ({ items: [], mine: null, page: 1, pageSize: 10, total: 0, totalPages: 0 }),
];

export function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}
