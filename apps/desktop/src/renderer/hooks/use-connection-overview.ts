import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  discoverProfilesAtom,
  discoveredProfileIDsAtom,
  disabledProfileIDsAtom,
  includedProfileIDsAtom,
  visibleProfileIDsAtom,
} from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { connectionOverview } from "../lib/connection-overview";
import { setFocusedOpenCodeRuntime } from "../services/opencode-client";

export type { ConnectionOverview, OverviewTriageCommand } from "../lib/connection-overview";

export function useConnectionOverview() {
  const controller = connectionOverview(useQueryClient());
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [includedProfileIDs, setIncludedProfileIDs] = useAtom(includedProfileIDsAtom);
  const [visibleProfileIDs, setVisibleProfileIDs] = useAtom(visibleProfileIDsAtom);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const search = useCallback(
    async (text: string) => {
      const generation = ++searchGeneration.current;
      setSearching(true);
      try {
        await controller.search(text);
      } finally {
        if (generation === searchGeneration.current) setSearching(false);
      }
    },
    [controller],
  );
  return {
    connections,
    includedProfileIDs,
    visibleProfileIDs,
    setIncludedProfileIDs,
    setVisibleProfileIDs,
    connect: controller.connect,
    refresh: controller.refresh,
    loadMore: controller.loadMore,
    loadProject: controller.loadProject,
    dispatch: controller.dispatch,
    rename: controller.rename,
    archive: controller.archive,
    search,
    searching,
  };
}

/** Mounted once, independently of the selected task or sidebar visibility. */
export function useConnectionOverviewController() {
  const controller = connectionOverview(useQueryClient());
  const runtime = useAtomValue(runtimeAtom);
  const setRuntime = useSetAtom(runtimeAtom);
  const included = useAtomValue(includedProfileIDsAtom);
  const discovered = useAtomValue(discoveredProfileIDsAtom);
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const discoverProfiles = useSetAtom(discoverProfilesAtom);
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const triage = useAtomValue(sessionTriageSnapshotAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => controller.start(), [controller]);
  useEffect(() => {
    if (!runtime || connections.length === 0) return;
    discoverProfiles({
      ids: connections.map((entry) => entry.profile.id),
      activeProfileID: runtime.profileID,
    });
  }, [runtime?.profileID, connections, discoverProfiles]);
  useEffect(() => {
    if (discovered !== null) controller.setIncluded(included);
  }, [controller, included, discovered]);
  useEffect(() => {
    if (!runtime) return;
    const entry = connections.find((entry) => entry.profile.id === runtime.profileID);
    const next = disabled.includes(runtime.profileID)
      ? { ...runtime, connected: false, phase: "stopped" as const }
      : runtime.phase === "stopped" &&
          included.includes(runtime.profileID) &&
          entry?.phase === "ready" &&
          entry.runtime?.connected
        ? entry.runtime
        : null;
    // Registry snapshots may predate the focused connection's successful startup.
    // Live status belongs to the workspace; adopt overview state only when a
    // deliberately stopped profile has finished enabling again.
    if (!next || JSON.stringify(next) === JSON.stringify(runtime)) return;
    setFocusedOpenCodeRuntime(next);
    setRuntime(next);
  }, [runtime, connections, disabled, included, setRuntime]);
  useEffect(() => {
    void controller.refreshRegistry().catch(() => undefined);
  }, [controller, pathname]);
  useEffect(() => {
    if (triage) controller.acceptTriage(triage);
  }, [controller, triage]);
  useEffect(() => {
    const refresh = () => {
      void controller.refreshRegistry().catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("palot:profiles-changed", refresh);
    const timer = setInterval(() => controller.tick(), 1_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("palot:profiles-changed", refresh);
      clearInterval(timer);
    };
  }, [controller]);
}
