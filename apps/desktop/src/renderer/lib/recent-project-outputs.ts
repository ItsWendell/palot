/**
 * Files recently changed or produced by tasks whose transcripts are loaded in this window, for
 * the composer's "Recent outputs" picker. Only tasks on the same connection and project are read,
 * and an output is offered as a workspace `@file` mention only when it lies inside the composer's
 * own location, so OpenCode revalidates the path when the prompt is sent. No bytes are replayed.
 */

import type { LocationRef } from "@opencode/client";
import type { PalotMessage, PalotSession } from "../../shared";
import { projectToolExecution } from "./tool-executions";
import { projectTranscriptTurns } from "./turn-projection";
import { isTool } from "./view-models";

export const MAX_RECENT_OUTPUT_TASKS = 20;
export const MAX_RECENT_OUTPUTS_PER_TASK = 12;

export interface LoadedTask {
  connectionID: string;
  session: PalotSession;
  messages: readonly PalotMessage[];
}

export interface RecentProjectOutput {
  /** Unique within the picker. */
  key: string;
  kind: "changed" | "produced";
  /** Absolute path on the task's server. */
  absolutePath: string;
  /** Path relative to the composer's location, or null when it lies elsewhere. */
  path: string | null;
  name: string;
  at: number;
  userMessageID: string | null;
}

export interface RecentProjectOutputTask {
  sessionID: string;
  title: string;
  updatedAt: number;
  outputs: RecentProjectOutput[];
}

function normalizePath(path: string): string | null {
  const value = path.replaceAll("\\", "/");
  if (!value || value.includes("\0")) return null;
  const absolute = value.startsWith("/")
    ? "/"
    : /^[A-Za-z]:\//.test(value)
      ? value.slice(0, 3)
      : "";
  if (!absolute) return null;
  const parts: string[] = [];
  for (const part of value.slice(absolute.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return absolute + parts.join("/");
}

/** Resolves a tool path against the task's directory; relative paths never escape it. */
export function resolveTaskPath(directory: string, path: string): string | null {
  const value = path.replaceAll("\\", "/");
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return normalizePath(value);
  if (value.split("/").includes("..")) return null;
  return normalizePath(`${directory.replaceAll("\\", "/").replace(/\/+$/, "")}/${value}`);
}

/** Relative path inside `directory`, or null when the path is the directory itself or outside it. */
export function pathInsideDirectory(directory: string, absolutePath: string): string | null {
  const root = normalizePath(directory);
  const target = normalizePath(absolutePath);
  if (!root || !target) return null;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return target.startsWith(prefix) && target.length > prefix.length
    ? target.slice(prefix.length)
    : null;
}

function fileUriPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    const path = decodeURIComponent(new URL(uri).pathname);
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

function taskOutputs(
  task: LoadedTask,
  location: LocationRef,
): { outputs: RecentProjectOutput[]; lastAt: number } {
  const byPath = new Map<string, RecentProjectOutput>();
  let lastAt = 0;
  const add = (
    kind: RecentProjectOutput["kind"],
    rawPath: string,
    at: number,
    userMessageID: string | null,
  ) => {
    const absolutePath = resolveTaskPath(task.session.location.directory, rawPath);
    if (!absolutePath) return;
    lastAt = Math.max(lastAt, at);
    const previous = byPath.get(absolutePath);
    if (previous && previous.at > at) return;
    byPath.set(absolutePath, {
      // Picker keys must not contain NUL; it separates section and option keys.
      key: `${task.session.id}:${absolutePath}`,
      kind: previous?.kind === "changed" ? "changed" : kind,
      absolutePath,
      path: pathInsideDirectory(location.directory, absolutePath),
      name: absolutePath.split("/").at(-1) ?? absolutePath,
      at,
      userMessageID,
    });
  };

  // Prompts and their responses project as neighbouring turns; outputs point at the prompt.
  let promptID: string | null = null;
  for (const turn of projectTranscriptTurns([...task.messages])) {
    if (turn.user?.type === "user") promptID = turn.user.id;
    // Only settled turns: running work may still rewrite or delete what it touched.
    if (turn.status === "working") continue;
    const userMessageID = turn.user?.id ?? promptID;
    const at = turn.completedAt ?? turn.workCompletedAt ?? turn.startedAt;
    for (const item of turn.postFinal) {
      const path = item.kind === "file" && item.uri ? fileUriPath(item.uri) : null;
      if (path) add("produced", path, at, userMessageID);
    }
    for (const group of turn.activity) {
      for (const entry of group.entries) {
        if (!isTool(entry.part)) continue;
        const execution = projectToolExecution(entry.part, entry.index);
        if (execution.kind !== "file-change" || execution.status !== "complete") continue;
        const deleted = new Set(
          execution.files.filter((file) => file.status === "deleted").map((file) => file.file),
        );
        for (const file of execution.targetFiles) {
          if (!deleted.has(file)) add("changed", file, at, userMessageID);
        }
      }
    }
  }
  const outputs = [...byPath.values()]
    .toSorted((left, right) => right.at - left.at || left.name.localeCompare(right.name))
    .slice(0, MAX_RECENT_OUTPUTS_PER_TASK);
  return { outputs, lastAt };
}

/**
 * Outputs from loaded tasks of the composer's project, newest task first. Tasks on another
 * connection or project are ignored even when present in the input.
 */
export function collectRecentProjectOutputs(input: {
  connectionID: string;
  projectID: string;
  location: LocationRef;
  tasks: readonly LoadedTask[];
  projectOf(session: PalotSession): string;
}): RecentProjectOutputTask[] {
  return input.tasks
    .filter(
      (task) =>
        task.connectionID === input.connectionID &&
        task.messages.length > 0 &&
        input.projectOf(task.session) === input.projectID,
    )
    .flatMap((task) => {
      const { outputs, lastAt } = taskOutputs(task, input.location);
      return outputs.length > 0
        ? [
            {
              sessionID: task.session.id,
              title: task.session.title || "Untitled task",
              updatedAt: lastAt,
              outputs,
            },
          ]
        : [];
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_OUTPUT_TASKS);
}
