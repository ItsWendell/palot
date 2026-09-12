import { queryOptions } from "@tanstack/react-query";
import type { PalotSession } from "../../shared";
import { locationDiffsQueryOptions, useLocationDiffs } from "./use-location-diffs";

type SessionDiffRef = Pick<PalotSession, "id" | "location">;

export function sessionDiffsQueryOptions(
  connectionID: string,
  session: SessionDiffRef,
  enabled = true,
) {
  return queryOptions({
    ...locationDiffsQueryOptions(connectionID, session.location),
    enabled,
  });
}

export function useSessionDiffs(session: PalotSession | null, enabled = true) {
  return useLocationDiffs(session?.location ?? { directory: "" }, Boolean(session && enabled));
}
