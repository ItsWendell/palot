import type { QueryClient } from "@tanstack/react-query";
import type { PalotProjectDirectory, PalotSession } from "../../../shared";
import type { PullRequestLink, PullRequestSnapshot } from "../../../shared/source-control-contract";
import { createSessionActivitySelector } from "../../hooks/use-session-activity";
import { sourceControl, sourceControlKeys } from "../../hooks/use-source-control";
import type { SessionActivityData } from "../../lib/session-activity-query";
import { getSessionInfo, listActiveSessionIDs } from "../../services/opencode-catalog";
import { getOpenCodeVcsStatus } from "../../services/opencode-vcs";

/** A managed worktree whose tasks' linked pull requests have all merged or closed, with one merged. */
export interface RetirementCandidate {
  directory: string;
  /** The most recently merged linked pull request. */
  pullRequest: PullRequestSnapshot;
  attachedTasks: PalotSession[];
}

function normalizeDirectory(directory: string): string {
  let normalized = directory.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  // Windows drive letters are case-insensitive.
  if (/^[a-z]:/i.test(normalized)) normalized = normalized[0]!.toLowerCase() + normalized.slice(1);
  while (normalized.length > 1 && normalized.endsWith("/") && !/^[a-z]:\/$/i.test(normalized))
    normalized = normalized.slice(0, -1);
  return normalized;
}

/**
 * Whether `path` is `root` or lies inside it. Trailing and doubled separators are ignored,
 * and a sibling that merely shares the prefix (`/wt2` for `/wt`) is not inside.
 */
export function isWithinDirectory(path: string, root: string): boolean {
  const candidate = normalizeDirectory(path);
  const base = normalizeDirectory(root);
  if (candidate === base) return true;
  return candidate.startsWith(base.endsWith("/") ? base : `${base}/`);
}

/** Tasks of the project working in the worktree or any directory inside it. */
export function attachedTasks(
  sessions: readonly PalotSession[],
  projectID: string,
  directory: string,
): PalotSession[] {
  return sessions.filter(
    (session) =>
      session.projectID === projectID && isWithinDirectory(session.location.directory, directory),
  );
}

/**
 * Worktrees whose attached tasks link a merged pull request and nothing still open. The
 * links come from Palot's existing per-profile source control cache; nothing here asks
 * GitHub for more.
 */
export function mergedWorktreeCandidates({
  worktrees,
  sessions,
  projectID,
  linksBySession,
}: {
  worktrees: readonly PalotProjectDirectory[];
  sessions: readonly PalotSession[];
  projectID: string;
  linksBySession: ReadonlyMap<string, readonly PullRequestLink[]> | undefined;
}): RetirementCandidate[] {
  if (!linksBySession?.size) return [];
  const candidates: RetirementCandidate[] = [];
  for (const worktree of worktrees) {
    const tasks = attachedTasks(sessions, projectID, worktree.directory);
    const links = tasks.flatMap((task) => linksBySession.get(task.id) ?? []);
    if (
      links.some((link) => link.pullRequest.state === "open" || link.pullRequest.state === "draft")
    )
      continue;
    let merged: PullRequestSnapshot | undefined;
    for (const { pullRequest } of links) {
      if (pullRequest.state !== "merged") continue;
      if (!merged || (pullRequest.mergedAt ?? 0) > (merged.mergedAt ?? 0)) merged = pullRequest;
    }
    if (merged)
      candidates.push({ directory: worktree.directory, pullRequest: merged, attachedTasks: tasks });
  }
  return candidates;
}

/** Whether a task, or any of its sub-agents, is running, retrying, or busy. */
export function sessionIsActive(activity: SessionActivityData, sessionID: string): boolean {
  const view = createSessionActivitySelector(sessionID)(activity);
  if (view.active) return true;
  if (view.status && view.status.type !== "idle") return true;
  return [...view.execution.values()].some((execution) => execution.status === "running");
}

export interface ActiveTask {
  id: string;
  title: string | null;
}

/** Fresh state read immediately before showing or performing a retirement. */
export interface RetirementCheck {
  attachedTasks: PalotSession[];
  /**
   * Running tasks (any project, including sub-agents) inside the worktree, as OpenCode
   * reports them; null when OpenCode could not confirm which tasks are running.
   */
  activeTasks: ActiveTask[] | null;
  /** Uncommitted paths; null when they could not be read. */
  dirtyFiles: string[] | null;
  /** Local branch state; null when it could not be read. */
  git: { branch: string | null; oid: string | null; ahead: number; root?: string } | null;
  /** The merged pull request's head commit; null when it could not be read. */
  pullRequestHeadOid: string | null;
}

export interface RetirementChecklistItem {
  id: "pull-request" | "tasks" | "changes" | "commits";
  label: string;
  ok: boolean;
  detail: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The retirement checklist. Every item must pass; anything unknown keeps the worktree,
 * because a stale or unreadable state is not evidence that its work is safe to remove.
 */
export function retirementChecklist(
  check: RetirementCheck,
  pullRequest: PullRequestSnapshot,
): RetirementChecklistItem[] {
  const items: RetirementChecklistItem[] = [
    {
      id: "pull-request",
      label: "Pull request",
      ok: pullRequest.state === "merged",
      detail: `#${pullRequest.number} ${pullRequest.title}${pullRequest.state === "merged" ? " merged" : ` is ${pullRequest.state}`}`,
    },
  ];

  const active = check.activeTasks?.length ?? 0;
  const attached = check.attachedTasks.length;
  items.push({
    id: "tasks",
    label: "Tasks",
    ok: check.activeTasks !== null && active === 0,
    detail:
      check.activeTasks === null
        ? "Couldn't confirm with OpenCode which tasks are running."
        : active > 0
          ? `${plural(active, "task in this worktree is", "tasks in this worktree are")} still running. Wait for ${active === 1 ? "it" : "them"} to finish.`
          : attached === 0
            ? "No attached tasks"
            : `${plural(attached, "attached task", "attached tasks")}, none running. ${attached === 1 ? "It keeps its" : "They keep their"} history; move ${attached === 1 ? "it" : "them"} before continuing elsewhere.`,
  });

  const dirty = check.dirtyFiles;
  items.push({
    id: "changes",
    label: "Uncommitted changes",
    ok: dirty !== null && dirty.length === 0,
    detail:
      dirty === null
        ? "Couldn't read uncommitted changes."
        : dirty.length > 0
          ? `${plural(dirty.length, "uncommitted change", "uncommitted changes")} would be lost. Commit, move, or discard ${dirty.length === 1 ? "it" : "them"} first.`
          : "None",
  });

  items.push({ id: "commits", label: "Commits", ...commitsCheck(check, pullRequest) });
  return items;
}

function commitsCheck(
  check: RetirementCheck,
  pullRequest: PullRequestSnapshot,
): { ok: boolean; detail: string } {
  const git = check.git;
  if (!git)
    return { ok: false, detail: "Couldn't read the branch, so merged commits can't be confirmed." };
  if (git.branch !== pullRequest.headBranch)
    return {
      ok: false,
      detail: `Checked out ${git.branch ?? "a detached HEAD"}, not the pull request branch ${pullRequest.headBranch}.`,
    };
  if (git.ahead > 0)
    return {
      ok: false,
      detail: `${plural(git.ahead, "local commit isn't", "local commits aren't")} pushed, so ${git.ahead === 1 ? "it isn't" : "they aren't"} in the merged pull request.`,
    };
  if (!check.pullRequestHeadOid)
    return { ok: false, detail: "Couldn't read the merged pull request's head commit to compare." };
  if (git.oid !== check.pullRequestHeadOid)
    return {
      ok: false,
      detail:
        "The branch's latest commit isn't the merged pull request's head, so it may hold unmerged work.",
    };
  return { ok: true, detail: `${git.branch} matches the merged pull request.` };
}

export function canRetire(items: readonly RetirementChecklistItem[]): boolean {
  return items.every((item) => item.ok);
}

/**
 * Asks OpenCode which sessions are running now and returns those working inside
 * `directory`. Throws when the list, or any running session's location, can't be read:
 * an unresolved running task might be inside the worktree.
 */
export async function readActiveTasksWithin(
  directory: string,
  connectionID: string,
): Promise<ActiveTask[]> {
  const ids = await listActiveSessionIDs(undefined, connectionID);
  const sessions = await Promise.all(ids.map((id) => getSessionInfo(id, undefined, connectionID)));
  const tasks: ActiveTask[] = [];
  sessions.forEach((session, index) => {
    if (!session) throw new Error(`Couldn't read running task ${ids[index]}`);
    if (isWithinDirectory(session.location.directory, directory))
      tasks.push({ id: session.id, title: session.title ?? null });
  });
  return tasks;
}

/**
 * Reads the worktree's uncommitted changes (OpenCode), local branch (Palot's Git bridge),
 * the merged pull request's head (shared PR detail cache), and OpenCode's running tasks.
 * Failures become unknowns.
 */
export async function readRetirementState({
  directory,
  connectionID,
  profileID,
  pullRequest,
  queryClient,
}: {
  directory: string;
  connectionID: string;
  profileID: string | null;
  pullRequest: PullRequestSnapshot;
  queryClient: QueryClient;
}): Promise<Pick<RetirementCheck, "dirtyFiles" | "git" | "pullRequestHeadOid" | "activeTasks">> {
  const ref = {
    host: pullRequest.host,
    repository: pullRequest.repository,
    number: pullRequest.number,
  };
  const [dirty, git, detail] = await Promise.allSettled([
    getOpenCodeVcsStatus({ directory }, undefined, connectionID),
    profileID
      ? sourceControl.gitStatus({ profileID, directory })
      : Promise.reject(new Error("No profile")),
    queryClient.fetchQuery({
      queryKey: sourceControlKeys.pullRequestDetail(ref),
      queryFn: () => sourceControl.pullRequestDetail(ref),
      staleTime: 0,
    }),
  ]);
  // Running tasks are read last, after the slower reads, so they are the freshest state.
  let activeTasks: ActiveTask[] | null;
  try {
    activeTasks = await readActiveTasksWithin(directory, connectionID);
  } catch {
    activeTasks = null;
  }
  // Either reader seeing a change counts; only both failing leaves it unknown.
  const dirtyFiles =
    dirty.status === "rejected" && git.status === "rejected"
      ? null
      : [
          ...new Set([
            ...(dirty.status === "fulfilled" ? dirty.value.map((file) => file.file) : []),
            ...(git.status === "fulfilled" ? git.value.files.map((file) => file.path) : []),
          ]),
        ];
  return {
    activeTasks,
    dirtyFiles,
    git:
      git.status === "fulfilled"
        ? {
            root: git.value.root,
            branch: git.value.branch.name,
            oid: git.value.branch.oid,
            ahead: git.value.branch.ahead,
          }
        : null,
    pullRequestHeadOid:
      detail.status === "fulfilled" && detail.value.state === "merged"
        ? detail.value.headOid || null
        : null,
  };
}
