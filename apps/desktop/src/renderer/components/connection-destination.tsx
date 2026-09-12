import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { CloudOff } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import { ConnectionBadge, connectionDescription } from "./connection-badge";

/** Keep the execution owner visible without subscribing the composer to background tasks. */
export function ConnectionDestination() {
  const runtime = useAtomValue(runtimeAtom);
  const controller = connectionOverview(useQueryClient());
  const select = useCallback(() => {
    return controller.getSnapshot().find((entry) => entry.profile.id === runtime?.profileID)
      ?.profile;
  }, [controller, runtime?.profileID]);
  const profile = useSyncExternalStore(controller.subscribe, select, select);
  if (!profile || (profile.kind === "local" && runtime?.connected)) return null;
  if (!runtime?.connected) {
    return (
      <span
        role="status"
        title={`${connectionDescription(profile)} · Reconnect to send messages`}
        className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 px-1.5 text-meta text-warning"
      >
        <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{profile.name}</span>
        <span className="shrink-0"> · Offline</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 min-w-0 items-center px-1.5"
      aria-label={`Execution connection: ${profile.name}`}
    >
      <ConnectionBadge profile={profile} connected />
    </span>
  );
}
