import { FileTree } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, RefreshCw, Search, X } from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { workspaceFileSelectionAtom } from "../../atoms/workspace-file-selection";
import { runtimeAtom } from "../../atoms/workspace";
import { cn } from "../../lib/cn";
import { workspaceRelativePath } from "../../lib/file-reference";
import { openCodeKeys } from "../../lib/opencode-query";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import {
  workbenchScopeKey,
  type WorkbenchPaneID,
  type WorkbenchScope,
  type WorkbenchTab,
} from "../../lib/workbench-tabs";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/workspace-file-drag";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  safeWorkspaceEntries,
  useWorkspaceFileTree,
  workspaceFileTreeStyle,
} from "./workspace-file-tree";

const SEARCH_LIMIT = 50;

// File API paths may be relative to the location or absolute on the server.
// Never send a path outside the owning location to file.list or a file tab.
export { workspaceRelativePath };

export function WorkspaceFilesTab({
  tab,
  pane,
  scope,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "workspace-files" }>;
  pane: WorkbenchPaneID;
  scope: WorkbenchScope;
  active?: boolean;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = tab.resource.location;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const commands = useWorkbenchCommands(scope);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const connected = canFetchOpenCode(runtime) && runtime?.profileID === tab.resource.profileID;
  const queryText = search.trim();
  const selections = useAtomValue(workspaceFileSelectionAtom);
  const selection = selections[workbenchScopeKey(scope)];
  const revealPath =
    selection?.location.directory === location.directory &&
    selection.location.workspaceID === location.workspaceID
      ? selection.path
      : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(queryText), 200);
    return () => window.clearTimeout(timer);
  }, [queryText]);
  const tree = useWorkspaceFileTree({
    location,
    connectionID,
    enabled: active && connected && !queryText,
    onOpenFile: openFile,
    revealPath,
  });
  const results = useQuery({
    queryKey: openCodeKeys.fileSearch(connectionID, location, debouncedSearch),
    queryFn: ({ signal }) =>
      palot.findWorkspaceFiles(
        { ...location, query: debouncedSearch, limit: SEARCH_LIMIT },
        signal,
        connectionID,
      ),
    enabled: active && connected && !!debouncedSearch && debouncedSearch === queryText,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const searching = !!queryText;
  const query = searching ? results : tree.root;
  const visible = safeWorkspaceEntries(location.directory, results.data ?? [])
    .filter((entry) => entry.type === "file")
    .slice(0, SEARCH_LIMIT);
  const isFetching = searching ? results.isFetching : tree.isFetching;
  const refresh = () => (searching ? results.refetch() : tree.refresh());

  useEffect(() => {
    const host = containerRef.current?.querySelector<HTMLElement>("file-tree-container");
    const root = host?.shadowRoot;
    if (!host || !root) return;
    // Host attributes do not propagate through @pierre/trees' shadow boundary.
    const sync = () => {
      root.querySelector('[role="tree"]')?.setAttribute("aria-label", "Workspace files");
      for (const row of root.querySelectorAll<HTMLElement>('[data-item-type="file"]'))
        row.draggable = true;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    const start = (event: DragEvent) => {
      const row = event
        .composedPath()
        .find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.dataset.itemType === "file",
        );
      const path = row?.dataset.itemPath;
      if (!path || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        WORKSPACE_FILE_DRAG_TYPE,
        JSON.stringify({ profileID: tab.resource.profileID, ...location, path }),
      );
    };
    host.addEventListener("dragstart", start);
    return () => {
      observer.disconnect();
      host.removeEventListener("dragstart", start);
    };
  }, [
    location,
    tab.resource.profileID,
    tree.model,
    tree.empty,
    query.isPending,
    searching,
    connected,
  ]);

  function openFile(path: string) {
    const relative = workspaceRelativePath(location.directory, path);
    if (!relative) return;
    const result = commands.openTab({ kind: "file", location, path: relative }, { pane });
    setOpenError(result?.ok ? null : "Too many workbench tabs. Close a tab and try again.");
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-background p-2">
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="min-w-0 truncate px-1.5 py-1 text-meta font-medium"
            title={location.directory}
          >
            {location.directory.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "/"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto shrink-0"
            aria-label={searching ? "Refresh search" : "Refresh workspace files"}
            disabled={!connected || (searching && debouncedSearch !== queryText)}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn(isFetching && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search workspace files"
            placeholder="Search workspace files"
            className="min-w-0 pl-8 pr-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.preventDefault();
                setSearch("");
              }
            }}
          />
          {search ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1"
              aria-label="Clear file search"
              onClick={() => setSearch("")}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      {openError ? (
        <p role="alert" className="px-3 py-2 text-meta text-destructive">
          {openError}
        </p>
      ) : null}
      {!connected ? (
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>Files unavailable</EmptyTitle>
            <EmptyDescription>Reconnect to this workspace to browse files.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (searching && debouncedSearch !== queryText) || query.isPending ? (
        <div
          role="status"
          className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground"
        >
          <Spinner /> {searching ? "Searching files" : "Loading files"}
        </div>
      ) : query.isError ? (
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>
              {searching ? "Could not search files" : "Could not load directory"}
            </EmptyTitle>
            <EmptyDescription>{query.error.message}</EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Empty>
      ) : searching ? (
        visible.length === 0 ? (
          <Empty className="min-h-0 flex-1 rounded-none p-5">
            <EmptyHeader>
              <EmptyTitle>No matching files</EmptyTitle>
              <EmptyDescription>Try a different filename.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            role="region"
            className="palot-native-scrollbar min-h-0 flex-1 overflow-auto py-1"
            aria-label="Search results"
          >
            {visible.map((entry) => {
              return (
                <button
                  key={`${entry.type}:${entry.path}`}
                  type="button"
                  className="flex min-h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-tree hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
                  title={entry.path}
                  onClick={() => openFile(entry.path)}
                >
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate">{entry.path}</span>
                </button>
              );
            })}
            {visible.length === SEARCH_LIMIT ? (
              <p className="px-3 py-2 text-meta text-muted-foreground">
                Showing the first {SEARCH_LIMIT} files. Refine your search for more.
              </p>
            ) : null}
          </div>
        )
      ) : tree.empty ? (
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>No files in this directory</EmptyTitle>
            <EmptyDescription>This directory has no visible files or folders.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {tree.pendingDirectories.map((path) => (
            <p key={path} role="status" className="px-3 py-1 text-meta text-muted-foreground">
              Loading {path}…
            </p>
          ))}
          {tree.failedDirectories.map(({ path, error, retry }) => (
            <div key={path} role="alert" className="px-3 py-1 text-meta text-destructive">
              Could not load {path}: {error.message}
              <Button type="button" variant="ghost" size="xs" onClick={() => void retry()}>
                Retry
              </Button>
            </div>
          ))}
          <FileTree
            model={tree.model}
            aria-label="Workspace files"
            className="min-h-0 flex-1 overflow-hidden"
            style={workspaceFileTreeStyle}
          />
        </div>
      )}
    </div>
  );
}
