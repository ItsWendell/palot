import type { WorktreeInfo } from "@opencode/client";
import type { PalotProject, PalotSession } from "../../shared";

export type WorkspaceSelection =
  | { type: "current"; directory: string }
  | { type: "create"; branch?: string };

export async function createSessionInWorkspace(input: {
  project: PalotProject;
  selection: WorkspaceSelection;
  createCopy(projectID: string, sourceDirectory: string, branch?: string): Promise<WorktreeInfo>;
  createSession(directory: string): Promise<PalotSession | null>;
}): Promise<PalotSession | null> {
  const sourceDirectory = input.project.canonical;
  const directory =
    input.selection.type === "create"
      ? (await input.createCopy(input.project.id, sourceDirectory, input.selection.branch))
          .directory
      : input.selection.directory;
  const session = await input.createSession(directory);
  if (!session) throw new Error("Could not create this task.");
  return session;
}
