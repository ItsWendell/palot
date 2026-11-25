import { LoaderCircle, Server } from "lucide-react";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import type { OpenCodeProfileSnapshot, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { cn } from "../lib/cn";
import { palotBuild } from "../lib/build";
import { palot } from "../services/palot";
import { BuildBadge } from "./branding";
import { AppTaskList } from "./task-list-host";
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { sidebarItemVariants } from "./ui/sidebar-styles";
import { AppIcon } from "./ui/app-icon";

interface WorkspaceSidebarProps {
  open: boolean;
  onSearchTasks(trigger: HTMLElement): void;
  /**
   * `peek` renders the column as a floating overlay below the window header: no drag strip,
   * no shell-transition surface, and none of the list's window-wide keys. `sheet` is the
   * compact window's overlay; it too leaves the window's keys to the pinned column.
   */
  presentation?: "column" | "peek" | "sheet";
}

/** The task column: the task list over every enabled server, with the Palot menu as footer. */
export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  open,
  onSearchTasks,
  presentation = "column",
}: WorkspaceSidebarProps) {
  const peek = presentation === "peek";
  const searchRef = useRef<HTMLDivElement>(null);

  return (
    <SidebarPrimitive
      collapsible="none"
      className="palot-sidebar w-full border-r-0!"
      // Shell transitions animate the pinned column; a peek animates itself.
      data-shell-surface={peek ? undefined : "navigation"}
      data-sidebar-presentation={presentation}
      aria-label="Tasks"
      // A hover peek is transient; F6 moves through the pinned or sheet sidebar.
      data-focus-region={peek ? undefined : "sidebar"}
      aria-hidden={!open}
      inert={!open}
    >
      {peek ? null : (
        <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      )}
      <div ref={searchRef} className="flex min-h-0 flex-1 flex-col">
        <AppTaskList
          primary={presentation === "column"}
          onSearch={() => {
            const trigger = searchRef.current?.querySelector<HTMLElement>(
              "[aria-label='Search tasks']",
            );
            onSearchTasks(trigger ?? document.body);
          }}
          footer={<PalotMenu />}
        />
      </div>
    </SidebarPrimitive>
  );
});

/** The footer's Palot menu: connection state, server toggles and About. */
function PalotMenu() {
  const { openSettings } = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const { connections, includedProfileIDs } = useConnectionOverview();
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
  return (
    <SidebarFooter className="p-2 pt-1">
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
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <span className="truncate">Palot</span>
                  <BuildBadge />
                </span>
                <span className="block truncate text-micro/tight font-normal text-sidebar-foreground/55">
                  {connectionSummary}
                </span>
              </span>
              <AppIcon name="chevronUp" className="text-sidebar-foreground/45" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={7} className="w-64 p-1.5">
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
  );
}

function ServerProfileMenu({ onManage }: { onManage(): void }) {
  const { connections, includedProfileIDs, setIncludedProfileIDs } = useConnectionOverview();
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
            const connection = connections.find((entry) => entry.profile.id === profile.id);
            const state = !enabled
              ? "Disabled"
              : connection?.runtime?.connected
                ? "Connected"
                : connection?.phase === "loading"
                  ? "Connecting…"
                  : "Offline";
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
                <span
                  className={cn(
                    "text-meta text-muted-foreground",
                    state === "Offline" && "text-warning",
                  )}
                >
                  {state}
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
