import { useCallback, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  approvalPresetRules,
  sessionApprovalMode,
  type ApprovalPreset,
} from "../lib/session-permissions";
import { palot } from "../services/palot";
import { patchSession } from "../lib/session-catalog-query";
import { openCodeReconciler } from "../lib/open-code-reconciler";

export function useComposerPermissions(session: PalotSession, draft: boolean, scope: string) {
  const runtime = useAtomValue(runtimeAtom);
  const store = useStore();
  const queryClient = useQueryClient();
  const identity = JSON.stringify([runtime?.connectionID, scope]);
  const [selection, setSelection] = useState<{ identity: string; mode: ApprovalPreset }>({
    identity,
    mode: "normal",
  });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Never carry an elevated draft preset into another thread/project/connection.
  if (selection.identity !== identity) setSelection({ identity, mode: "normal" });

  const draftMode = selection.identity === identity ? selection.mode : "normal";
  const assertReady = useCallback(() => {
    if (inFlight.current)
      throw new Error("Wait for the permission change to finish before sending.");
  }, []);

  const select = useCallback(
    async (mode: ApprovalPreset) => {
      assertReady();
      const current = store.get(runtimeAtom);
      if (
        !current?.connected ||
        current.connectionID !== runtime?.connectionID ||
        current.profileID !== runtime?.profileID
      ) {
        throw new Error("The server connection changed. Select permissions again.");
      }
      if (draft) {
        setSelection({ identity, mode });
        return;
      }
      inFlight.current = true;
      setBusy(true);
      const connectionID = current.connectionID;
      const previous = openCodeReconciler(queryClient).session(
        connectionID,
        session.id,
      )?.permissions;
      const permissions = approvalPresetRules(mode);
      try {
        await palot.setSessionPermissions(
          {
            sessionID: session.id,
            permissions,
          },
          connectionID,
        );
        // An ACK has no sequence. Never overwrite a rules event received during the request.
        // Patch only this field, against the captured connection, not a stale session snapshot.
        patchSession(queryClient, connectionID, session.id, (value) =>
          value.permissions === previous ? { ...value, permissions } : value,
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [
      assertReady,
      store,
      runtime?.connected,
      runtime?.connectionID,
      runtime?.profileID,
      draft,
      identity,
      session.id,
      queryClient,
    ],
  );

  const isBusy = useCallback(() => inFlight.current, []);
  const resetDraft = useCallback(() => setSelection({ identity, mode: "normal" }), [identity]);

  return {
    mode: draft ? draftMode : sessionApprovalMode(session.permissions),
    draftMode,
    busy,
    isBusy,
    select,
    assertReady,
    resetDraft,
  };
}
