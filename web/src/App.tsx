import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { Layout } from "./components/Layout";
import { AboutPage } from "./pages/AboutPage";
import { BrowsePage } from "./pages/BrowsePage";
import { FragrancePage } from "./pages/FragrancePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PairingPage } from "./pages/pairing/PairingPage";

// Pass 1 pages. /chat, /concierge, /me, /login, and /signup arrive in later milestones.
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <PairingPage /> },
      { path: "/browse", element: <BrowsePage /> },
      { path: "/f/:slug", element: <FragrancePage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

// Catalogue data only changes when the pipeline reloads the database, so cached
// answers stay fresh for a while and a failed request is retried once, not three times.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } },
  });
}

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
