import type { ConnectionOverview } from "./connection-overview";

/**
 * The server profile to open a linked task on. A named profile wins while Palot knows it (or
 * has not listed its servers yet); otherwise the profile whose loaded tasks include the task,
 * else none, which opens it on the active server. Links made on another machine name a profile
 * this one does not have.
 */
export function resolveTaskLinkProfile(
  connections: readonly Pick<ConnectionOverview, "profile" | "sessions">[],
  sessionID: string,
  profileID?: string,
): string | undefined {
  if (
    profileID &&
    (connections.length === 0 ||
      connections.some((connection) => connection.profile.id === profileID))
  )
    return profileID;
  return connections.find((connection) =>
    connection.sessions.some((session) => session.id === sessionID),
  )?.profile.id;
}
