export function absoluteServerPath(value: string): boolean {
  return (
    value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

export function directoryBreadcrumbs(value: string): { label: string; path: string }[] {
  const normalized = value.replaceAll("\\", "/");
  const root =
    normalized.match(/^[A-Za-z]:\//)?.[0] ?? normalized.match(/^\/\/[^/]+\/[^/]+\/?/)?.[0] ?? "/";
  const parts = normalized.slice(root.length).split("/").filter(Boolean);
  const result = [{ label: root, path: root }];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (result.length > 1) result.pop();
      continue;
    }
    const parent = result.at(-1)!.path;
    result.push({ label: part, path: `${parent.replace(/\/$/, "")}/${part}` });
  }
  return result;
}

export function resolveDirectoryEntry(directory: string, entry: string): string {
  return directoryBreadcrumbs(
    absoluteServerPath(entry) ? entry : `${directory.replace(/[\\/]$/, "")}/${entry}`,
  ).at(-1)!.path;
}
