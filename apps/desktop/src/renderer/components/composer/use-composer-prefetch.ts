import { useQueries, useQuery } from "@tanstack/react-query";
import type { LocationRef } from "@opencode/client";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { composerCatalogQueryOptions } from "../../hooks/use-composer-discovery";
import { settingsSnapshotQueryOptions } from "../../hooks/use-settings-snapshot";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";

/** How long an idle callback may wait before the catalogs load anyway. */
const IDLE_TIMEOUT_MS = 2_000;
/** Without idle callbacks, wait for the mount's own work to settle. */
const FALLBACK_DELAY_MS = 200;

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(id);
}

/**
 * Loads what `/`, `$`, `@` and the agent picker show once the app is idle after the composer
 * mounts, so their first use reads the cache. The queries stay observed, so the existing
 * invalidation keeps them fresh; the pickers keep their own loading states for a cold cache.
 */
export function useComposerPrefetch(location: LocationRef, projectID: string) {
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const enabled = idle && canFetchOpenCode(runtime);
  useQuery(composerCatalogQueryOptions(connectionID, location, enabled));
  // `@` reads agents and references; the agent picker shares the agents entry.
  useQueries({
    queries: (["agents", "references"] as const).map((capability) =>
      settingsSnapshotQueryOptions(
        connectionID,
        { ...location, projectID, capabilities: [capability] },
        enabled,
      ),
    ),
  });
}
