import { QueryClient } from "@tanstack/react-query";

export function createRendererQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 10 * 60_000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30_000,
      },
    },
  });
}

export const rendererQueryClient = createRendererQueryClient();
