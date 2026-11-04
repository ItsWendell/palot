import { isForbiddenError, type ArtifactInfo } from "@opencode/client";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeClient } from "../services/opencode-client";

/**
 * The project's published artifacts, newest update first. Artifacts belong to a project, and an
 * update from another task moves one to that task, so cards match by ID across the project.
 * "unavailable" when the server has no artifact routes or `experimental.artifacts` is off for
 * the location; cards then show what the tool call recorded.
 */
export function locationArtifactsQueryOptions(
  connectionID: string,
  directory: string,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.artifactsLocation(connectionID, directory),
    queryFn: async ({ signal }): Promise<readonly ArtifactInfo[] | "unavailable"> => {
      try {
        const result = await openCodeClient(connectionID).experimental.artifacts.list(
          { location: { directory } },
          { signal },
        );
        return result.data;
      } catch (error) {
        if (isForbiddenError(error) || isMissingOpenCodeRoute(error)) return "unavailable";
        throw error;
      }
    },
    enabled: enabled && Boolean(directory),
    staleTime: 30_000,
    retry: false,
  });
}

export function useLocationArtifacts(connectionID: string, directory: string, enabled: boolean) {
  const query = useQuery(locationArtifactsQueryOptions(connectionID, directory, enabled));
  return {
    artifacts: query.data === "unavailable" ? undefined : query.data,
    unavailable: query.data === "unavailable",
    loaded: query.isSuccess,
  };
}
