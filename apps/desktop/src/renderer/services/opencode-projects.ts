import type { OpenCodeClient } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

export type ProjectUpdate = Parameters<OpenCodeClient["project"]["update"]>[0];
export type ProjectDetails = Awaited<ReturnType<OpenCodeClient["project"]["update"]>>;
export type ProjectEdits = Partial<
  Record<"name" | "override" | "color" | "start" | "canonical", string>
>;

export function projectUpdatePatch(projectID: string, edits: ProjectEdits): ProjectUpdate {
  if (edits.canonical !== undefined && !isAbsoluteProjectPath(edits.canonical)) {
    throw new Error("Enter an absolute path on the connected OpenCode server.");
  }
  return {
    projectID,
    ...(edits.name !== undefined ? { name: edits.name } : {}),
    ...(edits.canonical !== undefined ? { canonical: edits.canonical } : {}),
    ...(edits.override !== undefined || edits.color !== undefined
      ? {
          icon: {
            ...(edits.override !== undefined ? { override: edits.override } : {}),
            ...(edits.color !== undefined ? { color: edits.color } : {}),
          },
        }
      : {}),
    ...(edits.start !== undefined ? { commands: { start: edits.start } } : {}),
  };
}

export function isAbsoluteProjectPath(path: string): boolean {
  return (
    !path.includes("\0") &&
    !/[\r\n]/.test(path) &&
    (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path))
  );
}

export async function loadProjectDetails(
  projectID: string,
  signal?: AbortSignal,
  connectionID?: string,
): Promise<ProjectDetails> {
  const projects = await openCodeClient(connectionID).project.list({
    signal: openCodeRequestSignal(signal),
  });
  const project = projects.find((item) => item.id === projectID);
  if (!project) throw new Error("This project is no longer available on the connected server.");
  return project;
}

export async function updateProjectDetails(
  projectID: string,
  edits: ProjectEdits,
  connectionID?: string,
): Promise<ProjectDetails> {
  return openCodeClient(connectionID).project.update(projectUpdatePatch(projectID, edits), {
    signal: openCodeRequestSignal(),
  });
}
