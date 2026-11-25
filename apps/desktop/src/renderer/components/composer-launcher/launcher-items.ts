/**
 * What the launcher lists: one item model for categories, actions, commands, skills,
 * mentions, recent outputs and stashed prompts, built from plain source data. Ranking,
 * grouping and "Suggested" live in `launcher-view.ts`. Pure, so the list, the key handling
 * and the tests agree.
 */

import type { PalotAgent, PalotCommand, PalotReference, PalotSkill } from "../../../shared";
import type { ComposerMentionOrigin } from "../../lib/composer-draft";
import type { ShortcutKeys } from "../../lib/keyboard-shortcuts";
import type { StashedPrompt } from "../../lib/prompt-stash";
import type { RecentProjectOutputTask } from "../../lib/recent-project-outputs";
import type { ApprovalPreset, SessionApprovalMode } from "../../lib/session-permissions";

export type LauncherCategory =
  | "outputs"
  | "stash"
  | "commands"
  | "skills"
  | "mention"
  /** The task's approvals: a setting of the message's task, not something put into it. */
  | "approvals"
  /** What `/review` reviews: reached by picking the review command, never listed at the root. */
  | "review";

export const LAUNCHER_CATEGORIES: readonly LauncherCategory[] = [
  "outputs",
  "stash",
  "commands",
  "skills",
  "mention",
];

export const CATEGORY_TITLES: Record<LauncherCategory, string> = {
  outputs: "Recent outputs",
  stash: "Stashed prompts",
  commands: "Commands",
  skills: "Skills",
  mention: "Mention a file, task or agent",
  approvals: "Approvals",
  review: "Review",
};

export const APPROVAL_MODE_LABELS: Record<SessionApprovalMode, string> = {
  normal: "Defaults",
  full: "Full access",
  custom: "Custom",
};

const CATEGORY_HINTS: Partial<Record<LauncherCategory, string>> = {
  commands: "/",
  skills: "$",
  mention: "@",
};

export type LauncherItemKind =
  | "category"
  | "attach"
  | "shell"
  | "send-to-models"
  | "output"
  | "stash"
  | "command"
  | "skill"
  | "file"
  | "task"
  | "agent"
  | "reference"
  | "approval"
  | "review"
  | "suggestion";

/** Icon names; the view maps them to glyphs so items stay plain data. */
export type LauncherIcon =
  | "attach"
  | "shell"
  | "send-to-models"
  | LauncherCategory
  | "output"
  | "command"
  | "skill"
  | "file"
  | "task"
  | "agent"
  | "reference"
  | "review"
  | "compact"
  | "approval-defaults"
  | "approval-full";

/** A mention the composer inserts; the same shapes today's `@` and `$` insert. */
export type LauncherMention =
  | { kind: "file"; path: string; origin?: ComposerMentionOrigin }
  | { kind: "agent"; name: string }
  | { kind: "task"; id: string; title: string }
  | { kind: "reference"; name: string; path: string }
  | { kind: "skill"; id: string };

export type LauncherAction =
  | { type: "drill"; category: LauncherCategory }
  | { type: "attach-files" }
  | { type: "shell" }
  | { type: "send-to-models" }
  | { type: "mention"; mention: LauncherMention }
  | { type: "command"; name: string }
  | { type: "restore-stash"; id: string }
  | { type: "review-changes" }
  /** Runs `/review <arguments>` in the task (empty arguments review uncommitted changes). */
  | { type: "review"; arguments: string }
  /** Puts `/review ` in the draft for a commit hash or one-off instructions. */
  | { type: "review-typed" }
  /** Defaults applies at once; Full access asks first. A highlight alone never arms it. */
  | { type: "approvals"; preset: ApprovalPreset };

export interface LauncherItem {
  /** Stable identity: the highlight follows it. */
  id: string;
  kind: LauncherItemKind;
  title: string;
  /** One muted line after the title. */
  description?: string;
  /**
   * `start` truncates the description from its start, so the end nearest the title stays in
   * view (a file's folder); by default the whole line truncates at its end.
   */
  descriptionOverflow?: "start";
  /** The row's hover title, when its visible text can be cut short (a file's full path). */
  tooltip?: string;
  /** The option in effect, marked with a check. */
  current?: boolean;
  /** A trigger character shown as a key cap at the row's end. */
  hint?: string;
  shortcut?: ShortcutKeys;
  badge?: string;
  icon: LauncherIcon;
  /** The category the item lives in; null for the root's own rows and suggestions. */
  category: LauncherCategory | null;
  action: LauncherAction;
  /** Listed but not pickable: a stale search row, or an output outside this folder. */
  disabled?: boolean;
  /** Extra text that matches at the lowest tier (paths, project names, ids). */
  keywords?: readonly string[];
  /** Newer wins ties against items of the same kind. */
  recency?: number;
  /** The source already matched the query (workspace search), so ranking never drops it. */
  preMatched?: boolean;
}

export interface LauncherSection {
  id: string;
  /** Shown only when a list mixes kinds, and for "Suggested". */
  label: string | null;
  items: LauncherItem[];
}

export type LauncherSourceID = "commands" | "skills" | "mention" | "files";

export interface LauncherTask {
  id: string;
  title: string;
  project: string;
  updatedAt: number;
}

export interface LauncherSources {
  newTask: boolean;
  commands: readonly PalotCommand[];
  skills: readonly PalotSkill[];
  agents: readonly PalotAgent[];
  references: readonly PalotReference[];
  /** Open workbench files, the active one first. */
  openFiles: readonly string[];
  /** Workspace search rows; `pending` while they belong to an older query. */
  files: { paths: readonly string[]; pending: boolean };
  /** Mentionable tasks, newest first. */
  tasks: readonly LauncherTask[];
  outputs: readonly RecentProjectOutputTask[];
  stash: readonly StashedPrompt[];
  /** Files cannot be attached here: a remote server, or an upload in progress. */
  attachDisabled?: boolean;
  /** Sources still waiting for their first data. */
  loading: readonly LauncherSourceID[];
  errors: Partial<Record<LauncherSourceID, string>>;
  attachShortcut?: ShortcutKeys;
  /** The open task's state for suggestions; null for a new task. */
  session: { contextPercent: number | null; changedFiles: number } | null;
  /** The task's approvals; absent where they cannot be changed. */
  approvals?: { mode: SessionApprovalMode; disabled: boolean } | null;
  /** What the review picker offers: the review base and saved instructions. */
  review?: LauncherReviewSource | null;
}

export interface LauncherReviewSource {
  /** The branch the checkout is reviewed against; null when none is known. */
  base: string | null;
  instructions: readonly { id: string; name: string; instructions: string }[];
}

export const EMPTY_LAUNCHER_SOURCES: LauncherSources = {
  newTask: false,
  commands: [],
  skills: [],
  agents: [],
  references: [],
  openFiles: [],
  files: { paths: [], pending: false },
  tasks: [],
  outputs: [],
  stash: [],
  loading: [],
  errors: {},
  session: null,
};

export function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dirname(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : undefined;
}

/** "just now", "5m ago", "3h ago", "2d ago", or a date past a week. */
export function timeAgo(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return `on ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp)}`;
}

/** The draft as its chips read: a task mention shows `@<title>`, not `@session:<id>`. */
function draftDisplayText(draft: StashedPrompt["draft"]): string {
  let text = draft.text;
  const tasks = draft.mentions
    .filter((mention) => mention.kind === "task")
    .toSorted((left, right) => right.start - left.start);
  for (const mention of tasks) {
    if (text.slice(mention.start, mention.end) !== mention.text) continue;
    const label = mention.title?.trim() || mention.value;
    text = `${text.slice(0, mention.start)}@${label}${text.slice(mention.end)}`;
  }
  return text;
}

export function stashPreview(entry: StashedPrompt): string {
  const text = draftDisplayText(entry.draft).trim().split("\n")[0]?.trim();
  if (text) return text;
  return entry.files.length === 1 ? "1 attachment" : `${entry.files.length} attachments`;
}

/* Root and categories */

function categoryItem(category: LauncherCategory): LauncherItem {
  return {
    id: `category:${category}`,
    kind: "category",
    title: CATEGORY_TITLES[category],
    hint: CATEGORY_HINTS[category],
    icon: category,
    category: null,
    action: { type: "drill", category },
  };
}

/** The root's rows: actions and categories, in the prototype's order. */
export function rootItems(
  sources: Pick<LauncherSources, "newTask" | "attachShortcut" | "attachDisabled" | "approvals">,
) {
  const items: LauncherItem[] = [
    {
      id: "attach",
      kind: "attach",
      title: "Attach files",
      shortcut: sources.attachShortcut,
      icon: "attach",
      category: null,
      action: { type: "attach-files" },
      disabled: sources.attachDisabled || undefined,
    },
    ...LAUNCHER_CATEGORIES.map(categoryItem),
    {
      id: "shell",
      kind: "shell",
      title: "Run a shell command",
      hint: "!",
      icon: "shell",
      category: null,
      action: { type: "shell" },
    },
  ];
  if (sources.newTask) {
    items.push({
      id: "send-to-models",
      kind: "send-to-models",
      title: "Send to several models…",
      icon: "send-to-models",
      category: null,
      action: { type: "send-to-models" },
    });
  }
  if (sources.approvals) {
    // Last: a setting of the task the message goes to, not something put into the message.
    items.push({
      ...categoryItem("approvals"),
      description: APPROVAL_MODE_LABELS[sources.approvals.mode],
    });
  }
  return items;
}

const APPROVAL_PRESETS: readonly {
  preset: ApprovalPreset;
  description: string;
  icon: LauncherIcon;
}[] = [
  {
    preset: "normal",
    description: "Project and agent rules decide what asks first",
    icon: "approval-defaults",
  },
  {
    preset: "full",
    description: "Commands and edits run without asking",
    icon: "approval-full",
  },
];

/** The presets; Custom is only reported (see the view's notice), never chosen here. */
function approvalItems(approvals: LauncherSources["approvals"]): LauncherItem[] {
  if (!approvals) return [];
  return APPROVAL_PRESETS.map(({ preset, description, icon }) => ({
    id: `approval:${preset}`,
    kind: "approval",
    title: APPROVAL_MODE_LABELS[preset],
    description,
    icon,
    category: "approvals",
    current: approvals.mode === preset || undefined,
    disabled: approvals.disabled || undefined,
    action: { type: "approvals", preset },
  }));
}

/** The command whose pick opens the review picker instead of being typed. */
export const REVIEW_COMMAND = "review";

/**
 * What `/review` can review, then saved instructions. OpenCode's `review` command takes one free
 * text argument: empty for uncommitted changes, a branch to diff against, a commit, or
 * instructions it follows with best judgement.
 */
function reviewItems(review: LauncherSources["review"]): LauncherItem[] {
  const base = review?.base ?? null;
  const item = (
    id: string,
    title: string,
    description: string,
    action: LauncherAction,
    extra: Partial<LauncherItem> = {},
  ): LauncherItem => ({
    id: `review:${id}`,
    kind: "review",
    title,
    description,
    icon: "review",
    category: "review",
    action,
    ...extra,
  });
  return [
    item("uncommitted", "Uncommitted changes", "Staged, unstaged and new files", {
      type: "review",
      arguments: "",
    }),
    base
      ? item("base", "Against the base branch", `Everything since ${base}`, {
          type: "review",
          arguments: base,
        })
      : item(
          "base",
          "Against the base branch",
          "No base branch found for this checkout",
          { type: "review", arguments: "" },
          { disabled: true },
        ),
    item("commit", "A commit…", "Type its hash after /review", { type: "review-typed" }),
    ...(review?.instructions ?? []).map((entry) =>
      item(
        `saved:${entry.id}`,
        entry.name,
        entry.instructions.split("\n")[0]!.trim(),
        {
          type: "review",
          arguments: entry.instructions,
        },
        { keywords: [entry.instructions], badge: "Saved" },
      ),
    ),
    item("custom", "Custom instructions…", "Type what to review after /review", {
      type: "review-typed",
    }),
  ];
}

function commandItems(commands: readonly PalotCommand[]): LauncherItem[] {
  return commands.map((command) => ({
    id: `command:${command.name}`,
    kind: "command",
    title: `/${command.name}`,
    description: command.description ?? undefined,
    badge:
      command.agent ??
      (command.model ? `${command.model.providerID}/${command.model.id}` : undefined),
    icon: "command",
    category: "commands",
    action: { type: "command", name: command.name },
  }));
}

function skillItems(skills: readonly PalotSkill[]): LauncherItem[] {
  return skills.map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "skill",
    title: `$${skill.id}`,
    description: skill.description ?? (skill.name !== skill.id ? skill.name : undefined),
    keywords: [skill.name],
    icon: "skill",
    category: "skills",
    action: { type: "mention", mention: { kind: "skill", id: skill.id } },
  }));
}

function referenceItems(references: readonly PalotReference[]): LauncherItem[] {
  return references
    .filter((reference) => !reference.hidden)
    .map((reference) => ({
      id: `reference:${reference.name}`,
      kind: "reference",
      title: `@${reference.name}`,
      description: reference.description ?? reference.source,
      keywords: [reference.path],
      icon: "reference",
      category: "mention",
      action: {
        type: "mention",
        mention: { kind: "reference", name: reference.name, path: reference.path },
      },
    }));
}

function agentItems(agents: readonly PalotAgent[]): LauncherItem[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent) => ({
      id: `agent:${agent.id}`,
      kind: "agent",
      title: `@${agent.id}`,
      description: agent.description ?? "Subagent",
      keywords: [agent.name],
      icon: "agent",
      category: "mention",
      action: { type: "mention", mention: { kind: "agent", name: agent.id } },
    }));
}

/** Open files first, then search rows not already listed. */
function fileItems(sources: Pick<LauncherSources, "openFiles" | "files">): LauncherItem[] {
  const open = new Set(sources.openFiles);
  const fileItem = (path: string, isOpen: boolean): LauncherItem => ({
    id: `file:${path}`,
    kind: "file",
    title: basename(path),
    // The workspace-relative folder tells two files with the same name apart.
    description: dirname(path),
    descriptionOverflow: "start",
    tooltip: path,
    badge: isOpen ? "Open" : undefined,
    keywords: [path],
    icon: "file",
    category: "mention",
    action: { type: "mention", mention: { kind: "file", path } },
    preMatched: isOpen ? undefined : true,
    // Search rows for an older query stay visible while the next result loads.
    disabled: !isOpen && sources.files.pending ? true : undefined,
  });
  return [
    ...sources.openFiles.map((path) => fileItem(path, true)),
    ...sources.files.paths.filter((path) => !open.has(path)).map((path) => fileItem(path, false)),
  ];
}

function taskItems(tasks: readonly LauncherTask[]): LauncherItem[] {
  return tasks.map((task) => ({
    id: `task:${task.id}`,
    kind: "task",
    title: task.title,
    description: task.project,
    keywords: [task.project, task.id],
    icon: "task",
    category: "mention",
    recency: task.updatedAt,
    action: { type: "mention", mention: { kind: "task", id: task.id, title: task.title } },
  }));
}

function outputItems(groups: readonly RecentProjectOutputTask[], now: number): LauncherItem[] {
  return groups.flatMap((group) =>
    group.outputs.map((output) => ({
      id: `output:${output.key}`,
      kind: "output" as const,
      title: output.name,
      description:
        output.path === null
          ? "Outside this task's folder, so it can't be mentioned here"
          : `${output.path} · ${timeAgo(output.at, now)}`,
      badge: output.kind === "produced" ? "Output" : "Changed",
      keywords: [output.absolutePath, group.title],
      icon: "output" as const,
      category: "outputs" as const,
      recency: output.at,
      disabled: output.path === null ? true : undefined,
      action: {
        type: "mention" as const,
        mention: {
          kind: "file" as const,
          path: output.path ?? output.absolutePath,
          // The chip offers "Open original task"; the list itself only puts things in.
          origin: { sessionID: group.sessionID, title: group.title },
        },
      },
    })),
  );
}

function stashItems(stash: readonly StashedPrompt[], now: number): LauncherItem[] {
  return stash.map((entry) => ({
    id: `stash:${entry.id}`,
    kind: "stash",
    title: stashPreview(entry),
    description: `Stashed ${timeAgo(entry.createdAt, now)}`,
    keywords: [entry.draft.text],
    icon: "stash",
    category: "stash",
    recency: entry.createdAt,
    action: { type: "restore-stash", id: entry.id },
  }));
}

/** Every item a category holds, before the query, in source order. */
export function categoryItems(
  category: LauncherCategory,
  sources: LauncherSources,
  now: number,
): LauncherItem[] {
  switch (category) {
    case "outputs":
      // Only what goes into the message: opening the task an output came from is navigation.
      return outputItems(sources.outputs, now);
    case "stash":
      return stashItems(sources.stash, now);
    case "commands":
      return commandItems(sources.commands);
    case "skills":
      return skillItems(sources.skills);
    case "mention":
      // Today's `@` order: references, subagents, open files, workspace search, tasks.
      return [
        ...referenceItems(sources.references),
        ...agentItems(sources.agents),
        ...fileItems(sources),
        ...taskItems(sources.tasks),
      ];
    case "approvals":
      return approvalItems(sources.approvals);
    case "review":
      return reviewItems(sources.review);
  }
}
