import type { QueryClient } from "@tanstack/react-query";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { sessionTranscriptQueryOptions, transcriptQueryKey } from "../hooks/use-session-transcript";
import { registerOpenCodeRuntime } from "../services/opencode-client";
import { mapSession } from "../services/opencode-mappers";
import { connectionOverview } from "./connection-overview";
import { openCodeReconciler } from "./open-code-reconciler";
import { canFetchOpenCode } from "./opencode-runtime-query";

/** Click-only optimization. Missing metadata and unavailable owners stay with the route loader. */
export function prefetchSessionNavigation(
  queryClient: QueryClient,
  sessionID: string,
  profileID: string | undefined,
  activeRuntime: OpenCodeRuntimeStatus | null,
  disabledProfileIDs: readonly string[],
): void {
  if (!profileID || disabledProfileIDs.includes(profileID)) return;
  const owner =
    activeRuntime?.profileID === profileID
      ? activeRuntime
      : connectionOverview(queryClient)
          .getSnapshot()
          .find((entry) => entry.profile.id === profileID)?.runtime;
  if (!owner || owner.profileID !== profileID || !canFetchOpenCode(owner)) return;
  // Even invalidated data is warm. Leave refresh policy to the mounted consumer.
  if (queryClient.getQueryData(transcriptQueryKey(owner.connectionID, sessionID)) !== undefined)
    return;
  const info = openCodeReconciler(queryClient).session(owner.connectionID, sessionID);
  if (!info) return;
  registerOpenCodeRuntime(owner);
  void queryClient.prefetchInfiniteQuery(
    sessionTranscriptQueryOptions(queryClient, mapSession(info), owner, true),
  );
}
