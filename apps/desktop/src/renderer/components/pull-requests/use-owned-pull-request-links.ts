import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { PullRequestLink } from "../../../shared/source-control-contract";
import {
  sourceControl,
  sourceControlKeys,
  useSourceControlEvent,
} from "../../hooks/use-source-control";

const EMPTY = new Map<string, ReadonlyMap<string, PullRequestLink[]>>();

/**
 * PR links for several local profiles at once (the multi-connection sidebar), keyed
 * by profile and then session. Shares each profile's cache entry with
 * `usePullRequestLinks`, so one query per profile backs every list and task control.
 * Remote profiles are unsupported and must not be passed.
 */
export function useOwnedPullRequestLinks(
  profileIDs: readonly string[],
): ReadonlyMap<string, ReadonlyMap<string, PullRequestLink[]>> {
  const queryClient = useQueryClient();
  useSourceControlEvent((event) => {
    if (event.type !== "pull-requests" || !profileIDs.includes(event.profileID)) return;
    // Another mounted links hook may already be refetching for the same event.
    void queryClient.invalidateQueries(
      { queryKey: sourceControlKeys.links(event.profileID) },
      { cancelRefetch: false },
    );
  });
  return useQueries({
    queries: profileIDs.map((profileID) => ({
      queryKey: sourceControlKeys.links(profileID),
      queryFn: () => sourceControl.listPullRequestLinks({ profileID }),
      staleTime: 30_000,
    })),
    combine: (results) => {
      if (results.every((result) => !result.data?.length)) return EMPTY;
      const byProfile = new Map<string, ReadonlyMap<string, PullRequestLink[]>>();
      results.forEach((result, index) => {
        const profileID = profileIDs[index];
        if (!profileID || !result.data?.length) return;
        const bySession = new Map<string, PullRequestLink[]>();
        for (const link of result.data)
          bySession.set(link.sessionID, [...(bySession.get(link.sessionID) ?? []), link]);
        byProfile.set(profileID, bySession);
      });
      return byProfile;
    },
  });
}
