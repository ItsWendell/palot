import type { ComponentType } from "react";

export type GlobalCommandGroup =
  | "suggested"
  | "tasks"
  | "projects"
  | "navigation"
  | "settings"
  | "diagnostics"
  | "development";

export interface GlobalCommand {
  id: string;
  title: string;
  description?: string;
  group: GlobalCommandGroup;
  icon?: ComponentType<{ className?: string }>;
  keywords?: readonly string[];
  shortcut?: readonly string[];
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
  suggested: "Suggested",
  tasks: "Recent tasks",
  projects: "Projects",
  navigation: "Go to",
  settings: "Settings",
  diagnostics: "Diagnostics",
  development: "Development",
};

const DEFAULT_GROUP_ORDER: readonly GlobalCommandGroup[] = [
  "suggested",
  "tasks",
  "navigation",
  "settings",
  "diagnostics",
  "projects",
  "development",
];

export function defaultGlobalCommands(commands: readonly GlobalCommand[]): GlobalCommand[] {
  const recentTasks = commands.filter((command) => command.kind === "task").slice(0, 7);
  const visible = commands.filter(
    (command) => command.suggested || command.defaultVisible || command.group === "development",
  );
  const byID = new Map([...visible, ...recentTasks].map((command) => [command.id, command]));
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

export function formatCommandShortcut(keys: readonly string[], platform = navigator.platform) {
  const mac = platform.toLowerCase().includes("mac");
  if (!mac) return keys.map((key) => (key === "Meta" ? "Ctrl" : key)).join("+");
  return keys
    .map((key) => {
      if (key === "Meta") return "⌘";
      if (key === "Shift") return "⇧";
      if (key === "Alt") return "⌥";
      return key;
    })
    .join("");
}
