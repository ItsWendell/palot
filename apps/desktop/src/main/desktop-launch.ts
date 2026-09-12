import path from "node:path";
import type { PalotOpenTarget } from "../shared/opencode-contract";

export const DESKTOP_HELP = `Palot desktop

  --show                 Show the existing window
  --new-task             Open a new task draft
  --project <directory>  Start a task in a local project folder
  --task <session-id>    Open an existing task
  --attach <file>        Attach a file to --project (repeatable)
  --diagnostics          Print desktop/Electron diagnostics and exit
  --help                 Show this help

Paths with spaces must be quoted. Launches reuse the same build channel.
`;

export function parseDesktopLaunch(
  args: readonly string[],
  cwd: string,
): (PalotOpenTarget & { attachmentPaths?: string[] }) | null {
  const actions = args.flatMap<PalotOpenTarget>((arg, index) => {
    if (arg === "--show") return [{ type: "open" } as const];
    if (arg === "--new-task") return [{ type: "new-task" } as const];
    if (arg !== "--project" && arg !== "--task") return [];
    const value = args[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0"))
      throw new Error(`${arg} requires a value`);
    if (arg === "--project")
      return [{ type: "project", directory: path.resolve(cwd, value) } as const];
    if (!/^ses[_a-zA-Z0-9-]+$/.test(value))
      throw new Error("--task requires an OpenCode session ID");
    return [{ type: "session", sessionID: value } as const];
  });
  if (actions.length > 1) throw new Error("Choose one of --show, --new-task, --project, or --task");
  const attachments = args.flatMap((arg, index) => {
    if (arg !== "--attach") return [];
    const value = args[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0"))
      throw new Error("--attach requires a file path");
    return [path.resolve(cwd, value)];
  });
  const target = actions[0];
  if (attachments.length && target?.type !== "project")
    throw new Error("Use --attach with --project");
  return target
    ? { ...target, ...(attachments.length ? { attachmentPaths: attachments } : {}) }
    : null;
}
