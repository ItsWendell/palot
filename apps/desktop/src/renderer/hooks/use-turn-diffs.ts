import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { palot } from "../services/palot";

export function turnDiffsQueryOptions(
  connectionID: string,
  sessionID: string,
  userMessageID: string,
) {
  return queryOptions({
    queryKey: [...openCodeKeys.session(connectionID, sessionID), "turn-diff", userMessageID],
    queryFn: ({ signal }) => palot.listTurnDiffs(sessionID, userMessageID, signal, connectionID),
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
) {
  const runtime = useAtomValue(runtimeAtom);
  const available = Boolean(runtime?.connected && runtime.profileID === profileID);
  const query = useQuery({
    ...turnDiffsQueryOptions(runtime?.connectionID ?? "disconnected", sessionID, userMessageID),
    enabled: available && active,
  });
  return { ...query, available };
}
