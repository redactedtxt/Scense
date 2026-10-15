import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useDebounced } from "./useDebounced";

// Query hooks shared by more than one page. Keys are arrays so TanStack Query caches
// each fragrance, search, and list separately and reuses them across pages.

const SUGGESTION_LIMIT = 8;

export function useFragrance(slug: string | null) {
  return useQuery({
    queryKey: ["fragrance", slug],
    queryFn: () => api.fragrance(slug!),
    enabled: slug !== null,
  });
}

// Fragrance autocomplete: the catalogue search, first few hits, most voted first.
export function useFragranceSuggestions(text: string) {
  const q = useDebounced(text.trim());
  return useQuery({
    queryKey: ["fragrance-suggestions", q],
    queryFn: async () => (await api.fragrances({ q })).items.slice(0, SUGGESTION_LIMIT),
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });
}

export function useNoteSuggestions(text: string) {
  const q = useDebounced(text.trim());
  return useQuery({
    queryKey: ["note-suggestions", q],
    queryFn: async () => (await api.notes(q, SUGGESTION_LIMIT)).items,
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });
}

export function useFamilies() {
  return useQuery({ queryKey: ["families"], queryFn: api.families, staleTime: Infinity });
}

// The catalogue size, read from the first page of the unfiltered list.
export function useCatalogueTotal() {
  return useQuery({
    queryKey: ["fragrances", { q: "", gender: "", family: "", page: 1 }],
    queryFn: () => api.fragrances({ page: 1 }),
    select: (list) => list.total,
  });
}
