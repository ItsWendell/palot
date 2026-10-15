import { FolderGit2, GitPullRequest } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import type { PointerEvent, ReactNode } from "react";
import type { SidebarMode } from "../../shared";
import { automationUnreadCountAtom } from "../atoms/automations";
import { navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionInbox } from "../hooks/use-session-inbox";
import { isFullPageRoute } from "../lib/full-page-routes";
import { cn } from "../lib/cn";
import { PalotMark } from "./branding";
import { Button } from "./ui/button";
import { AppIcon } from "./ui/app-icon";
import { formatShortcut, useShortcutKeys } from "../lib/keyboard-shortcuts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { SidebarFluidList, sidebarFluidRowProps } from "./sidebar-fluid-list";

/** Routes that render outside the workspace shell and therefore have no task column. */
function isWorkspaceRoute(pathname: string): boolean {
  return !pathname.startsWith("/settings") && !pathname.startsWith("/welcome");
}

/**
 * Global destinations as a narrow icon column. It lives outside the task column so it
 * stays visible when that column is hidden, and is self-contained so other shells such
 * as Settings can mount it too.
 */
export function NavigationRail({
  className,
  navigationOpen,
  onNavigationOpenChange,
  onViewHoverStart,
  onViewHoverEnd,
  peeking = false,
}: {
  className?: string;
  /** A peek overlay sits beside the rail; tooltips would cover its top edge. */
  peeking?: boolean;
  /** Whether the task column is visible. Omit outside the workspace shell. */
  navigationOpen?: boolean;
  onNavigationOpenChange?(open: boolean): void;
  /** The pointer rests on a column view button; the shell may peek that view. */
  onViewHoverStart?(view: SidebarMode): void;
  onViewHoverEnd?(): void;
}) {
  const [mode, setMode] = useAtom(sidebarModeAtom);
  const [storedNavigationOpen, setStoredNavigationOpen] = useAtom(navigationOpenAtom);
  const columnVisible = navigationOpen ?? storedNavigationOpen;
  const { closeSettings, openPullRequests, openScheduled, openSettings, openUsage, openWorktrees } =
    usePalotNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scheduledUnreadCount = useAtomValue(automationUnreadCountAtom);
  const attentionCount = useInboxAttentionCount();
  const workspaceRoute = isWorkspaceRoute(pathname);
  const scheduledActive = pathname === "/scheduled";
  const usageActive = pathname === "/usage";
  const worktreesActive = pathname === "/worktrees";
  const pullRequestsActive = pathname === "/pull-requests";
  const settingsActive = pathname.startsWith("/settings");
  // Route destinations own the strong selected state; the column view stays pressed.
  const routeDestinationActive = isFullPageRoute(pathname);
  const showMode = (next: typeof mode) => {
    if (!workspaceRoute) {
      setMode(next);
      setStoredNavigationOpen(true);
      void closeSettings();
      return;
    }
    // Like ChatGPT's rail: the active view toggles its column; another view opens it.
    if (columnVisible && mode === next && !routeDestinationActive) {
      onNavigationOpenChange?.(false);
      return;
    }
    setMode(next);
    if (!columnVisible) onNavigationOpenChange?.(true);
  };
  const settingsShortcut = formatShortcut(useShortcutKeys("settings.open"));
  // Hover intent is a pointer affordance only; touch taps go straight to the click path.
  const viewHoverProps = (view: SidebarMode) =>
    onViewHoverStart
      ? {
          onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
            if (event.pointerType !== "touch") onViewHoverStart(view);
          },
          onPointerLeave: () => onViewHoverEnd?.(),
        }
      : undefined;

  return (
    <nav
      aria-label="Palot"
      data-navigation-rail
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-1 pt-0.5 pb-2 text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-8 items-center justify-center" aria-hidden="true">
        <PalotMark className="size-4 text-sidebar-foreground/80" />
      </div>
      {/* Gap clicks only count beside a button, never across the empty span above Settings. */}
      <SidebarFluidList
        gapClick={{ maxDistance: 8 }}
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-1"
      >
        <RailButton
          tooltipDisabled={peeking}
          label={attentionCount > 0 ? `Show inbox, ${attentionCount} need attention` : "Show inbox"}
          tooltip={attentionCount > 0 ? `Inbox · ${attentionCount} need attention` : "Inbox"}
          pressed={workspaceRoute && columnVisible && mode === "inbox"}
          selected={workspaceRoute && columnVisible && mode === "inbox" && !routeDestinationActive}
          indicator={attentionCount > 0}
          onClick={() => showMode("inbox")}
          hoverProps={viewHoverProps("inbox")}
        >
          <AppIcon name="inbox" aria-hidden="true" />
        </RailButton>
        <RailButton
          tooltipDisabled={peeking}
          label="Show projects"
          tooltip="Projects"
          pressed={workspaceRoute && columnVisible && mode === "project"}
          selected={
            workspaceRoute && columnVisible && mode === "project" && !routeDestinationActive
          }
          onClick={() => showMode("project")}
          hoverProps={viewHoverProps("project")}
        >
          <AppIcon name="folder" aria-hidden="true" />
        </RailButton>
        <div className="h-1.5 shrink-0" aria-hidden="true" />
        <RailButton
          tooltipDisabled={peeking}
          label={
            scheduledUnreadCount > 0
              ? `Scheduled, ${scheduledUnreadCount} unread ${scheduledUnreadCount === 1 ? "run" : "runs"}`
              : "Scheduled"
          }
          tooltip="Scheduled"
          current={scheduledActive}
          selected={scheduledActive}
          indicator={scheduledUnreadCount > 0}
          onClick={() => void openScheduled()}
        >
          <AppIcon name="scheduled" aria-hidden="true" />
        </RailButton>
        <RailButton
          tooltipDisabled={peeking}
          label="Usage"
          current={usageActive}
          selected={usageActive}
          onClick={() => void openUsage()}
        >
          <AppIcon name="usage" aria-hidden="true" />
        </RailButton>
        <RailButton
          tooltipDisabled={peeking}
          label="Worktrees"
          current={worktreesActive}
          selected={worktreesActive}
          onClick={() => void openWorktrees()}
        >
          <FolderGit2 aria-hidden="true" />
        </RailButton>
        <RailButton
          tooltipDisabled={peeking}
          label="Pull requests"
          current={pullRequestsActive}
          selected={pullRequestsActive}
          onClick={() => void openPullRequests()}
        >
          <GitPullRequest aria-hidden="true" />
        </RailButton>
        <RailButton
          tooltipDisabled={peeking}
          label="Settings"
          tooltip={`Settings (${settingsShortcut})`}
          className="mt-auto"
          current={settingsActive}
          selected={settingsActive}
          onClick={() => void openSettings()}
        >
          <AppIcon name="settings" aria-hidden="true" />
        </RailButton>
      </SidebarFluidList>
    </nav>
  );
}

function RailButton({
  label,
  tooltip = label,
  tooltipDisabled = false,
  pressed,
  current,
  selected,
  indicator = false,
  className,
  onClick,
  hoverProps,
  children,
}: {
  label: string;
  tooltip?: string;
  tooltipDisabled?: boolean;
  /** View toggles report aria-pressed; route destinations report aria-current. */
  pressed?: boolean;
  current?: boolean;
  selected: boolean;
  indicator?: boolean;
  className?: string;
  onClick(): void;
  hoverProps?: {
    onPointerEnter(event: PointerEvent<HTMLButtonElement>): void;
    onPointerLeave(): void;
  };
  children: ReactNode;
}) {
  return (
    <Tooltip disabled={tooltipDisabled}>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            {...sidebarFluidRowProps}
            {...hoverProps}
            aria-label={label}
            aria-pressed={pressed}
            aria-current={current ? "page" : undefined}
            data-selected={selected || undefined}
            className={cn(
              // The rail's gliding highlight is the hover fill; a selected item keeps its own.
              "relative shrink-0 text-sidebar-foreground/60 outline-none hover:bg-transparent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring [&_[data-icon]]:size-(--theme-ui-icon-size)! [&_svg]:size-(--theme-ui-icon-size)!",
              pressed && !selected && "text-sidebar-foreground",
              selected &&
                "bg-(--palot-sidebar-selected) text-sidebar-foreground hover:bg-(--palot-sidebar-selected)",
              className,
            )}
            onClick={onClick}
          />
        }
      >
        {children}
        {indicator ? (
          <span
            className="absolute top-1 right-1 size-1.5 rounded-full bg-info ring-1 ring-sidebar"
            aria-hidden="true"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Attention count for the Inbox destination, spanning every visible connection. */
function useInboxAttentionCount(): number {
  const inbox = useSessionInbox();
  const { connections, includedProfileIDs, visibleProfileIDs } = useConnectionOverview();
  const multiConnection =
    connections.length > 1 ||
    connections.some((connection) => !includedProfileIDs.includes(connection.profile.id));
  if (!multiConnection)
    return [...inbox.pinned, ...inbox.inbox].filter((item) => item.attention || item.failed).length;
  return connections
    .filter(
      (connection) =>
        includedProfileIDs.includes(connection.profile.id) &&
        (visibleProfileIDs === null || visibleProfileIDs.includes(connection.profile.id)),
    )
    .reduce(
      (count, connection) =>
        count +
        [...connection.inbox.pinned, ...connection.inbox.inbox].filter(
          (item) => item.attention || item.failed,
        ).length,
      0,
    );
}
