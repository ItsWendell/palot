import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";

/**
 * Without `context` the patches are full-file, as the Turn changes tab shows them. A context
 * request is cached separately because its patches differ.
 */
export function turnDiffsQueryOptions(
  connectionID: string,
  sessionID: string,
  userMessageID: string,
  context?: number,
) {
  return queryOptions({
    queryKey: [
      ...openCodeKeys.session(connectionID, sessionID),
      "turn-diff",
      userMessageID,
      ...(context !== undefined ? [{ context }] : []),
    ],
    queryFn: ({ signal }) =>
      context !== undefined
        ? palot.listTurnDiffs(sessionID, userMessageID, signal, connectionID, context)
        : palot.listTurnDiffs(sessionID, userMessageID, signal, connectionID),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useTurnDiffs(
  profileID: string,
  sessionID: string,
  userMessageID: string,
  active: boolean,
  context?: number,
) {
  const runtime = useAtomValue(runtimeAtom);
  const available = Boolean(runtime?.connected && runtime.profileID === profileID);
  const query = useQuery({
    ...turnDiffsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      sessionID,
      userMessageID,
      context,
    ),
    enabled: available && active,
  });
  return { ...query, available };
}
