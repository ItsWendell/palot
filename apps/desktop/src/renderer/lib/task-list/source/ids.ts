/**
 * Task and project ids in the list are owner-qualified: OpenCode ids are unique per server
 * only, and the list shows every connected server at once. The encoding matches the
 * multi-connection sidebar's row keys, so a key read from one surface means the same task in
 * the other.
 */

export interface TaskOwnerRef {
  /** The OpenCode profile (the list's server id). */
  serverID: string;
  sessionID: string;
}

export function taskID(serverID: string, sessionID: string): string {
  return JSON.stringify([serverID, sessionID]);
}

export function projectKey(serverID: string, projectID: string): string {
  return JSON.stringify([serverID, projectID]);
}

/** The owner of a task or project id, or null for an id this module did not make. */
export function parseTaskID(id: string): TaskOwnerRef | null {
  const pair = parsePair(id);
  return pair ? { serverID: pair[0], sessionID: pair[1] } : null;
}

export function parseProjectKey(id: string): { serverID: string; projectID: string } | null {
  const pair = parsePair(id);
  return pair ? { serverID: pair[0], projectID: pair[1] } : null;
}

function parsePair(id: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(id);
    return Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
      ? [value[0], value[1]]
      : null;
  } catch {
    return null;
  }
}
