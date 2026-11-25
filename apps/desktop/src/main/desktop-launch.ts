import path from "node:path";
import type { PalotOpenTarget } from "../shared/opencode-contract";
import { isPalotLink, parseTaskLink } from "../shared/task-link";

export const DESKTOP_HELP = `Palot desktop

  --show                 Show the existing window
  --new-task             Open a new task draft
  --project <directory>  Start a task in a local project folder
  --task <session-id>    Open an existing task
  palot://task/<id>      Open an existing task from a link (other links are ignored)
  --attach <file>        Attach a file to --project (repeatable)
  --diagnostics          Print desktop/Electron diagnostics and exit
  --help                 Show this help

Paths with spaces must be quoted. Launches reuse the same build channel.
`;

export function parseDesktopLaunch(
  args: readonly string[],
  cwd: string,
): (PalotOpenTarget & { attachmentPaths?: string[] }) | null {
  // The Linux desktop entry runs `palot --show %U`, so a link arrives after --show; a valid
  // link wins, and a malformed one leaves --show to bring the window forward.
  const hasLink = args.some((arg) => isPalotLink(arg) && parseTaskLink(arg));
  const actions = args.flatMap<PalotOpenTarget>((arg, index) => {
    if (isPalotLink(arg)) {
      // Links arrive from other apps; a malformed one is ignored rather than failing the launch.
      const link = parseTaskLink(arg);
      return link ? [{ type: "session", ...link } as const] : [];
    }
    if (arg === "--show") return hasLink ? [] : [{ type: "open" } as const];
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
