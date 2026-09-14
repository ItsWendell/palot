import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect } from "react";
import type { AutomationCommand } from "../../shared";
import {
  automationErrorAtom,
  automationErrorsByProfileAtom,
  automationLoadingAtom,
  automationLoadingByProfileAtom,
  automationSnapshotAtom,
  automationSnapshotsAtom,
} from "../atoms/automations";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";

type AutomationActionCommand = AutomationCommand extends infer Command
  ? Command extends { profileID: string }
    ? Omit<Command, "profileID">
    : never
  : never;

const generations = new WeakMap<ReturnType<typeof useStore>, Map<string, number>>();

export function useAutomations(synchronize = true) {
  const store = useStore();
  const snapshot = useAtomValue(automationSnapshotAtom);
  const loading = useAtomValue(automationLoadingAtom);
  const error = useAtomValue(automationErrorAtom);
  const profileID = useAtomValue(runtimeAtom)?.profileID;

  const refresh = useCallback(async () => {
    if (!profileID) return null;
    let versions = generations.get(store);
    if (!versions) generations.set(store, (versions = new Map()));
    const generation = (versions.get(profileID) ?? 0) + 1;
    versions.set(profileID, generation);
    store.set(automationLoadingByProfileAtom, (current) => ({ ...current, [profileID]: true }));
    store.set(automationErrorsByProfileAtom, (current) => ({ ...current, [profileID]: null }));
    try {
      const value = await palot.loadAutomations(profileID);
      if (versions.get(profileID) !== generation) return null;
      store.set(automationSnapshotsAtom, (current) => ({ ...current, [profileID]: value }));
      return value;
    } catch (cause) {
      if (versions.get(profileID) === generation)
        store.set(automationErrorsByProfileAtom, (current) => ({
          ...current,
          [profileID]: cause instanceof Error ? cause.message : "Could not load scheduled tasks",
        }));
      return null;
    } finally {
      if (versions.get(profileID) === generation)
        store.set(automationLoadingByProfileAtom, (current) => ({
          ...current,
          [profileID]: false,
        }));
    }
  }, [profileID, store]);

  const dispatch = useCallback(
    async (command: AutomationActionCommand) => {
      if (!profileID) throw new Error("Select a server before editing scheduled tasks.");
      const value = await palot.dispatchAutomation({ ...command, profileID } as AutomationCommand);
      // Invalidate older reads without changing another profile's selection or data.
      const versions = generations.get(store);
      versions?.set(profileID, (versions.get(profileID) ?? 0) + 1);
      store.set(automationLoadingByProfileAtom, (current) => ({ ...current, [profileID]: false }));
      store.set(automationSnapshotsAtom, (current) => ({ ...current, [profileID]: value }));
      return value;
    },
    [profileID, store],
  );

  useEffect(() => {
    if (!synchronize || !profileID) return;
    void refresh();
    return palot.onAutomationChanged((event) => {
      if (event.profileID === profileID) void refresh();
    });
  }, [refresh, synchronize, profileID]);

  return { snapshot, loading, error, refresh, dispatch };
}
