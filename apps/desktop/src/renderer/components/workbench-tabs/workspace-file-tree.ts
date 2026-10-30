import type { FileSystemEntry, LocationRef } from "@opencode/client";
import { useFileTree } from "@pierre/trees/react";
import { useQueries } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { workspaceRelativePath } from "../../lib/file-reference";
import { openCodeKeys } from "../../lib/opencode-query";
import { palot } from "../../services/palot";

// Match the Changes tab's tree, using the active Palot theme.
export const workspaceFileTreeStyle = {
  height: "100%",
  border: 0,
  background: "var(--background)",
  "--trees-accent-override": "var(--ring)",
  "--trees-bg-override": "var(--background)",
  "--trees-bg-muted-override": "var(--muted)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "5px",
  "--trees-fg-override": "var(--foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "var(--theme-tree-font-size)",
  "--trees-input-bg-override": "var(--card)",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
} as CSSProperties;

export function safeWorkspaceEntries(root: string, entries: FileSystemEntry[]) {
  return entries.flatMap((entry) => {
    const path = workspaceRelativePath(root, entry.path);
    return path && (entry.type === "file" || entry.type === "directory")
      ? [{ type: entry.type, path }]
      : [];
  });
}

function samePaths(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function isExpandedDirectory(path: string, expanded: readonly string[]) {
  const parts = path.split("/");
  return parts.every((_, index) => expanded.includes(parts.slice(0, index + 1).join("/")));
}

export function useWorkspaceFileTree({
  location,
  connectionID,
  enabled,
  onOpenFile,
  revealPath,
}: {
  location: LocationRef;
  connectionID: string;
  enabled: boolean;
  onOpenFile: (path: string) => void;
  revealPath?: string;
}) {
  // Keep loaded children when collapsed, but only watch expanded branches for changes.
  const [requestedDirectories, setRequestedDirectories] = useState([""]);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const listings = useQueries({
    queries: requestedDirectories.map((directory) => ({
      queryKey: openCodeKeys.fileDirectory(connectionID, location, directory),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        palot.listWorkspaceDirectory(
          { ...location, ...(directory ? { path: directory } : {}) },
          signal,
          connectionID,
        ),
      enabled: enabled && (!directory || isExpandedDirectory(directory, expandedDirectories)),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    })),
  });
  const children = new Map(
    requestedDirectories.map((directory, index) => [
      directory,
      safeWorkspaceEntries(location.directory, listings[index]?.data ?? []).filter(
        (entry) => entry.path.split("/").slice(0, -1).join("/") === directory,
      ),
    ]),
  );
  const paths: string[] = [];
  const filePaths = new Set<string>();
  function appendChildren(directory: string) {
    for (const entry of children.get(directory) ?? []) {
      if (entry.type === "directory") {
        paths.push(`${entry.path}/`);
        appendChildren(entry.path);
      } else {
        paths.push(entry.path);
        filePaths.add(entry.path);
      }
    }
  }
  // Only include descendants whose parents still exist in the latest listings.
  appendChildren("");

  const selectionRef = useRef({ filePaths, onOpenFile });
  const revealing = useRef(false);
  const revealedPath = useRef<string | null>(null);
  const pathsRef = useRef<string[]>([]);
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    dragAndDrop: false,
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    renaming: false,
    search: false,
    stickyFolders: true,
    sort: (left, right) =>
      left.isDirectory === right.isDirectory
        ? left.basename.localeCompare(right.basename)
        : left.isDirectory
          ? -1
          : 1,
    onSelectionChange(selected) {
      if (revealing.current) return;
      const path = selected.at(-1);
      if (path && selectionRef.current.filePaths.has(path)) {
        selectionRef.current.onOpenFile(path);
      }
    },
  });

  useLayoutEffect(() => {
    function syncExpansion() {
      const expanded = pathsRef.current.flatMap((path) => {
        const item = path.endsWith("/") ? model.getItem(path) : null;
        return item && "isExpanded" in item && item.isExpanded() ? [path.slice(0, -1)] : [];
      });
      setExpandedDirectories((previous) => (samePaths(previous, expanded) ? previous : expanded));
      setRequestedDirectories((previous) => {
        const added = expanded.filter((path) => !previous.includes(path));
        return added.length ? [...previous, ...added] : previous;
      });
    }
    return model.subscribe(syncExpansion);
  }, [model]);

  useLayoutEffect(() => {
    selectionRef.current = { filePaths, onOpenFile };
    if (samePaths(pathsRef.current, paths)) return;
    const expandedPaths = pathsRef.current.filter((path) => {
      const item = path.endsWith("/") ? model.getItem(path) : null;
      return item && "isExpanded" in item && item.isExpanded();
    });
    pathsRef.current = paths;
    model.resetPaths(paths, { initialExpandedPaths: expandedPaths });
  }, [filePaths, model, onOpenFile, paths]);

  useLayoutEffect(() => {
    if (!enabled || !revealPath) {
      revealedPath.current = null;
      return;
    }
    const relative = workspaceRelativePath(location.directory, revealPath);
    if (!relative) return;
    if (revealedPath.current === relative) return;
    const parts = relative.split("/");
    for (let index = 1; index < parts.length; index++) {
      const item = model.getItem(`${parts.slice(0, index).join("/")}/`);
      if (!item || !("expand" in item)) break;
      if (!item.isExpanded()) item.expand();
    }
    const file = model.getItem(relative);
    if (!file || file.isDirectory()) return;
    revealing.current = true;
    try {
      for (const path of model.getSelectedPaths())
        if (path !== relative) model.getItem(path)?.deselect();
      if (!file.isSelected()) file.select();
      model.scrollToPath(relative, { focus: false, offset: "nearest" });
      revealedPath.current = relative;
    } finally {
      revealing.current = false;
    }
  }, [enabled, location.directory, model, paths, revealPath]);

  const expandedListings = listings.filter(
    (_, index) =>
      !requestedDirectories[index] ||
      isExpandedDirectory(requestedDirectories[index]!, expandedDirectories),
  );
  const pendingDirectories = requestedDirectories.filter(
    (directory, index) =>
      directory &&
      isExpandedDirectory(directory, expandedDirectories) &&
      listings[index]?.isPending,
  );
  const failedDirectories = requestedDirectories.flatMap((directory, index) => {
    const listing = listings[index];
    return directory && isExpandedDirectory(directory, expandedDirectories) && listing?.isError
      ? [{ path: directory, error: listing.error, retry: listing.refetch }]
      : [];
  });

  return {
    model,
    root: listings[0]!,
    empty: paths.length === 0,
    isFetching: expandedListings.some((listing) => listing.isFetching),
    pendingDirectories,
    failedDirectories,
    refresh: () => Promise.all(expandedListings.map((listing) => listing.refetch())),
  };
}
