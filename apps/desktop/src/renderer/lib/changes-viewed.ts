import { useCallback, useSyncExternalStore } from "react";
import { loadScopedPersistedValue, saveScopedPersistedValue } from "../atoms/persisted";

/**
 * Viewed marks for the Changes tab, per task, review mode and file. A mark remembers the diff it
 * was made on (a fingerprint of the changed lines), so a file whose change moves on reads as
 * "changed since viewed" instead of staying ticked.
 */

/** Path → fingerprint of the diff that was marked viewed. */
export type ViewedMarks = Readonly<Record<string, string>>;

export type ViewedState = "viewed" | "changed" | "unviewed";

const FAMILY = "changes.viewed";
/** Task × mode scopes kept on disk; older ones are evicted. */
const MAX_SCOPES = 100;
const EMPTY: ViewedMarks = Object.freeze({});

const loaded = new Map<string, ViewedMarks>();
const listeners = new Map<string, Set<() => void>>();

function validMarks(value: unknown): value is ViewedMarks {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string")
  );
}

/**
 * The scope a task's marks live in. The same task reviewed as working changes or as a branch
 * keeps separate marks, since the two diffs differ.
 */
export function changesViewedScope(
  profileID: string,
  task: string,
  mode: "working" | "branch",
): string {
  return JSON.stringify([profileID, task, mode]);
}

/**
 * A fingerprint of what a patch changes: its added and removed lines and the file's status.
 * Context lines and hunk positions are left out, so showing more context, or edits elsewhere
 * that only shift line numbers, keep the mark.
 */
export function diffFingerprint(patch: string, status = ""): string {
  let hash = 2_166_136_261;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  add(status);
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-")) add(`\n${line}`);
  }
  return (hash >>> 0).toString(36);
}

export function viewedState(
  marks: ViewedMarks,
  path: string,
  fingerprint: string | undefined,
): ViewedState {
  const mark = marks[path];
  if (mark === undefined) return "unviewed";
  return mark === fingerprint ? "viewed" : "changed";
}

export function loadViewedMarks(scope: string): ViewedMarks {
  let marks = loaded.get(scope);
  if (!marks) {
    marks = loadScopedPersistedValue<ViewedMarks>({
      family: FAMILY,
      scope,
      initialValue: EMPTY,
      validate: validMarks,
      maxEntries: MAX_SCOPES,
    });
    loaded.set(scope, marks);
  }
  return marks;
}

/**
 * Marks a file viewed at a fingerprint, or clears its mark with null. Marks for files no longer
 * in `livePaths` are dropped, so a task's scope never outgrows its current diff.
 */
export function setFileViewed(
  scope: string,
  path: string,
  fingerprint: string | null,
  livePaths?: Iterable<string>,
): void {
  const live = livePaths ? new Set(livePaths) : null;
  const next: Record<string, string> = {};
  for (const [candidate, mark] of Object.entries(loadViewedMarks(scope))) {
    if (candidate === path || (live && !live.has(candidate))) continue;
    next[candidate] = mark;
  }
  if (fingerprint !== null) next[path] = fingerprint;
  loaded.set(scope, next);
  saveScopedPersistedValue(FAMILY, scope, next, MAX_SCOPES);
  listeners.get(scope)?.forEach((notify) => notify());
}

function subscribe(scope: string, notify: () => void): () => void {
  const set = listeners.get(scope) ?? new Set<() => void>();
  set.add(notify);
  listeners.set(scope, set);
  return () => {
    set.delete(notify);
    if (set.size === 0) listeners.delete(scope);
  };
}

export function useViewedMarks(scope: string): ViewedMarks {
  const listen = useCallback((notify: () => void) => subscribe(scope, notify), [scope]);
  const read = useCallback(() => loadViewedMarks(scope), [scope]);
  return useSyncExternalStore(listen, read, read);
}

/** Forgets cached marks; tests use it to read storage again. */
export function resetViewedMarksCache(): void {
  loaded.clear();
}
