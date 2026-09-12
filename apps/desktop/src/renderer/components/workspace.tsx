import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { SharedOpenCodeAction } from "./opencode-connection-alert";
import { OpenCodeReleaseSetup } from "./open-code-release-settings";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { usePanelRef } from "react-resizable-panels";
import type { AutomationNotificationTarget, PalotSession } from "../../shared";
import {
  commandPaletteOpenAtom,
  commandPaletteReturnFocusAtom,
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
} from "../atoms/workbench";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import type { WorkbenchScope } from "../lib/workbench-tabs";
import { projectForSession, projectLocation, visibleProjects } from "../lib/view-models";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useProjectCatalog, useSessionCatalogSelector } from "../hooks/use-session-catalog";
import { useAutomations } from "../hooks/use-automations";
import { palot } from "../services/palot";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { WorkbenchPane } from "./workbench/workbench-pane";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { SidebarProvider } from "./ui/sidebar";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";
import { IconButton } from "./ui";
import { PalotLoading } from "./branding";

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
  const router = useRouter();
  const [phase, setPhase] = useAtom(phaseAtom);
  const [error, setError] = useAtom(errorAtom);
  const [runtime, setRuntime] = useAtom(runtimeAtom);
  const workspaceRecovery = useAtomValue(workspaceRecoveryAtom);
  const projects = useProjectCatalog();
  const visible = useMemo(() => visibleProjects(projects), [projects]);
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
  const { openNewTask: navigateToNewTask, openScheduled, openSession } = usePalotNavigation();
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
  const newTaskContext = useRef({ projects, selectedSession, visible });
  useEffect(() => {
    newTaskContext.current = { projects, selectedSession, visible };
  }, [projects, selectedSession, visible]);
  const [navigationRequestedOpen, setNavigationOpen] = useAtom(navigationOpenAtom);
  const workbenchScope: WorkbenchScope | null =
    runtime && sessionID ? { profileID: runtime.profileID, sessionID } : null;
  const workbench = useWorkbenchScope(workbenchScope);
  const workbenchCommands = useWorkbenchCommands(workbenchScope);
  const rightRequestedOpen = workbench.right.requestedOpen;
  const bottomRequestedOpen = workbench.bottom.requestedOpen;
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const setCommandPaletteReturnFocus = useSetAtom(commandPaletteReturnFocusAtom);
  const navigationPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const bottomPanelRef = usePanelRef();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const shellTransitionRef = useRef(0);
  const shellAnimationRef = useRef<Animation | null>(null);
  const shellExitCleanupRef = useRef<(() => void) | null>(null);
  const [exitingPanel, setExitingPanel] = useState<string | null>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (phase !== "ready") return;
    const workspace = workspaceRef.current;
    const chrome = workspace?.querySelector<HTMLElement>(".window-chrome-cluster");
    const trailing = workspace?.querySelector<HTMLElement>(".window-trailing-controls");
    const center = workspace?.querySelector<HTMLElement>('[data-shell-panel="center"]');
    const navigation = workspace?.querySelector<HTMLElement>('[data-shell-panel="navigation"]');
    if (!workspace || !chrome || !trailing || !center || !navigation) return;
    // Panel state can lead or lag its physical size during hydration and transitions.
    // Reserve only the toolbar's actual overlap with the center pane.
    const measure = () => {
      const inset = Math.max(
        18,
        chrome.getBoundingClientRect().right - center.getBoundingClientRect().left + 12,
      );
      workspace.style.setProperty("--thread-header-leading-inset", `${inset}px`);
      workspace.style.setProperty(
        "--thread-header-trailing-inset",
        `${Math.max(12, center.getBoundingClientRect().right - trailing.getBoundingClientRect().left + 12)}px`,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const element of [workspace, chrome, trailing, center, navigation])
      observer.observe(element);
    return () => observer.disconnect();
  }, [phase]);
  const [paneGeometry, setPaneGeometry] = useAtom(paneGeometryAtom);
  const navigationCompact =
    workspaceSize.width > 0 && workspaceSize.width < paneGeometry.navigation + 480;
  const navigationOpen = navigationRequestedOpen && !navigationCompact;
  const [navigationSheetHistory, setNavigationSheetHistory] = useState<number | null>(null);
  const navigationSheetOpen = navigationCompact && navigationSheetHistory === historyIndex;
  const navigationVisible = navigationOpen || navigationSheetOpen;
  const navigationTransitionRef = useRef<boolean | null>(navigationOpen);
  const navigationWidth = navigationOpen ? paneGeometry.navigation : 0;
  const rightUsesSheet =
    workspaceSize.width > 0 &&
    workspaceSize.width < navigationWidth + 420 + Math.min(paneGeometry.right, 400) + 2;
  const rightSheet = rightRequestedOpen && rightUsesSheet;
  const rightInlineOpen = rightRequestedOpen && !rightSheet;
  const bottomOpen =
    bottomRequestedOpen && (workspaceSize.height === 0 || workspaceSize.height >= 501);
  const rightTransitionRef = useRef<boolean | null>(rightInlineOpen);
  const bottomTransitionRef = useRef<boolean | null>(bottomOpen);
  const canGoBack = router.history.canGoBack();
  const canGoForward = historyIndex < router.history.length - 1;

  const runShellTransition = useCallback(
    async (surface: "navigation" | "right" | "bottom", open: boolean, update: () => void) => {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const transitionID = ++shellTransitionRef.current;
      shellAnimationRef.current?.cancel();
      shellAnimationRef.current = null;
      const previousExitCleanup = shellExitCleanupRef.current;
      shellExitCleanupRef.current = null;
      if (previousExitCleanup) {
        previousExitCleanup();
        flushSync(() => setExitingPanel(null));
      }

      const findSurface = () => {
        const selector =
          surface === "right"
            ? '[data-shell-panel="right-workbench-sheet"], [data-shell-surface="right"]'
            : `[data-shell-surface="${surface}"]`;
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
      const createAnimation = (target: HTMLElement) =>
        target.animate(
          open
            ? [
                { opacity: 0.88, transform: `translate3d(${x}px, ${y}px, 0)` },
                { opacity: 1, transform: "translate3d(0, 0, 0)" },
              ]
            : [
                { opacity: 1, transform: "translate3d(0, 0, 0)" },
                { opacity: 0, transform: `translate3d(${x}px, ${y}px, 0)` },
              ],
          {
            duration: open ? 180 : 140,
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
          shellExitCleanupRef.current = () => {
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
          shellAnimationRef.current = animation;
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
          if (shellTransitionRef.current !== transitionID) return;
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
      if (!animatedSurface || shellTransitionRef.current !== transitionID) return;
      animation ??= createAnimation(animatedSurface);
      shellAnimationRef.current = animation;

      let cleanupTimer: number | undefined;
      await Promise.race([
        animation.finished.catch(() => undefined),
        new Promise((resolve) => {
          cleanupTimer = window.setTimeout(resolve, open ? 240 : 200);
        }),
      ]);
      if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
      if (shellTransitionRef.current === transitionID) {
        animation.cancel();
        shellAnimationRef.current = null;
        shellExitCleanupRef.current?.();
        shellExitCleanupRef.current = null;
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

  const openCommandPalette = useCallback(
    (trigger: HTMLElement) => {
      setCommandPaletteReturnFocus(trigger);
      setCommandPaletteOpen(true);
    },
    [setCommandPaletteOpen, setCommandPaletteReturnFocus],
  );

  const setNavigationVisibility = useCallback(
    (open: boolean) => {
      if (navigationCompact) {
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
    [historyIndex, navigationCompact, navigationPanelRef, runShellTransition, setNavigationOpen],
  );

  const startNewTask = useCallback(
    (requestedDirectory?: string) => {
      const current = newTaskContext.current;
      const project = requestedDirectory
        ? current.visible.find((item) => projectLocation(item) === requestedDirectory)
        : current.selectedSession
          ? projectForSession(current.projects, current.selectedSession)
          : current.visible[0];
      if (!project) return;
      void navigateToNewTask(project.id);
    },
    [navigateToNewTask],
  );

  const toggleRightWorkbench = useCallback(() => {
    if (!selectedSession) return;
    const open = !rightRequestedOpen;
    rightTransitionRef.current = open;
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
        if (open && !rightUsesSheet) rightPanelRef.current?.expand();
        else rightPanelRef.current?.collapse();
      });
    })();
  }, [
    rightPanelRef,
    rightRequestedOpen,
    rightUsesSheet,
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
    await palot.removePty(selectedSession.location, pty.id, pty.transport).catch(() => undefined);
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
    window.addEventListener("beforeunload", flushWorkbenchPersistence);
    return () => {
      window.removeEventListener("beforeunload", flushWorkbenchPersistence);
      flushWorkbenchPersistence();
    };
  }, []);

  useEffect(
    () => () => {
      shellTransitionRef.current += 1;
      shellAnimationRef.current?.cancel();
      shellExitCleanupRef.current?.();
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
      if (!event.shiftKey && event.key === "[") {
        event.preventDefault();
        if (canGoBack) router.history.back();
        return;
      }
      if (!event.shiftKey && event.key === "]") {
        event.preventDefault();
        if (canGoForward) router.history.forward();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canGoBack, canGoForward, router]);

  useEffect(() => {
    const openTarget = (target: AutomationNotificationTarget) => {
      if (target.sessionID && target.requestID && target.requestType) {
        void openSession(target.sessionID, {
          focus: "request",
          requestID: target.requestID,
          requestType: target.requestType,
        });
        return;
      }
      void openScheduled({ automationID: target.automationID, runID: target.runID });
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
    rightTransitionRef.current = rightInlineOpen;
    const animationFrame = requestAnimationFrame(() => {
      if (rightInlineOpen) rightPanelRef.current?.expand();
      else rightPanelRef.current?.collapse();
    });
    const transitionEnd = window.setTimeout(() => {
      if (rightTransitionRef.current === rightInlineOpen) {
        rightTransitionRef.current = null;
      }
    }, 280);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(transitionEnd);
    };
  }, [phase, rightInlineOpen, rightPanelRef]);

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
    <div ref={workspaceRef} className="relative size-full min-h-0 min-w-0">
      <SidebarProvider
        open={navigationOpen}
        onOpenChange={setNavigationVisibility}
        className="size-full min-h-0 min-w-0 bg-transparent"
        data-navigation={navigationOpen ? "open" : "closed"}
        data-right-workbench={rightRequestedOpen ? "open" : "closed"}
        data-right-workbench-mode={rightSheet ? "sheet" : "inline"}
        data-bottom-workbench={bottomRequestedOpen ? "open" : "closed"}
      >
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
              right: rightSize > 1 ? rightSize : current.right,
            }));
          }}
        >
          <ResizablePanel
            id="navigation"
            panelRef={navigationPanelRef}
            defaultSize={`${paneGeometry.navigation}px`}
            minSize="220px"
            maxSize="420px"
            collapsedSize="0px"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            data-shell-panel="navigation"
            className={cn(
              "relative flex min-w-0 overflow-hidden!",
              navigationOpen || exitingPanel === "navigation"
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
            onResize={({ inPixels }, _id, previousSize) => {
              if (!previousSize) return;
              const open = inPixels > 1;
              if (
                !navigationCompact &&
                navigationTransitionRef.current === null &&
                open !== navigationOpen
              ) {
                setNavigationOpen(open);
              }
            }}
          >
            <WorkspaceSidebar
              open={navigationOpen}
              onNewSession={startNewTask}
              onSearchTasks={openCommandPalette}
            />
          </ResizablePanel>
          <ResizableHandle
            disabled={!navigationOpen}
            aria-hidden={!navigationOpen}
            className={cn(
              "transition-opacity duration-150",
              navigationOpen ? "opacity-100" : "pointer-events-none w-0 opacity-0 after:hidden",
            )}
          />
          <ResizablePanel
            id="center"
            minSize={`${Math.min(360, workspaceSize.width || 360)}px`}
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
                  bottomOpen ? "opacity-100" : "pointer-events-none h-0 opacity-0 after:hidden",
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
                  bottomOpen || exitingPanel === "bottom-workbench"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0",
                )}
              >
                {(bottomOpen || exitingPanel === "bottom-workbench") &&
                workbenchScope &&
                selectedSession ? (
                  <WorkbenchPane
                    pane="bottom"
                    scope={workbenchScope}
                    context={workbench}
                    location={selectedSession.location}
                  />
                ) : null}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle
            disabled={!rightInlineOpen}
            aria-hidden={!rightInlineOpen}
            className={cn(
              "transition-opacity duration-150",
              rightInlineOpen ? "opacity-100" : "pointer-events-none w-0 opacity-0 after:hidden",
            )}
          />
          <ResizablePanel
            id="right-workbench"
            panelRef={rightPanelRef}
            defaultSize={`${paneGeometry.right}px`}
            minSize="300px"
            maxSize="70%"
            collapsedSize="0px"
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            data-shell-panel="right-workbench"
            className={cn(
              "relative flex min-h-0 min-w-0 overflow-hidden!",
              rightInlineOpen || exitingPanel === "right-workbench"
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
          >
            {(rightInlineOpen || exitingPanel === "right-workbench") &&
            workbenchScope &&
            selectedSession ? (
              <WorkbenchPane
                pane="right"
                scope={workbenchScope}
                context={workbench}
                location={selectedSession.location}
              />
            ) : null}
          </ResizablePanel>
        </ResizablePanelGroup>
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
            <SheetDescription className="sr-only">Projects, tasks, and settings</SheetDescription>
            <WorkspaceSidebar
              open={navigationSheetOpen}
              onNewSession={startNewTask}
              onSearchTasks={openCommandPalette}
            />
          </SheetContent>
        </Sheet>
        {(rightSheet || exitingPanel === "right-workbench-sheet") &&
        workbenchScope &&
        selectedSession ? (
          <div
            className="absolute inset-y-0 right-0 z-30 min-w-[300px] overflow-hidden border-l border-border/40 shadow-2xl"
            style={{
              width: `${Math.min(paneGeometry.right, Math.max(300, workspaceSize.width - 80))}px`,
            }}
            data-shell-panel="right-workbench-sheet"
          >
            <WorkbenchPane
              pane="right"
              scope={workbenchScope}
              context={workbench}
              location={selectedSession.location}
            />
          </div>
        ) : null}
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
              label={window.palot?.platform === "darwin" ? "Back (⌘[)" : "Back (Ctrl+[)"}
              appIcon="back"
              size="icon-sm"
              disabled={!canGoBack}
              className="pointer-events-auto [-webkit-app-region:no-drag]"
              onClick={goBack}
            />
            <IconButton
              label={window.palot?.platform === "darwin" ? "Forward (⌘])" : "Forward (Ctrl+])"}
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
          {window.palot?.platform === "linux" ? (
            <span className="size-6 shrink-0" aria-hidden="true" />
          ) : null}
        </div>
      </SidebarProvider>
    </div>
  );
}
