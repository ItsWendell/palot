import {
  Activity,
  BarChart3,
  Bot,
  Copy,
  Code2,
  Cpu,
  Download,
  FileSearch,
  FolderTree,
  GitFork,
  GitPullRequest,
  Layers2,
  Inbox,
  MessageCircle,
  MessageSquare,
  Mic,
  PhoneOff,
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  ScanSearch,
  Redo2,
  Settings2,
  Shrink,
  Sparkles,
  SquarePen,
  TextCursorInput,
  Trash2,
  TextSearch,
  Undo2,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { actionableErrorMessage, type PalotSession } from "../../shared";
import { useAttentionItems } from "./use-attention-items";
import { catalogSessionIsUnread } from "./use-session-info";
import { commandPaletteReturnFocusAtom, navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
import { composerActionRequestAtom, type ComposerAction } from "../atoms/command-requests";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands, useWorkbenchScope } from "../atoms/workbench";
import { toast } from "../components/ui/toast";
import {
  formatRelativeTime,
  projectForSession,
  projectLocation,
  projectName,
  visibleProjects,
} from "../lib/view-models";
import { palotBuild } from "../lib/build";
import { openCodeKeys } from "../lib/opencode-query";
import { writeClipboardText } from "../lib/clipboard";
import type { GlobalCommand } from "../lib/global-commands";
import { boundShortcutKeys, useShortcutOverrides } from "../lib/keyboard-shortcuts";
import {
  paletteTaskCommandID,
  RECENT_TASK_LIMIT,
  type PaletteTask,
  type PaletteTaskStatus,
} from "../lib/palette-tasks";
import { cacheSessions } from "../lib/session-catalog-query";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";
import { showErrorToast } from "../lib/toast-error";
import {
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
  updateDiagnosticsPreferences,
} from "../lib/diagnostics-preferences";
import { palot } from "../services/palot";
import { openNewWorkbenchTerminal } from "../services/workbench-terminal";
import { usePalotNavigation } from "./use-navigation";
import { openTranscriptFindAtom } from "../components/transcript-find";
import { useSessionActivity } from "./use-session-activity";
import { useSessionFork } from "./use-session-fork";
import { useVoiceCall } from "./use-voice-call";
import { voiceCall } from "../services/voice-call";
import { supportsOpenCodeVoice } from "../lib/voice/voice-support";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";

interface UseGlobalCommandsOptions {
  /** Root tasks in recent-first order, including search results; see `mergePaletteTasks`. */
  tasks: readonly PaletteTask[];
  /** Loaded tasks in recent-first order; the first nine own Alt+1…Alt+9. */
  recentTasks: readonly PaletteTask[];
  onChooseProject(): void;
  /** Shows the palette on the Files tab for the open task. */
  onOpenFiles(): void;
}

export function useGlobalCommands({
  tasks,
  recentTasks,
  onChooseProject,
  onOpenFiles,
}: UseGlobalCommandsOptions) {
  // Command shortcuts follow personal bindings.
  useShortcutOverrides();
  const navigate = useNavigate();
  const allProjects = useProjectCatalog();
  const loadedSessions = useSessionCatalog();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const activity = useSessionActivity().data;
  const attentionItems = useAttentionItems();
  const [navigationOpen, setNavigationOpen] = useAtom(navigationOpenAtom);
  const [sidebarMode, setSidebarMode] = useAtom(sidebarModeAtom);
  const diagnosticsPreferences = useSyncExternalStore(
    subscribeDiagnosticsPreferences,
    readDiagnosticsPreferences,
    readDiagnosticsPreferences,
  );
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeProjectID = useRouterState({
    select: (state) => {
      const projectID = (state.location.search as { projectID?: unknown }).projectID;
      return typeof projectID === "string" ? projectID : null;
    },
  });
  const openTranscriptFind = useSetAtom(openTranscriptFindAtom);
  const requestComposerAction = useSetAtom(composerActionRequestAtom);
  const setPaletteReturnFocus = useSetAtom(commandPaletteReturnFocusAtom);
  const forkSession = useSessionFork();
  const voicePhase = useVoiceCall().snapshot.phase;
  const sessionID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return typeof value === "string" ? value : null;
    },
  });
  const {
    openNewTask,
    openPullRequests,
    openSession,
    openSettings,
    openUsage,
    openWelcome,
    preloadSession,
  } = usePalotNavigation();
  const projects = visibleProjects(allProjects);
  const selectedSession = loadedSessions.find((session) => session.id === sessionID) ?? null;
  const workbenchScope = runtime && sessionID ? { profileID: runtime.profileID, sessionID } : null;
  const workbench = useWorkbenchScope(workbenchScope);
  const workbenchCommands = useWorkbenchCommands(workbenchScope);
  const currentProject = selectedSession
    ? projectForSession(allProjects, selectedSession)
    : projects.find((project) => project.id === routeProjectID);
  const workspaceRoute = !pathname.startsWith("/settings");
  const changesPane = (["right", "bottom"] as const).find((pane) =>
    workbench[pane].tabs.some((tab) => tab.kind === "changes"),
  );
  const changesTab = changesPane
    ? workbench[changesPane].tabs.find((tab) => tab.kind === "changes")
    : undefined;
  const changesOpen = Boolean(
    changesPane &&
    changesTab &&
    workbench[changesPane].requestedOpen &&
    workbench[changesPane].activeTabID === changesTab.id,
  );
  const terminalPane = (["bottom", "right"] as const).find((pane) =>
    workbench[pane].tabs.some((tab) => tab.kind === "terminal"),
  );
  const terminalTab = terminalPane
    ? workbench[terminalPane].tabs.find((tab) => tab.kind === "terminal")
    : undefined;
  const terminalOpen = Boolean(
    terminalPane &&
    terminalTab &&
    workbench[terminalPane].requestedOpen &&
    workbench[terminalPane].activeTabID === terminalTab.id,
  );
  const attentionSessionIDs = new Set(attentionItems.map((item) => item.sessionID));

  const projectCommands: GlobalCommand[] = projects.map((project) => ({
    id: `project.newTask:${project.id}`,
    title: `New task in ${projectName(project)}`,
    description: projectLocation(project),
    group: "projects",
    icon: SquarePen,
    keywords: [project.name ?? "", project.canonical, ...project.sandboxes],
    kind: "project",
    run: () => openNewTask(project.id),
  }));

  const sessionRunning = (id: string) => {
    const status = activity?.statuses.get(id);
    return (
      activity?.execution.get(id)?.status === "running" ||
      status?.type === "busy" ||
      status?.type === "retry"
    );
  };

  /** Actions on the open task. Draft and menu actions go to its composer. */
  const taskActionCommands = (id: string): GlobalCommand[] => {
    const connectionID = runtime?.connectionID;
    const composerAction = (action: ComposerAction) =>
      requestComposerAction({
        action,
        profileID: runtime?.profileID ?? null,
        sessionID: id,
        requestedAt: Date.now(),
      });
    return [
      {
        id: "task.files.open",
        title: "Open file",
        description: "Search this task's files and open one in the workbench",
        group: "actions",
        icon: FileSearch,
        keywords: ["go to file", "quick open", "find file", "workspace", "/open"],
        kind: "action",
        closeOnRun: false,
        run: onOpenFiles,
      },
      {
        id: "task.fork",
        title: "Fork task",
        description: "Continue this task's history in a new task",
        group: "actions",
        icon: GitFork,
        keywords: ["branch", "duplicate", "copy", "/fork"],
        kind: "action",
        run: async () => {
          try {
            await forkSession({ sessionID: id });
          } catch (error) {
            showErrorToast("Could not fork task", error);
          }
        },
      },
      {
        id: "task.export",
        title: "Export task",
        description: "Save this task's transcript to a file",
        group: "actions",
        icon: Download,
        keywords: ["save", "download", "transcript", "json", "/export"],
        kind: "action",
        run: async () => {
          try {
            const path = await palot.exportSession(id, selectedSession?.title, connectionID);
            if (path) toast.add({ type: "success", title: "Task exported", description: path });
          } catch (error) {
            showErrorToast("Could not export task", error);
          }
        },
      },
      {
        id: "task.compact",
        title: "Compact task",
        description: "Summarize the conversation history to free context space",
        group: "actions",
        icon: Shrink,
        keywords: ["summarize", "context", "tokens", "/compact"],
        kind: "action",
        run: async () => {
          try {
            await palot.compactSession(id);
          } catch (error) {
            showErrorToast("Compaction failed", error);
          }
        },
      },
      {
        id: "task.undo",
        title: "Undo last step",
        description: "Revert the last conversation step and its file changes",
        group: "actions",
        icon: Undo2,
        keywords: ["revert", "rollback", "/undo"],
        kind: "action",
        runAfterClose: true,
        run: () => composerAction("undo"),
      },
      {
        id: "task.redo",
        title: "Redo step",
        description: "Redo one staged conversation step",
        group: "actions",
        icon: Redo2,
        keywords: ["restore", "/redo"],
        kind: "action",
        disabledReason: selectedSession && !selectedSession.revert ? "Nothing to redo" : undefined,
        runAfterClose: true,
        run: () => composerAction("redo"),
      },
      {
        id: "task.background",
        title: "Move work to background",
        description: "Let running subagents and shells continue without blocking the task",
        group: "actions",
        icon: Layers2,
        keywords: ["subagent", "shell", "detach", "unblock"],
        kind: "action",
        disabledReason: sessionRunning(id) ? undefined : "Nothing is running",
        run: async () => {
          try {
            await palot.backgroundSession(id);
          } catch (error) {
            showErrorToast("Could not move work to the background", error);
          }
        },
      },
      {
        id: "task.model",
        title: "Change model",
        description: "Choose this task's model",
        group: "actions",
        icon: Cpu,
        keywords: ["provider", "llm", "switch", "/model"],
        kind: "action",
        runAfterClose: true,
        run: () => {
          // The model menu takes focus; the palette must not hand it back on close.
          setPaletteReturnFocus(null);
          composerAction("model");
        },
      },
      {
        id: "task.agent",
        title: "Change agent",
        description: "Choose this task's primary agent",
        group: "actions",
        icon: Bot,
        keywords: ["build", "plan", "mode", "switch", "/agent"],
        kind: "action",
        runAfterClose: true,
        run: () => {
          setPaletteReturnFocus(null);
          composerAction("agent");
        },
      },
    ];
  };

  const commands: GlobalCommand[] = [];
  commands.push({
    id: "task.new",
    title: "New task",
    description: "Choose a server and project, then start a task",
    group: "actions",
    icon: SquarePen,
    keywords: ["create", "conversation", "thread"],
    shortcut: boundShortcutKeys("task.new"),
    suggested: true,
    kind: "action",
    run: () => openNewTask(),
  });
  commands.push({
    id: "chat.new",
    title: "New chat",
    description: "Ask a question without choosing a project",
    group: "actions",
    icon: MessageCircle,
    keywords: ["create", "conversation", "question", "no project"],
    shortcut: boundShortcutKeys("chat.new"),
    suggested: true,
    kind: "action",
    run: () => navigate({ to: "/new", search: { chat: true } }),
  });
  if (projects.length > 0) {
    commands.push({
      id: "task.choose-project",
      title: "Choose project for a new task",
      group: "actions",
      icon: SquarePen,
      keywords: ["new task", "project", "folder"],
      shortcut: boundShortcutKeys("task.choose-project"),
      defaultVisible: true,
      kind: "action",
      closeOnRun: false,
      run: onChooseProject,
    });
  }

  if (workspaceRoute) {
    commands.push(
      {
        id: "navigation.toggle",
        title: navigationOpen ? "Hide navigation" : "Show navigation",
        group: "actions",
        icon: navigationOpen ? PanelLeftClose : PanelLeftOpen,
        keywords: ["sidebar", "panel", "projects", "inbox"],
        shortcut: boundShortcutKeys("navigation.toggle"),
        suggested: true,
        kind: "action",
        run: () => setNavigationOpen(!navigationOpen),
      },
      {
        id: "sidebar.mode.toggle",
        title: sidebarMode === "inbox" ? "Show projects" : "Show inbox",
        description:
          sidebarMode === "inbox"
            ? "Switch the sidebar to projects"
            : "Switch the sidebar to inbox",
        group: "actions",
        icon: sidebarMode === "inbox" ? FolderTree : Inbox,
        keywords: ["sidebar", "tasks", "attention"],
        suggested: true,
        kind: "action",
        run: () => setSidebarMode(sidebarMode === "inbox" ? "project" : "inbox"),
      },
    );
  }

  if (sessionID) {
    if (selectedSession && runtime?.capabilities?.localPathActions === true) {
      commands.push({
        id: "task.openExternal",
        title: "Open checkout in preferred app",
        description: "Open this task's checkout in your preferred editor",
        group: "actions",
        icon: Code2,
        keywords: ["editor", "IDE", "Cursor", "VS Code", "Zed", "Finder"],
        suggested: true,
        kind: "action",
        run: async () => {
          await palot.externalOpen(
            {
              resource: { kind: "session-directory", sessionID: selectedSession.id },
            },
            runtime?.connectionID,
          );
        },
      });
    }
    commands.push(
      {
        id: "task.changes.toggle",
        title: changesOpen ? "Hide changes" : "Show changes",
        description: changesOpen
          ? "Close the task changes panel"
          : "Open files changed by this task",
        group: "actions",
        icon: changesOpen ? PanelRightClose : PanelRightOpen,
        keywords: ["diff", "files", "inspector"],
        shortcut: boundShortcutKeys("task.changes.toggle"),
        suggested: true,
        kind: "action",
        run: () => {
          if (!selectedSession) return;
          if (!changesPane || !changesTab) {
            workbenchCommands.openTab({
              kind: "changes",
              location: selectedSession.location,
              mode: "working",
              sourceSessionID: sessionID,
            });
            return;
          }
          if (changesOpen) {
            workbenchCommands.togglePane(changesPane);
            return;
          }
          workbenchCommands.activateTab(changesPane, changesTab.id);
        },
      },
      ...(supportsOpenCodeVoice(runtime?.version) || voicePhase !== "idle"
        ? [
            {
              id: "task.voice.toggle",
              title: voicePhase === "idle" ? "Start voice chat" : "End voice chat",
              description:
                voicePhase === "idle"
                  ? "Talk with this task's agent through a voice assistant"
                  : "Hang up the current voice chat",
              group: "actions" as const,
              icon: voicePhase === "idle" ? Mic : PhoneOff,
              keywords: ["voice", "talk", "speak", "microphone", "call", "gpt-live"],
              shortcut: boundShortcutKeys("task.voice.toggle"),
              suggested: voicePhase !== "idle",
              kind: "action" as const,
              run: () => voiceCall.handleHostCommand({ type: "toggle-call" }),
            },
          ]
        : []),
      ...(supportsOpenCodeVoice(runtime?.version) &&
      voicePhase === "idle" &&
      runtime?.connected &&
      selectedSession
        ? [
            {
              id: "task.voice.coordinator",
              title: "Start coordinator voice chat",
              description: "Talk with a coordinator that can start and steer several tasks",
              group: "actions" as const,
              icon: Mic,
              keywords: ["voice", "coordinator", "orchestrate", "delegate", "tasks", "call"],
              kind: "action" as const,
              run: () => {
                const directory = selectedSession.location.directory;
                const project = allProjects.find(
                  (candidate) => candidate.id === selectedSession.projectID,
                );
                void voiceCall.startCoordinatorChat({
                  connectionID: runtime.connectionID,
                  directory,
                  projectName: project?.name ?? directory.split("/").filter(Boolean).at(-1) ?? null,
                  projects: allProjects.map((candidate) => ({
                    name: candidate.name,
                    directory: candidate.canonical,
                  })),
                });
              },
            },
          ]
        : []),
      {
        id: "task.terminal.toggle",
        title: terminalOpen ? "Hide terminal" : "Show terminal",
        description: terminalOpen
          ? "Close the terminal pane without stopping its OpenCode PTY"
          : "Open an interactive OpenCode terminal",
        group: "actions",
        icon: terminalOpen ? PanelBottomClose : PanelBottomOpen,
        keywords: ["terminal", "shell", "pty", "bottom panel"],
        shortcut: boundShortcutKeys("task.terminal.toggle"),
        suggested: true,
        kind: "action",
        run: async () => {
          if (!selectedSession) return;
          if (!terminalPane || !terminalTab) {
            await openNewWorkbenchTerminal(
              selectedSession.id,
              selectedSession.location,
              workbenchCommands.openTab,
              undefined,
              runtime?.connectionID,
            );
            return;
          }
          if (terminalOpen) {
            workbenchCommands.togglePane(terminalPane);
            return;
          }
          workbenchCommands.activateTab(terminalPane, terminalTab.id);
        },
      },
      {
        id: "task.find",
        title: "Find in task",
        description: "Search this task's messages",
        group: "actions",
        icon: TextSearch,
        keywords: ["search", "find", "transcript", "messages"],
        shortcut: boundShortcutKeys("task.find"),
        kind: "action",
        runAfterClose: true,
        run: () => openTranscriptFind(),
      },
      ...taskActionCommands(sessionID),
      {
        id: "task.copyId",
        title: "Copy task ID",
        description: sessionID,
        group: "actions",
        icon: Copy,
        keywords: ["session", "identifier", "clipboard"],
        kind: "action",
        run: async () => {
          await writeClipboardText(sessionID);
          toast.add({ type: "success", title: "Task ID copied" });
        },
      },
    );
  }

  if (workspaceRoute) {
    commands.push({
      id: "task.focusComposer",
      title: "Focus composer",
      description: "Move the cursor to the message input",
      group: "actions",
      icon: TextCursorInput,
      keywords: ["prompt", "message", "input", "write"],
      shortcut: boundShortcutKeys("composer.focus"),
      defaultVisible: true,
      kind: "action",
      runAfterClose: true,
      run: () => document.querySelector<HTMLElement>("[data-palot-composer-input]")?.focus(),
    });
  }

  commands.push(
    {
      id: "onboarding.open",
      title: "Open welcome guide",
      description: "Review projects, provider connections, and how Palot presents OpenCode work",
      group: "actions",
      icon: Sparkles,
      keywords: ["onboarding", "setup", "getting started", "providers"],
      kind: "setting",
      run: () => openWelcome(),
    },
    {
      id: "usage.open",
      title: "Usage",
      description: "View local OpenCode activity, model cost, and tool reliability",
      group: "actions",
      icon: BarChart3,
      keywords: ["tokens", "cost", "models", "statistics", "activity"],
      defaultVisible: true,
      kind: "action",
      run: () => openUsage(),
    },
    {
      id: "pull-requests.open",
      title: "Pull requests",
      description: "Review requested, authored, and recently merged GitHub pull requests",
      group: "actions",
      icon: GitPullRequest,
      keywords: ["github", "pr", "review", "merge"],
      defaultVisible: true,
      kind: "action",
      run: () => openPullRequests(),
    },
    ...SETTINGS_NAV_ITEMS.toSorted(
      (left, right) => Number(right.id === "general") - Number(left.id === "general"),
    ).map((item): GlobalCommand => ({
      id: `settings.open:${item.id}`,
      title: item.id === "general" ? "Settings" : item.label,
      description: item.description,
      group: "settings",
      icon: item.id === "general" ? Settings2 : item.icon,
      keywords: [item.keywords, "preferences"],
      shortcut: item.id === "general" ? boundShortcutKeys("settings.open") : undefined,
      kind: "setting",
      run: () => openSettings(item.id, routeProjectID ?? currentProject?.id),
    })),
  );

  const reloadConnectionID = runtime?.connected ? runtime.connectionID : null;
  if (reloadConnectionID && reloadConnectionID !== "preview") {
    commands.push({
      id: "server.reloadConfiguration",
      title: "Reload configuration",
      description:
        "Reload OpenCode configuration and plugins. Pending approvals and questions are cancelled.",
      group: "actions",
      icon: RotateCw,
      keywords: ["config", "opencode.json", "plugins", "refresh", "reload", "server"],
      kind: "action",
      run: () =>
        void toast
          .promise(
            palot
              .reloadConfiguration(reloadConnectionID)
              .then(() =>
                queryClient.invalidateQueries({ queryKey: openCodeKeys.all(reloadConnectionID) }),
              ),
            {
              loading: { title: "Reloading configuration…" },
              success: { title: "Configuration reloaded" },
              error: (cause: unknown) => ({
                title: "Could not reload configuration",
                description: actionableErrorMessage(cause, "OpenCode refused the reload."),
              }),
            },
          )
          .catch(() => undefined),
    });
  }

  const reactScanEnabled = diagnosticsPreferences.reactScanEnabled ?? __PALOT_REACT_SCAN_DEFAULT__;
  const runtimeSummary = runtime
    ? {
        connected: runtime.connected,
        phase: runtime.phase,
        version: runtime.version,
        managed: runtime.managed,
      }
    : null;
  commands.push(
    {
      id: "diagnostics.overlay.toggle",
      title: diagnosticsPreferences.overlayVisible
        ? "Hide diagnostics overlay"
        : "Show diagnostics overlay",
      description: "Toggle live CPU, memory, frame, long-task, and streaming signals",
      group: "diagnostics",
      icon: Activity,
      keywords: ["performance", "hud", "fps", "memory", "cpu"],
      trailing: diagnosticsPreferences.overlayVisible ? "On" : "Off",
      defaultVisible: true,
      kind: "action",
      run: () => {
        updateDiagnosticsPreferences({
          overlayVisible: !diagnosticsPreferences.overlayVisible,
        });
      },
    },
    {
      id: "diagnostics.capture",
      title: "Capture diagnostics now",
      description: "Refresh the current Electron process and GPU snapshot",
      group: "diagnostics",
      icon: RotateCw,
      keywords: ["refresh", "sample", "performance"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        await diagnostics.captureNow();
        toast.add({ type: "success", title: "Diagnostics refreshed" });
      },
    },
    {
      id: "diagnostics.copy",
      title: "Copy diagnostics report",
      description: "Copy an allowlisted report without task content, paths, or credentials",
      group: "diagnostics",
      icon: Copy,
      keywords: ["support", "clipboard", "export", "report"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        await diagnostics.copySafeReport(runtimeSummary);
        toast.add({ type: "success", title: "Diagnostics copied" });
      },
    },
    {
      id: "diagnostics.history.clear",
      title: "Clear diagnostics history",
      description: "Discard the bounded in-memory history",
      group: "diagnostics",
      icon: Trash2,
      keywords: ["reset", "samples"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        diagnostics.clearHistory();
        toast.add({ type: "success", title: "Diagnostic history cleared" });
      },
    },
    {
      id: "diagnostics.reactScan.toggle",
      title: reactScanEnabled ? "Disable React Scan and reload" : "Enable React Scan and reload",
      description: "Toggle component render outlines",
      group: "diagnostics",
      icon: ScanSearch,
      keywords: ["react", "renders", "profiler", "instrumentation"],
      trailing: reactScanEnabled ? "On" : "Off",
      kind: "action",
      run: () => {
        updateDiagnosticsPreferences({ reactScanEnabled: !reactScanEnabled });
        window.location.reload();
      },
    },
  );

  if (palotBuild.channel !== "stable") {
    commands.push({
      id: "app.restart",
      title: "Restart Palot",
      description: "Restart the development app",
      group: "development",
      icon: RotateCw,
      keywords: ["reload", "development"],
      shortcut: boundShortcutKeys("app.restart"),
      kind: "action",
      run: () =>
        palot
          .restartApp("Restart requested from the command palette")
          .catch((error) => showErrorToast("Could not restart Palot", error)),
    });
  }

  const focusedProfileID = runtime?.profileID ?? null;
  const recentIndex = new Map(
    recentTasks
      .slice(0, RECENT_TASK_LIMIT)
      .map((task, index) => [paletteTaskCommandID(task), index] as const),
  );
  const focusedStatus = (session: PalotSession): PaletteTaskStatus | undefined =>
    attentionSessionIDs.has(session.id)
      ? "attention"
      : sessionRunning(session.id)
        ? "running"
        : catalogSessionIsUnread(session)
          ? "unread"
          : undefined;
  commands.push(
    ...tasks.map((task): GlobalCommand => {
      const { session } = task;
      const id = paletteTaskCommandID(task);
      const shortcutIndex = recentIndex.get(id);
      const focused = task.profileID === null || task.profileID === focusedProfileID;
      const project = focused ? projectForSession(allProjects, session) : undefined;
      const location = task.projectName ?? (project ? projectName(project) : null);
      const retainSession = () =>
        cacheSessions(queryClient, task.connectionID ?? runtime?.connectionID ?? "disconnected", [
          session,
        ]);
      return {
        id,
        title: session.title ?? "Untitled task",
        description: [location ?? session.location.directory, task.serverName]
          .filter(Boolean)
          .join(" · "),
        group: "tasks",
        icon: MessageSquare,
        keywords: [
          session.id,
          project?.canonical ?? "",
          project?.name ?? "",
          task.projectName ?? "",
          task.serverName ?? "",
          session.location.directory,
          "thread",
          "conversation",
        ],
        shortcut: shortcutIndex === undefined ? undefined : ["Alt", String(shortcutIndex + 1)],
        trailing: formatRelativeTime(session.updatedAt),
        status: task.status ?? (focused ? focusedStatus(session) : undefined),
        kind: "task",
        run: () => {
          retainSession();
          return task.profileID === null
            ? openSession(session.id)
            : openSession(session.id, { profileID: task.profileID });
        },
        preload: () => {
          if (!task.connected) return;
          retainSession();
          return preloadSession(session.id, task.profileID ?? undefined);
        },
      };
    }),
    ...projectCommands,
  );

  return { commands, projectCommands };
}

async function loadDiagnosticsController() {
  return (await import("../lib/diagnostics-controller")).diagnostics;
}
