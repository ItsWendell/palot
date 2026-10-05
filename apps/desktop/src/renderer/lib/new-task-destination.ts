import type { OpenCodeProfile, OpenCodeRuntimeStatus, PalotProject } from "../../shared";
import type { ConnectionOverview } from "./connection-overview";
import type { ProjectRouteSearch } from "./route-search";

export interface NewTaskDestination {
  profileID: string;
  projectID: string | null;
}

export function destinationKey(profileID: string, project: PalotProject | null): string {
  return JSON.stringify([profileID, project?.id || project?.canonical || null]);
}

export function destinationGroups(
  connections: readonly ConnectionOverview[],
  focusedProfileID?: string,
  focusedProjects: readonly PalotProject[] = [],
) {
  return connections.map((entry) => ({
    ...entry,
    // The focused catalog can hydrate before the overview's background catalog.
    projects:
      entry.profile.id === focusedProfileID && focusedProjects.length > 0
        ? [...focusedProjects]
        : entry.projects,
  }));
}

export function assertNewTaskOwner(
  expected: Pick<OpenCodeRuntimeStatus, "connectionID" | "profileID"> | null,
  current: OpenCodeRuntimeStatus | null,
  profileID: string | undefined,
  disabledProfileIDs: readonly string[],
): asserts current is OpenCodeRuntimeStatus {
  if (!expected || !current?.connected || disabledProfileIDs.includes(current.profileID))
    throw new Error("Reconnect to the selected server to create this task.");
  if (
    current.connectionID !== expected.connectionID ||
    current.profileID !== expected.profileID ||
    (profileID !== undefined && current.profileID !== profileID)
  )
    throw new Error("The server connection changed. Try creating the task again.");
}

export function resolveNewTaskDestination({
  projectID,
  profileID,
  focusedProfileID,
  remembered,
  profiles,
  disabledProfileIDs,
}: {
  projectID?: string;
  profileID?: string;
  focusedProfileID?: string;
  remembered: NewTaskDestination | null;
  profiles: readonly Pick<OpenCodeProfile, "id" | "kind">[];
  disabledProfileIDs: readonly string[];
}): ProjectRouteSearch {
  // Explicit destinations belong to their supplied (or focused) server, even if unavailable.
  if (projectID !== undefined || profileID !== undefined)
    return { projectID, profileID: profileID ?? focusedProfileID };

  if (
    remembered &&
    !disabledProfileIDs.includes(remembered.profileID) &&
    (profiles.length === 0 || profiles.some((profile) => profile.id === remembered.profileID))
  )
    return { profileID: remembered.profileID, projectID: remembered.projectID ?? undefined };

  // Never let browsing a remote session become the implicit new-task owner.
  const local = profiles.find(
    (profile) => profile.kind === "local" && !disabledProfileIDs.includes(profile.id),
  );
  return { profileID: local?.id ?? "local-default" };
}
