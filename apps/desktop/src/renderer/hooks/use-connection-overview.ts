import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { includedProfileIDsAtom, visibleProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { connectionOverview } from "../lib/connection-overview";

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
  const [included, setIncluded] = useAtom(includedProfileIDsAtom);
  const triage = useAtomValue(sessionTriageSnapshotAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => controller.start(), [controller]);
  useEffect(() => {
    if (runtime && !included.includes(runtime.profileID)) {
      setIncluded((current) =>
        current.includes(runtime.profileID) ? current : [...current, runtime.profileID],
      );
    }
  }, [runtime?.profileID, included, setIncluded]);
  useEffect(() => {
    controller.setIncluded(included);
  }, [controller, included]);
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
