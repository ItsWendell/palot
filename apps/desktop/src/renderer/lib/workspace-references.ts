import type { PalotPromptFileReference } from "../../shared";

export function normalizeWorkspacePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Workspace path must be normalized and stay inside the session location");
  }
  return normalized;
}

export function workspaceFileUri(directory: string, relativePath: string): string {
  const root = new URL(`file://${directory.endsWith("/") ? directory : `${directory}/`}`);
  return new URL(normalizeWorkspacePath(relativePath), root).href;
}

export function workspaceFileAttachments(
  directory: string,
  references: PalotPromptFileReference[],
) {
  return references.map((reference) => ({
    uri: workspaceFileUri(directory, reference.path),
    name: reference.name,
    mention: { ...reference.mention },
  }));
}
