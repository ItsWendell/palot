import { atom } from "jotai";
import type { AutomationSnapshot } from "../../shared";
import { runtimeAtom } from "./workspace";

export const automationSnapshotsAtom = atom<Record<string, AutomationSnapshot>>({});
export const automationLoadingByProfileAtom = atom<Record<string, boolean>>({});
export const automationErrorsByProfileAtom = atom<Record<string, string | null>>({});
export const automationSnapshotAtom = atom(
  (get) => get(automationSnapshotsAtom)[get(runtimeAtom)?.profileID ?? ""] ?? null,
);
export const automationLoadingAtom = atom(
  (get) => get(automationLoadingByProfileAtom)[get(runtimeAtom)?.profileID ?? ""] ?? false,
);
export const automationErrorAtom = atom(
  (get) => get(automationErrorsByProfileAtom)[get(runtimeAtom)?.profileID ?? ""] ?? null,
);
export const groupedScheduledSessionIDsAtom = atom((get) => {
  const snapshot = get(automationSnapshotAtom);
  if (!snapshot) return new Set<string>();
  const standaloneIDs = new Set(
    snapshot.automations
      .filter((automation) => automation.destination.type === "standalone")
      .map((automation) => automation.id),
  );
  return new Set(
    snapshot.runs
      .filter(
        (run) =>
          run.rootSessionID &&
          standaloneIDs.has(run.automationID) &&
          run.state !== "needs-attention",
      )
      .map((run) => run.rootSessionID as string),
  );
});
export const automationUnreadCountAtom = atom((get) => {
  const snapshot = get(automationSnapshotAtom);
  return (
    snapshot?.runs.filter(
      (run) =>
        run.readAt === null &&
        run.archivedAt === null &&
        ["succeeded", "failed", "interrupted", "unknown", "needs-attention"].includes(run.state),
    ).length ?? 0
  );
});
