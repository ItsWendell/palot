import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface ProjectRoots {
  canonical: string;
  sandboxes: readonly string[];
}

/**
 * Resolve a task's directory for a script run. It must exist and, after following symlinks,
 * stay inside the project's main checkout or one of its OpenCode worktrees.
 */
export async function resolveScriptDirectory(
  directory: string,
  project: ProjectRoots,
): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error("The task's directory is not an absolute path.");
  let resolved: string;
  try {
    resolved = await realpath(directory);
  } catch {
    throw new Error("The task's directory no longer exists.");
  }
  if (!(await stat(resolved)).isDirectory())
    throw new Error("The task's directory is not a directory.");
  const roots = await Promise.all(
    [project.canonical, ...project.sandboxes]
      .filter((root) => path.isAbsolute(root))
      .map((root) => realpath(root).catch(() => null)),
  );
  if (!roots.some((root) => root !== null && contains(root, resolved)))
    throw new Error("The task's directory is outside the project and its worktrees.");
  return resolved;
}

/** Whether a resolved task directory sits inside one of the project's OpenCode worktrees. */
export async function isWorktreeDirectory(
  resolved: string,
  project: ProjectRoots,
): Promise<boolean> {
  const roots = await Promise.all(
    project.sandboxes
      .filter((root) => path.isAbsolute(root))
      .map((root) => realpath(root).catch(() => null)),
  );
  return roots.some((root) => root !== null && contains(root, resolved));
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
