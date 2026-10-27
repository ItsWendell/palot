import { LoaderCircle, MessageCircle, Server } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import type { OpenCodeProfileSnapshot, OpenCodeRuntimeStatus, SidebarMode } from "../../shared";
import { sidebarModeAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { MultiConnectionSidebar } from "./multi-connection-sidebar";
import { cn } from "../lib/cn";
import { palotBuild } from "../lib/build";
import { palot } from "../services/palot";
import { InboxSidebarContent } from "./inbox-sidebar";
import { ProjectSidebarContent } from "./sidebar";
import { BuildBadge } from "./branding";
import { formatShortcut, shortcutAriaKeys, useShortcutKeys } from "../lib/keyboard-shortcuts";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar as SidebarPrimitive,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { sidebarItemVariants } from "./ui/sidebar-styles";
import { AppIcon } from "./ui/app-icon";

interface WorkspaceSidebarProps {
  open: boolean;
  onNewSession(directory?: string): void;
  onSearchTasks(trigger: HTMLElement): void;
  /** Shows this view instead of the remembered one (a peek shows the hovered view). */
  mode?: SidebarMode;
  /**
   * `peek` renders the column as a floating overlay below the window header: no
   * drag strip, no shell-transition surface, and no duplicate side effects.
   */
  presentation?: "column" | "peek";
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  open,
  onNewSession,
  onSearchTasks,
  mode: modeOverride,
  presentation = "column",
}: WorkspaceSidebarProps) {
  const storedMode = useAtomValue(sidebarModeAtom);
  const mode = modeOverride ?? storedMode;
  const peek = presentation === "peek";
  const { openSettings } = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const { connections, includedProfileIDs } = useConnectionOverview();
  const multiConnection =
    connections.length > 1 ||
    connections.some((connection) => !includedProfileIDs.includes(connection.profile.id));
  const enabledConnections = connections.filter((connection) =>
    includedProfileIDs.includes(connection.profile.id),
  );
  const connectedCount = enabledConnections.filter(
    (connection) => connection.runtime?.connected,
  ).length;
  const connectionSummary =
    connections.length === 0
      ? runtimeLabel(runtime)
      : enabledConnections.length === 0
        ? "Servers disabled"
        : `${connectedCount} of ${enabledConnections.length} ${enabledConnections.length === 1 ? "server" : "servers"} connected`;
  const title = mode === "inbox" ? "Inbox" : "Projects";
  const searchKeys = useShortcutKeys("palette.open");
  const chatKeys = useShortcutKeys("chat.new");
  const navigate = useNavigate();
  const searchShortcut = formatShortcut(searchKeys);

  return (
    <SidebarPrimitive
      collapsible="none"
      className="palot-sidebar w-full border-r-0!"
      // Shell transitions animate the pinned column; a peek animates itself.
      data-shell-surface={peek ? undefined : "navigation"}
      data-sidebar-presentation={presentation}
      aria-label={mode === "inbox" ? "Inbox navigation" : "Task navigation"}
      aria-hidden={!open}
      inert={!open}
      data-sidebar-mode={mode}
    >
      {peek ? null : (
        <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <SidebarHeader className="gap-0 p-0">
            <div className="flex h-8 shrink-0 items-center gap-2 px-2">
              <div className="flex min-w-0 items-center gap-2 px-1.5">
                <h2 className="truncate text-sm font-semibold text-sidebar-foreground">{title}</h2>
                <BuildBadge />
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Search tasks"
                      aria-keyshortcuts={shortcutAriaKeys(searchKeys)}
                      className="ml-auto text-sidebar-foreground/55 hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/90 focus-visible:ring-inset"
                      onClick={(event) => onSearchTasks(event.currentTarget)}
                    />
                  }
                >
                  <AppIcon name="search" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>
                  Search tasks
                  <Kbd>{searchShortcut}</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
            <SidebarGroup className="pt-1 pb-2">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className={sidebarItemVariants()}
                    onClick={() => onNewSession()}
                  >
                    <AppIcon name="add" aria-hidden="true" />
                    <span>New task</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className={sidebarItemVariants()}
                    aria-keyshortcuts={shortcutAriaKeys(chatKeys)}
                    title={`New chat without a project (${formatShortcut(chatKeys)})`}
                    onClick={() => void navigate({ to: "/new", search: { chat: true } })}
                  >
                    <MessageCircle aria-hidden="true" />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarHeader>

          {multiConnection ? (
            <MultiConnectionSidebar mode={mode} />
          ) : mode === "inbox" ? (
            <InboxSidebarContent />
          ) : (
            <ProjectSidebarContent onNewSession={onNewSession} notifyAttention={!peek} />
          )}

          <SidebarFooter className="p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton
                        className={cn(sidebarItemVariants(), "h-auto min-h-10 py-1.5")}
                        aria-label="Open Palot menu"
                      />
                    }
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">Palot</span>
                      <span className="block truncate text-micro/tight font-normal text-sidebar-foreground/55">
                        {connectionSummary}
                      </span>
                    </span>
                    <AppIcon
                      name="chevronUp"
                      className="text-sidebar-foreground/45"
                      aria-hidden="true"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    sideOffset={7}
                    className="w-64 p-1.5"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2 py-2">
                        <span className="block text-sm font-medium text-foreground">
                          {palotBuild.label ? `Palot ${palotBuild.label}` : "Palot"}
                        </span>
                        <span className="mt-0.5 block text-meta font-normal text-muted-foreground">
                          {runtime?.version
                            ? `OpenCode ${runtime.version} · ${runtime.connected ? "Connected" : "Disconnected"}`
                            : "OpenCode service unavailable"}
                        </span>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <ServerProfileMenu onManage={() => void openSettings("connections")} />
                      <DropdownMenuItem onClick={() => void openSettings("about")}>
                        <AppIcon name="info" aria-hidden="true" />
                        <span>About</span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </div>
      </div>
    </SidebarPrimitive>
  );
});

function ServerProfileMenu({ onManage }: { onManage(): void }) {
  const { includedProfileIDs, setIncludedProfileIDs } = useConnectionOverview();
  const [snapshot, setSnapshot] = useState<OpenCodeProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadProfiles = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setSnapshot(await palot.listOpenCodeProfiles());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open && !loading) void loadProfiles();
      }}
    >
      <DropdownMenuSubTrigger>
        <Server aria-hidden="true" />
        <span>Servers</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64 p-1.5">
        {snapshot ? (
          snapshot.profiles.map((profile) => {
            const enabled = includedProfileIDs.includes(profile.id);
            return (
              <DropdownMenuCheckboxItem
                key={profile.id}
                checked={enabled}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  setIncludedProfileIDs((current) =>
                    checked
                      ? [...new Set([...current, profile.id])]
                      : current.filter((id) => id !== profile.id),
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                <span className="text-meta text-muted-foreground">
                  {enabled ? "Enabled" : "Disabled"}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })
        ) : loadError ? (
          <DropdownMenuItem onClick={() => void loadProfiles()}>
            <Server aria-hidden="true" />
            Retry loading connections
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Loading connections…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManage}>Manage connections…</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function runtimeLabel(runtime: OpenCodeRuntimeStatus | null): string {
  if (!runtime) return "OpenCode unavailable";
  if (runtime.connected) return "OpenCode connected";
  if (runtime.phase === "connecting" || runtime.phase === "starting")
    return "Connecting to OpenCode";
  return "OpenCode disconnected";
}
