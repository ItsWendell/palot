import {
  FileText,
  MessageSquareText,
  RotateCw,
  SearchIcon,
  Settings2,
  TextSearch,
} from "lucide-react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  createContext,
  useContext,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import type { PalotSession } from "../../shared";
import { commandPaletteTabAtom, globalCommandRequestAtom } from "../atoms/command-requests";
import { commandPaletteOpenAtom, commandPaletteReturnFocusAtom } from "../atoms/ui";
import { transcriptJumpTargetAtom, useWorkbenchCommands } from "../atoms/workbench";
import { runtimeAtom } from "../atoms/workspace";
import { workspaceFileSearchQueryOptions } from "../hooks/use-composer-discovery";
import { useConnectionOverview, type ConnectionOverview } from "../hooks/use-connection-overview";
import { useFluidHover, useRegisterFluidHoverItem } from "../hooks/use-fluid-hover";
import { useGlobalCommands } from "../hooks/use-global-commands";
import { requestTranscriptJump, useMessageSearch } from "../hooks/use-message-search";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import {
  adjacentPaletteTab,
  PALETTE_FILE_ENTER_LABEL,
  paletteEnterLabel,
  paletteFileSearch,
  paletteResultGroups,
  paletteTabStep,
  rankGlobalCommands,
} from "../lib/global-command-search";
import { cn } from "../lib/cn";
import { groupGlobalCommands, type GlobalCommand } from "../lib/global-commands";
import {
  formatShortcut,
  matchesShortcut,
  recentTaskShortcutIndex,
  shortcutKeys,
  shortcutPlatform,
  type KeyboardShortcutID,
  type ShortcutKeys,
} from "../lib/keyboard-shortcuts";
import {
  ALL_TAB_MESSAGE_LIMIT,
  MESSAGE_SEARCH_LIMIT,
  messageSearchConnectionKey,
  type MessageSearchHit,
} from "../lib/message-search";
import {
  adjacentPaletteTask,
  mergePaletteTasks,
  paletteTaskCommandID,
  type PaletteTask,
  type PaletteTaskStatus,
} from "../lib/palette-tasks";
import { showErrorToast } from "../lib/toast-error";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { SETTINGS_SEARCH_CATALOG } from "../lib/settings-search-catalog";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";
import { formatRelativeTime, projectForSession, projectName } from "../lib/view-models";
import { listRootSessionInfo } from "../services/opencode-catalog";
import { mapSession } from "../services/opencode-mappers";
import { palot } from "../services/palot";
import { useSessionCatalog } from "../hooks/use-session-catalog";
import { CommandPaletteDialog } from "./command-palette-dialog";
import { PaletteTabs } from "./palette-tabs";
import { DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { FluidHoverHighlight } from "./ui/fluid-hover-highlight";
import { Kbd, ShortcutKbd } from "./ui/kbd";

type PalettePage = "root" | "projects";

interface PaletteGroup {
  id: string;
  label: string;
  hint?: string;
  items: string[];
}

interface SearchTarget {
  key: string;
  profileID: string | null;
  connectionID: string | undefined;
  serverName: string | null;
}

interface SearchPage {
  results: { target: string; sessions: PalotSession[]; next?: string }[];
}

const RETRY_SEARCH_ID = "retry remote task search";
const LOAD_MORE_ID = "load more remote task results";
const FILE_ITEM_PREFIX = "palette-file:";
const FILE_SEARCH_DEBOUNCE_MS = 150;
const MESSAGE_ITEM_PREFIX = "palette-message:";
const SEARCH_RECENT_MESSAGES_ID = "search recent task messages";
const RETRY_MESSAGE_SEARCH_ID = "retry message search";

function fileItemPath(itemID: string): string | null {
  return itemID.startsWith(FILE_ITEM_PREFIX) ? itemID.slice(FILE_ITEM_PREFIX.length) : null;
}
// Rows draw no hover or highlight fill of their own: one FluidHoverHighlight glides behind them.
const COMMAND_ITEM_CLASS =
  "group/command-item relative flex min-h-9 cursor-default items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
const SECONDARY_TEXT_CLASS =
  "text-muted-foreground group-data-highlighted/command-item:text-foreground/70";

/** Global shortcuts that run a palette command; the catalog owns their keys. */
const DIRECT_SHORTCUTS: readonly (readonly [KeyboardShortcutID, string])[] = [
  ["task.terminal.toggle", "task.terminal.toggle"],
  ["task.voice.toggle", "task.voice.toggle"],
  ["settings.open", "settings.open:general"],
  ["task.new", "task.new"],
  ["task.choose-project", "task.choose-project"],
  ["navigation.toggle", "navigation.toggle"],
  ["task.changes.toggle", "task.changes.toggle"],
  ["composer.focus", "task.focusComposer"],
  ["app.restart", "app.restart"],
];

function overviewTaskStatus(
  item: ConnectionOverview["inbox"]["inbox"][number] | undefined,
  session: PalotSession,
): PaletteTaskStatus | undefined {
  if (item?.attention) return "attention";
  if (item?.running) return "running";
  return catalogSessionIsUnread(session) ? "unread" : undefined;
}

/** Root tasks from every scoped connection, labelled and owned by their server. */
function overviewTasks(connections: readonly ConnectionOverview[]): PaletteTask[] {
  return connections.flatMap((connection) => {
    const rows = new Map(
      (["pinned", "inbox", "snoozed", "settled"] as const).flatMap((section) =>
        connection.inbox[section].map((item) => [item.session.id, item] as const),
      ),
    );
    const connected = connection.runtime?.connected === true;
    return connection.sessions.map((session): PaletteTask => {
      const project = projectForSession(connection.projects, session);
      return {
        session,
        profileID: connection.profile.id,
        connectionID: connection.runtime?.connectionID ?? null,
        projectName: project ? projectName(project) : null,
        serverName: connection.profile.name,
        connected,
        status: overviewTaskStatus(rows.get(session.id), session),
      };
    });
  });
}

export function GlobalCommandPalette() {
  const navigate = useNavigate();
  const routeProjectID = useRouterState({
    select: (state) => (state.location.search as { projectID?: string }).projectID,
  });
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [returnFocus, setReturnFocus] = useAtom(commandPaletteReturnFocusAtom);
  const loadedSessions = useSessionCatalog();
  const runtime = useAtomValue(runtimeAtom);
  const overview = useConnectionOverview();
  const routeSessionID = useRouterState({
    select: (state) =>
      state.matches
        .map((match) => (match.params as { sessionID?: string }).sessionID)
        .find((value) => typeof value === "string") ?? null,
  });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<PalettePage>("root");
  const [tab, setTab] = useAtom(commandPaletteTabAtom);
  const [commandRequest, setCommandRequest] = useAtom(globalCommandRequestAtom);
  const [highlight] = useState(createHighlightStore);
  const [debouncedSearch, setDebouncedSearch] = useState<{
    scope: string;
    query: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previousRemotePageCountRef = useRef(0);
  const deferredQuery = useDeferredValue(query.trim());

  // With several servers, tasks come from every enabled server shown in the sidebar and
  // always open on their own connection.
  const multiConnection = overview.connections.length > 1;
  const scopedConnections = useMemo(
    () =>
      multiConnection
        ? overview.connections.filter(
            (connection) =>
              overview.includedProfileIDs.includes(connection.profile.id) &&
              (overview.visibleProfileIDs === null ||
                overview.visibleProfileIDs.includes(connection.profile.id)),
          )
        : [],
    [
      multiConnection,
      overview.connections,
      overview.includedProfileIDs,
      overview.visibleProfileIDs,
    ],
  );
  const recentTasks = useMemo(
    () =>
      mergePaletteTasks(
        multiConnection
          ? overviewTasks(scopedConnections)
          : loadedSessions.map((session): PaletteTask => ({
              session,
              profileID: null,
              connectionID: runtime?.connectionID ?? null,
              serverName: null,
              connected: true,
            })),
      ),
    [multiConnection, scopedConnections, loadedSessions, runtime?.connectionID],
  );
  const searchTargets = useMemo<SearchTarget[]>(
    () =>
      multiConnection
        ? scopedConnections.flatMap((connection) =>
            connection.runtime?.connected
              ? [
                  {
                    key: connection.profile.id,
                    profileID: connection.profile.id,
                    connectionID: connection.runtime.connectionID,
                    serverName: connection.profile.name,
                  },
                ]
              : [],
          )
        : palot.isPreview() || canFetchOpenCode(runtime)
          ? [
              {
                key: runtime?.connectionID ?? "disconnected",
                profileID: null,
                connectionID: undefined,
                serverName: null,
              },
            ]
          : [],
    [multiConnection, scopedConnections, runtime],
  );
  const targetsSignature = searchTargets
    .map((target) => `${target.key}=${target.connectionID ?? runtime?.connectionID ?? ""}`)
    .join(",");
  const searchesTasks = page === "root" && (tab === "all" || tab === "tasks");
  const searchScope =
    open && searchesTasks && deferredQuery.length >= 2
      ? `${targetsSignature}:${deferredQuery}`
      : null;
  const searchQuery = debouncedSearch?.scope === searchScope ? debouncedSearch.query : "";
  const search = useInfiniteQuery({
    queryKey: ["palot", "palette-task-search", targetsSignature, searchQuery],
    enabled: searchTargets.length > 0 && open && searchesTasks && searchQuery.length >= 2,
    initialPageParam: null as Record<string, string> | null,
    queryFn: async ({ pageParam, signal }): Promise<SearchPage> => {
      const targets = pageParam
        ? searchTargets.filter((target) => pageParam[target.key])
        : searchTargets;
      const settled = await Promise.allSettled(
        targets.map(async (target) => {
          const input = {
            limit: 50,
            search: searchQuery,
            ...(pageParam?.[target.key] ? { cursor: pageParam[target.key] } : {}),
          };
          const response = target.connectionID
            ? await listRootSessionInfo(input, signal, target.connectionID)
            : await listRootSessionInfo(input, signal);
          return {
            target: target.key,
            sessions: response.data.map(mapSession),
            next: response.cursor.next ?? undefined,
          };
        }),
      );
      const results = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failure = settled.find((result) => result.status === "rejected");
      // One unreachable server must not hide matches from the others.
      if (results.length === 0 && failure?.status === "rejected") throw failure.reason;
      return { results };
    },
    getNextPageParam: (lastPage) => {
      const cursors = Object.fromEntries(
        lastPage.results.flatMap((result) => (result.next ? [[result.target, result.next]] : [])),
      );
      return Object.keys(cursors).length > 0 ? cursors : undefined;
    },
    retry: false,
  });
  const remoteTasks = useMemo(() => {
    const targets = new Map(searchTargets.map((target) => [target.key, target]));
    return (
      search.data?.pages.flatMap((result) =>
        result.results.flatMap(({ target: key, sessions }) => {
          const target = targets.get(key);
          if (!target) return [];
          return sessions.map((session): PaletteTask => ({
            session,
            profileID: target.profileID,
            connectionID: target.connectionID ?? runtime?.connectionID ?? null,
            serverName: target.serverName,
            connected: true,
          }));
        }),
      ) ?? []
    );
  }, [search.data, searchTargets, runtime?.connectionID]);
  const tasks = useMemo(
    () => (searchQuery ? mergePaletteTasks(recentTasks, remoteTasks) : recentTasks),
    [recentTasks, remoteTasks, searchQuery],
  );
  const showPalette = (nextPage: PalettePage) => {
    if (!open) {
      setReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setOpen(true);
    }
    setQuery("");
    setPage(nextPage);
  };
  const { commands, projectCommands } = useGlobalCommands({
    tasks,
    recentTasks,
    onChooseProject: () => showPalette("projects"),
    onOpenFiles: () => {
      showPalette("root");
      setTab("files");
    },
  });

  // The open task's files, from OpenCode's workspace file search.
  const fileTask = routeSessionID
    ? (loadedSessions.find((candidate) => candidate.id === routeSessionID) ?? null)
    : null;
  const fileScope =
    runtime && fileTask ? { profileID: runtime.profileID, sessionID: fileTask.id } : null;
  const fileWorkbench = useWorkbenchCommands(fileScope);
  const fileSearch =
    open && page === "root" ? paletteFileSearch(tab, deferredQuery, Boolean(fileTask)) : null;
  const [debouncedFileQuery, setDebouncedFileQuery] = useState<string | null>(null);
  const fileQueryText = fileSearch?.query ?? null;
  useEffect(() => {
    if (fileQueryText === null) return;
    // An empty Files tab lists files right away; typing waits for a pause.
    const timer = window.setTimeout(
      () => setDebouncedFileQuery(fileQueryText),
      fileQueryText ? FILE_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [fileQueryText]);
  const files = useQuery({
    ...workspaceFileSearchQueryOptions(
      runtime?.connectionID ?? "disconnected",
      fileTask?.location ?? { directory: "" },
      debouncedFileQuery ?? "",
      Boolean(fileSearch && debouncedFileQuery !== null) &&
        (palot.isPreview() || canFetchOpenCode(runtime)),
    ),
    placeholderData: keepPreviousData,
  });
  const fileRows = fileSearch
    ? (files.data ?? [])
        .filter((entry) => entry.type === "file")
        .slice(0, fileSearch.limit)
        .map((entry) => `${FILE_ITEM_PREFIX}${entry.path}`)
    : [];
  const searchingFiles = Boolean(fileSearch) && files.isFetching && fileRows.length === 0;

  // Message text across tasks: hydrated transcripts, then on request the latest messages of
  // recent tasks. Native session search matches titles only.
  const queryClient = useQueryClient();
  const setTranscriptJumpTarget = useSetAtom(transcriptJumpTargetAtom);
  const searchesMessages = page === "root" && (tab === "all" || tab === "tasks");
  const messageSearch = useMessageSearch({
    open,
    active: searchesMessages,
    query: deferredQuery,
    tasks: recentTasks,
    canFetch: multiConnection || palot.isPreview() || canFetchOpenCode(runtime),
    limit: tab === "all" ? ALL_TAB_MESSAGE_LIMIT : MESSAGE_SEARCH_LIMIT,
  });
  const messageHits = new Map<string, MessageSearchHit>(
    messageSearch.hits.map((hit) => [`${MESSAGE_ITEM_PREFIX}${hit.id}`, hit]),
  );

  const reset = () => {
    setQuery("");
    setPage("root");
    setTab("all");
    highlight.set(null);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const openFile = (path: string) => {
    close();
    if (!fileTask) return;
    const result = fileWorkbench.openTab(
      { kind: "file", location: fileTask.location, path },
      { pane: "right" },
    );
    if (!result?.ok) {
      showErrorToast(
        "Could not open file",
        new Error("Too many workbench tabs. Close a tab and try again."),
      );
    }
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, page]);

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

  // Opens the task on its own connection, then scrolls to the match's turn once it hydrates.
  const openMessage = (hit: MessageSearchHit) => {
    const command = commands.find((candidate) => candidate.id === paletteTaskCommandID(hit.task));
    if (!command) return;
    if (hit.anchorMessageID) {
      requestTranscriptJump(queryClient, setTranscriptJumpTarget, {
        connectionID: messageSearchConnectionKey(hit.task),
        sessionID: hit.task.session.id,
        messageID: hit.anchorMessageID,
      });
    }
    execute(command);
  };

  // Slash commands such as /fork and /open run palette commands by ID.
  const runRequestedCommand = useEffectEvent((commandID: string) => {
    const command = commands.find((candidate) => candidate.id === commandID);
    if (command) execute(command);
    else showErrorToast("Command unavailable", new Error("Open a task to use this command."));
  });
  useEffect(() => {
    if (!commandRequest) return;
    setCommandRequest(null);
    runRequestedCommand(commandRequest.commandID);
  }, [commandRequest, setCommandRequest]);

  useEffect(() => {
    if (searchScope === null) return;
    const timer = window.setTimeout(
      () => setDebouncedSearch({ scope: searchScope, query: deferredQuery }),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [deferredQuery, searchScope]);

  useEffect(() => {
    const otherDialogOpen = () =>
      !open && Boolean(document.querySelector('[data-slot="dialog-content"][data-open]'));
    const runTask = (task: PaletteTask | null | undefined) => {
      if (!task) return;
      const command = commands.find((candidate) => candidate.id === paletteTaskCommandID(task));
      if (command) execute(command);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const inTerminal =
        event.target instanceof Element &&
        Boolean(event.target.closest("[data-workbench-terminal]"));

      // On macOS, Option+digit types characters such as ¡ or £; keep that inside text fields.
      const typesCharacter = shortcutPlatform() === "mac" && isEditableTarget(event.target);
      const recentIndex = inTerminal || typesCharacter ? null : recentTaskShortcutIndex(event);
      if (recentIndex !== null) {
        if (otherDialogOpen()) return;
        const task = recentTasks[recentIndex - 1];
        if (!task) return;
        event.preventDefault();
        runTask(task);
        return;
      }

      // New chat defaults to Mod+Alt+N; matchesShortcut tells that chord apart from AltGr typing.
      if (!open && matchesShortcut(event, shortcutKeys("chat.new"))) {
        event.preventDefault();
        if (otherDialogOpen()) return;
        const command = commands.find((candidate) => candidate.id === "chat.new");
        if (command) execute(command);
        return;
      }

      if (event.altKey || event.getModifierState("AltGraph")) return;
      if (inTerminal && event.ctrlKey && !event.metaKey && !event.shiftKey && event.key !== "`")
        return;
      if (!event.metaKey && !event.ctrlKey) return;

      if (matchesShortcut(event, shortcutKeys("palette.open"))) {
        event.preventDefault();
        if (open) {
          close();
          return;
        }
        if (otherDialogOpen()) return;
        setReturnFocus(
          document.activeElement instanceof HTMLElement ? document.activeElement : null,
        );
        setOpen(true);
        return;
      }
      if (open) return;

      const direction = matchesShortcut(event, shortcutKeys("task.next"))
        ? 1
        : matchesShortcut(event, shortcutKeys("task.previous"))
          ? -1
          : 0;
      if (direction !== 0) {
        event.preventDefault();
        if (otherDialogOpen()) return;
        runTask(
          adjacentPaletteTask(
            recentTasks,
            { sessionID: routeSessionID, profileID: runtime?.profileID ?? null },
            direction,
          ),
        );
        return;
      }

      const commandID = DIRECT_SHORTCUTS.find(([shortcut]) =>
        matchesShortcut(event, shortcutKeys(shortcut)),
      )?.[1];
      if (!commandID) return;
      event.preventDefault();
      if (otherDialogOpen()) return;
      const command = commands.find((candidate) => candidate.id === commandID);
      if (!command) return;
      execute(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const searching = Boolean(deferredQuery);
  const groups: { group: string; label: string; hint?: string; commands: GlobalCommand[] }[] =
    page === "projects"
      ? groupGlobalCommands(rankGlobalCommands(projectCommands, deferredQuery))
      : paletteResultGroups(commands, deferredQuery, tab).map((group) =>
          !searching && group.group === "tasks"
            ? { ...group, hint: formatShortcut(shortcutKeys("task.recent")) }
            : group,
        );
  if (page === "root" && searching && (tab === "all" || tab === "settings")) {
    const settings = rankGlobalCommands(
      SETTINGS_SEARCH_CATALOG.map((setting): GlobalCommand => ({
        id: `settings.row:${setting.route}:${setting.title}`,
        title: setting.title,
        description: SETTINGS_NAV_ITEMS.find((item) => item.id === setting.route.split("/")[2])
          ?.label,
        keywords: setting.keywords,
        group: "settings",
        kind: "setting",
        icon: Settings2,
        run: () =>
          navigate({
            to: setting.route,
            search: {
              projectID: routeProjectID ?? fileTask?.projectID,
              profileID: runtime?.profileID,
            },
          }),
      })),
      deferredQuery,
    ).slice(0, tab === "all" ? 5 : undefined);
    const settingsGroup = groups.find((group) => group.group === "settings");
    if (settingsGroup) settingsGroup.commands.push(...settings);
    else if (settings.length > 0) {
      const similar = groups.findIndex((group) => group.group === "similar-tasks");
      const group = { group: "settings", label: "Settings", commands: settings };
      if (similar === -1) groups.push(group);
      else groups.splice(similar, 0, group);
    }
  }
  const visibleCommands = groups.flatMap((group) => group.commands);
  const commandByID = new Map(visibleCommands.map((command) => [command.id, command]));
  const paletteGroups: PaletteGroup[] = groups.map(
    ({ group, label, hint, commands: groupedCommands }) => ({
      id: group,
      label,
      hint,
      items: groupedCommands.map((command) => command.id),
    }),
  );
  if (fileRows.length > 0) {
    // Files follow tasks and commands, ahead of loose task matches.
    const similar = paletteGroups.findIndex((group) => group.id === "similar-tasks");
    const filesGroup: PaletteGroup = { id: "files", label: "Files", items: fileRows };
    if (similar === -1) paletteGroups.push(filesGroup);
    else paletteGroups.splice(similar, 0, filesGroup);
  }
  const messageItems = [...messageHits.keys()];
  if (messageSearch.canSearchRecent) messageItems.push(SEARCH_RECENT_MESSAGES_ID);
  if (messageSearch.failures.length > 0) messageItems.push(RETRY_MESSAGE_SEARCH_ID);
  // All lists messages only once something matched or was asked for; Tasks always offers them.
  const showMessages =
    searchesMessages &&
    messageSearch.query !== "" &&
    (tab === "tasks" ||
      messageHits.size > 0 ||
      messageSearch.pending ||
      messageSearch.failures.length > 0);
  if (showMessages && messageItems.length > 0) {
    const similar = paletteGroups.findIndex((group) => group.id === "similar-tasks");
    const messagesGroup: PaletteGroup = {
      id: "messages",
      label: "Messages",
      hint: messageSearch.coverage || undefined,
      items: messageItems,
    };
    if (similar === -1) paletteGroups.push(messagesGroup);
    else paletteGroups.splice(similar, 0, messagesGroup);
  }
  // Without rows the heading is hidden, so its coverage moves to a status line.
  const messageStatus =
    !showMessages || messageItems.length > 0 || !messageSearch.coverage
      ? null
      : messageSearch.pending
        ? `Messages · ${messageSearch.coverage}`
        : `No matching messages · ${messageSearch.coverage}`;
  if (searchesTasks && search.isError) {
    paletteGroups.push({ id: "task-search", label: "Task search", items: [RETRY_SEARCH_ID] });
  }
  if (searchesTasks && search.hasNextPage) {
    paletteGroups.push({ id: "more-tasks", label: "More tasks", items: [LOAD_MORE_ID] });
  }
  const itemOrder = paletteGroups.flatMap((group) => group.items);
  const fluidIndex = new Map(itemOrder.map((itemID, index) => [itemID, index]));
  const resultOrder = itemOrder.join("\0");
  const searchingRemote = searchesTasks && search.isFetching && !search.isFetchingNextPage;
  const layoutKey = `${paletteGroups.map((group) => `${group.id}:${group.items.length}:${group.hint ?? ""}`).join(",")}|${resultOrder}|${searchingRemote}|${searchingFiles}|${messageStatus}`;
  const enterLabel = (itemID: string) => {
    if (fileItemPath(itemID) !== null) return PALETTE_FILE_ENTER_LABEL;
    if (messageHits.has(itemID)) return "Open message";
    if (itemID === SEARCH_RECENT_MESSAGES_ID) return "Search messages";
    if (itemID === RETRY_MESSAGE_SEARCH_ID) return "Retry search";
    if (itemID === RETRY_SEARCH_ID) return "Retry search";
    if (itemID === LOAD_MORE_ID) return "Load more";
    const command = commandByID.get(itemID);
    if (!command || command.disabledReason) return null;
    return paletteEnterLabel(command);
  };
  const remotePageCount = search.data?.pages.length ?? 0;
  const paletteLabel = page === "projects" ? "Choose a project" : "Search tasks and commands";

  useLayoutEffect(() => {
    const appendedPage =
      previousRemotePageCountRef.current > 0 &&
      remotePageCount > previousRemotePageCountRef.current;
    previousRemotePageCountRef.current = remotePageCount;
    if (!appendedPage) resultsRef.current?.scrollTo({ top: 0 });
  }, [deferredQuery, page, tab, remotePageCount, resultOrder]);
  const emptyLabel =
    page === "projects"
      ? "No matching projects."
      : tab === "all"
        ? "No matching tasks or commands."
        : tab !== "files"
          ? `No matching ${tab}.`
          : !fileTask
            ? "Open a task to search its files."
            : searchingFiles
              ? ""
              : files.isError
                ? "Could not search this task's files."
                : "No matching files.";

  return (
    <CommandPaletteDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        setOpen(nextOpen);
      }}
      initialFocus={inputRef}
      finalFocus={() => (returnFocus?.isConnected ? returnFocus : false)}
      className="sm:max-w-[680px]"
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
          fileItemPath(itemID) ??
          messageHitText(messageHits.get(itemID)) ??
          (itemID === RETRY_SEARCH_ID
            ? "Retry older task search"
            : itemID === LOAD_MORE_ID
              ? "Load more tasks"
              : itemID)
        }
        autoHighlight="always"
        keepHighlight
        onItemHighlighted={(itemID) => {
          highlight.set(itemID ?? null);
          if (itemID) void commandByID.get(itemID)?.preload?.();
        }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-popover-foreground"
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
          <div className="shrink-0 border-b border-(--command-border)">
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
                  page === "projects"
                    ? "Search projects..."
                    : tab === "files"
                      ? "Search files..."
                      : "Search tasks and commands..."
                }
                aria-label={paletteLabel}
                onKeyDown={(event) => {
                  if (page !== "root" || event.nativeEvent.isComposing) return;
                  const input = event.currentTarget;
                  const step = paletteTabStep({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    altKey: event.altKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                    value: input.value,
                    selectionStart: input.selectionStart,
                    selectionEnd: input.selectionEnd,
                  });
                  if (step === 0) return;
                  event.preventDefault();
                  setTab((current) => adjacentPaletteTab(current, step));
                }}
              />
              {page === "root" ? (
                <Kbd className="shrink-0 bg-foreground/6">
                  {formatShortcut(shortcutKeys("palette.open"))}
                </Kbd>
              ) : null}
            </Autocomplete.InputGroup>
            {page === "root" ? <PaletteTabs value={tab} onValueChange={setTab} /> : null}
          </div>
          <PaletteResults
            store={highlight}
            order={itemOrder}
            layoutKey={layoutKey}
            busy={search.isFetching || searchingFiles || messageSearch.pending}
            resultsRef={resultsRef}
          >
            {/* Empty stays mounted as a live region; it must not reserve space when results exist. */}
            <Autocomplete.Empty className="py-6 text-center text-xs/relaxed empty:p-0">
              {emptyLabel}
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
                    className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    {group.label}
                    {group.hint ? (
                      <span
                        className="ml-auto text-micro font-normal text-muted-foreground/80"
                        aria-hidden="true"
                      >
                        {group.hint}
                      </span>
                    ) : null}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(itemID: string) => {
                      const index = fluidIndex.get(itemID);
                      if (itemID === RETRY_SEARCH_ID) {
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={() => void search.refetch()}
                          >
                            <RotateCw aria-hidden="true" />
                            Retry older task search
                          </PaletteItem>
                        );
                      }
                      if (itemID === LOAD_MORE_ID) {
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={() => void search.fetchNextPage()}
                          >
                            <RotateCw
                              className={search.isFetchingNextPage ? "animate-spin" : undefined}
                              aria-hidden="true"
                            />
                            Load more tasks
                          </PaletteItem>
                        );
                      }

                      if (itemID === SEARCH_RECENT_MESSAGES_ID) {
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={messageSearch.searchRecent}
                          >
                            <TextSearch aria-hidden="true" />
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="min-w-0 truncate">
                                Search messages in {messageSearch.recentTaskCount} recent{" "}
                                {messageSearch.recentTaskCount === 1 ? "task" : "tasks"}
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 shrink-[4] truncate text-meta",
                                  SECONDARY_TEXT_CLASS,
                                )}
                              >
                                Latest messages of each; older history is not searched
                              </span>
                            </span>
                          </PaletteItem>
                        );
                      }
                      if (itemID === RETRY_MESSAGE_SEARCH_ID) {
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={messageSearch.retry}
                          >
                            <RotateCw aria-hidden="true" />
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="min-w-0 truncate">Retry message search</span>
                              <span
                                className={cn(
                                  "min-w-0 shrink-[4] truncate text-meta",
                                  SECONDARY_TEXT_CLASS,
                                )}
                              >
                                {messageSearch.failures
                                  .map(
                                    (failure) =>
                                      `Couldn't search ${failure.serverName ?? "this server"}: ${failure.message}`,
                                  )
                                  .join(" · ")}
                              </span>
                            </span>
                          </PaletteItem>
                        );
                      }
                      const hit = messageHits.get(itemID);
                      if (hit) {
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={() => openMessage(hit)}
                          >
                            <MessageSquareText aria-hidden="true" />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="min-w-0 truncate">
                                {hit.excerpt.before}
                                <mark className="rounded-xs bg-warning/30 text-inherit forced-colors:bg-[Mark] forced-colors:text-[MarkText]">
                                  {hit.excerpt.match}
                                </mark>
                                {hit.excerpt.after}
                              </span>
                              <span
                                className={cn("min-w-0 truncate text-meta", SECONDARY_TEXT_CLASS)}
                              >
                                {messageHitContext(hit, commands)}
                              </span>
                            </span>
                            <span
                              className={cn("ml-auto shrink-0 text-micro", SECONDARY_TEXT_CLASS)}
                            >
                              {formatRelativeTime(hit.createdAt)}
                            </span>
                          </PaletteItem>
                        );
                      }

                      const filePath = fileItemPath(itemID);
                      if (filePath !== null) {
                        const slash = filePath.lastIndexOf("/");
                        return (
                          <PaletteItem
                            key={itemID}
                            index={index}
                            value={itemID}
                            onClick={() => openFile(filePath)}
                          >
                            <FileText aria-hidden="true" />
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="min-w-0 truncate">{filePath.slice(slash + 1)}</span>
                              {slash > 0 ? (
                                <span
                                  className={cn(
                                    "min-w-0 shrink-[4] truncate text-meta",
                                    SECONDARY_TEXT_CLASS,
                                  )}
                                >
                                  {filePath.slice(0, slash)}
                                </span>
                              ) : null}
                            </span>
                          </PaletteItem>
                        );
                      }

                      const command = commandByID.get(itemID);
                      if (!command) return null;
                      const Icon = command.icon;
                      return (
                        <PaletteItem
                          key={command.id}
                          index={index}
                          value={command.id}
                          disabled={Boolean(command.disabledReason)}
                          onClick={() => execute(command)}
                          onMouseEnter={() => void command.preload?.()}
                        >
                          {Icon ? <Icon aria-hidden="true" /> : null}
                          <span className="flex min-w-0 flex-1 items-baseline gap-2">
                            <span className="min-w-0 truncate">{command.title}</span>
                            {command.description || command.disabledReason ? (
                              <span
                                className={cn(
                                  "min-w-0 shrink-[4] truncate text-meta",
                                  SECONDARY_TEXT_CLASS,
                                )}
                              >
                                {command.disabledReason ?? command.description}
                              </span>
                            ) : null}
                          </span>
                          {command.kind === "task" ? (
                            <TaskTrailing command={command} />
                          ) : command.shortcut ? (
                            <span
                              className={cn("ml-auto shrink-0 text-micro", SECONDARY_TEXT_CLASS)}
                            >
                              {formatShortcut(command.shortcut)}
                            </span>
                          ) : command.trailing ? (
                            <span
                              className={cn("ml-auto shrink-0 text-micro", SECONDARY_TEXT_CLASS)}
                            >
                              {command.trailing}
                            </span>
                          ) : null}
                        </PaletteItem>
                      );
                    }}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            {searchingRemote ? (
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
            {messageStatus ? (
              <div
                className="flex h-10 items-center gap-2 px-4 text-xs text-muted-foreground"
                role="status"
              >
                {messageSearch.pending ? (
                  <RotateCw className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                <span className="min-w-0 truncate">{messageStatus}</span>
              </div>
            ) : null}
            {searchingFiles ? (
              <div
                className="flex h-10 items-center gap-2 px-4 text-xs text-muted-foreground"
                role="status"
              >
                <RotateCw className="size-3.5 animate-spin" aria-hidden="true" />
                Searching files...
              </div>
            ) : null}
          </PaletteResults>
          <PaletteFooter
            store={highlight}
            enterLabel={enterLabel}
            tabs={page === "root"}
            escapeLabel={page === "projects" ? "Back" : "Close"}
          />
          <Autocomplete.Status className="sr-only">
            {search.isFetching
              ? "Searching older tasks"
              : `${visibleCommands.length + fileRows.length + messageHits.size} results`}
          </Autocomplete.Status>
        </div>
      </Autocomplete.Root>
    </CommandPaletteDialog>
  );
}

/**
 * The Base UI highlighted item, published outside React state so a highlight change re-renders
 * only the fluid fill and the footer, never the whole palette.
 */
interface HighlightStore {
  get(): string | null;
  set(itemID: string | null): void;
  subscribe(listener: () => void): () => void;
}

function createHighlightStore(): HighlightStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(itemID) {
      if (itemID === current) return;
      current = itemID;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useHighlightedItem(store: HighlightStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const PaletteRowRegistry = createContext<
  ((index: number, element: HTMLElement | null) => void) | undefined
>(undefined);

/** A result row that registers with the fluid hover so the shared fill can reach it. */
function PaletteItem({
  index,
  className,
  ...props
}: ComponentProps<typeof Autocomplete.Item> & { index: number | undefined }) {
  const registerItem = useContext(PaletteRowRegistry);
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <Autocomplete.Item
      ref={ref}
      data-fluid-hover-index={index}
      className={cn(COMMAND_ITEM_CLASS, className)}
      {...props}
    />
  );
}

/**
 * The scrolling results area. Base UI owns which row is highlighted, from the keyboard or the
 * pointer; the fluid hover only measures rows and follows that row, so exactly one is lit.
 */
function PaletteResults({
  store,
  order,
  layoutKey,
  busy,
  resultsRef,
  children,
}: {
  store: HighlightStore;
  /** Item IDs in visual order; a row's position here is its fluid hover index. */
  order: readonly string[];
  /** Changes whenever rows or headings may have moved. */
  layoutKey: string;
  busy: boolean;
  resultsRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const hover = useFluidHover(resultsRef);
  const { activeIndex, setActiveIndex, registerItem, measureItems } = hover;
  const highlighted = useHighlightedItem(store);
  const position = highlighted === null ? -1 : order.indexOf(highlighted);
  const targetIndex = position === -1 ? null : position;

  useLayoutEffect(() => {
    if (activeIndex !== targetIndex) setActiveIndex(targetIndex);
  }, [activeIndex, setActiveIndex, targetIndex]);

  // Headings and status rows move rows without resizing them; re-read the rects in place.
  useLayoutEffect(() => {
    measureItems();
  }, [layoutKey, measureItems]);

  return (
    <div
      ref={resultsRef}
      className="palot-command-results no-scrollbar relative min-h-0 flex-1 scroll-py-3 overflow-x-hidden overflow-y-auto pb-1.5 outline-none"
      aria-busy={busy || undefined}
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      <PaletteRowRegistry.Provider value={registerItem}>{children}</PaletteRowRegistry.Provider>
    </div>
  );
}

function FooterHint({ keys, children }: { keys: readonly ShortcutKeys[]; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="flex shrink-0 items-center gap-0.5">
        {keys.map((shortcut) => (
          <ShortcutKbd key={shortcut.join("+")} keys={shortcut} />
        ))}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** At most four hints; Enter is named after what it does on the highlighted row. */
function PaletteFooter({
  store,
  enterLabel,
  tabs,
  escapeLabel,
}: {
  store: HighlightStore;
  enterLabel(itemID: string): string | null;
  tabs: boolean;
  escapeLabel: string;
}) {
  const highlighted = useHighlightedItem(store);
  const action = highlighted === null ? null : enterLabel(highlighted);
  return (
    <div
      data-slot="command-palette-footer"
      className="flex h-9 shrink-0 items-center gap-4 border-t border-(--command-border) px-4 text-micro text-muted-foreground"
    >
      <FooterHint keys={[["ArrowUp"], ["ArrowDown"]]}>Navigate</FooterHint>
      {tabs ? <FooterHint keys={[["ArrowLeft"], ["ArrowRight"]]}>Switch tab</FooterHint> : null}
      <FooterHint keys={[["Escape"]]}>{escapeLabel}</FooterHint>
      {/* Trailing, so its changing width never moves the other hints. */}
      {action ? (
        <span data-slot="command-palette-enter-hint" className="ml-auto min-w-0 text-foreground">
          <FooterHint keys={[["Enter"]]}>{action}</FooterHint>
        </span>
      ) : null}
    </div>
  );
}

const STATUS_LABELS: Record<PaletteTaskStatus, string> = {
  attention: "Needs attention",
  unread: "Unread task activity",
  running: "Running",
};

/** Status and age; the Alt+N hint replaces the age while the row is highlighted. */
function TaskTrailing({ command }: { command: GlobalCommand }) {
  const hint = command.shortcut ? formatShortcut(command.shortcut) : null;
  return (
    <span
      className={cn("ml-auto flex shrink-0 items-center gap-1.5 text-micro", SECONDARY_TEXT_CLASS)}
    >
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
          aria-label={STATUS_LABELS[command.status]}
        />
      ) : null}
      {command.trailing ? (
        <span className={hint ? "group-data-highlighted/command-item:hidden" : undefined}>
          {command.trailing}
        </span>
      ) : null}
      {hint ? (
        <span className="hidden group-data-highlighted/command-item:inline" aria-hidden="true">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

const MESSAGE_AUTHOR_LABELS = { user: "You", assistant: "Assistant" } as const;

function messageHitText(hit: MessageSearchHit | undefined): string | undefined {
  return hit ? `${hit.excerpt.before}${hit.excerpt.match}${hit.excerpt.after}` : undefined;
}

/** Author, task, and the task row's own project and server label. */
function messageHitContext(hit: MessageSearchHit, commands: readonly GlobalCommand[]): string {
  const task = commands.find((command) => command.id === paletteTaskCommandID(hit.task));
  return [
    MESSAGE_AUTHOR_LABELS[hit.author],
    hit.task.session.title ?? "Untitled task",
    task?.description,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !==
    null
  );
}
