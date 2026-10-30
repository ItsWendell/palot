import type { LocationRef } from "@opencode/client";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { workspaceRelativePath } from "../lib/file-reference";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { openCodeClient } from "../services/opencode-client";
import { palot } from "../services/palot";

// OpenCode expires watches 24 hours after the latest request.
const REFRESH_MS = 12 * 60 * 60 * 1_000;
/** Open file tabs per connection/location/file, so one renewal serves them all. */
const watches = new Map<string, { refs: number; stop: () => void }>();

function retainWatch(connectionID: string, directory: string, path: string): () => void {
  const key = JSON.stringify([connectionID, directory, path]);
  const existing = watches.get(key);
  if (existing) {
    existing.refs += 1;
  } else {
    const input = { location: { directory }, path };
    // Watch routes are optional on older servers. Fail silently.
    const renew = () =>
      void openCodeClient(connectionID)
        .experimental.file.watch(input)
        .catch(() => undefined);
    const unsubscribe = palot.subscribe((batch) => {
      if (
        batch.connectionID === connectionID &&
        batch.events.some((event) => event.type === "server.connected")
      )
        renew();
    });
    const timer = window.setInterval(renew, REFRESH_MS);
    watches.set(key, {
      refs: 1,
      stop: () => {
        unsubscribe();
        window.clearInterval(timer);
      },
    });
    renew();
  }
  return () => {
    const watch = watches.get(key);
    if (!watch || --watch.refs > 0) return;
    // Stop renewing, but never unwatch: OpenCode keeps one watch per file for every client, so
    // unwatching would end another Palot window's (or app's) live updates. Unrenewed watches
    // expire after 24 hours, and the server drops the soonest-expiring one past 256 per location.
    watch.stop();
    watches.delete(key);
  };
}

/** One server watch per connection/location/file, shared by visible file tabs. */
export function useFileWatch(location: LocationRef, path: string, enabled = true): void {
  const runtime = useAtomValue(runtimeAtom);
  const directory = location.directory;
  const relativePath = workspaceRelativePath(directory, path);
  const connectionID = runtime?.connectionID;
  const version = runtime?.version?.match(/^(\d+)\.(\d+)\./);
  const supported =
    !version || Number(version[1]) > 2 || (Number(version[1]) === 2 && Number(version[2]) >= 2);
  const active = enabled && supported && canFetchOpenCode(runtime);

  useEffect(() => {
    if (!active || !connectionID || !directory || !relativePath) return;
    return retainWatch(connectionID, directory, relativePath);
  }, [active, connectionID, directory, relativePath]);
}
