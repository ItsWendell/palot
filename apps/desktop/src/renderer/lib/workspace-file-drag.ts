import { workspaceRelativePath } from "./file-reference";

export const WORKSPACE_FILE_DRAG_TYPE = "application/x-palot-workspace-file";
export function parseWorkspaceFileDrop(
  raw: string,
  profileID: string | undefined,
  directory: string,
  workspaceID?: string,
): string | null {
  try {
    const value = JSON.parse(raw);
    if (
      !profileID ||
      value.profileID !== profileID ||
      value.directory !== directory ||
      value.workspaceID !== workspaceID ||
      typeof value.path !== "string"
    )
      return null;
    return workspaceRelativePath(directory, value.path);
  } catch {
    return null;
  }
}
