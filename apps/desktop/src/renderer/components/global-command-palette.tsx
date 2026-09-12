import { RotateCw, SearchIcon } from "lucide-react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PalotSession } from "../../shared";
import { commandPaletteOpenAtom, commandPaletteReturnFocusAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { useGlobalCommands } from "../hooks/use-global-commands";
import { rankGlobalCommands } from "../lib/global-command-search";
import { cn } from "../lib/cn";
import {
  defaultGlobalCommands,
  formatCommandShortcut,
  groupGlobalCommands,
  type GlobalCommand,
} from "../lib/global-commands";
import { showErrorToast } from "../lib/toast-error";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { listRootSessionInfo } from "../services/opencode-catalog";
import { mapSession } from "../services/opencode-mappers";
import { palot } from "../services/palot";
import { useSessionCatalog } from "../hooks/use-session-catalog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";

type PalettePage = "root" | "projects";

interface PaletteGroup {
  id: string;
  label: string;
  items: string[];
}

const RETRY_SEARCH_ID = "retry remote task search";
const LOAD_MORE_ID = "load more remote task results";
const COMMAND_ITEM_CLASS =
  "palot-command-row group/command-item relative flex min-h-10 cursor-default items-center gap-2 rounded-xl px-3 py-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50";

function mergeSessions(loaded: readonly PalotSession[], remote: readonly PalotSession[]) {
  const byID = new Map(loaded.map((session) => [session.id, session]));
  for (const session of remote) byID.set(session.id, session);
  return [...byID.values()];
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [returnFocus, setReturnFocus] = useAtom(commandPaletteReturnFocusAtom);
  const loadedSessions = useSessionCatalog();
  const runtime = useAtomValue(runtimeAtom);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<PalettePage>("root");
  const [debouncedSearch, setDebouncedSearch] = useState<{
    scope: string;
    query: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousRemotePageCountRef = useRef(0);
  const deferredQuery = useDeferredValue(query.trim());
  const searchScope =
    open && page === "root" && deferredQuery.length >= 2
      ? `${runtime?.connectionID ?? "disconnected"}:${deferredQuery}`
      : null;
  const searchQuery = debouncedSearch?.scope === searchScope ? debouncedSearch.query : "";
  const search = useInfiniteQuery({
    queryKey: openCodeKeys.search(runtime?.connectionID ?? "disconnected", searchQuery),
    enabled:
      (palot.isPreview() || canFetchOpenCode(runtime)) &&
      open &&
      page === "root" &&
      searchQuery.length >= 2,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listRootSessionInfo(
        { limit: 50, search: searchQuery, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.cursor.next ?? undefined,
    retry: false,
  });
  const remoteSessions = useMemo(
    () => search.data?.pages.flatMap((result) => result.data.map(mapSession)) ?? [],
    [search.data],
  );
  const sessions = useMemo(
    () => mergeSessions(loadedSessions, remoteSessions),
    [loadedSessions, remoteSessions],
  );
  const { commands, projectCommands } = useGlobalCommands({
    sessions,
    onChooseProject: () => {
      if (!open) {
        setReturnFocus(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
        setOpen(true);
      }
      setQuery("");
      setPage("projects");
    },
  });

  const reset = () => {
    setQuery("");
    setPage("root");
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const execute = (command: GlobalCommand) => {
    if (command.disabledReason) return;
    const run = () =>
      void Promise.resolve(command.run()).catch((error) => showErrorToast("Command failed", error));
    if (command.closeOnRun !== false) {
      close();
      if (command.runAfterClose) {
        window.setTimeout(run, 0);
        return;
      }
    }
    run();
  };

  useEffect(() => {
    if (searchScope === null) return;
    const timer = window.setTimeout(
      () => setDebouncedSearch({ scope: searchScope, query: deferredQuery }),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [deferredQuery, searchScope]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.altKey || event.getModifierState("AltGraph")) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-workbench-terminal]") &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key !== "`"
      )
        return;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();

      if (!event.shiftKey && key === "k") {
        event.preventDefault();
        if (open) {
          close();
          return;
        }
        if (document.querySelector('[data-slot="dialog-content"][data-open]')) return;
        setReturnFocus(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
        setOpen(true);
        return;
      }
      if (open) return;

      const commandID =
        event.ctrlKey && !event.shiftKey && key === "`"
          ? "task.terminal.toggle"
          : !event.shiftKey && key === ","
            ? "settings.open:general"
            : !event.shiftKey && key === "n"
              ? "task.new"
              : !event.shiftKey && key === "b"
                ? "navigation.toggle"
                : event.shiftKey && key === "i"
                  ? "task.changes.toggle"
                  : event.shiftKey && key === "r"
                    ? "app.restart"
                    : null;
      if (!commandID) return;
      event.preventDefault();
      if (document.querySelector('[data-slot="dialog-content"][data-open]')) return;
      const command = commands.find((candidate) => candidate.id === commandID);
      if (!command) return;
      execute(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const visibleCommands =
    page === "projects"
      ? rankGlobalCommands(projectCommands, deferredQuery)
      : deferredQuery
        ? rankGlobalCommands(commands, deferredQuery)
        : defaultGlobalCommands(commands);
  const groups = deferredQuery
    ? [{ group: "results" as const, label: "Results", commands: visibleCommands }]
    : groupGlobalCommands(visibleCommands);
  const commandByID = new Map(visibleCommands.map((command) => [command.id, command]));
  const paletteGroups: PaletteGroup[] = groups.map(
    ({ group, label, commands: groupedCommands }) => ({
      id: group,
      label,
      items: groupedCommands.map((command) => command.id),
    }),
  );
  if (search.isError) {
    paletteGroups.push({ id: "task-search", label: "Task search", items: [RETRY_SEARCH_ID] });
  }
  if (search.hasNextPage) {
    paletteGroups.push({ id: "more-tasks", label: "More tasks", items: [LOAD_MORE_ID] });
  }
  const resultOrder = paletteGroups.flatMap((group) => group.items).join("\0");
  const remotePageCount = search.data?.pages.length ?? 0;
  const paletteLabel = page === "projects" ? "Choose a project" : "Search tasks and commands";

  useLayoutEffect(() => {
    const appendedPage =
      previousRemotePageCountRef.current > 0 &&
      remotePageCount > previousRemotePageCountRef.current;
    previousRemotePageCountRef.current = remotePageCount;
    if (!appendedPage) resultsRef.current?.scrollTo({ top: 0 });
  }, [deferredQuery, page, remotePageCount, resultOrder]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        setOpen(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        surfaceTone="command"
        initialFocus={inputRef}
        finalFocus={() => (returnFocus?.isConnected ? returnFocus : false)}
        overlayClassName="palot-command-overlay"
        className="palot-command-palette top-[18vh] max-h-[min(680px,76vh)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[680px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Commands</DialogTitle>
          <DialogDescription>
            Search tasks, navigate Palot, or run an available command.
          </DialogDescription>
        </DialogHeader>
        <Autocomplete.Root
          open
          inline
          mode="none"
          items={paletteGroups}
          value={query}
          onValueChange={(nextQuery, details) => {
            if (details.reason !== "item-press") setQuery(nextQuery);
          }}
          itemToStringValue={(itemID) =>
            commandByID.get(itemID)?.title ??
            (itemID === RETRY_SEARCH_ID
              ? "Retry older task search"
              : itemID === LOAD_MORE_ID
                ? "Load more tasks"
                : itemID)
          }
          autoHighlight="always"
          keepHighlight
          onItemHighlighted={(itemID) => {
            if (itemID) void commandByID.get(itemID)?.preload?.();
          }}
        >
          <div
            className="flex size-full flex-col overflow-hidden rounded-none bg-transparent p-0 text-popover-foreground"
            onKeyDown={(event) => {
              if (
                page === "projects" &&
                (event.key === "Escape" || (!query && event.key === "Backspace"))
              ) {
                event.preventDefault();
                event.stopPropagation();
                setPage("root");
              } else if (page === "root" && event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          >
            <div className="border-b border-(--command-border)">
              {page === "projects" ? (
                <div className="px-4 pt-2.5 text-meta font-medium text-muted-foreground">
                  New task / Choose project
                </div>
              ) : null}
              <Autocomplete.InputGroup
                data-slot="command-palette-input"
                className="flex h-14 items-center gap-3 px-4"
              >
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Autocomplete.Input
                  ref={inputRef}
                  data-slot="command-input"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={
                    page === "projects" ? "Search projects..." : "Search tasks and commands..."
                  }
                  aria-label={paletteLabel}
                />
                {page === "root" ? (
                  <Kbd className="shrink-0 bg-foreground/6">
                    {formatCommandShortcut(["Meta", "K"])}
                  </Kbd>
                ) : null}
              </Autocomplete.InputGroup>
            </div>
            <div
              ref={resultsRef}
              className="palot-command-results no-scrollbar max-h-[min(480px,58vh)] scroll-py-3 overflow-x-hidden overflow-y-auto pb-1.5 outline-none"
              aria-busy={search.isFetching || undefined}
            >
              <Autocomplete.Empty className="py-6 text-center text-xs/relaxed">
                {page === "projects" ? "No matching projects." : "No matching tasks or commands."}
              </Autocomplete.Empty>
              <Autocomplete.List aria-label="Command results">
                {(group: PaletteGroup) => (
                  <Autocomplete.Group
                    key={group.id}
                    items={group.items}
                    data-slot="command-group"
                    className="overflow-visible px-1.5 pb-1 text-foreground"
                  >
                    <Autocomplete.GroupLabel
                      data-slot="command-group-heading"
                      className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {group.label}
                    </Autocomplete.GroupLabel>
                    <Autocomplete.Collection>
                      {(itemID: string) => {
                        if (itemID === RETRY_SEARCH_ID) {
                          return (
                            <Autocomplete.Item
                              key={itemID}
                              value={itemID}
                              onClick={() => void search.refetch()}
                              className={COMMAND_ITEM_CLASS}
                            >
                              <RotateCw aria-hidden="true" />
                              Retry older task search
                            </Autocomplete.Item>
                          );
                        }
                        if (itemID === LOAD_MORE_ID) {
                          return (
                            <Autocomplete.Item
                              key={itemID}
                              value={itemID}
                              onClick={() => void search.fetchNextPage()}
                              className={COMMAND_ITEM_CLASS}
                            >
                              <RotateCw
                                className={search.isFetchingNextPage ? "animate-spin" : undefined}
                                aria-hidden="true"
                              />
                              Load more tasks
                            </Autocomplete.Item>
                          );
                        }

                        const command = commandByID.get(itemID);
                        if (!command) return null;
                        const Icon = command.icon;
                        return (
                          <Autocomplete.Item
                            key={command.id}
                            value={command.id}
                            disabled={Boolean(command.disabledReason)}
                            onClick={() => execute(command)}
                            onMouseEnter={() => void command.preload?.()}
                            className={COMMAND_ITEM_CLASS}
                          >
                            {Icon ? <Icon aria-hidden="true" /> : null}
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-medium">{command.title}</span>
                              {command.description || command.disabledReason ? (
                                <span className="truncate text-xs text-muted-foreground group-data-highlighted/command-item:text-foreground/70">
                                  {command.disabledReason ?? command.description}
                                </span>
                              ) : null}
                            </span>
                            {command.shortcut ? (
                              <span className="ml-auto text-micro tracking-widest text-muted-foreground group-data-highlighted/command-item:text-foreground">
                                {formatCommandShortcut(command.shortcut)}
                              </span>
                            ) : command.status || command.trailing ? (
                              <span className="ml-auto flex items-center gap-1.5 text-micro tracking-normal text-muted-foreground group-data-highlighted/command-item:text-foreground">
                                {command.status ? (
                                  <span
                                    className={cn(
                                      "size-2 shrink-0 rounded-full",
                                      command.status === "attention"
                                        ? "bg-warning"
                                        : command.status === "unread"
                                          ? "bg-info"
                                          : "bg-success",
                                    )}
                                    aria-label={
                                      command.status === "attention"
                                        ? "Needs attention"
                                        : command.status === "unread"
                                          ? "Unread task activity"
                                          : "Running"
                                    }
                                  />
                                ) : null}
                                {command.trailing ? <span>{command.trailing}</span> : null}
                              </span>
                            ) : null}
                          </Autocomplete.Item>
                        );
                      }}
                    </Autocomplete.Collection>
                  </Autocomplete.Group>
                )}
              </Autocomplete.List>
              {search.isFetching && !search.isFetchingNextPage ? (
                <div
                  data-slot="command-group"
                  className="overflow-visible px-1.5 pb-1 text-foreground"
                >
                  <div
                    data-slot="command-group-heading"
                    className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    Searching
                  </div>
                  <div
                    className="flex h-10 items-center gap-2 px-3 text-xs text-muted-foreground"
                    role="status"
                  >
                    <RotateCw className="size-3.5 animate-spin" aria-hidden="true" />
                    Searching older tasks...
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex h-9 items-center gap-4 border-t border-(--command-border) px-4 text-micro text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Kbd>↑↓</Kbd> Navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> Run
              </span>
              {page === "projects" ? (
                <span className="flex items-center gap-1.5">
                  <Kbd>⌫</Kbd> Back
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <Kbd>esc</Kbd> Close
              </span>
            </div>
            <Autocomplete.Status className="sr-only">
              {search.isFetching ? "Searching older tasks" : `${visibleCommands.length} results`}
            </Autocomplete.Status>
          </div>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  );
}
