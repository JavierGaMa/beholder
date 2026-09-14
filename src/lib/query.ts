import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export function qError(e: unknown): string | null {
  if (e == null) return null;
  return String(e).replace(/^Error: /, "");
}
