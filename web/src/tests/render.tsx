import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createQueryClient, routes } from "../App";

type Responder = (url: URL, init?: RequestInit) => unknown;

// Replaces fetch with a table of [path prefix, answer] pairs, so page tests run
// without the API. The first prefix that matches the request path answers it.
export function mockApi(table: [string, Responder][]) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://test");
    const match = table.find(([prefix]) => url.pathname.startsWith(prefix));
    if (!match) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "no mock" } }), { status: 404 });
    }
    return new Response(JSON.stringify(match[1](url, init)), { status: 200 });
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
