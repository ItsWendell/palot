import { useAtom, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect } from "react";
import type { AutomationCommand } from "../../shared";
import {
  automationErrorAtom,
  automationLoadingAtom,
  automationSnapshotAtom,
} from "../atoms/automations";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";

type AutomationActionCommand = AutomationCommand extends infer Command
  ? Command extends { profileID: string }
    ? Omit<Command, "profileID">
    : never
  : never;

let refreshGeneration = 0;

export function useAutomations(synchronize = true) {
  const [snapshot, setSnapshot] = useAtom(automationSnapshotAtom);
  const [loading, setLoading] = useAtom(automationLoadingAtom);
  const [error, setError] = useAtom(automationErrorAtom);
  const setRuntime = useSetAtom(runtimeAtom);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration;
    setLoading(true);
    setError(null);
    try {
      const runtime = await palot.runtimeStatus();
      if (generation !== refreshGeneration) return null;
      setRuntime(runtime);
      const value = await palot.loadAutomations(runtime.profileID);
      if (generation !== refreshGeneration) return null;
      startTransition(() => setSnapshot(value));
      return value;
    } catch (cause) {
      if (generation === refreshGeneration) {
        setError(cause instanceof Error ? cause.message : "Could not load scheduled tasks");
      }
      return null;
    } finally {
      if (generation === refreshGeneration) setLoading(false);
    }
  }, [setError, setLoading, setRuntime, setSnapshot]);

  const dispatch = useCallback(
    async (command: AutomationActionCommand) => {
      const runtime = await palot.runtimeStatus();
      const value = await palot.dispatchAutomation({
        ...command,
        profileID: runtime.profileID,
      } as AutomationCommand);
      startTransition(() => setSnapshot(value));
      return value;
    },
    [setSnapshot],
  );

  useEffect(() => {
    if (!synchronize) return;
    void refresh();
    return palot.onAutomationChanged(() => void refresh());
  }, [refresh, synchronize]);

  return { snapshot, loading, error, refresh, dispatch };
}
