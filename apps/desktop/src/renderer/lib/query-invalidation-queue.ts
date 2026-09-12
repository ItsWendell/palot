import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Coalesce per-query refreshes; the transport owns aggregate concurrency limits. */
export function createQueryInvalidationQueue(queryClient: QueryClient, delay = 150) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = new Set<string>();
  let disposed = false;

  const schedule = () => {
    if (disposed || timer !== undefined || ![...pending.keys()].some((hash) => !running.has(hash)))
      return;
    timer = setTimeout(() => {
      timer = undefined;
      for (const [hash, queryKey] of pending) {
        if (running.has(hash)) continue;
        pending.delete(hash);
        void refresh(hash, queryKey);
      }
    }, delay);
  };
  const refresh = async (hash: string, queryKey: QueryKey) => {
    running.add(hash);
    try {
      await queryClient.invalidateQueries(
        { queryKey, exact: true, refetchType: "active" },
        { cancelRefetch: false },
      );
    } finally {
      running.delete(hash);
      schedule();
    }
  };

  return {
    invalidate(queryKey: QueryKey) {
      if (disposed) return;
      // Expanding prefixes absorbs overlapping global and location invalidations.
      for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
        pending.set(query.queryHash, query.queryKey);
      }
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      pending.clear();
    },
  };
}
