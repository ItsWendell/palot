import type { ComponentType } from "react";
import { formatShortcut, type ShortcutKeys } from "./keyboard-shortcuts";
import { RECENT_TASK_LIMIT } from "./palette-tasks";

export type GlobalCommandGroup =
  | "tasks"
  | "actions"
  | "settings"
  | "projects"
  | "diagnostics"
  | "development";

export interface GlobalCommand {
  id: string;
  title: string;
  description?: string;
  group: GlobalCommandGroup;
  icon?: ComponentType<{ className?: string }>;
  keywords?: readonly string[];
  shortcut?: ShortcutKeys;
  suggested?: boolean;
  defaultVisible?: boolean;
  disabledReason?: string;
  closeOnRun?: boolean;
  runAfterClose?: boolean;
  trailing?: string;
  status?: "running" | "attention" | "unread";
  kind?: "action" | "task" | "project" | "setting";
  run(): void | Promise<void>;
  preload?(): void | Promise<void>;
}

export const GLOBAL_COMMAND_GROUP_LABELS: Record<GlobalCommandGroup, string> = {
  tasks: "Recent tasks",
  actions: "Quick actions",
  settings: "Settings",
  projects: "Projects",
  diagnostics: "Diagnostics",
  development: "Development",
};

const DEFAULT_GROUP_ORDER: readonly GlobalCommandGroup[] = [
  "tasks",
  "actions",
  "settings",
  "diagnostics",
  "development",
  "projects",
];

/** The empty-query palette: recent tasks, then quick actions, then every settings page. */
export function defaultGlobalCommands(commands: readonly GlobalCommand[]): GlobalCommand[] {
  const recentTasks = commands
    .filter((command) => command.kind === "task")
    .slice(0, RECENT_TASK_LIMIT);
  const visible = commands.filter(
    (command) =>
      command.kind !== "task" &&
      (command.suggested ||
        command.defaultVisible ||
        command.group === "development" ||
        command.group === "settings"),
  );
  const byID = new Map([...recentTasks, ...visible].map((command) => [command.id, command]));
  return [...byID.values()].toSorted(
    (left, right) =>
      DEFAULT_GROUP_ORDER.indexOf(left.group) - DEFAULT_GROUP_ORDER.indexOf(right.group),
  );
}

export function groupGlobalCommands(commands: readonly GlobalCommand[]) {
  return DEFAULT_GROUP_ORDER.map((group) => ({
    group,
    label: GLOBAL_COMMAND_GROUP_LABELS[group],
    commands: commands.filter((command) => command.group === group),
  })).filter(({ commands: grouped }) => grouped.length > 0);
}

export function commandSearchText(command: GlobalCommand): string {
  return [command.title, command.description, ...(command.keywords ?? [])]
    .filter(Boolean)
    .join(" ");
}

/** Alias of `formatShortcut` from `lib/keyboard-shortcuts`, kept for existing callers. */
export function formatCommandShortcut(keys: ShortcutKeys, platform?: string) {
  return formatShortcut(keys, platform);
}
