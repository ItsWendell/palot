import { useCallback } from "react";
import { useStore } from "jotai";
import type { OpenCodeRuntimeStatus, PalotMessage } from "../../shared";
import { composerDraftAtomFamily } from "../atoms/ui";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { runtimeAtom } from "../atoms/workspace";
import { composerDraftFromMessage, composerFilesFromMessage } from "../lib/composer-restoration";
import { composerScope } from "../lib/composer-scope";
import { palot } from "../services/palot";
import { usePalotNavigation } from "./use-navigation";
import { useCacheSession } from "./use-session-catalog";

export function useSessionFork(owner?: OpenCodeRuntimeStatus | null) {
  const store = useStore();
  const cacheSession = useCacheSession(owner);
  const { openSession } = usePalotNavigation();

  return useCallback(
    async (input: { sessionID: string; beforeMessageID?: string; restore?: PalotMessage }) => {
      const origin = owner === undefined ? store.get(runtimeAtom) : owner;
      if (owner !== undefined && (!origin?.connected || origin.phase !== "connected")) {
        throw new Error("The task's connection is unavailable");
      }
      const profileID = origin?.profileID;
      const connectionID = origin?.connectionID;
      const restored = input.restore
        ? {
            draft: composerDraftFromMessage(input.restore),
            files: composerFilesFromMessage(input.restore).files,
          }
        : null;
      const request = {
        sessionID: input.sessionID,
        beforeMessageID: input.beforeMessageID,
      };
      const forked = await palot.forkSession(request, connectionID);
      const currentRuntime = store.get(runtimeAtom);
      if (
        owner === undefined &&
        (currentRuntime?.profileID !== profileID || currentRuntime?.connectionID !== connectionID)
      ) {
        throw new Error(
          "The connection changed while forking. The fork remains on the original connection; its draft was not restored here.",
        );
      }
      cacheSession(forked);
      if (restored) {
        const scope = composerScope(profileID, `session:${forked.id}`);
        store.set(composerDraftAtomFamily(scope), restored.draft);
        store.set(composerStateAtomFamily(scope), (current) => ({
          ...current,
          files: restored.files,
          edit: null,
          sending: false,
          cancelingID: null,
        }));
      }
      await openSession(forked.id, { profileID });
      return forked;
    },
    [cacheSession, openSession, owner, store],
  );
}
