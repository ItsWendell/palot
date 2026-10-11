import fuzzysort from "fuzzysort";
import {
  commandSearchText,
  defaultGlobalCommands,
  groupGlobalCommands,
  type GlobalCommand,
} from "./global-commands";

/** Lexical matches score at least this much; fuzzy-only matches score below it. */
export const STRONG_MATCH_SCORE = 2;

function normalized(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function lexicalScore(command: GlobalCommand, query: string): number {
  const title = normalized(command.title);
  const text = normalized(commandSearchText(command));
  if (title === query) return 5;
  if (title.startsWith(query)) return 4;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 3;
  if (title.includes(query)) return 2.5;
  if (text.includes(query)) return 2;
  return 0;
}

export interface ScoredGlobalCommand {
  command: GlobalCommand;
  score: number;
}

export function scoreGlobalCommands(
  commands: readonly GlobalCommand[],
  rawQuery: string,
): ScoredGlobalCommand[] {
  const query = normalized(rawQuery);
  if (!query) return commands.map((command) => ({ command, score: 0 }));

  return commands
    .map((command, index) => {
      const lexical = lexicalScore(command, query);
      const fuzzy = fuzzysort.single(query, commandSearchText(command))?.score ?? 0;
      const score = Math.max(lexical, fuzzy) + (command.suggested ? 0.025 : 0);
      return { command, index, score };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command, score }) => ({ command, score }));
}

export function rankGlobalCommands(
  commands: readonly GlobalCommand[],
  rawQuery: string,
): GlobalCommand[] {
  return scoreGlobalCommands(commands, rawQuery).map(({ command }) => command);
}

export interface GlobalSearchGroup {
  group: "tasks" | "commands" | "similar-tasks";
  label: string;
  commands: GlobalCommand[];
}

/**
 * Groups ranked search results with matching tasks first, then commands and settings.
 * Fuzzy-only task matches follow the commands so a loose match on a long task path never
 * outranks an exact command.
 */
export function groupGlobalSearchResults(
  commands: readonly GlobalCommand[],
  rawQuery: string,
): GlobalSearchGroup[] {
  const scored = scoreGlobalCommands(commands, rawQuery);
  const tasks = scored.filter(
    ({ command, score }) => command.kind === "task" && score >= STRONG_MATCH_SCORE,
  );
  const others = scored.filter(({ command }) => command.kind !== "task");
  const similar = scored.filter(
    ({ command, score }) => command.kind === "task" && score < STRONG_MATCH_SCORE,
  );
  const groups: GlobalSearchGroup[] = [
    { group: "tasks", label: "Tasks", commands: tasks.map(({ command }) => command) },
    { group: "commands", label: "Commands", commands: others.map(({ command }) => command) },
    {
      group: "similar-tasks",
      label: "Similar tasks",
      commands: similar.map(({ command }) => command),
    },
  ];
  return groups.filter((group) => group.commands.length > 0);
}

/** Palette tabs: every result, or only tasks, the open task's files, commands, or settings. */
export type PaletteTab = "all" | "tasks" | "files" | "commands" | "settings";

export const PALETTE_TABS: readonly { value: PaletteTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "files", label: "Files" },
  { value: "commands", label: "Commands" },
  { value: "settings", label: "Settings" },
];

/** Files the All tab shows after tasks and commands; the Files tab shows a full search page. */
export const ALL_TAB_FILE_LIMIT = 5;

/**
 * The open task's file search for a tab and query, or `null` when the tab shows no files. Files
 * has its own tab; All adds them only once something is typed.
 */
export function paletteFileSearch(
  tab: PaletteTab,
  rawQuery: string,
  taskOpen: boolean,
): { query: string; limit: number | undefined } | null {
  if (!taskOpen) return null;
  const query = rawQuery.trim();
  if (tab === "files") return { query, limit: undefined };
  if (tab === "all" && query) return { query, limit: ALL_TAB_FILE_LIMIT };
  return null;
}

/** Tasks the Tasks tab lists before anything is typed; typing searches every task. */
export const TAB_TASK_LIMIT = 50;

/** The tab, other than All and Files, that lists a command. */
export function paletteTabOf(command: GlobalCommand): Exclude<PaletteTab, "all" | "files"> {
  if (command.kind === "task") return "tasks";
  if (command.group === "settings") return "settings";
  return "commands";
}

export interface PaletteResultGroup {
  group: string;
  label: string;
  commands: GlobalCommand[];
}

/**
 * The palette's result groups for a tab and query. All keeps the suggestion layout (recent
 * tasks first) when nothing is typed and the ranked Tasks/Commands/Similar tasks groups when
 * searching; the other tabs list only their own commands.
 */
export function paletteResultGroups(
  commands: readonly GlobalCommand[],
  rawQuery: string,
  tab: PaletteTab,
): PaletteResultGroup[] {
  const searching = normalized(rawQuery).length > 0;
  if (tab === "all") {
    return searching
      ? groupGlobalSearchResults(commands, rawQuery)
      : groupGlobalCommands(defaultGlobalCommands(commands));
  }
  // File rows come from the open task's workspace search, not the command list.
  if (tab === "files") return [];
  const inTab = commands.filter((command) => paletteTabOf(command) === tab);
  if (tab === "tasks") {
    if (searching) return groupGlobalSearchResults(inTab, rawQuery);
    const recent = inTab.slice(0, TAB_TASK_LIMIT);
    return recent.length > 0 ? [{ group: "tasks", label: "Recent tasks", commands: recent }] : [];
  }
  if (searching) {
    const ranked = rankGlobalCommands(inTab, rawQuery);
    const label = tab === "settings" ? "Settings" : "Commands";
    return ranked.length > 0 ? [{ group: tab, label, commands: ranked }] : [];
  }
  // Without a query, per-project "New task in …" rows stay behind the project chooser.
  return groupGlobalCommands(inTab.filter((command) => command.kind !== "project"));
}

/** The next tab in either direction, wrapping at both ends. */
export function adjacentPaletteTab(tab: PaletteTab, step: 1 | -1): PaletteTab {
  const index = PALETTE_TABS.findIndex((candidate) => candidate.value === tab);
  const next = (Math.max(index, 0) + step + PALETTE_TABS.length) % PALETTE_TABS.length;
  return PALETTE_TABS[next]!.value;
}

export interface PaletteArrowInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Whether ← or → in the search field switches tabs, and which way. They do when the field is
 * empty or the caret already sits at the edge it points past, so the arrows still move the
 * caret through typed text. Modified presses and selections keep their editing meaning.
 */
export function paletteTabStep(input: PaletteArrowInput): 1 | -1 | 0 {
  const step = input.key === "ArrowRight" ? 1 : input.key === "ArrowLeft" ? -1 : 0;
  if (step === 0 || input.shiftKey || input.altKey || input.ctrlKey || input.metaKey) return 0;
  if (input.value === "") return step;
  const { selectionStart, selectionEnd } = input;
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return 0;
  if (step === -1) return selectionStart === 0 ? -1 : 0;
  return selectionEnd === input.value.length ? 1 : 0;
}

/** What Enter does on a highlighted file row. */
export const PALETTE_FILE_ENTER_LABEL = "Open file";

/** What Enter does on a highlighted row, named for the footer hint. */
export function paletteEnterLabel(command: GlobalCommand): string {
  if (command.kind === "task") return "Open task";
  if (command.group === "settings") return "Open settings";
  if (command.kind === "project") return "Start task";
  return "Run command";
}
