import {
  Activity,
  BarChart3,
  Copy,
  Code2,
  FolderTree,
  Inbox,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  ScanSearch,
  Settings2,
  Sparkles,
  SquarePen,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { PalotSession } from "../../shared";
import { useAttentionItems } from "./use-attention-items";
import { catalogSessionIsUnread } from "./use-session-info";
import { navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
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
import { writeClipboardText } from "../lib/clipboard";
import type { GlobalCommand } from "../lib/global-commands";
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
import { useSessionActivity } from "./use-session-activity";
import { useCacheSession, useProjectCatalog, useSessionCatalog } from "./use-session-catalog";

interface UseGlobalCommandsOptions {
  sessions: readonly PalotSession[];
  onChooseProject(): void;
}

export function useGlobalCommands({ sessions, onChooseProject }: UseGlobalCommandsOptions) {
  const allProjects = useProjectCatalog();
  const loadedSessions = useSessionCatalog();
  const cacheSession = useCacheSession();
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
  const sessionID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return typeof value === "string" ? value : null;
    },
  });
  const { openNewTask, openSession, openSettings, openUsage, openWelcome, preloadSession } =
    usePalotNavigation();
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

  const commands: GlobalCommand[] = [];
  if (projects.length > 0) {
    commands.push({
      id: "task.new",
      title: currentProject ? `New task in ${projectName(currentProject)}` : "New task",
      description:
        currentProject && projects.length > 1
          ? "Start in the current project"
          : "Choose a project and start a task",
      group: "suggested",
      icon: SquarePen,
      keywords: ["create", "conversation", "thread"],
      shortcut: ["Meta", "N"],
      suggested: true,
      kind: "action",
      closeOnRun: Boolean(currentProject || projects.length === 1),
      run: () => {
        const project = currentProject ?? (projects.length === 1 ? projects[0] : undefined);
        if (project) return openNewTask(project.id);
        onChooseProject();
      },
    });
  }

  if (workspaceRoute) {
    commands.push(
      {
        id: "navigation.toggle",
        title: navigationOpen ? "Hide navigation" : "Show navigation",
        group: "suggested",
        icon: navigationOpen ? PanelLeftClose : PanelLeftOpen,
        keywords: ["sidebar", "panel", "projects", "inbox"],
        shortcut: ["Meta", "B"],
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
        group: "suggested",
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
        group: "suggested",
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
        group: "suggested",
        icon: changesOpen ? PanelRightClose : PanelRightOpen,
        keywords: ["diff", "files", "inspector"],
        shortcut: ["Meta", "Shift", "I"],
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
      {
        id: "task.terminal.toggle",
        title: terminalOpen ? "Hide terminal" : "Show terminal",
        description: terminalOpen
          ? "Close the terminal pane without stopping its OpenCode PTY"
          : "Open an interactive OpenCode terminal",
        group: "suggested",
        icon: terminalOpen ? PanelBottomClose : PanelBottomOpen,
        keywords: ["terminal", "shell", "pty", "bottom panel"],
        shortcut: ["Control", "`"],
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
        id: "task.copyId",
        title: "Copy task ID",
        description: sessionID,
        group: "navigation",
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
      group: "navigation",
      icon: TextCursorInput,
      keywords: ["prompt", "message", "input", "write"],
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
      group: "settings",
      icon: Sparkles,
      keywords: ["onboarding", "setup", "getting started", "providers"],
      kind: "setting",
      run: () => openWelcome(),
    },
    {
      id: "usage.open",
      title: "Usage",
      description: "View local OpenCode activity, model cost, and tool reliability",
      group: "navigation",
      icon: BarChart3,
      keywords: ["tokens", "cost", "models", "statistics", "activity"],
      defaultVisible: true,
      kind: "action",
      run: () => openUsage(),
    },
    ...SETTINGS_NAV_ITEMS.map((item): GlobalCommand => ({
      id: `settings.open:${item.id}`,
      title: item.id === "general" ? "Settings" : item.label,
      description: item.description,
      group: "settings",
      icon: item.id === "general" ? Settings2 : item.icon,
      keywords: [item.keywords, "preferences"],
      shortcut: item.id === "general" ? ["Meta", ","] : undefined,
      defaultVisible: item.id === "general" || item.id === "appearance",
      kind: "setting",
      run: () => openSettings(item.id, routeProjectID ?? currentProject?.id),
    })),
  );

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
      shortcut: ["Meta", "Shift", "R"],
      kind: "action",
      run: () =>
        palot
          .restartApp("Restart requested from the command palette")
          .catch((error) => showErrorToast("Could not restart Palot", error)),
    });
  }

  commands.push(
    ...sessions
      .filter((session) => !session.parentID)
      .toSorted(
        (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      )
      .map((session): GlobalCommand => {
        const project = projectForSession(allProjects, session);
        const runtime = activity?.statuses.get(session.id);
        const execution = activity?.execution.get(session.id);
        const retainSession = () => cacheSession(session);
        return {
          id: `session.open:${session.id}`,
          title: session.title ?? "Untitled task",
          description: project ? projectName(project) : session.location.directory,
          group: "tasks",
          icon: MessageSquare,
          keywords: [
            session.id,
            project?.canonical ?? "",
            project?.name ?? "",
            session.location.directory,
            "thread",
            "conversation",
          ],
          trailing: formatRelativeTime(session.updatedAt),
          status: attentionSessionIDs.has(session.id)
            ? "attention"
            : execution?.status === "running" ||
                runtime?.type === "busy" ||
                runtime?.type === "retry"
              ? "running"
              : catalogSessionIsUnread(session)
                ? "unread"
                : undefined,
          kind: "task",
          run: () => {
            retainSession();
            return openSession(session.id);
          },
          preload: () => {
            retainSession();
            return preloadSession(session.id);
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
