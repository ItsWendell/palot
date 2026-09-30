import type { FileSystemEntry } from "@opencode/client";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, Folder, RefreshCw, Search, X } from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { cn } from "../../lib/cn";
import { openCodeKeys } from "../../lib/opencode-query";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import type { WorkbenchPaneID, WorkbenchScope, WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

const SEARCH_LIMIT = 50;

// File API paths may be relative to the location or absolute on the server.
// Never send a path outside the owning location to file.list or a file tab.
export function workspaceRelativePath(root: string, path: string): string | null {
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  const entry = path.replaceAll("\\", "/");
  if (!entry || entry.includes("\0") || entry.split("/").includes("..")) return null;
  const absolute = entry.startsWith("/") || /^[a-zA-Z]:\//.test(entry);
  const relative = absolute
    ? entry === base
      ? ""
      : entry.startsWith(`${base === "/" ? "" : base}/`)
        ? entry.slice(base === "/" ? 1 : base.length + 1)
        : null
    : entry;
  if (relative === null || relative.startsWith("/") || relative.includes(":")) return null;
  return relative
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function safeEntries(
  root: string,
  entries: FileSystemEntry[],
): Array<FileSystemEntry & { path: string }> {
  return entries.flatMap((entry) => {
    const path = workspaceRelativePath(root, entry.path);
    return path && (entry.type === "file" || entry.type === "directory")
      ? [{ type: entry.type, path }]
      : [];
  });
}

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
  const location = tab.resource.location;
  const [directory, setDirectory] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const currentDirectoryRef = useRef<HTMLButtonElement>(null);
  const commands = useWorkbenchCommands(scope);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const connected = canFetchOpenCode(runtime) && runtime?.profileID === tab.resource.profileID;
  const queryText = search.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(queryText), 200);
    return () => window.clearTimeout(timer);
  }, [queryText]);
  useEffect(() => {
    if (directory) currentDirectoryRef.current?.focus();
  }, [directory]);

  const listing = useQuery({
    queryKey: openCodeKeys.fileDirectory(connectionID, location, directory),
    queryFn: ({ signal }) =>
      palot.listWorkspaceDirectory(
        { ...location, ...(directory ? { path: directory } : {}) },
        signal,
        connectionID,
      ),
    enabled: active && connected && !queryText,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
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
  const query = searching ? results : listing;
  const entries = safeEntries(location.directory, query.data ?? []);
  const visible = searching
    ? entries.filter((entry) => entry.type === "file").slice(0, SEARCH_LIMIT)
    : entries
        .filter((entry) => {
          const parent = entry.path.split("/").slice(0, -1).join("/");
          return parent === directory;
        })
        .toSorted((left, right) =>
          left.type === right.type
            ? left.path.localeCompare(right.path)
            : left.type === "directory"
              ? -1
              : 1,
        );
  const crumbs = directory.split("/").filter(Boolean);

  function openFile(path: string) {
    const result = commands.openTab({ kind: "file", location, path }, { pane });
    setOpenError(result?.ok ? null : "Too many workbench tabs. Close a tab and try again.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-background p-2">
        <nav className="flex min-w-0 items-center gap-1" aria-label="Workspace path">
          <button
            ref={directory ? undefined : currentDirectoryRef}
            type="button"
            aria-current={!directory ? "location" : undefined}
            className="max-w-36 truncate rounded-sm px-1.5 py-1 text-meta font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title={location.directory}
            onClick={() => setDirectory("")}
          >
            {location.directory.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "/"}
          </button>
          {crumbs.map((name, index) => {
            const path = crumbs.slice(0, index + 1).join("/");
            return (
              <span key={path} className="flex min-w-0 items-center gap-1 text-meta">
                <span className="text-muted-foreground" aria-hidden="true">
                  /
                </span>
                <button
                  ref={index === crumbs.length - 1 ? currentDirectoryRef : undefined}
                  type="button"
                  aria-current={index === crumbs.length - 1 ? "location" : undefined}
                  title={path}
                  className="max-w-32 truncate rounded-sm px-1.5 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setDirectory(path)}
                >
                  {name}
                </button>
              </span>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto shrink-0"
            aria-label={searching ? "Refresh search" : "Refresh directory"}
            disabled={!connected || (searching && debouncedSearch !== queryText)}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden="true" />
          </Button>
        </nav>
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
      ) : visible.length === 0 ? (
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>
              {searching ? "No matching files" : "No files in this directory"}
            </EmptyTitle>
            <EmptyDescription>
              {searching
                ? "Try a different filename."
                : "This directory has no visible files or folders."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          role="region"
          className="palot-native-scrollbar min-h-0 flex-1 overflow-auto py-1"
          aria-label={searching ? "Search results" : "Directory contents"}
        >
          {visible.map((entry) => {
            const name = entry.path.split("/").at(-1);
            return (
              <button
                key={`${entry.type}:${entry.path}`}
                type="button"
                className="flex min-h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-tree hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
                title={entry.path}
                onClick={() =>
                  entry.type === "directory" ? setDirectory(entry.path) : openFile(entry.path)
                }
              >
                {entry.type === "directory" ? (
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">{searching ? entry.path : name}</span>
              </button>
            );
          })}
          {searching && visible.length === SEARCH_LIMIT ? (
            <p className="px-3 py-2 text-meta text-muted-foreground">
              Showing the first {SEARCH_LIMIT} files. Refine your search for more.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
