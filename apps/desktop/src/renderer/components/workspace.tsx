import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { SharedOpenCodeAction } from "./opencode-connection-alert";
import { OpenCodeReleaseSetup } from "./open-code-release-settings";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { usePanelRef } from "react-resizable-panels";
import type { AutomationNotificationTarget, PalotSession } from "../../shared";
import {
  commandPaletteOpenAtom,
  commandPaletteReturnFocusAtom,
  keepSidePanelAcrossTasksAtom,
  navigationOpenAtom,
} from "../atoms/ui";
import {
  errorAtom,
  paneGeometryAtom,
  phaseAtom,
  runtimeAtom,
  workspaceRecoveryAtom,
} from "../atoms/workspace";
import {
  flushWorkbenchPersistence,
  useWorkbenchCommands,
  useWorkbenchScope,
  workbenchStateAtom,
} from "../atoms/workbench";
import { cn } from "../lib/cn";
import { spring } from "../lib/springs";
import { showErrorToast } from "../lib/toast-error";
import { carryRightPane, workbenchScopeKey, type WorkbenchScope } from "../lib/workbench-tabs";
import { usePalotNavigation } from "../hooks/use-navigation";
import { prefersReducedMotion } from "../hooks/use-reduced-motion";
import { useSessionCatalogSelector } from "../hooks/use-session-catalog";
import { useAutomations } from "../hooks/use-automations";
import { useAutomaticWorktreeCleanup } from "../hooks/use-worktree-cleanup";
import { palot } from "../services/palot";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { TaskListSourceProvider } from "./task-list-host";
import { WorkbenchPane } from "./workbench/workbench-pane";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { SidebarProvider } from "./ui/sidebar";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";
import { IconButton } from "./ui";
import { PalotLoading } from "./branding";
import {
  formatShortcut,
  matchesShortcut,
  shortcutKeys,
  useShortcutKeys,
} from "../lib/keyboard-shortcuts";
import { NavigationRail } from "./navigation-rail";
import { isFullPageRoute } from "../lib/full-page-routes";
import { SIDEBAR_PEEK_MAX_WIDTH, SidebarPeek, useSidebarPeek } from "./sidebar-peek";

/** Width of the always-visible navigation rail (`w-11`). */
const NAVIGATION_RAIL_WIDTH = 44;
const CENTER_MIN_WIDTH = 360;
const RIGHT_WORKBENCH_MIN_WIDTH = 300;
/** The two 1px separators beside the center panel. */
const PANEL_SEPARATORS_WIDTH = 2;

type ShellSurface = "navigation" | "right" | "bottom";

interface ShellTransitionSlot {
  id: number;
  animation: Animation | null;
  exitCleanup: (() => void) | null;
}

const SHELL_OPEN_MS = Math.round(spring.moderate.duration * 1000);
const SHELL_CLOSE_MS = Math.round(spring.moderate.exit.duration * 1000);
// Force-finish a stalled pane animation (background window) a little after it should end.
const SHELL_FALLBACK_MARGIN_MS = 60;

type WorkspaceSession = Pick<PalotSession, "id" | "projectID" | "location">;

function sameWorkspaceSession(left: WorkspaceSession | null, right: WorkspaceSession | null) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.projectID === right.projectID &&
      left.location.directory === right.location.directory &&
      left.location.workspaceID === right.location.workspaceID)
  );
}

export function Workspace({ content }: { content: ReactNode; children?: ReactNode }) {
  useAutomations();
  useAutomaticWorktreeCleanup();
  const router = useRouter();
  const [phase, setPhase] = useAtom(phaseAtom);
  const [error, setError] = useAtom(errorAtom);
  const [runtime, setRuntime] = useAtom(runtimeAtom);
  const workspaceRecovery = useAtomValue(workspaceRecoveryAtom);
  const historyIndex = useRouterState({
    select: (state) => state.location.state.__TSR_index,
  });
  const sessionID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return typeof value === "string" ? value : null;
    },
  });
  const { openScheduled, openSession } = usePalotNavigation();
  const selectWorkspaceSession = useCallback(
    (sessions: PalotSession[]) => {
      const session = sessionID
        ? (sessions.find((candidate) => candidate.id === sessionID) ?? null)
        : null;
      return session
        ? { id: session.id, projectID: session.projectID, location: session.location }
        : null;
    },
    [sessionID],
  );
  const selectedSession = useSessionCatalogSelector(selectWorkspaceSession, sameWorkspaceSession);
  const [navigationRequestedOpen, setNavigationOpen] = useAtom(navigationOpenAtom);
  const workbenchScope: WorkbenchScope | null =
    runtime && sessionID ? { profileID: runtime.profileID, sessionID } : null;
  const scopeKey = workbenchScope ? workbenchScopeKey(workbenchScope) : null;
  const workbench = useWorkbenchScope(workbenchScope);
  const workbenchCommands = useWorkbenchCommands(workbenchScope);
  const keepSidePanel = useAtomValue(keepSidePanelAcrossTasksAtom);
  const setWorkbenchState = useSetAtom(workbenchStateAtom);
  // The last task shown, so the next one can take its right pane when the setting asks.
  const carryFromRef = useRef<WorkbenchScope | null>(null);
  const profileID = runtime?.profileID;
  const selectedLocation =
    selectedSession && selectedSession.id === sessionID ? selectedSession.location : null;
  useEffect(() => {
    if (!profileID || !sessionID || !selectedLocation) return;
    const to = { profileID, sessionID };
    const from = carryFromRef.current;
    carryFromRef.current = to;
    if (!keepSidePanel || !from) return;
    setWorkbenchState((state) => carryRightPane(state, from, to, selectedLocation));
  }, [keepSidePanel, profileID, selectedLocation, sessionID, setWorkbenchState]);
  const rightRequestedOpen = workbench.right.requestedOpen;
  const bottomRequestedOpen = workbench.bottom.requestedOpen;
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const setCommandPaletteReturnFocus = useSetAtom(commandPaletteReturnFocusAtom);
  const navigationPanelRef = usePanelRef();
  const centerPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const bottomPanelRef = usePanelRef();
  const workspaceRef = useRef<HTMLDivElement>(null);
  // One slot per surface, so toggling one pane never cancels another pane's animation.
  const shellTransitionsRef = useRef<Record<ShellSurface, ShellTransitionSlot>>({
    navigation: { id: 0, animation: null, exitCleanup: null },
    right: { id: 0, animation: null, exitCleanup: null },
    bottom: { id: 0, animation: null, exitCleanup: null },
  });
  const [exitingPanels, setExitingPanels] = useState<Partial<Record<ShellSurface, string>>>({});
  const isExitingPanel = (panel: string) => Object.values(exitingPanels).includes(panel);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const [paneGeometry, setPaneGeometry] = useAtom(paneGeometryAtom);
  const navigationCompact =
    workspaceSize.width > 0 &&
    workspaceSize.width < NAVIGATION_RAIL_WIDTH + paneGeometry.navigation + 480;
  // Full-page destinations keep the column hidden without changing the saved preference;
  // like a compact window, showing navigation there opens it as an overlay sheet.
  const fullPageRoute = useRouterState({
    select: (state) => isFullPageRoute(state.location.pathname),
  });
  const navigationOverlay = navigationCompact || fullPageRoute;
  const navigationOpen = navigationRequestedOpen && !navigationOverlay;
  const [navigationSheetHistory, setNavigationSheetHistory] = useState<number | null>(null);
  const navigationSheetOpen = navigationOverlay && navigationSheetHistory === historyIndex;
  const navigationVisible = navigationOpen || navigationSheetOpen;
  // A hidden (not compact) column can peek as an overlay without being pinned.
  const navigationPeek = useSidebarPeek(
    phase === "ready" && !navigationVisible && !navigationCompact,
  );
  const railRef = useRef<HTMLDivElement>(null);
  const locationHref = useRouterState({ select: (state) => state.location.href });
  const closeNavigationPeek = navigationPeek.close;
  useEffect(() => {
    // Choosing a task or starting one navigates; the peek has done its job.
    closeNavigationPeek();
  }, [closeNavigationPeek, locationHref]);
  const navigationTransitionRef = useRef<boolean | null>(navigationOpen);
  const navigationWidth = navigationOpen ? paneGeometry.navigation : 0;
  const [fullscreenScopeKey, setFullscreenScopeKey] = useState<string | null>(null);
  const [fullscreenNavigationWidth, setFullscreenNavigationWidth] = useState(
    paneGeometry.navigation,
  );
  const rightExpanded =
    fullscreenScopeKey !== null &&
    fullscreenScopeKey === scopeKey &&
    rightRequestedOpen &&
    Boolean(selectedSession);
  const rightTooNarrow = workspaceSize.width < NAVIGATION_RAIL_WIDTH + navigationWidth + 800;
  // Reopened in a narrow window, the right workbench keeps its minimum and the transcript's
  // minimum yields, so the three panels never add up to more than the window.
  const centerMinWidth =
    workspaceSize.width === 0
      ? CENTER_MIN_WIDTH
      : Math.max(
          0,
          Math.min(
            CENTER_MIN_WIDTH,
            workspaceSize.width -
              (rightRequestedOpen
                ? NAVIGATION_RAIL_WIDTH +
                  navigationWidth +
                  RIGHT_WORKBENCH_MIN_WIDTH +
                  PANEL_SEPARATORS_WIDTH
                : 0),
          ),
        );
  const narrowRightRef = useRef<{ scope: string; narrow: boolean } | null>(null);
  const wasRightExpandedRef = useRef(false);
  const bottomOpen =
    bottomRequestedOpen && (workspaceSize.height === 0 || workspaceSize.height >= 501);
  const rightTransitionRef = useRef<boolean | null>(rightRequestedOpen);
  const bottomTransitionRef = useRef<boolean | null>(bottomOpen);
  const canGoBack = router.history.canGoBack();
  const canGoForward = historyIndex < router.history.length - 1;
  const backShortcut = useShortcutKeys("navigation.back");
  const forwardShortcut = useShortcutKeys("navigation.forward");

  const runShellTransition = useCallback(
    async (surface: ShellSurface, open: boolean, update: () => void) => {
      const reducedMotion = prefersReducedMotion();
      const slot = shellTransitionsRef.current[surface];
      const transitionID = ++slot.id;
      const setExitingPanel = (panel: string | null) =>
        setExitingPanels((current) => {
          if (panel !== null) return { ...current, [surface]: panel };
          if (!(surface in current)) return current;
          const next = { ...current };
          delete next[surface];
          return next;
        });
      // A toggle that interrupts this surface's animation continues from where it is
      // instead of snapping back to the unanimated state first.
      let interruptedFrom: Keyframe | null = null;
      const interrupted = slot.animation;
      if (interrupted) {
        const target = (interrupted.effect as KeyframeEffect | null)?.target;
        if (target instanceof HTMLElement && interrupted.playState !== "finished") {
          const style = getComputedStyle(target);
          interruptedFrom = {
            opacity: Number.parseFloat(style.opacity),
            transform: style.transform === "none" ? "translate3d(0, 0, 0)" : style.transform,
          };
        }
        interrupted.cancel();
      }
      slot.animation = null;
      const previousExitCleanup = slot.exitCleanup;
      slot.exitCleanup = null;
      if (previousExitCleanup) {
        previousExitCleanup();
        flushSync(() => setExitingPanel(null));
      }

      const findSurface = () => {
        const selector = `[data-shell-surface="${surface}"]`;
        const candidates = Array.from(
          workspaceRef.current?.querySelectorAll<HTMLElement>(selector) ?? [],
        );
        return candidates.find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1 && getComputedStyle(candidate).opacity !== "0";
        });
      };

      let animatedSurface: HTMLElement | null = null;
      const x = surface === "navigation" ? -12 : surface === "right" ? 12 : 0;
      const y = surface === "bottom" ? 10 : 0;
      const duration = open ? SHELL_OPEN_MS : SHELL_CLOSE_MS;
      const createAnimation = (target: HTMLElement) =>
        target.animate(
          open
            ? [
                interruptedFrom ?? { opacity: 0.88, transform: `translate3d(${x}px, ${y}px, 0)` },
                { opacity: 1, transform: "translate3d(0, 0, 0)" },
              ]
            : [
                interruptedFrom ?? { opacity: 1, transform: "translate3d(0, 0, 0)" },
                { opacity: 0, transform: `translate3d(${x}px, ${y}px, 0)` },
              ],
          {
            duration,
            easing: open ? "cubic-bezier(0.22, 1, 0.36, 1)" : "ease-out",
            fill: "both",
          },
        );
      let animation: Animation | null = null;
      if (!open && !reducedMotion && typeof Element.prototype.animate === "function") {
        const source = findSurface();
        if (source) {
          const rect = source.getBoundingClientRect();
          const sourcePanel = source.closest<HTMLElement>("[data-shell-panel]");
          const panelOverflow = sourcePanel?.style.getPropertyValue("overflow") ?? "";
          const panelOverflowPriority = sourcePanel?.style.getPropertyPriority("overflow") ?? "";
          const temporaryStyles = new Map(
            [
              "position",
              "inset",
              "top",
              "left",
              "width",
              "height",
              "margin",
              "z-index",
              "pointer-events",
              "opacity",
              "transform-origin",
            ].map((property) => [property, source.style.getPropertyValue(property)]),
          );
          Object.assign(source.style, {
            position: "fixed",
            inset: "auto",
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: "0",
            zIndex: "60",
            pointerEvents: "none",
            opacity: "1",
            transformOrigin: "center",
          });
          if (sourcePanel && sourcePanel !== source) {
            sourcePanel.style.setProperty("overflow", "visible", "important");
          }
          slot.exitCleanup = () => {
            temporaryStyles.forEach((value, property) => {
              if (value) source.style.setProperty(property, value);
              else source.style.removeProperty(property);
            });
            if (sourcePanel && sourcePanel !== source) {
              if (panelOverflow) {
                sourcePanel.style.setProperty("overflow", panelOverflow, panelOverflowPriority);
              } else {
                sourcePanel.style.removeProperty("overflow");
              }
            }
          };
          animatedSurface = source;
          animation = createAnimation(source);
          slot.animation = animation;
          await new Promise<void>((resolve) => {
            let animationFrame: number | undefined;
            const timer = window.setTimeout(() => {
              if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
              resolve();
            }, 32);
            animationFrame = requestAnimationFrame(() => {
              window.clearTimeout(timer);
              resolve();
            });
          });
          if (slot.id !== transitionID) return;
        }
      }

      flushSync(() => {
        if (animatedSurface) {
          setExitingPanel(
            animatedSurface.dataset.shellPanel ??
              animatedSurface.closest<HTMLElement>("[data-shell-panel]")?.dataset.shellPanel ??
              surface,
          );
        }
        update();
      });
      if (reducedMotion || typeof Element.prototype.animate !== "function") return;
      if (open) animatedSurface = findSurface() ?? null;
      if (!animatedSurface || slot.id !== transitionID) return;
      animation ??= createAnimation(animatedSurface);
      slot.animation = animation;

      let cleanupTimer: number | undefined;
      await Promise.race([
        animation.finished.catch(() => undefined),
        new Promise((resolve) => {
          cleanupTimer = window.setTimeout(resolve, duration + SHELL_FALLBACK_MARGIN_MS);
        }),
      ]);
      if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
      if (slot.id === transitionID) {
        animation.cancel();
        slot.animation = null;
        slot.exitCleanup?.();
        slot.exitCleanup = null;
        setExitingPanel(null);
      }
    },
    [],
  );

  const resolveVersionMismatch = useCallback(
    async (versionMismatch: "continue" | "replace") => {
      setPhase("loading");
      setError(null);
      try {
        const input = {
          versionMismatch,
          ...(versionMismatch === "continue"
            ? { approvedVersion: runtime?.versionMismatch?.detectedVersion }
            : {}),
        };
        if (workspaceRecovery) await workspaceRecovery.run(input);
        else await palot.connectOpenCode(input);
      } catch (connectionError) {
        try {
          setRuntime(await palot.runtimeStatus());
        } catch {
          // Keep the original connection failure visible.
        }
        setError(
          connectionError instanceof Error
            ? connectionError.message
            : "Could not connect to OpenCode",
        );
        setPhase("error");
      }
    },
    [setError, setPhase, setRuntime, workspaceRecovery, runtime?.versionMismatch?.detectedVersion],
  );

  const retryWorkspace = useCallback(
    async (startLocalService?: boolean) => {
      const input = startLocalService ? { startLocalService: true } : undefined;
      if (workspaceRecovery) {
        await workspaceRecovery.run(input);
        return;
      }
      await palot.connectOpenCode(input);
    },
    [workspaceRecovery],
  );

  // The main process connects by itself once a missing local service appears (Palot can start
  // before OpenCode at login). Leave the error screen then, without waiting for "Try again".
  const runtimeConnected = runtime?.connected === true;
  const recoveredConnection = useRef(runtimeConnected);
  useEffect(() => {
    const appeared = runtimeConnected && !recoveredConnection.current;
    recoveredConnection.current = runtimeConnected;
    if (appeared && phase === "error") void retryWorkspace().catch(() => undefined);
  }, [phase, retryWorkspace, runtimeConnected]);

  const openCommandPalette = useCallback(
    (trigger: HTMLElement) => {
      setCommandPaletteReturnFocus(trigger);
      setCommandPaletteOpen(true);
    },
    [setCommandPaletteOpen, setCommandPaletteReturnFocus],
  );

  const setNavigationVisibility = useCallback(
    (open: boolean) => {
      if (navigationOverlay) {
        setNavigationSheetHistory(open ? historyIndex : null);
        return;
      }
      navigationTransitionRef.current = open;
      void runShellTransition("navigation", open, () => {
        setNavigationOpen(open);
        if (open) navigationPanelRef.current?.expand();
        else navigationPanelRef.current?.collapse();
      });
    },
    [historyIndex, navigationOverlay, navigationPanelRef, runShellTransition, setNavigationOpen],
  );

  const toggleRightWorkbench = useCallback(() => {
    if (!selectedSession) return;
    const open = !rightRequestedOpen;
    rightTransitionRef.current = open;
    if (!open) setFullscreenScopeKey(null);
    void (async () => {
      await runShellTransition("right", open, () => {
        if (open && workbench.right.tabs.length === 0) {
          workbenchCommands.openTab(
            {
              kind: "changes",
              location: selectedSession.location,
              mode: "working",
              sourceSessionID: selectedSession.id,
            },
            { pane: "right" },
          );
        } else {
          workbenchCommands.togglePane("right");
        }
        if (open) rightPanelRef.current?.expand();
        else rightPanelRef.current?.collapse();
      });
    })();
  }, [
    rightPanelRef,
    rightRequestedOpen,
    runShellTransition,
    selectedSession,
    workbench.right.tabs.length,
    workbenchCommands,
  ]);

  const toggleBottomWorkbench = useCallback(async () => {
    if (!selectedSession) return;
    if (bottomRequestedOpen || workbench.bottom.tabs.length > 0) {
      const open = !bottomRequestedOpen;
      bottomTransitionRef.current = open;
      await runShellTransition("bottom", open, () => {
        workbenchCommands.togglePane("bottom");
        if (open && (workspaceSize.height === 0 || workspaceSize.height >= 501)) {
          bottomPanelRef.current?.expand();
        } else {
          bottomPanelRef.current?.collapse();
        }
      });
      return;
    }
    if (runtime?.capabilities?.pty === "none") {
      throw new Error("Terminals are unavailable for the active OpenCode server");
    }
    const pty = await palot.createPty(
      selectedSession.id,
      selectedSession.location,
      runtime?.connectionID,
    );
    let opened = false;
    bottomTransitionRef.current = true;
    await runShellTransition("bottom", true, () => {
      opened =
        workbenchCommands.openTab(
          {
            kind: "terminal",
            location: selectedSession.location,
            ptyID: pty.id,
            sessionID: selectedSession.id,
            transport: pty.transport,
          },
          { pane: "bottom" },
        )?.ok === true;
      if (opened && (workspaceSize.height === 0 || workspaceSize.height >= 501)) {
        bottomPanelRef.current?.expand();
      }
    });
    if (opened) return;
    await palot
      .removePty(selectedSession.location, pty.id, pty.transport, runtime?.connectionID)
      .catch(() => undefined);
    throw new Error("Close a workbench tab before opening another terminal");
  }, [
    bottomPanelRef,
    bottomRequestedOpen,
    runShellTransition,
    runtime?.capabilities?.pty,
    runtime?.connectionID,
    selectedSession,
    workbench.bottom.tabs.length,
    workbenchCommands,
    workspaceSize.height,
  ]);
  const toggleNavigation = useCallback(
    () => setNavigationVisibility(!navigationVisible),
    [navigationVisible, setNavigationVisibility],
  );
  const goBack = useCallback(() => router.history.back(), [router]);
  const goForward = useCallback(() => router.history.forward(), [router]);
  const toggleBottom = useCallback(() => {
    void toggleBottomWorkbench().catch((error) => showErrorToast("Could not open terminal", error));
  }, [toggleBottomWorkbench]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWorkspaceSize({ width: element.clientWidth, height: element.clientHeight });
      return;
    }
    let animationFrame: number | undefined;
    let fallbackTimer: number | undefined;
    let pendingSize = { width: element.clientWidth, height: element.clientHeight };
    const commitSize = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      animationFrame = undefined;
      fallbackTimer = undefined;
      setWorkspaceSize((current) =>
        current.width === pendingSize.width && current.height === pendingSize.height
          ? current
          : pendingSize,
      );
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      pendingSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (animationFrame !== undefined) return;
      animationFrame = requestAnimationFrame(commitSize);
      fallbackTimer = window.setTimeout(commitSize, 100);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [phase]);

  useEffect(() => {
    setFullscreenScopeKey(null);
  }, [scopeKey]);

  useEffect(() => {
    if (!rightRequestedOpen) setFullscreenScopeKey(null);
  }, [rightRequestedOpen]);

  useEffect(() => {
    if (phase !== "ready" || workspaceSize.width === 0 || !scopeKey) return;
    const previous = narrowRightRef.current;
    narrowRightRef.current = { scope: scopeKey, narrow: rightTooNarrow };
    if (
      rightTooNarrow &&
      (previous?.scope !== scopeKey || !previous.narrow) &&
      rightRequestedOpen &&
      !rightExpanded
    ) {
      workbenchCommands.togglePane("right");
      rightPanelRef.current?.collapse();
    }
  }, [
    phase,
    rightTooNarrow,
    rightRequestedOpen,
    rightExpanded,
    scopeKey,
    workbenchCommands,
    rightPanelRef,
    workspaceSize.width,
  ]);

  useLayoutEffect(() => {
    if (phase !== "ready") return;
    let restoreFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      if (rightExpanded) centerPanelRef.current?.collapse();
      else if (wasRightExpandedRef.current) {
        centerPanelRef.current?.expand();
        if (rightRequestedOpen)
          restoreFrame = requestAnimationFrame(() =>
            rightPanelRef.current?.resize(paneGeometry.right),
          );
      }
      wasRightExpandedRef.current = rightExpanded;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
    };
  }, [phase, rightExpanded, rightRequestedOpen, paneGeometry.right, centerPanelRef, rightPanelRef]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushWorkbenchPersistence);
    return () => {
      window.removeEventListener("beforeunload", flushWorkbenchPersistence);
      flushWorkbenchPersistence();
    };
  }, []);

  useEffect(
    () => () => {
      for (const slot of Object.values(shellTransitionsRef.current)) {
        slot.id += 1;
        slot.animation?.cancel();
        slot.exitCleanup?.();
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.getModifierState("AltGraph")
      )
        return;
      if (event.target instanceof Element && event.target.closest("[data-workbench-terminal]"))
        return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (matchesShortcut(event, shortcutKeys("navigation.back"))) {
        event.preventDefault();
        if (canGoBack) router.history.back();
        return;
      }
      if (matchesShortcut(event, shortcutKeys("navigation.forward"))) {
        event.preventDefault();
        if (canGoForward) router.history.forward();
        return;
      }
    };
    // A mouse's back and forward buttons do what Mod+[ and Mod+] do. The browser pane's page is
    // its own web contents, so its clicks never arrive here.
    const onMouseUp = (event: MouseEvent) => {
      if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) return;
      event.preventDefault();
      if (event.button === 3) {
        if (canGoBack) router.history.back();
      } else if (canGoForward) router.history.forward();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [canGoBack, canGoForward, router]);

  useEffect(() => {
    const openTarget = (target: AutomationNotificationTarget) => {
      if (target.sessionID && target.requestID && target.requestType) {
        void openSession(target.sessionID, {
          profileID: target.profileID,
          focus: "request",
          requestID: target.requestID,
          requestType: target.requestType,
        });
        return;
      }
      void openScheduled({
        automationID: target.automationID,
        runID: target.runID,
        profileID: target.profileID,
      });
    };
    void palot.takeAutomationNotificationTarget().then((target) => {
      if (target) openTarget(target);
    });
    return palot.onAutomationNotificationOpened((target) => {
      void palot.takeAutomationNotificationTarget();
      openTarget(target);
    });
  }, [openScheduled, openSession]);

  useEffect(() => {
    if (phase !== "ready") return;
    navigationTransitionRef.current = navigationOpen;
    const animationFrame = requestAnimationFrame(() => {
      if (navigationOpen) navigationPanelRef.current?.expand();
      else navigationPanelRef.current?.collapse();
    });
    const transitionEnd = window.setTimeout(() => {
      if (navigationTransitionRef.current === navigationOpen) {
        navigationTransitionRef.current = null;
      }
    }, 280);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(transitionEnd);
    };
  }, [navigationOpen, navigationPanelRef, phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    rightTransitionRef.current = rightRequestedOpen;
    const animationFrame = requestAnimationFrame(() => {
      if (rightRequestedOpen) rightPanelRef.current?.expand();
      else rightPanelRef.current?.collapse();
    });
    const transitionEnd = window.setTimeout(() => {
      if (rightTransitionRef.current === rightRequestedOpen) {
        rightTransitionRef.current = null;
      }
    }, 280);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(transitionEnd);
    };
  }, [phase, rightRequestedOpen, rightPanelRef]);

  useEffect(() => {
    if (phase !== "ready") return;
    bottomTransitionRef.current = bottomOpen;
    const animationFrame = requestAnimationFrame(() => {
      if (bottomOpen) bottomPanelRef.current?.expand();
      else bottomPanelRef.current?.collapse();
    });
    const transitionEnd = window.setTimeout(() => {
      if (bottomTransitionRef.current === bottomOpen) bottomTransitionRef.current = null;
    }, 280);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(transitionEnd);
    };
  }, [bottomOpen, bottomPanelRef, phase]);

  if (phase === "loading") {
    const loadingLabel =
      runtime?.phase === "starting"
        ? "Starting OpenCode"
        : runtime?.phase === "connecting"
          ? "Connecting to OpenCode"
          : "Preparing your workspace";
    return <PalotLoading>{loadingLabel}</PalotLoading>;
  }
  if (phase === "error") {
    const mismatch = runtime?.versionMismatch;
    return (
      <main className="flex size-full items-center justify-center p-6" role="alert">
        <Empty>
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={1}>
              {mismatch ? "OpenCode version mismatch" : "Could not connect to OpenCode"}
            </EmptyTitle>
            <EmptyDescription>
              {mismatch
                ? mismatch.canContinue
                  ? `Palot was tested with OpenCode ${mismatch.expectedVersion}, but the running service is ${mismatch.detectedVersion}. This release has not been verified against Palot's current API. Beta APIs may change; compatibility is not guaranteed. You can continue, though some features may fail.`
                  : `Palot requires OpenCode ${mismatch.expectedVersion} for this release, but the running service is ${mismatch.detectedVersion}.`
                : error}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            {mismatch?.canContinue ? (
              <Button type="button" onClick={() => void resolveVersionMismatch("continue")}>
                Continue with existing service
              </Button>
            ) : null}
            {mismatch && runtime?.source === "shared-service" ? (
              <SharedOpenCodeAction
                action="replace"
                onConfirm={() => void resolveVersionMismatch("replace")}
              />
            ) : (
              <Button type="button" variant="outline" onClick={() => void retryWorkspace()}>
                Try again
              </Button>
            )}
            {!mismatch && runtime?.canStartLocalService ? (
              <SharedOpenCodeAction onConfirm={() => void retryWorkspace(true)} />
            ) : null}
            {runtime?.source !== "network-server" &&
            (runtime?.source === "shared-service" ||
              runtime?.canStartLocalService ||
              runtime?.profileID === "local-default") ? (
              <OpenCodeReleaseSetup />
            ) : null}
          </EmptyContent>
        </Empty>
      </main>
    );
  }
  return (
    <div ref={workspaceRef} data-palot-workspace className="relative size-full min-h-0 min-w-0">
      <TaskListSourceProvider>
        <SidebarProvider
          open={navigationOpen}
          onOpenChange={setNavigationVisibility}
          className="size-full min-h-0 min-w-0 bg-transparent"
          data-navigation={navigationOpen ? "open" : "closed"}
          data-right-workbench={rightRequestedOpen ? "open" : "closed"}
          data-right-workbench-mode={rightExpanded ? "expanded" : "inline"}
          data-bottom-workbench={bottomRequestedOpen ? "open" : "closed"}
        >
          <div
            ref={railRef}
            className={cn(
              "palot-navigation-rail flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground",
              // With the task column open the rail shares its surface; otherwise it owns the edge.
              !navigationOpen && "border-r border-border",
            )}
            data-shell-surface="rail"
          >
            <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
            <NavigationRail
              className="min-h-0 flex-1"
              navigationOpen={navigationVisible}
              onNavigationOpenChange={setNavigationVisibility}
              onViewHoverStart={navigationPeek.requestPeek}
              onViewHoverEnd={navigationPeek.cancelPendingPeek}
              peeking={navigationPeek.view !== null}
            />
          </div>
          <ResizablePanelGroup
            orientation="horizontal"
            className="@container/workspace-shell min-h-0"
            onLayoutChanged={(_, { isUserInteraction }) => {
              if (!isUserInteraction) return;
              const navigationSize = navigationPanelRef.current?.getSize().inPixels ?? 0;
              const rightSize = rightPanelRef.current?.getSize().inPixels ?? 0;
              setPaneGeometry((current) => ({
                ...current,
                navigation: navigationSize > 1 ? navigationSize : current.navigation,
                right: !rightExpanded && rightSize > 1 ? rightSize : current.right,
              }));
            }}
          >
            <ResizablePanel
              id="navigation"
              panelRef={navigationPanelRef}
              defaultSize={`${paneGeometry.navigation}px`}
              minSize="220px"
              maxSize={
                rightExpanded
                  ? `${Math.min(420, Math.max(220, fullscreenNavigationWidth))}px`
                  : "420px"
              }
              collapsedSize="0px"
              collapsible
              groupResizeBehavior="preserve-pixel-size"
              data-shell-panel="navigation"
              className={cn(
                "relative flex min-w-0 overflow-hidden!",
                navigationOpen || isExitingPanel("navigation")
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              onResize={({ inPixels }, _id, previousSize) => {
                if (!previousSize) return;
                const open = inPixels > 1;
                if (
                  !navigationOverlay &&
                  navigationTransitionRef.current === null &&
                  open !== navigationOpen
                ) {
                  setNavigationOpen(open);
                }
              }}
            >
              <WorkspaceSidebar open={navigationOpen} onSearchTasks={openCommandPalette} />
            </ResizablePanel>
            <ResizableHandle
              disabled={!navigationOpen}
              aria-hidden={!navigationOpen}
              className={cn(
                "transition-opacity duration-150",
                navigationOpen ? "opacity-100" : "pointer-events-none w-0 opacity-0",
              )}
            />
            <ResizablePanel
              id="center"
              panelRef={centerPanelRef}
              minSize={rightExpanded ? "0px" : `${centerMinWidth}px`}
              maxSize={rightExpanded ? "0px" : "100%"}
              collapsedSize="0px"
              collapsible
              aria-hidden={rightExpanded}
              inert={rightExpanded}
              data-shell-panel="center"
              className="relative min-h-0 min-w-0 flex-[1_1_auto]"
            >
              <ResizablePanelGroup
                orientation="vertical"
                className="min-h-0"
                onLayoutChanged={(_, { isUserInteraction }) => {
                  if (!isUserInteraction) return;
                  const bottomSize = bottomPanelRef.current?.getSize().inPixels ?? 0;
                  if (bottomSize <= 1) return;
                  setPaneGeometry((current) => ({ ...current, bottom: bottomSize }));
                }}
              >
                <ResizablePanel
                  id="thread"
                  minSize={`${Math.min(320, workspaceSize.height || 320)}px`}
                  className="relative min-h-0 min-w-0 [container-type:size]"
                >
                  {content}
                </ResizablePanel>
                <ResizableHandle
                  disabled={!bottomOpen}
                  aria-hidden={!bottomOpen}
                  className={cn(
                    "transition-opacity duration-150",
                    bottomOpen ? "opacity-100" : "pointer-events-none h-0 opacity-0",
                  )}
                />
                <ResizablePanel
                  id="bottom-workbench"
                  panelRef={bottomPanelRef}
                  defaultSize={`${paneGeometry.bottom}px`}
                  minSize="180px"
                  maxSize="70%"
                  collapsedSize="0px"
                  collapsible
                  groupResizeBehavior="preserve-pixel-size"
                  data-shell-panel="bottom-workbench"
                  className={cn(
                    "relative flex min-h-0 min-w-0 overflow-hidden!",
                    bottomOpen || isExitingPanel("bottom-workbench")
                      ? "opacity-100"
                      : "pointer-events-none opacity-0",
                  )}
                >
                  {(bottomOpen || isExitingPanel("bottom-workbench")) &&
                  workbenchScope &&
                  selectedSession ? (
                    <WorkbenchPane
                      pane="bottom"
                      visible={bottomOpen}
                      scope={workbenchScope}
                      context={workbench}
                      location={selectedSession.location}
                    />
                  ) : null}
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle
              disabled={!rightRequestedOpen || rightExpanded}
              aria-hidden={!rightRequestedOpen || rightExpanded}
              className={cn(
                "transition-opacity duration-150",
                rightRequestedOpen && !rightExpanded
                  ? "opacity-100"
                  : "pointer-events-none w-0 opacity-0",
              )}
            />
            <ResizablePanel
              id="right-workbench"
              panelRef={rightPanelRef}
              defaultSize={`${paneGeometry.right}px`}
              minSize={`${RIGHT_WORKBENCH_MIN_WIDTH}px`}
              maxSize={rightExpanded ? "100%" : "70%"}
              collapsedSize="0px"
              collapsible
              groupResizeBehavior="preserve-pixel-size"
              data-shell-panel="right-workbench"
              className={cn(
                "relative flex min-h-0 min-w-0 overflow-hidden!",
                rightRequestedOpen || isExitingPanel("right-workbench")
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
            >
              {(rightRequestedOpen || isExitingPanel("right-workbench")) &&
              workbenchScope &&
              selectedSession ? (
                <WorkbenchPane
                  pane="right"
                  visible={rightRequestedOpen}
                  expanded={rightExpanded}
                  onToggleExpanded={() => {
                    if (!rightExpanded) {
                      const width = navigationPanelRef.current?.getSize().inPixels ?? 0;
                      setFullscreenNavigationWidth(
                        navigationOpen && width > 1 ? width : paneGeometry.navigation,
                      );
                    }
                    setFullscreenScopeKey(rightExpanded ? null : scopeKey);
                  }}
                  scope={workbenchScope}
                  context={workbench}
                  location={selectedSession.location}
                />
              ) : null}
            </ResizablePanel>
          </ResizablePanelGroup>
          {phase === "ready" && !navigationVisible && !navigationOverlay ? (
            // Hot edge just right of the rail: resting here peeks the remembered view.
            <div
              aria-hidden="true"
              data-sidebar-peek-edge=""
              className="absolute top-(--shell-header-height) bottom-0 z-30 w-1.5"
              style={{ left: NAVIGATION_RAIL_WIDTH }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") navigationPeek.requestPeek("tasks");
              }}
              onPointerLeave={navigationPeek.cancelPendingPeek}
            />
          ) : null}
          <SidebarPeek
            peek={navigationPeek}
            railRef={railRef}
            left={NAVIGATION_RAIL_WIDTH}
            width={Math.min(paneGeometry.navigation, SIDEBAR_PEEK_MAX_WIDTH)}
            label="Tasks preview"
          >
            <WorkspaceSidebar open presentation="peek" onSearchTasks={openCommandPalette} />
          </SidebarPeek>
          <Sheet
            open={navigationSheetOpen}
            onOpenChange={(open) => setNavigationSheetHistory(open ? historyIndex : null)}
          >
            <SheetContent
              side="left"
              className="p-0"
              style={{ width: Math.min(paneGeometry.navigation, 360) }}
            >
              <SheetTitle className="sr-only">Task navigation</SheetTitle>
              <SheetDescription className="sr-only">Tasks across your projects</SheetDescription>
              <WorkspaceSidebar
                open={navigationSheetOpen}
                presentation="sheet"
                onSearchTasks={openCommandPalette}
              />
            </SheetContent>
          </Sheet>
          <div className="window-chrome-cluster pointer-events-none fixed top-0 z-40 flex h-(--shell-header-height) items-center gap-2">
            <IconButton
              label={navigationVisible ? "Hide navigation" : "Show navigation"}
              appIcon="sidebarLeading"
              size="icon-sm"
              aria-pressed={navigationVisible}
              className="pointer-events-auto [-webkit-app-region:no-drag]"
              onClick={toggleNavigation}
            />
            <div className="flex items-center gap-0.5 max-[480px]:hidden">
              <IconButton
                label={backShortcut.length ? `Back (${formatShortcut(backShortcut)})` : "Back"}
                appIcon="back"
                size="icon-sm"
                disabled={!canGoBack}
                className="pointer-events-auto [-webkit-app-region:no-drag]"
                onClick={goBack}
              />
              <IconButton
                label={
                  forwardShortcut.length
                    ? `Forward (${formatShortcut(forwardShortcut)})`
                    : "Forward"
                }
                appIcon="forward"
                size="icon-sm"
                disabled={!canGoForward}
                className="pointer-events-auto [-webkit-app-region:no-drag]"
                onClick={goForward}
              />
            </div>
          </div>
          <div className="window-trailing-controls pointer-events-none fixed top-0 right-3 z-40 flex h-(--shell-header-height) items-center gap-1">
            <IconButton
              label={bottomRequestedOpen ? "Hide bottom workbench" : "Show terminal"}
              appIcon="panelBottom"
              size="icon-sm"
              aria-pressed={bottomRequestedOpen}
              className="pointer-events-auto [-webkit-app-region:no-drag]"
              disabled={
                !selectedSession ||
                (runtime?.capabilities?.pty === "none" &&
                  !bottomRequestedOpen &&
                  workbench.bottom.tabs.length === 0)
              }
              onClick={toggleBottom}
            />
            <IconButton
              label={rightRequestedOpen ? "Hide right workbench" : "Show changes"}
              appIcon="sidebarTrailing"
              size="icon-sm"
              aria-pressed={rightRequestedOpen}
              className="pointer-events-auto [-webkit-app-region:no-drag]"
              disabled={!selectedSession}
              onClick={toggleRightWorkbench}
            />
            <span className="window-close-spacer shrink-0" aria-hidden="true" />
          </div>
        </SidebarProvider>
      </TaskListSourceProvider>
    </div>
  );
}
