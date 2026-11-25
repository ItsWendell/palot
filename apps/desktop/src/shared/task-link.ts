/**
 * `palot://task/<id>` links: they open a task from outside Palot (another app, a note, the
 * shell). Links come from anywhere, so parsing accepts exactly the shape Palot writes and
 * nothing else; anything off returns null and is ignored.
 */

export const PALOT_PROTOCOL = "palot";

const SESSION_ID = /^ses_[A-Za-z0-9]{26}$/;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_LINK_LENGTH = 512;

export interface TaskLink {
  sessionID: string;
  /** The Palot server profile the task was on when the link was made. */
  profileID?: string;
}

export function isTaskLinkSessionID(value: string): boolean {
  return SESSION_ID.test(value);
}

/** The link for a task; the profile is added when it is a valid id. */
export function taskLink(sessionID: string, profileID?: string | null): string {
  if (!SESSION_ID.test(sessionID)) throw new Error("Not a complete OpenCode session ID");
  const base = `${PALOT_PROTOCOL}://task/${sessionID}`;
  return profileID && PROFILE_ID.test(profileID)
    ? `${base}?profile=${encodeURIComponent(profileID)}`
    : base;
}

/** Whether a launch argument is meant as a Palot link at all (valid or not). */
export function isPalotLink(value: string): boolean {
  return value.toLowerCase().startsWith(`${PALOT_PROTOCOL}:`);
}

/**
 * `palot://task/<session-id>` with an optional `?profile=<id>`; null for anything else:
 * other hosts, extra path segments, credentials, ports, fragments, unknown or repeated
 * parameters, and ids that are not a complete OpenCode session ID.
 */
export function parseTaskLink(value: string): TaskLink | null {
  if (value.length > MAX_LINK_LENGTH || /[\s\0#]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${PALOT_PROTOCOL}:`) return null;
  if (url.username || url.password || url.port || url.hash) return null;
  if (url.hostname !== "task") return null;
  const segments = url.pathname.split("/");
  if (segments.length !== 2 || segments[0] !== "") return null;
  const sessionID = segments[1]!;
  if (!SESSION_ID.test(sessionID)) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "profile") || keys.length > 1) return null;
  const profileID = url.searchParams.get("profile");
  if (profileID === null) return value.includes("?") ? null : { sessionID };
  return PROFILE_ID.test(profileID) ? { sessionID, profileID } : null;
}
