import type { PalotSession } from "../../shared";

type UnreadFields = Pick<PalotSession, "idleAt" | "viewedAt">;

/** OpenCode's unread state: the task went idle after it was last viewed. */
export function serverSessionIsUnread(session: UnreadFields | null | undefined): boolean {
  if (session?.idleAt === undefined) return false;
  return session.viewedAt === undefined || session.viewedAt < session.idleAt;
}

export interface TaskUnreadOptions {
  /** Marked unread in Palot. OpenCode has no way to mark a task unread, so the mark is local. */
  marked?: boolean;
  /**
   * The task is open. OpenCode's unread state is acknowledged on open, so it does not show;
   * a Palot mark still does until the task is opened again.
   */
  selected?: boolean;
}

/** The one unread predicate every surface uses, so rows, filters, ordering and menus agree. */
export function taskIsUnread(
  session: UnreadFields | null | undefined,
  { marked = false, selected = false }: TaskUnreadOptions = {},
): boolean {
  return marked || (!selected && serverSessionIsUnread(session));
}

/** Marked-unread tasks kept across launches; the oldest marks drop first. */
export const MAX_UNREAD_MARKS = 500;

/** When each task was marked unread, by `unreadMarkKey`. */
export type UnreadMarks = Readonly<Record<string, number>>;

export function unreadMarkKey(profileID: string, sessionID: string): string {
  return JSON.stringify([profileID, sessionID]);
}

export function hasUnreadMark(marks: UnreadMarks, key: string): boolean {
  return Object.hasOwn(marks, key);
}

export function addUnreadMark(marks: UnreadMarks, key: string, now = Date.now()): UnreadMarks {
  const next: Record<string, number> = { ...marks, [key]: now };
  const keys = Object.keys(next);
  if (keys.length <= MAX_UNREAD_MARKS) return next;
  const kept = keys.sort((a, b) => next[b]! - next[a]!).slice(0, MAX_UNREAD_MARKS);
  return Object.fromEntries(kept.map((kept) => [kept, next[kept]!]));
}

/** Returns `marks` itself when nothing changes, so callers can skip the write. */
export function removeUnreadMark(marks: UnreadMarks, key: string): UnreadMarks {
  if (!hasUnreadMark(marks, key)) return marks;
  const next = { ...marks };
  delete next[key];
  return next;
}

export function validUnreadMarks(value: unknown): value is UnreadMarks {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (markedAt) => typeof markedAt === "number" && Number.isFinite(markedAt),
    )
  );
}
