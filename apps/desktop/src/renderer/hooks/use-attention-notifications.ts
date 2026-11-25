import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { sessionCatalogReadyAtom } from "../atoms/inbox";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { useAttentionItems } from "./use-attention-items";

/**
 * A system notification for each request that arrives while the window is not focused, on the
 * focused server. Requests already waiting when the catalog loads, or when another server
 * takes focus, do not notify. Runs once per
 * window, whatever the task list shows.
 */
export function useAttentionNotifications(): void {
  const attentionItems = useAttentionItems();
  const catalogReady = useAtomValue(sessionCatalogReadyAtom);
  const connectionID = useAtomValue(runtimeAtom)?.connectionID ?? null;
  const knownAttentionKeys = useRef<Set<string> | null>(null);
  const baselineFor = useRef<string | null>(null);
  useEffect(() => {
    if (!catalogReady || baselineFor.current !== connectionID) {
      knownAttentionKeys.current = null;
      baselineFor.current = catalogReady ? connectionID : null;
      if (!catalogReady) return;
    }
    const currentKeys = new Set(attentionItems.flatMap((item) => item.requestKeys));
    const known = knownAttentionKeys.current;
    if (known && !document.hasFocus()) {
      for (const item of attentionItems) {
        const request = item.requests.find((candidate) => !known.has(candidate.key));
        if (request) {
          void palot.showAttentionNotification({
            sessionID: request.sessionID,
            requestID: request.id,
            type: request.type,
          });
        }
      }
    }
    knownAttentionKeys.current = currentKeys;
  }, [attentionItems, catalogReady, connectionID]);
}
