import type { PalotCommand } from "../../shared";

export const BUILTIN_COMMANDS: readonly PalotCommand[] = [
  {
    name: "compact",
    description: "Summarize and compact conversation history to free context space",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "new",
    description: "Start a new conversation task",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "clear",
    description: "Start a fresh conversation task",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "model",
    description: "Switch model or open model selector",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "undo",
    description: "Revert the last conversation step and file changes",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "revert",
    description: "Revert the last conversation step and file changes",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "redo",
    description: "Redo one staged conversation step",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "restore",
    description: "Restore all currently staged conversation changes",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "init",
    description: "Initialize OpenCode in the current project",
    agent: null,
    model: null,
    subtask: false,
  },
] as const;

export function mergeBuiltinCommands(customCommands: PalotCommand[]): PalotCommand[] {
  const customNames = new Set(customCommands.map((c) => c.name.toLowerCase()));
  const availableBuiltins = BUILTIN_COMMANDS.filter((b) => !customNames.has(b.name.toLowerCase()));
  return [...availableBuiltins, ...customCommands];
}

export function isBuiltinCommand(name: string): boolean {
  const normalized = name.toLowerCase();
  return BUILTIN_COMMANDS.some((c) => c.name.toLowerCase() === normalized);
}
