import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowUpToLine,
  Bell,
  Bot,
  Boxes,
  Braces,
  BrainCircuit,
  Cable,
  Check,
  CircleAlert,
  Code2,
  Command,
  Download,
  Ellipsis,
  FileCog,
  FolderGit2,
  GripVertical,
  ExternalLink,
  Link2,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { LocationRef, ModelRef } from "@opencode/client";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  APPEARANCE_MODES,
  APPEARANCE_THEMES,
  CODE_FONT_OPTIONS,
  CODE_THEME_IDS,
  CODE_THEME_OPTIONS,
  DEFAULT_APPEARANCE_PREFERENCES,
  NATIVE_GLASS_VARIANTS,
  SIDEBAR_MATERIALS,
  UI_FONT_OPTIONS,
  WINDOW_MATERIALS,
  effectiveAppearanceTreatment,
  appearanceTheme,
  effectiveNativeGlass,
} from "../../shared";
import type {
  AppearanceMode,
  AppearancePreferences,
  AppearanceTerminalPalette,
  AppearanceThemeID,
  AppearanceThemeVariant,
  CodeThemeID,
  AutomationHostSettings,
  DesktopNotificationDeliveryStatus,
  DesktopNotificationSettings,
  PalotIntegration,
  PalotIntegrationConnection,
  PalotMcpConfig,
  PalotMcpServer,
  PalotModel,
  PalotPlugin,
  PalotProject,
  PalotSettingsSnapshot,
  SettingsCapability,
} from "../../shared";
import {
  autoBackgroundOnSteerAtom,
  defaultDeliveryAtom,
  defaultModelsAtom,
  modelPickerPreferencesAtom,
  remoteMarkdownFaviconsAtom,
  showTimelineCacheBustsAtom,
  defaultSidebarModeAtom,
  defaultWorktreeBaseAtom,
  defaultWorkspaceModeAtom,
  sessionProjectionPreferenceAtom,
} from "../atoms/ui";
import {
  appearancePreferencesAtom,
  appearanceRestartRequiredAtom,
  resolvedAppearanceAtom,
} from "../atoms/appearance";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { runtimeAtom } from "../atoms/workspace";
import { cn } from "../lib/cn";
import { openCodeKeys } from "../lib/opencode-query";
import { isAppearanceFontAvailable } from "../lib/font-loading";
import {
  applyModelPreference,
  modelPreferenceKey,
  reconcileModelPreference,
  reconcileModelOrder,
  type ModelPickerPreference,
} from "../lib/model-preferences";
import { SETTINGS_NAV_ITEMS, type SettingsCategory } from "../lib/settings-navigation";
import { isPopularProvider, orderProviderIntegrations } from "../lib/provider-presentation";
import {
  ACTIVITY_CATEGORIES,
  resolveSessionProjectionPreference,
  type ActivityCategory,
  type ActivityProjectionPreference,
  type GroupTitleMode,
  type SessionProjectionPreset,
} from "../lib/session-projection-policy";
import { projectForSession, projectLocation, orderProjects } from "../lib/view-models";
import { palotBuild } from "../lib/build";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useCheckPlugins, useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import {
  useProjectCatalog,
  useSelectedSession,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { palot } from "../services/palot";
import { BuildBadge, PalotMark } from "./branding";
import { ProviderConnectionDialog } from "./provider-connection-dialog";
import { ProviderIcon } from "./ui/provider-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { AppIcon, type AppIconName } from "./ui/app-icon";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ProjectSelect } from "./project-select";
import { ProjectSettings, projectDetailsKey } from "./project-settings";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { sidebarItemVariants, sidebarSectionLabelVariants } from "./ui/sidebar-styles";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/toast";
import { SettingsEmpty, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";

const CATEGORY_COPY: Record<SettingsCategory, { title: string; description: string }> = {
  general: {
    title: "General",
    description: "Choose how new tasks start and how much activity Palot shows.",
  },
  project: {
    title: "Project",
    description: "Manage project details, worktree startup, and the main checkout directory.",
  },
  connections: {
    title: "Connections",
    description: "Choose where Palot connects and how you access OpenCode.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose themes, materials, and typography for your workspace.",
  },
  notifications: {
    title: "Notifications",
    description: "Choose when Palot uses native macOS alerts for tasks that need you.",
  },
  models: {
    title: "Models",
    description: "Choose project defaults and inspect the models OpenCode makes available.",
  },
  providers: {
    title: "Providers",
    description: "Connect model providers and manage their authentication methods.",
  },
  tools: {
    title: "Tools",
    description: "Manage plugins and MCP servers, and browse tools discovered for this project.",
  },
  agents: {
    title: "Agents",
    description: "Inspect the primary agents and subagents available in this project.",
  },
  permissions: {
    title: "Permissions",
    description: "Review saved approvals and the effective configured policy.",
  },
  config: {
    title: "Configuration",
    description: "Inspect the configuration sources and capabilities resolved by OpenCode.",
  },
  diagnostics: {
    title: "Diagnostics",
    description: "Inspect live renderer, Electron, GPU, and OpenCode runtime signals.",
  },
  about: {
    title: "About",
    description: "View Palot build details and the connected OpenCode service.",
  },
};

const SETTINGS_APP_ICONS: Record<SettingsCategory, AppIconName> = {
  project: "config",
  general: "settings",
  appearance: "appearance",
  notifications: "notifications",
  connections: "servers",
  models: "models",
  providers: "providers",
  tools: "tools",
  agents: "agents",
  permissions: "permissions",
  config: "config",
  diagnostics: "diagnostics",
  about: "info",
};

const DiagnosticsSettings = lazy(() =>
  import("./diagnostics-settings").then((module) => ({ default: module.DiagnosticsSettings })),
);
const ConnectionSettings = lazy(() =>
  import("./connection-settings").then((module) => ({ default: module.ConnectionSettings })),
);

const SETTINGS_CAPABILITIES: Partial<Record<SettingsCategory, SettingsCapability[]>> = {
  models: ["catalog"],
  providers: ["integrations"],
  tools: [
    "mcp",
    "mcpResources",
    "plugins",
    "skills",
    "commands",
    "references",
    "websearchProviders",
  ],
  agents: ["agents"],
  permissions: ["config", "savedPermissions"],
  config: ["config"],
};

export function Settings({
  category,
  projectID: routeProjectID,
  connectionTab = "profiles",
}: {
  category: SettingsCategory;
  projectID?: string;
  connectionTab?: "profiles" | "web-access" | "local-service";
}) {
  const { closeSettings, openSettings } = usePalotNavigation();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const allProjects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const projects = useMemo(() => orderProjects(allProjects, sessions), [allProjects, sessions]);
  const session = useSelectedSession();
  const sessionProject = session ? projectForSession(allProjects, session) : undefined;
  const initialProject =
    sessionProject ??
    projects.find((project) => project.id === routeProjectID) ??
    projects[0] ??
    null;
  const projectID = routeProjectID ?? initialProject?.id ?? "";
  const project = projects.find((item) => item.id === projectID) ?? initialProject;
  const settingsLocation =
    project && session && sessionProject?.id === project.id
      ? session.location
      : project
        ? { directory: projectLocation(project) }
        : null;
  const capabilities = SETTINGS_CAPABILITIES[category];
  const settingsInput =
    capabilities && project && settingsLocation
      ? {
          projectID: project.id,
          directory: settingsLocation.directory,
          capabilities,
          ...(settingsLocation.workspaceID ? { workspaceID: settingsLocation.workspaceID } : {}),
        }
      : null;
  const settings = useSettingsSnapshot(settingsInput);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== "Escape") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        event.target.blur();
        return;
      }
      event.preventDefault();
      void closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings]);

  async function refresh() {
    if (category === "project" && project) {
      await queryClient.invalidateQueries({
        queryKey: projectDetailsKey(runtime?.connectionID ?? "disconnected", project.id),
      });
      return;
    }
    await settings.refetch();
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSnapshot = settings.data ?? null;
  const capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>> = {};
  for (const capability of capabilities ?? []) {
    const queryState = settingsInput
      ? queryClient.getQueryState(
          openCodeKeys.settingsSnapshot(runtime?.connectionID ?? "disconnected", {
            ...settingsInput,
            capabilities: [capability],
          }),
        )
      : undefined;
    capabilityStates[capability] = queryState?.error
      ? { status: "error", message: queryState.error.message }
      : queryState?.data
        ? inventoryState(visibleSnapshot, capability)
        : { status: queryState?.fetchStatus === "fetching" ? "loading" : "unavailable" };
  }
  const loading = settings.isFetching;
  const error = settings.error
    ? settings.error instanceof Error
      ? settings.error.message
      : "Could not load OpenCode settings."
    : null;
  const visibleNav = normalizedQuery
    ? SETTINGS_NAV_ITEMS.filter((item) =>
        `${item.label} ${item.description} ${item.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : SETTINGS_NAV_ITEMS;
  const activeCopy = CATEGORY_COPY[category];

  return (
    <main
      className="flex size-full min-h-0 flex-col bg-transparent md:flex-row"
      aria-label="Settings"
    >
      <aside className="palot-settings-sidebar flex max-h-[196px] shrink-0 flex-col border-b border-sidebar-border bg-sidebar pt-(--shell-header-height) md:max-h-none md:w-[248px] md:border-r md:border-b-0">
        <div className="px-3 pt-3 pb-2 md:px-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              value={query}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-8 bg-background/55 pr-8 pl-8"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Clear settings search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-2 md:px-2.5">
          <nav
            className="flex gap-1 py-1 md:flex md:flex-col md:gap-3"
            aria-label="Settings categories"
          >
            {(["Palot", "OpenCode", "System"] as const).map((group) => {
              const items = visibleNav.filter((item) => item.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="contents md:flex md:flex-col md:gap-px">
                  <div className={cn("hidden md:flex", sidebarSectionLabelVariants())}>{group}</div>
                  <div className="flex gap-1 md:flex md:flex-col md:gap-px">
                    {items.map((item) => {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-active={category === item.id || undefined}
                          aria-current={category === item.id ? "page" : undefined}
                          title={item.description}
                          className={cn(
                            "group flex shrink-0 items-center text-left md:w-full",
                            sidebarItemVariants(),
                            "data-[active]:bg-(--palot-sidebar-selected) data-[active]:font-medium data-[active]:text-sidebar-foreground",
                          )}
                          onClick={() => void openSettings(item.id, project?.id, true)}
                        >
                          <AppIcon
                            name={SETTINGS_APP_ICONS[item.id]}
                            className="size-3.5 shrink-0 opacity-75 group-data-[active]:opacity-100"
                            aria-hidden="true"
                          />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleNav.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                No settings match “{query}”.
              </p>
            ) : null}
          </nav>
        </ScrollArea>
        <div className="hidden border-t border-sidebar-border p-2 md:block">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 px-2.5"
            onClick={() => void closeSettings()}
          >
            <ArrowLeft aria-hidden="true" />
            Back to tasks
          </Button>
        </div>
      </aside>
      <section className="palot-main-surface @container/settings-page relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="palot-main-surface-header window-drag flex h-(--shell-header-height) shrink-0 items-center border-b border-sidebar-border bg-background px-5">
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <span className="text-sm font-semibold">Settings</span>
            <span className="text-muted-foreground/45">/</span>
            <span className="truncate text-xs text-muted-foreground">{activeCopy.title}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {projects.length > 1 ? (
              <ProjectSelect
                projects={projects}
                value={project?.id ?? null}
                onValueChange={(value) => value && void openSettings(category, value, true)}
                ariaLabel="Settings project"
                align="end"
                variant="settings"
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh settings"
              disabled={loading || !project}
              onClick={() => void refresh()}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div
            className={cn(
              "mx-auto flex w-full flex-col gap-8 px-4 py-6 @2xl/settings-page:px-8",
              category === "diagnostics" ? "max-w-[1180px]" : "max-w-5xl",
            )}
          >
            <div className="space-y-2">
              <h1 className="text-page-title font-semibold">{activeCopy.title}</h1>
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                {activeCopy.description}
              </p>
            </div>
            {visibleSnapshot?.errors.length ? (
              <div className="rounded-xl border border-warning/25 bg-warning/5 p-4 text-compact">
                <div className="flex items-center gap-2 font-medium text-warning">
                  <CircleAlert className="size-4" aria-hidden="true" />
                  Some settings need attention
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleSnapshot.errors.map((item) => (
                    <Badge
                      key={`${item.capability}:${item.message}`}
                      variant="outline"
                      title={item.message}
                    >
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {visibleSnapshot && settings.pendingCapabilities.length > 0 ? (
              <p role="status" className="text-compact text-muted-foreground">
                Some settings are still loading. Available settings are shown below.
              </p>
            ) : null}
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{error}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {!project &&
            ![
              "general",
              "appearance",
              "notifications",
              "connections",
              "diagnostics",
              "about",
            ].includes(category) ? (
              <SettingsSection title="No project selected" icon={FolderGit2}>
                <p className="px-4 text-sm text-muted-foreground">
                  Add a project before configuring project-scoped OpenCode settings.
                </p>
              </SettingsSection>
            ) : (
              <SettingsContent
                category={category}
                project={project}
                location={settingsLocation}
                snapshot={visibleSnapshot}
                loading={loading}
                pendingCapabilities={settings.pendingCapabilities}
                capabilityStates={capabilityStates}
                refresh={refresh}
                connectionTab={connectionTab}
              />
            )}
          </div>
        </ScrollArea>
      </section>
    </main>
  );
}

function SettingsContent({
  category,
  project,
  location,
  snapshot,
  loading,
  pendingCapabilities,
  capabilityStates,
  refresh,
  connectionTab,
}: {
  category: SettingsCategory;
  project: PalotProject | null;
  location: LocationRef | null;
  snapshot: PalotSettingsSnapshot | null;
  loading: boolean;
  pendingCapabilities: SettingsCapability[];
  capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
  connectionTab: "profiles" | "web-access" | "local-service";
}) {
  if (loading && !snapshot && category !== "tools") return <SettingsSkeleton />;
  if (category === "general") return <GeneralSettings />;
  if (category === "appearance") return <AppearanceSettings />;
  if (category === "notifications") return <NotificationSettings />;
  if (category === "connections") {
    return (
      <Suspense fallback={<SettingsSkeleton />}>
        <ConnectionSettings tab={connectionTab} />
      </Suspense>
    );
  }
  if (category === "diagnostics") {
    return (
      <Suspense fallback={<SettingsSkeleton />}>
        <DiagnosticsSettings />
      </Suspense>
    );
  }
  if (category === "about") return <AboutSettings snapshot={snapshot} />;
  if (!project) return null;
  if (category === "project") return <ProjectSettings project={project} />;
  if (category === "models") return <ModelSettings project={project} snapshot={snapshot} />;
  if (category === "providers") {
    return (
      <ProviderSettings
        project={project}
        location={location!}
        snapshot={snapshot}
        refresh={refresh}
      />
    );
  }
  if (category === "tools") {
    return (
      <ToolSettings
        project={project}
        location={location!}
        snapshot={snapshot}
        pendingCapabilities={pendingCapabilities}
        capabilityStates={capabilityStates}
        refresh={refresh}
      />
    );
  }
  if (category === "agents") return <AgentSettings snapshot={snapshot} />;
  if (category === "permissions") {
    return (
      <PermissionSettings
        snapshot={snapshot}
        pendingCapabilities={pendingCapabilities}
        capabilityStates={capabilityStates}
        refresh={refresh}
      />
    );
  }
  if (category === "config") return <ConfigSettings snapshot={snapshot} />;
  return null;
}

const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  reasoning: "Reasoning",
  read: "Reads",
  "code-search": "Code searches",
  edit: "Edits",
  command: "Commands",
  web: "Web activity",
  delegation: "Delegation",
  other: "Other tools",
};

const PROJECTION_PRESET_DESCRIPTIONS: Record<SessionProjectionPreset, string> = {
  "code-focus": "Keeps the final response prominent and activity available as summaries.",
  compact:
    "Keeps the current phase open with reasoning summaries while completed work stays compact.",
  expanded: "Shows every activity row while keeping raw tool inputs and outputs inspectable.",
};

const PROJECTION_PRESET_LABELS: Record<SessionProjectionPreset, string> = {
  "code-focus": "Focused",
  compact: "Balanced",
  expanded: "Detailed",
};

const ACTIVITY_PRESENTATION_LABELS: Record<ActivityProjectionPreference["presentation"], string> = {
  individual: "Individual",
  grouped: "Grouped",
  hidden: "Hidden when completed",
};

const DETAIL_DEFAULT_LABELS: Record<ActivityProjectionPreference["details"], string> = {
  collapsed: "Collapsed",
  expanded: "Expanded",
};

const FOLDED_TURN_LABELS: Record<ActivityProjectionPreference["foldedTurn"], string> = {
  inside: "Inside",
  pinned: "Keep visible",
};

const GROUP_TITLE_LABELS: Record<GroupTitleMode, string> = {
  summary: "Activity summary",
  "latest-reasoning": "Reasoning intent",
};

const SIDEBAR_MODE_LABELS = {
  remember: "Remember",
  project: "Projects",
  inbox: "Inbox",
} as const;

const WORKSPACE_MODE_LABELS = {
  worktree: "Worktree",
  current: "Current checkout",
} as const;

const WORKTREE_BASE_LABELS = {
  "repository-default": "Repository default",
  current: "Current branch",
} as const;

const DELIVERY_LABELS = {
  steer: "Steer",
  queue: "Queue",
} as const;

function GeneralSettings() {
  const [workspaceMode, setWorkspaceMode] = useAtom(defaultWorkspaceModeAtom);
  const [worktreeBase, setWorktreeBase] = useAtom(defaultWorktreeBaseAtom);
  const [projection, setProjection] = useAtom(sessionProjectionPreferenceAtom);
  const [customizeProjection, setCustomizeProjection] = useState(false);
  const [delivery, setDelivery] = useAtom(defaultDeliveryAtom);
  const [autoBackgroundOnSteer, setAutoBackgroundOnSteer] = useAtom(autoBackgroundOnSteerAtom);
  const [showTimelineCacheBusts, setShowTimelineCacheBusts] = useAtom(showTimelineCacheBustsAtom);
  const [remoteMarkdownFavicons, setRemoteMarkdownFavicons] = useAtom(remoteMarkdownFaviconsAtom);
  const [defaultSidebarMode, setDefaultSidebarMode] = useAtom(defaultSidebarModeAtom);
  const [automationHostSettings, setAutomationHostSettings] =
    useState<AutomationHostSettings | null>(null);
  const resolvedProjection = useMemo(
    () => resolveSessionProjectionPreference(projection),
    [projection],
  );
  const customized =
    projection.foldCompletedTurns !== undefined ||
    projection.groupTitle !== undefined ||
    projection.groupSameFileReads !== undefined ||
    projection.showReasoningSummaries !== undefined ||
    projection.keepCurrentActivityExpanded !== undefined ||
    (projection.categories !== undefined && Object.keys(projection.categories).length > 0);
  const updateCategory = (
    category: ActivityCategory,
    patch: Partial<ActivityProjectionPreference>,
  ) => {
    setProjection((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [category]: { ...current.categories?.[category], ...patch },
      },
    }));
  };
  useEffect(() => {
    let active = true;
    void palot
      .loadAutomationHostSettings()
      .then((settings) => {
        if (active) setAutomationHostSettings(settings);
      })
      .catch((error) => {
        toast.add({
          type: "error",
          title: error instanceof Error ? error.message : "Could not load Scheduled settings",
        });
      });
    return () => {
      active = false;
    };
  }, []);
  const updateAutomationHostSettings = async (patch: Partial<AutomationHostSettings>) => {
    if (!automationHostSettings) return;
    const previous = automationHostSettings;
    const next = { ...previous, ...patch };
    setAutomationHostSettings(next);
    try {
      setAutomationHostSettings(await palot.updateAutomationHostSettings(next));
    } catch (error) {
      setAutomationHostSettings(previous);
      toast.add({
        type: "error",
        title: error instanceof Error ? error.message : "Could not update Scheduled settings",
      });
    }
  };
  return (
    <div className="space-y-8">
      <SettingsSection
        title="Task defaults"
        description="Starting choices for new tasks and messages sent while work is running."
      >
        <SettingsGroup>
          <SettingsRow
            title="Default workspace"
            description="Create isolated worktrees by default, or start in the project checkout."
            control={
              <Select
                value={workspaceMode}
                onValueChange={(value) => setWorkspaceMode(value as typeof workspaceMode)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="Default workspace">
                  <SelectValue>{WORKSPACE_MODE_LABELS[workspaceMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="worktree">New worktree</SelectItem>
                  <SelectItem value="current">Current checkout</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="New worktree starting point"
            description="Start new task worktrees from the repository default branch or your current branch."
            control={
              <Select
                value={worktreeBase}
                onValueChange={(value) => setWorktreeBase(value as typeof worktreeBase)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-48"
                  aria-label="New worktree starting point"
                >
                  <SelectValue>{WORKTREE_BASE_LABELS[worktreeBase]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="repository-default">Repository default</SelectItem>
                  <SelectItem value="current">Current branch</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Messages while running"
            description="Steer updates the active turn. Queue waits and starts after the current turn finishes."
            control={
              <Select
                value={delivery}
                onValueChange={(value) => setDelivery(value as typeof delivery)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-44"
                  aria-label="Messages while running"
                >
                  <SelectValue>{DELIVERY_LABELS[delivery]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="steer">Steer current turn</SelectItem>
                  <SelectItem value="queue">Queue next turn</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Automatically send blocking work to background"
            description="If a steer stays blocked for five seconds, let supported foreground work continue in the background."
            control={
              <Switch
                checked={autoBackgroundOnSteer}
                aria-label="Automatically send blocking work to background when steering"
                onCheckedChange={(checked) => setAutoBackgroundOnSteer(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Desktop behavior"
        description="Startup, local schedules, and website icons."
      >
        <SettingsGroup>
          <SettingsRow
            title="Default sidebar"
            description="Choose which sidebar opens when Palot starts, or return to the last one you used."
            control={
              <Select
                value={defaultSidebarMode}
                onValueChange={(value) => setDefaultSidebarMode(value as typeof defaultSidebarMode)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="Default sidebar">
                  <SelectValue>{SIDEBAR_MODE_LABELS[defaultSidebarMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="remember">Remember last used</SelectItem>
                  <SelectItem value="project">Projects</SelectItem>
                  <SelectItem value="inbox">Inbox</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Launch at login"
            description="Start Palot when you sign in so local schedules can run."
            control={
              <Switch
                aria-label="Launch at login"
                checked={automationHostSettings?.launchAtLogin ?? false}
                disabled={!automationHostSettings}
                onCheckedChange={(checked) =>
                  void updateAutomationHostSettings({ launchAtLogin: Boolean(checked) })
                }
              />
            }
          />
          <SettingsRow
            title="Prevent sleep during runs"
            description="Keep this computer awake only while a scheduled run is preparing, queued, running, or finishing."
            control={
              <Switch
                aria-label="Prevent sleep during scheduled runs"
                checked={automationHostSettings?.preventSleepWhileRunning ?? false}
                disabled={!automationHostSettings}
                onCheckedChange={(checked) =>
                  void updateAutomationHostSettings({
                    preventSleepWhileRunning: Boolean(checked),
                  })
                }
              />
            }
          />
          <SettingsRow
            title="Website icons in links"
            description="Load icons from DuckDuckGo for public websites linked in messages. This shares each exact hostname, including subdomains, but not its page path."
            control={
              <Switch
                checked={remoteMarkdownFavicons}
                aria-label="Load website icons from DuckDuckGo"
                onCheckedChange={(checked) => setRemoteMarkdownFavicons(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Timeline"
        description="Choose how reasoning and tool activity appear in your tasks."
      >
        <SettingsGroup>
          <SettingsRow
            title="Likely cache busts"
            description="Show a warning in the timeline when cache reuse drops unexpectedly between matching model steps. Context always includes these diagnostics."
            control={
              <Switch
                checked={showTimelineCacheBusts}
                aria-label="Show likely cache busts in timeline"
                onCheckedChange={(checked) => setShowTimelineCacheBusts(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="Timeline activity"
            description={PROJECTION_PRESET_DESCRIPTIONS[projection.preset]}
            control={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Customize timeline activity"
                  aria-expanded={customizeProjection}
                  title="Customize timeline activity"
                  onClick={() => setCustomizeProjection((open) => !open)}
                >
                  <SlidersHorizontal aria-hidden="true" />
                </Button>
                <Select
                  value={projection.preset}
                  onValueChange={(value) =>
                    setProjection({ version: 2, preset: value as SessionProjectionPreset })
                  }
                >
                  <SelectTrigger className="w-full @lg/settings:w-44" aria-label="Timeline style">
                    <SelectValue>
                      {PROJECTION_PRESET_LABELS[projection.preset]}
                      {customized ? ", customized" : ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="code-focus">Focused</SelectItem>
                    <SelectItem value="compact">Balanced</SelectItem>
                    <SelectItem value="expanded">Detailed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />
          <SettingsRow
            title="Reasoning summaries"
            description="Show the agent's reasoning summaries inside activity groups."
            control={
              <Switch
                checked={resolvedProjection.showReasoningSummaries}
                aria-label="Show reasoning summaries in the timeline"
                onCheckedChange={(checked) =>
                  setProjection((current) => ({
                    ...current,
                    showReasoningSummaries: Boolean(checked),
                  }))
                }
              />
            }
          />
          <SettingsRow
            title="Current activity"
            description="Keep the current activity group open while the agent works."
            control={
              <Switch
                checked={resolvedProjection.keepCurrentActivityExpanded}
                aria-label="Keep current activity expanded"
                onCheckedChange={(checked) =>
                  setProjection((current) => ({
                    ...current,
                    keepCurrentActivityExpanded: Boolean(checked),
                  }))
                }
              />
            }
          />
        </SettingsGroup>
        {customizeProjection ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2.5">
              <div className="text-xs font-medium">
                {projection.preset === "code-focus"
                  ? "Focused"
                  : projection.preset === "compact"
                    ? "Balanced"
                    : "Detailed"}
                {customized ? ", customized" : ""}
              </div>
              {customized ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setProjection({ version: 2, preset: projection.preset })}
                >
                  Reset
                </Button>
              ) : null}
            </div>
            <div className="hidden grid-cols-[minmax(7rem,1fr)_repeat(3,minmax(7rem,auto))] gap-x-2 border-b px-4 py-2 text-meta font-medium text-muted-foreground @3xl/settings:grid">
              <span>Activity</span>
              <span>Display</span>
              <span>Details</span>
              <span>Folded turns</span>
            </div>
            {ACTIVITY_CATEGORIES.map((category) => {
              const preference = resolvedProjection.categories[category];
              return (
                <div
                  key={category}
                  className="grid gap-2 border-b px-4 py-3 last:border-b-0 @3xl/settings:grid-cols-[minmax(7rem,1fr)_repeat(3,minmax(7rem,auto))] @3xl/settings:items-center"
                >
                  <span className="text-xs font-medium">{ACTIVITY_CATEGORY_LABELS[category]}</span>
                  <Select
                    value={preference.presentation}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        presentation: value as ActivityProjectionPreference["presentation"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-36"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} display`}
                    >
                      <SelectValue>
                        {ACTIVITY_PRESENTATION_LABELS[preference.presentation]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="individual">Individual</SelectItem>
                      <SelectItem value="grouped">Grouped</SelectItem>
                      <SelectItem value="hidden">Hidden when completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={preference.details}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        details: value as ActivityProjectionPreference["details"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-32"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} details`}
                    >
                      <SelectValue>{DETAIL_DEFAULT_LABELS[preference.details]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="collapsed">Collapsed</SelectItem>
                      <SelectItem value="expanded">Expanded</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={preference.foldedTurn}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        foldedTurn: value as ActivityProjectionPreference["foldedTurn"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-32"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} folded turns`}
                    >
                      <SelectValue>{FOLDED_TURN_LABELS[preference.foldedTurn]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="inside">Inside</SelectItem>
                      <SelectItem value="pinned">Keep visible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">Group titles</span>
              <Select
                value={resolvedProjection.groupTitle}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    groupTitle: value as GroupTitleMode,
                  }))
                }
              >
                <SelectTrigger className="w-44" aria-label="Group titles">
                  <SelectValue>{GROUP_TITLE_LABELS[resolvedProjection.groupTitle]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="summary">Activity summary</SelectItem>
                  <SelectItem value="latest-reasoning">Reasoning intent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">Repeated file reads</span>
              <Select
                value={resolvedProjection.groupSameFileReads ? "grouped" : "separate"}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    groupSameFileReads: value === "grouped",
                  }))
                }
              >
                <SelectTrigger className="w-44" aria-label="Repeated file reads">
                  <SelectValue>
                    {resolvedProjection.groupSameFileReads ? "One card per file" : "Separate cards"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="separate">Separate cards</SelectItem>
                  <SelectItem value="grouped">One card per file</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">Completed turns</span>
              <Select
                value={resolvedProjection.foldCompletedTurns ? "folded" : "expanded"}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    foldCompletedTurns: value === "folded",
                  }))
                }
              >
                <SelectTrigger className="w-36" aria-label="Completed turns">
                  <SelectValue>
                    {resolvedProjection.foldCompletedTurns ? "Folded" : "Expanded"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="folded">Folded</SelectItem>
                  <SelectItem value="expanded">Expanded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );
}

const TURN_NOTIFICATION_LABELS: Record<DesktopNotificationSettings["turnCompletion"], string> = {
  never: "Never",
  unfocused: "Only when unfocused",
  always: "Always",
};

function NotificationSettings() {
  const [settings, setSettings] = useState<DesktopNotificationSettings | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<DesktopNotificationDeliveryStatus | null>(
    null,
  );
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const isMac = document.documentElement.dataset.platform === "darwin";

  useEffect(() => {
    let active = true;
    void palot
      .loadDesktopNotificationSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((error) => showError("Could not load notification settings", error));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isMac) return;
    let active = true;
    const refresh = () => {
      void palot
        .desktopNotificationDeliveryStatus()
        .then((value) => {
          if (active) setDeliveryStatus(value);
        })
        .catch((error) => showError("Could not check notification delivery", error));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [isMac]);

  const updateSettings = async (patch: Partial<DesktopNotificationSettings>) => {
    if (!settings) return;
    const previous = settings;
    const next = { ...previous, ...patch };
    setSettings(next);
    try {
      setSettings(await palot.updateDesktopNotificationSettings(next));
    } catch (error) {
      setSettings(previous);
      showError("Could not update notification settings", error);
    }
  };

  const refreshDeliveryStatus = async () => {
    setDeliveryBusy(true);
    try {
      setDeliveryStatus(await palot.desktopNotificationDeliveryStatus());
    } catch (error) {
      showError("Could not check notification delivery", error);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const runDeliveryAction = async () => {
    if (!deliveryStatus) return;
    setDeliveryBusy(true);
    try {
      if (deliveryStatus.authorization === "not-determined") {
        setDeliveryStatus(await palot.requestDesktopNotificationPermission());
      } else if (deliveryStatus.authorization === "denied" || deliveryStatus.delivery === "off") {
        await palot.openDesktopNotificationSystemSettings();
      } else {
        await palot.sendDesktopTestNotification();
      }
    } catch (error) {
      showError("Could not update notification delivery", error);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const delivery = notificationDeliveryPresentation(deliveryStatus);

  return (
    <SettingsSection
      title="Native alerts"
      description="Palot uses the macOS notification center and opens the relevant task when you click an alert."
      icon={Bell}
    >
      <SettingsGroup>
        {isMac ? (
          <SettingsRow
            title="Delivery check"
            description={delivery.description}
            control={
              <>
                <Badge variant={delivery.badgeVariant}>{delivery.label}</Badge>
                {delivery.action ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={deliveryBusy || !deliveryStatus}
                    onClick={() => void runDeliveryAction()}
                  >
                    {deliveryBusy ? <LoaderCircle className="animate-spin" /> : delivery.icon}
                    {delivery.action}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Check notification delivery again"
                  disabled={deliveryBusy}
                  onClick={() => void refreshDeliveryStatus()}
                >
                  <RefreshCw className={deliveryBusy ? "animate-spin" : undefined} />
                </Button>
              </>
            }
          />
        ) : null}
        <SettingsRow
          title="Turn completion notifications"
          description="Set when Palot alerts you that a task has finished."
          control={
            <Select
              value={settings?.turnCompletion ?? "always"}
              disabled={!settings}
              onValueChange={(value) =>
                void updateSettings({
                  turnCompletion: value as DesktopNotificationSettings["turnCompletion"],
                })
              }
            >
              <SelectTrigger
                className="w-full @lg/settings:w-48"
                aria-label="Turn completion notifications"
              >
                <SelectValue>
                  {TURN_NOTIFICATION_LABELS[settings?.turnCompletion ?? "always"]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="unfocused">Only when unfocused</SelectItem>
                <SelectItem value="always">Always</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title="Permission notifications"
          description="Show alerts when a task needs permission to continue."
          control={
            <Switch
              aria-label="Permission notifications"
              checked={settings?.permissionRequests ?? false}
              disabled={!settings}
              onCheckedChange={(checked) =>
                void updateSettings({ permissionRequests: Boolean(checked) })
              }
            />
          }
        />
        <SettingsRow
          title="Question notifications"
          description="Show alerts when your input is needed to continue."
          control={
            <Switch
              aria-label="Question notifications"
              checked={settings?.questionRequests ?? false}
              disabled={!settings}
              onCheckedChange={(checked) =>
                void updateSettings({ questionRequests: Boolean(checked) })
              }
            />
          }
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

function notificationDeliveryPresentation(status: DesktopNotificationDeliveryStatus | null): {
  label: string;
  description: string;
  action: string | null;
  icon: ReactNode;
  badgeVariant: "secondary" | "outline" | "destructive";
} {
  if (!status) {
    return {
      label: "Checking",
      description: "Reading Palot's current delivery path from macOS.",
      action: null,
      icon: null,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "not-determined") {
    return {
      label: "Not set up",
      description: "Choose whether Palot may alert you when work needs attention.",
      action: "Allow alerts",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "denied") {
    return {
      label: "Blocked",
      description: "macOS is blocking Palot alerts. Your in-app choices are still saved.",
      action: "Open macOS Settings",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "off") {
    return {
      label: "Paused",
      description: "Palot is allowed, but banners and Notification Center delivery are both off.",
      action: "Open macOS Settings",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "notification-center" || status.authorization === "provisional") {
    return {
      label: "Quiet",
      description: "Updates land in Notification Center without interrupting your current task.",
      action: "Send test",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "authorized" || status.authorization === "ephemeral") {
    return {
      label: "Ready",
      description:
        "Banners and Notification Center are available. Verify the route whenever you like.",
      action: "Send test",
      icon: <Check />,
      badgeVariant: "secondary",
    };
  }
  return {
    label: "Unavailable",
    description: "Palot could not read notification delivery from macOS.",
    action: null,
    icon: null,
    badgeVariant: "outline",
  };
}

function AppearanceSettings() {
  const [preferences, setPreferences] = useAtom(appearancePreferencesAtom);
  const resolved = useAtomValue(resolvedAppearanceAtom);
  const restartRequired = useAtomValue(appearanceRestartRequiredAtom);
  const [nativeMaterial, setNativeMaterial] = useState(() => ({
    tier: document.documentElement.dataset.chromeTier ?? "opaque",
    reducedTransparency: document.documentElement.dataset.reducedTransparency === "true",
  }));
  const [fontAvailability] = useState<Record<string, boolean>>(() => {
    const platform = document.documentElement.dataset.platform ?? "browser";
    return Object.fromEntries(
      [...Object.entries(UI_FONT_OPTIONS), ...Object.entries(CODE_FONT_OPTIONS)].map(
        ([id, option]) => [id, isAppearanceFontAvailable(option, platform)],
      ),
    );
  });
  const update = (patch: Partial<AppearancePreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const api = window.palot;
    if (!api) return;
    const unsubscribeTier = api.onChromeTierChanged((tier) =>
      setNativeMaterial((current) => ({ ...current, tier })),
    );
    const unsubscribeReduced = api.onReducedTransparencyChanged((reducedTransparency) =>
      setNativeMaterial((current) => ({ ...current, reducedTransparency })),
    );
    return () => {
      unsubscribeTier();
      unsubscribeReduced();
    };
  }, []);

  const effectiveMaterial = nativeMaterial.reducedTransparency
    ? "Opaque because Reduce Transparency is enabled"
    : nativeMaterial.tier === "liquid-glass"
      ? "Liquid Glass"
      : nativeMaterial.tier === "vibrancy"
        ? "Vibrancy"
        : "Opaque";
  const themeNativeGlass = effectiveNativeGlass(
    {
      ...preferences,
      nativeGlassVariant: "theme",
    },
    resolved.scheme,
  );
  const themeTreatment = effectiveAppearanceTreatment(
    {
      ...preferences,
      glassOpacity: DEFAULT_APPEARANCE_PREFERENCES.glassOpacity,
      nativeGlassTint: DEFAULT_APPEARANCE_PREFERENCES.nativeGlassTint,
      windowMaterial: "automatic",
      sidebarMaterial: "automatic",
    },
    resolved.scheme,
  );

  return (
    <>
      <SettingsSection
        title="Theme"
        description="Follow your desktop or choose a palette. Changes apply immediately."
        icon={Palette}
      >
        <SettingsGroup>
          <AppearanceSelectRow
            title="Theme"
            description={
              preferences.source === "system"
                ? preferences.systemPalette === "macos"
                  ? "Following macOS appearance."
                  : preferences.omarchyTheme
                    ? `Following Omarchy · ${preferences.omarchyTheme.name}`
                    : "Following desktop light/dark mode with your saved palettes."
                : `Palette for ${resolved.scheme} mode. Light and dark palettes are saved independently.`
            }
            value={
              preferences.source === "system"
                ? "system"
                : resolved.scheme === "light"
                  ? preferences.lightTheme
                  : preferences.darkTheme
            }
            options={[
              { value: "system", label: "System" },
              ...Object.values(APPEARANCE_THEMES).flatMap((theme) => {
                const variant = theme[resolved.scheme];
                return variant
                  ? [
                      {
                        value: theme.id,
                        label: theme.name,
                        preview: <ThemeSwatch variant={variant} />,
                      },
                    ]
                  : [];
              }),
            ]}
            onChange={(theme) =>
              update(
                theme === "system"
                  ? { source: "system" }
                  : resolved.scheme === "light"
                    ? { lightTheme: theme as AppearanceThemeID, source: "palot" }
                    : { darkTheme: theme as AppearanceThemeID, source: "palot" },
              )
            }
          />
          <SettingsRow
            title="Contrast"
            description={`Adjust separation between surfaces, controls, borders, and secondary text in the current ${resolved.scheme} theme.`}
            control={
              <AppearanceSlider
                label={`${titleCase(resolved.scheme)} theme contrast`}
                value={
                  resolved.scheme === "light" ? preferences.lightContrast : preferences.darkContrast
                }
                min={0}
                max={100}
                defaultValue={50}
                onChange={(value) =>
                  update(
                    resolved.scheme === "light"
                      ? { lightContrast: value }
                      : { darkContrast: value },
                  )
                }
              />
            }
          />
          <AppearanceSelectRow
            title="Code theme"
            description="File previews, diffs, Markdown code, and terminal ANSI colors."
            value={
              resolved.scheme === "light" ? preferences.lightCodeTheme : preferences.darkCodeTheme
            }
            options={codeThemeOptions(preferences, resolved.scheme)}
            onChange={(theme) =>
              update(
                resolved.scheme === "light"
                  ? { lightCodeTheme: theme as CodeThemeID }
                  : { darkCodeTheme: theme as CodeThemeID },
              )
            }
          />
          <CodeThemePreview theme={resolved.codeThemeName} terminal={resolved.terminal} />
        </SettingsGroup>
      </SettingsSection>

      {preferences.source === "palot" ? (
        <SettingsSection
          title="Color mode"
          description="Choose when Palot uses your light and dark palettes."
          icon={Palette}
        >
          <div className="grid gap-3 @lg/settings:grid-cols-3">
            {APPEARANCE_MODES.map((mode) => (
              <AppearanceModeCard
                key={mode}
                mode={mode}
                selected={preferences.mode === mode}
                onSelect={() => update({ mode })}
              />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Scrolling"
        description="Scrollbars appear while scrolling or interacting with a pane."
        icon={Palette}
      >
        <SettingsGroup>
          <SettingsRow
            title="Always show scrollbars"
            description="Keep scroll handles visible instead of hiding them when idle."
            control={
              <Switch
                checked={preferences.alwaysShowScrollbars}
                onCheckedChange={(alwaysShowScrollbars) => update({ alwaysShowScrollbars })}
                aria-label="Always show scrollbars"
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Glass and materials"
        description="Control renderer translucency separately from the native material behind the window."
        icon={Sparkles}
      >
        <SettingsGroup>
          {window.palot?.platform === "linux" ? (
            <SettingsRow
              title="Window background opacity"
              description="Make window backgrounds translucent while keeping text crisp. Enabling or disabling transparency requires restarting Palot. Your compositor controls desktop blur and can additionally fade the whole window."
              control={
                <AppearanceSlider
                  label="Window background opacity"
                  value={preferences.linuxBackgroundOpacity}
                  min={60}
                  max={100}
                  defaultValue={100}
                  onChange={(linuxBackgroundOpacity) => update({ linuxBackgroundOpacity })}
                />
              }
            />
          ) : null}
          <SettingsRow
            title="Surface tint"
            description="Higher values make the composer, inspector, menus, and dialogs more solid. Native Liquid Glass sidebars remain transparent."
            control={
              <AppearanceSlider
                label="Surface tint"
                value={
                  preferences.glassOpacity === "theme"
                    ? themeTreatment.sidebar.opacity
                    : preferences.glassOpacity
                }
                min={30}
                max={100}
                defaultValue={themeTreatment.sidebar.opacity}
                isDefault={preferences.glassOpacity === "theme"}
                onChange={(glassOpacity) => update({ glassOpacity })}
                onReset={() => update({ glassOpacity: "theme" })}
              />
            }
          />
          <SettingsRow
            title="Main content opacity"
            description="Let the native material show through the chat surface and right or bottom workbench panes."
            control={
              <AppearanceSlider
                label="Main content opacity"
                value={preferences.contentOpacity}
                min={55}
                max={100}
                defaultValue={DEFAULT_APPEARANCE_PREFERENCES.contentOpacity}
                onChange={(contentOpacity) => update({ contentOpacity })}
              />
            }
          />
          <SettingsRow
            title="Native glass tint"
            description="Tint macOS Liquid Glass toward the current theme background."
            control={
              <AppearanceSlider
                label="Native glass tint"
                value={resolved.treatment.native.tint}
                min={0}
                max={30}
                defaultValue={themeTreatment.native.tint}
                isDefault={preferences.nativeGlassTint === "theme"}
                onChange={(nativeGlassTint) => update({ nativeGlassTint })}
                onReset={() => update({ nativeGlassTint: "theme" })}
              />
            }
          />
          <AppearanceSelectRow
            title="Native glass variant"
            description="Choose between Apple's regular and clear Liquid Glass treatments. Theme follows the active palette's recommendation."
            value={preferences.nativeGlassVariant}
            options={[
              {
                value: "theme",
                label: `Theme (${titleCase(themeNativeGlass.variant)})`,
              },
              ...NATIVE_GLASS_VARIANTS.map((value) => ({ value, label: titleCase(value) })),
            ]}
            onChange={(nativeGlassVariant) =>
              update({
                nativeGlassVariant:
                  nativeGlassVariant as AppearancePreferences["nativeGlassVariant"],
              })
            }
          />
          <AppearanceSelectRow
            title="Window material"
            description="Automatic follows the active theme's native backdrop. Changing this may require a restart."
            value={preferences.windowMaterial}
            options={WINDOW_MATERIALS.map((value) => ({
              value,
              label:
                value === "automatic"
                  ? `Theme (${titleCase(themeTreatment.native.backdrop.replaceAll("-", " "))})`
                  : value === "native"
                    ? "Native translucency"
                    : titleCase(value),
            }))}
            onChange={(windowMaterial) => {
              update({ windowMaterial: windowMaterial as AppearancePreferences["windowMaterial"] });
            }}
          />
          <AppearanceSelectRow
            title="Sidebar material"
            description="Choose whether the navigation and settings sidebar stay solid or reveal the window material."
            value={preferences.sidebarMaterial}
            options={SIDEBAR_MATERIALS.map((value) => ({
              value,
              label:
                value === "automatic"
                  ? `Theme (${titleCase(themeTreatment.sidebar.material)})`
                  : titleCase(value),
            }))}
            onChange={(sidebarMaterial) =>
              update({
                sidebarMaterial: sidebarMaterial as AppearancePreferences["sidebarMaterial"],
              })
            }
          />
          <SettingsRow
            title="Effective material"
            description="The material Palot is using after platform capability and accessibility fallbacks."
            control={<Badge variant="outline">{effectiveMaterial}</Badge>}
          />
          {restartRequired ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <p className="text-compact text-muted-foreground">
                Restart Palot to apply native window material changes.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void palot.restartApp("Apply appearance material")}
              >
                Restart
              </Button>
            </div>
          ) : null}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Typography"
        description="Fonts and sizes apply across the interface, Markdown, file previews, diffs, and terminals. Included fonts work offline; unavailable system fonts remain disabled."
        icon={Braces}
      >
        <SettingsGroup>
          <AppearanceSelectRow
            title="Interface font"
            description="Everything outside code blocks, file previews, and terminals."
            value={preferences.uiFont}
            options={Object.entries(UI_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name} (Unavailable)` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "Included" : undefined,
            }))}
            onChange={(uiFont) => update({ uiFont: uiFont as AppearancePreferences["uiFont"] })}
            trailing={
              <SizeSelect
                label="Interface font size"
                value={preferences.uiFontSize}
                values={[13, 14, 15, 16, 17, 18, 19]}
                onChange={(uiFontSize) => update({ uiFontSize })}
              />
            }
          />
          <TypographyPreview />
          {window.palot?.platform === "linux" ? (
            <SettingsRow
              title="Follow desktop monospace font"
              description="Use Omarchy’s monospace font with the System theme. Interface typography stays independent."
              control={
                <Switch
                  checked={preferences.followOmarchyFont}
                  onCheckedChange={(followOmarchyFont) => update({ followOmarchyFont })}
                  aria-label="Follow desktop monospace font"
                />
              }
            />
          ) : null}
          <AppearanceSelectRow
            title="Monospace font"
            description="Code blocks, diffs, file previews, and terminal output."
            value={preferences.codeFont}
            options={Object.entries(CODE_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name} (Unavailable)` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "Included" : undefined,
            }))}
            onChange={(codeFont) =>
              update({ codeFont: codeFont as AppearancePreferences["codeFont"] })
            }
            trailing={
              <SizeSelect
                label="Code font size"
                value={preferences.codeFontSize}
                values={[10, 11, 12, 13, 14, 15, 16, 17, 18]}
                onChange={(codeFontSize) => update({ codeFontSize })}
              />
            }
          />
          <SettingsRow
            title="Terminal font size"
            description="Terminal size stays independent so shell output can remain compact or roomy."
            control={
              <SizeSelect
                label="Terminal font size"
                value={preferences.terminalFontSize}
                values={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22]}
                onChange={(terminalFontSize) => update({ terminalFontSize })}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function AppearanceModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: AppearanceMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "group rounded-2xl border bg-card/60 p-2.5 text-left transition-colors hover:border-foreground/20",
        selected && "border-info/55 ring-2 ring-info/15",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "relative mb-2.5 h-24 overflow-hidden rounded-xl border",
          mode === "light" && "bg-[#f6f7f9]",
          mode === "dark" && "bg-[#151619]",
          mode === "system" && "bg-[linear-gradient(110deg,#f6f7f9_0_50%,#151619_50%)]",
        )}
      >
        <div className="absolute inset-2 grid grid-cols-[28%_1fr] overflow-hidden rounded-lg border border-black/10 bg-white/75 shadow-sm dark:border-white/10 dark:bg-black/15">
          <div className="border-r border-black/10 bg-black/6 dark:border-white/10 dark:bg-white/6" />
          <div className="space-y-2 p-2">
            <div className="h-2 w-2/3 rounded-full bg-black/15 dark:bg-white/18" />
            <div className="h-2 w-full rounded-full bg-black/8 dark:bg-white/10" />
            <div className="mt-4 h-6 rounded-md border border-black/10 bg-white/70 dark:border-white/10 dark:bg-black/25" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium">{titleCase(mode)}</span>
        {selected ? <Check className="ml-auto size-3.5 text-info" aria-hidden="true" /> : null}
      </div>
    </button>
  );
}

function ThemeSwatch({ variant }: { variant: AppearanceThemeVariant }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-compact font-medium ring-1 ring-inset ring-white/10"
      style={{ background: variant.palette.codeBackground, color: variant.palette.ring }}
      aria-hidden="true"
    >
      Aa
    </span>
  );
}

function AppearanceSelectRow({
  title,
  description,
  value,
  options,
  onChange,
  trailing,
}: {
  title: string;
  description: string;
  value: string;
  options: Array<{
    value: string;
    label: string;
    preview?: ReactNode;
    disabled?: boolean;
    detail?: string;
  }>;
  onChange: (value: string) => void;
  trailing?: ReactNode;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <div className="flex w-full flex-wrap items-center gap-2 @lg/settings:w-auto">
          {selected?.preview}
          <Select value={value} onValueChange={(next) => onChange(String(next))}>
            <SelectTrigger className="w-full @lg/settings:w-52" aria-label={title}>
              <SelectValue>
                <span className="truncate">{selected?.label ?? titleCase(value)}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <span className="flex w-full items-center gap-2">
                    {option.preview}
                    <span>{option.label}</span>
                    {option.detail ? (
                      <span className="ml-auto text-xs text-muted-foreground">{option.detail}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {trailing}
        </div>
      }
    />
  );
}

function SizeSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: number;
  values: number[];
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="w-20" aria-label={label}>
        <SelectValue>{value}px</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {values.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {size}px
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AppearanceSlider({
  label,
  value,
  min,
  max,
  defaultValue,
  isDefault,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  isDefault?: boolean;
  onChange(value: number): void;
  onReset?(): void;
}) {
  const [interaction, setInteraction] = useState<{ source: number; value: number } | null>(null);
  const displayedValue = interaction?.source === value ? interaction.value : value;

  const numberValue = (next: number | readonly number[]) => (Array.isArray(next) ? next[0]! : next);

  return (
    <div className="flex min-w-56 items-center gap-3">
      <span className="w-10 text-right font-mono text-xs tabular-nums">{displayedValue}%</span>
      <Slider
        aria-label={label}
        value={displayedValue}
        min={min}
        max={max}
        step={1}
        className="min-w-32 flex-1"
        onValueChange={(next) =>
          setInteraction((current) => ({
            source: current?.source ?? value,
            value: numberValue(next),
          }))
        }
        onValueCommitted={(next) => {
          const committed = numberValue(next);
          onChange(committed);
          setInteraction(null);
        }}
      />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={isDefault ?? displayedValue === defaultValue}
        onClick={() => {
          setInteraction(null);
          if (onReset) onReset();
          else onChange(defaultValue);
        }}
      >
        Reset
      </Button>
    </div>
  );
}

function CodeThemePreview({
  theme,
  terminal,
}: {
  theme: string;
  terminal: AppearanceTerminalPalette;
}) {
  const ansi = [
    terminal.red,
    terminal.yellow,
    terminal.green,
    terminal.cyan,
    terminal.blue,
    terminal.magenta,
    terminal.foreground,
  ];
  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-xl border bg-[var(--code-background)] font-mono text-code text-[var(--code-foreground)]">
        <div className="flex h-8 items-center justify-between border-b border-border/60 px-3 text-micro text-muted-foreground">
          <span>appearance/theme.ts</span>
          <span>{theme}</span>
        </div>
        <div className="border-b border-border/60 p-3 [&_.markdown-highlight_pre]:mb-0 [&_.markdown-highlight_pre]:border-0 [&_.markdown-highlight_pre]:p-0">
          <MarkdownCodeBlock
            language="typescript"
            code={'const snapshot = compileTheme({ mode: "system" })\npublish(snapshot)'}
          />
        </div>
        <div className="grid grid-cols-1 @2xl/settings:grid-cols-2">
          <pre className="m-0 border-r border-border/60 bg-destructive/10 p-3 leading-relaxed">
            <span className="text-destructive">-</span> theme: fixedTheme
          </pre>
          <pre className="m-0 bg-success/10 p-3 leading-relaxed">
            <span className="text-success">+</span> theme: snapshot.syntax
          </pre>
        </div>
        <div
          className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5"
          style={{ background: terminal.background, color: terminal.foreground }}
        >
          <span className="mr-auto text-micro">ANSI palette</span>
          {ansi.map((color, index) => (
            <span
              key={`${color}:${index}`}
              className="size-3 rounded-sm border border-white/15"
              style={{ background: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TypographyPreview() {
  return (
    <div className="px-4 py-3">
      <p className="text-sm leading-relaxed">
        Palot keeps prose calm and readable while dense activity stays compact.
      </p>
      <code className="mt-2 block rounded-lg bg-muted/60 px-3 py-2 font-mono text-code">
        const appearance = compileTheme(preferences)
      </code>
    </div>
  );
}

function codeThemeOptions(preferences: AppearancePreferences, scheme: "light" | "dark") {
  return CODE_THEME_IDS.map((value) => ({
    value,
    label: value === "follow" ? "Follow app theme" : CODE_THEME_OPTIONS[value].name,
    preview: (
      <ThemeSwatch
        variant={
          value === "follow"
            ? appearanceTheme(preferences, scheme)
            : APPEARANCE_THEMES[CODE_THEME_OPTIONS[value].source][scheme]!
        }
      />
    ),
  }));
}

function titleCase(value: string): string {
  const words = value.replaceAll("-", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ModelSettings({
  project,
  snapshot,
}: {
  project: PalotProject;
  snapshot: PalotSettingsSnapshot | null;
}) {
  const [defaults, setDefaults] = useAtom(defaultModelsAtom);
  const [preferences, setPreferences] = useAtom(modelPickerPreferencesAtom);
  const [query, setQuery] = useState("");
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const selected = defaults[project.id] ?? null;
  const models = snapshot?.catalog.models ?? [];
  const preference = reconcileModelPreference(models, preferences[project.id]);
  const orderedModels = applyModelPreference(models, preference, true);
  const hidden = new Set(preference?.hidden ?? []);
  const visibleModels = orderedModels.filter((model) => !hidden.has(modelPreferenceKey(model)));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = normalizedQuery
    ? orderedModels.filter((model) =>
        `${model.name} ${model.id} ${model.providerID}`.toLowerCase().includes(normalizedQuery),
      )
    : orderedModels;
  const selectedModel = selected
    ? (models.find(
        (model) => model.id === selected.id && model.providerID === selected.providerID,
      ) ?? null)
    : null;
  const providers = new Map(
    snapshot?.catalog.providers.map((provider) => [provider.id, provider.name]) ?? [],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeModel = activeModelKey
    ? (orderedModels.find((model) => modelPreferenceKey(model) === activeModelKey) ?? null)
    : null;

  function updatePreference(next: ModelPickerPreference) {
    setPreferences((current) => ({ ...current, [project.id]: next }));
  }

  function setModelEnabled(model: PalotModel, enabled: boolean) {
    const key = modelPreferenceKey(model);
    const nextHidden = new Set(preference?.hidden ?? []);
    if (enabled) nextHidden.delete(key);
    else {
      nextHidden.add(key);
      const fallback = orderedModels.find(
        (candidate) => !nextHidden.has(modelPreferenceKey(candidate)),
      );
      const hidesSelected = selected?.id === model.id && selected.providerID === model.providerID;
      const hidesOpenCodeDefault =
        !selected &&
        snapshot?.catalog.defaultModel?.id === model.id &&
        snapshot.catalog.defaultModel.providerID === model.providerID;
      if (hidesSelected || hidesOpenCodeDefault) {
        setDefaults((current) => {
          if (fallback) return { ...current, [project.id]: modelRef(fallback) };
          const next = { ...current };
          delete next[project.id];
          return next;
        });
      }
    }
    updatePreference({
      hidden: [...nextHidden],
      order: reconcileModelOrder(models, preference),
    });
  }

  function setAllModelsEnabled(enabled: boolean) {
    if (!enabled && selected) {
      setDefaults((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
    }
    const nextHidden = new Set(preference.hidden);
    for (const model of models) {
      const key = modelPreferenceKey(model);
      if (enabled) nextHidden.delete(key);
      else nextHidden.add(key);
    }
    updatePreference({
      hidden: [...nextHidden],
      order: reconcileModelOrder(models, preference),
    });
  }

  function moveModelToTop(model: PalotModel) {
    const order = reconcileModelOrder(models, preference);
    const from = order.indexOf(modelPreferenceKey(model));
    if (from <= 0) return;
    updatePreference({ hidden: preference?.hidden ?? [], order: arrayMove(order, from, 0) });
  }

  function finishSorting(event: DragEndEvent) {
    setActiveModelKey(null);
    if (!event.over || event.active.id === event.over.id) return;
    const order = reconcileModelOrder(models, preference);
    const from = order.indexOf(String(event.active.id));
    const to = order.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    updatePreference({ hidden: preference?.hidden ?? [], order: arrayMove(order, from, to) });
  }

  return (
    <>
      <SettingsSection
        title="Task default"
        description="Palot applies this model and effort after creating a task. Clear it to use OpenCode's resolved location default."
        icon={Sparkles}
      >
        <SettingsGroup>
          <SettingsRow
            title="Default model"
            description={
              snapshot?.catalog.defaultModel
                ? `OpenCode currently resolves ${snapshot.catalog.defaultModel.name}.`
                : "OpenCode will resolve the model from the project and global configuration."
            }
            control={
              <Select
                value={selected ? `${selected.providerID}/${selected.id}` : "opencode-default"}
                onValueChange={(value) => {
                  const key = String(value);
                  if (key === "opencode-default") {
                    const next = { ...defaults };
                    delete next[project.id];
                    setDefaults(next);
                    return;
                  }
                  const model = models.find((item) => `${item.providerID}/${item.id}` === key);
                  if (model) setDefaults({ ...defaults, [project.id]: modelRef(model) });
                }}
              >
                <SelectTrigger className="w-full @lg/settings:w-64" aria-label="Default model">
                  <SelectValue>
                    {selected
                      ? `${providers.get(selected.providerID) ?? selected.providerID} · ${selectedModel?.name ?? selected.id}`
                      : "OpenCode default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" className="max-h-80">
                  <SelectItem value="opencode-default">OpenCode default</SelectItem>
                  {visibleModels.map((model) => (
                    <SelectItem
                      key={`${model.providerID}/${model.id}`}
                      value={`${model.providerID}/${model.id}`}
                    >
                      {providers.get(model.providerID) ?? model.providerID} · {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          {selectedModel && selectedModel.variants.length > 0 ? (
            <SettingsRow
              title="Default effort"
              description="Choose the reasoning effort Palot applies with this model when creating a task."
              control={
                <Select
                  value={selected?.variant ?? "model-default"}
                  onValueChange={(value) => {
                    const variant = String(value);
                    setDefaults({
                      ...defaults,
                      [project.id]: modelRef(
                        selectedModel,
                        variant === "model-default" ? undefined : variant,
                      ),
                    });
                  }}
                >
                  <SelectTrigger className="w-full @lg/settings:w-64" aria-label="Default effort">
                    <SelectValue>
                      {selected?.variant ? sentenceCase(selected.variant) : "Model default"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="model-default">Model default</SelectItem>
                    {selectedModel.variants.map((variant) => (
                      <SelectItem key={variant} value={variant}>
                        {sentenceCase(variant)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          ) : null}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Available models"
        description={`${visibleModels.length} of ${models.length} models shown in Palot pickers. Drag to set picker order.`}
        icon={Bot}
        action={<Badge variant="outline">{visibleModels.length} enabled</Badge>}
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-2 @lg/settings:flex-row @lg/settings:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                placeholder="Search models"
                aria-label="Search models"
                className="h-8 pl-8"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex shrink-0 items-center self-end rounded-lg border bg-card p-0.5 @lg/settings:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={models.length === 0 || visibleModels.length === models.length}
                onClick={() => setAllModelsEnabled(true)}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={models.length === 0 || visibleModels.length === 0}
                onClick={() => setAllModelsEnabled(false)}
              >
                Deselect all
              </Button>
            </div>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  "Press space to pick up a model. Use the arrow keys to move it, space to drop it, or escape to cancel.",
              },
              announcements: {
                onDragStart({ active }) {
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  return `Picked up ${model?.name ?? "model"}.`;
                },
                onDragOver({ active, over }) {
                  if (!over) return;
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  const position = filteredModels.findIndex(
                    (candidate) => modelPreferenceKey(candidate) === over.id,
                  );
                  return `${model?.name ?? "Model"} is over position ${position + 1} of ${filteredModels.length}.`;
                },
                onDragEnd({ active, over }) {
                  if (!over) return "Model was not moved.";
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  const position = filteredModels.findIndex(
                    (candidate) => modelPreferenceKey(candidate) === over.id,
                  );
                  return `${model?.name ?? "Model"} was dropped at position ${position + 1} of ${filteredModels.length}.`;
                },
                onDragCancel({ active }) {
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  return `Sorting cancelled. ${model?.name ?? "Model"} returned to its original position.`;
                },
              },
            }}
            onDragStart={(event: DragStartEvent) => setActiveModelKey(String(event.active.id))}
            onDragCancel={() => setActiveModelKey(null)}
            onDragEnd={finishSorting}
          >
            <SortableContext
              items={filteredModels.map(modelPreferenceKey)}
              strategy={verticalListSortingStrategy}
            >
              <SettingsGroup>
                {filteredModels.map((model) => (
                  <SortableModelRow
                    key={modelPreferenceKey(model)}
                    model={model}
                    providerName={providers.get(model.providerID) ?? model.providerID}
                    enabled={!hidden.has(modelPreferenceKey(model))}
                    sortingDisabled={Boolean(normalizedQuery)}
                    moveToTopDisabled={
                      !orderedModels[0] ||
                      modelPreferenceKey(model) === modelPreferenceKey(orderedModels[0])
                    }
                    onEnabledChange={(enabled) => setModelEnabled(model, enabled)}
                    onMoveToTop={() => moveModelToTop(model)}
                  />
                ))}
                <InventoryState
                  title="Models"
                  state={inventoryState(snapshot, "catalog")}
                  count={filteredModels.length}
                  total={models.length}
                  empty="OpenCode returned no models for this project."
                />
              </SettingsGroup>
            </SortableContext>
            <DragOverlay>
              {activeModel ? (
                <div className="rounded-xl border bg-card shadow-xl">
                  <ModelInventoryRow
                    model={activeModel}
                    providerName={providers.get(activeModel.providerID) ?? activeModel.providerID}
                    enabled={!hidden.has(modelPreferenceKey(activeModel))}
                    overlay
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          {normalizedQuery ? (
            <p className="text-meta text-muted-foreground">Clear search to reorder models.</p>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}

function SortableModelRow({
  model,
  providerName,
  enabled,
  sortingDisabled,
  moveToTopDisabled,
  onEnabledChange,
  onMoveToTop,
}: {
  model: PalotModel;
  providerName: string;
  enabled: boolean;
  sortingDisabled: boolean;
  moveToTopDisabled: boolean;
  onEnabledChange(enabled: boolean): void;
  onMoveToTop(): void;
}) {
  const id = modelPreferenceKey(model);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: sortingDisabled });
  return (
    <div
      ref={setNodeRef}
      className="border-b border-border/70 last:border-b-0"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
    >
      <ModelInventoryRow
        model={model}
        providerName={providerName}
        enabled={enabled}
        moveToTopDisabled={moveToTopDisabled}
        handle={
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            aria-label={`Reorder ${model.name}`}
            disabled={sortingDisabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        }
        onEnabledChange={onEnabledChange}
        onMoveToTop={onMoveToTop}
      />
    </div>
  );
}

function ModelInventoryRow({
  model,
  providerName,
  enabled,
  overlay = false,
  handle,
  moveToTopDisabled = false,
  onEnabledChange,
  onMoveToTop,
}: {
  model: PalotModel;
  providerName: string;
  enabled: boolean;
  overlay?: boolean;
  handle?: ReactNode;
  moveToTopDisabled?: boolean;
  onEnabledChange?(enabled: boolean): void;
  onMoveToTop?(): void;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 px-3 py-3", !enabled && "opacity-60")}>
      {handle ?? (
        <span className="flex size-6 items-center justify-center text-muted-foreground">
          <GripVertical aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium wrap-anywhere">{model.name}</span>
          {model.status !== "active" ? <Badge variant="outline">{model.status}</Badge> : null}
        </div>
        <div className="mt-1 text-compact wrap-anywhere text-muted-foreground">
          {providerName} · <span className="font-mono">{model.id}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span>{formatTokens(model.contextLimit)} context</span>
          {model.inputLimit ? <span>{formatTokens(model.inputLimit)} input limit</span> : null}
          <span>{formatTokens(model.outputLimit)} output</span>
          {model.variants.length ? <span>{model.variants.length} reasoning levels</span> : null}
          {model.capabilities.tools ? <span>tools</span> : null}
          {model.capabilities.input.map((capability) => (
            <span key={`input:${capability}`}>{capability} input</span>
          ))}
          {model.capabilities.output.map((capability) => (
            <span key={`output:${capability}`}>{capability} output</span>
          ))}
        </div>
      </div>
      {overlay ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Move ${model.name} to top`}
            title="Move to top"
            disabled={moveToTopDisabled}
            onClick={onMoveToTop}
          >
            <ArrowUpToLine aria-hidden="true" />
          </Button>
          <Switch
            checked={enabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${model.name}`}
            onCheckedChange={(checked) => onEnabledChange?.(Boolean(checked))}
          />
        </div>
      )}
    </div>
  );
}

const COLLAPSED_PROVIDER_COUNT = 8;

type CredentialActionTarget = {
  integration: PalotIntegration;
  connection: PalotIntegrationConnection;
};

function ProviderSettings({
  project,
  location,
  snapshot,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  refresh(): Promise<void>;
}) {
  const [dialog, setDialog] = useState<PalotIntegration | null>(null);
  const [wellknownOpen, setWellknownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [activatingCredentialID, setActivatingCredentialID] = useState<string | null>(null);
  const [removingCredentialID, setRemovingCredentialID] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CredentialActionTarget | null>(null);
  const [rename, setRename] = useState<{
    integrationName: string;
    credentialID: string;
    label: string;
  } | null>(null);
  const integrations = snapshot?.integrations ?? [];
  const orderedIntegrations = orderProviderIntegrations(integrations);
  const normalizedQuery = providerQuery.trim().toLowerCase();
  const filteredIntegrations = normalizedQuery
    ? orderedIntegrations.filter((integration) =>
        `${integration.name} ${integration.id}`.toLowerCase().includes(normalizedQuery),
      )
    : orderedIntegrations;
  const connectedIntegrations = filteredIntegrations.filter(
    (integration) => integration.connections.length > 0,
  );
  const availableIntegrations = filteredIntegrations.filter(
    (integration) =>
      integration.connections.length === 0 &&
      integration.methods.some((method) => method.type !== "env"),
  );
  const visibleAvailableIntegrations =
    expanded || normalizedQuery
      ? availableIntegrations
      : availableIntegrations
          .filter((integration) => isPopularProvider(integration.id))
          .slice(0, COLLAPSED_PROVIDER_COUNT);
  const connectedCount = integrations.filter(
    (integration) => integration.connections.length,
  ).length;
  const storedCredentialCount = integrations.reduce(
    (count, integration) =>
      count +
      integration.connections.filter((connection) => connection.type === "credential").length,
    0,
  );

  async function activate(connection: PalotIntegrationConnection) {
    if (!connection.id || connection.active) return;
    setActivatingCredentialID(connection.id);
    try {
      await palot.activateCredential({
        credentialID: connection.id,
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await refresh();
      toast.add({ type: "success", title: `${connection.label} is now in use` });
    } catch (cause) {
      showError("Could not switch credential", cause);
    } finally {
      setActivatingCredentialID(null);
    }
  }

  async function removeCredential(target: CredentialActionTarget) {
    if (!target.connection.id) return;
    const credentialID = target.connection.id;
    setRemoving(null);
    setRemovingCredentialID(credentialID);
    try {
      await palot.removeCredential({
        credentialID,
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await refresh();
      toast.add({ type: "success", title: `${target.connection.label} removed` });
    } catch (cause) {
      showError("Could not remove credential", cause);
    } finally {
      setRemovingCredentialID(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Provider connections"
        description="Credentials belong to this OpenCode service and are shared by every project connected to it."
        icon={Cable}
        action={
          <Badge variant="outline">
            {connectedCount} connected · {storedCredentialCount} stored
          </Badge>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={providerQuery}
                placeholder="Search providers"
                aria-label="Search providers"
                className="h-8 pl-8"
                onChange={(event) => setProviderQuery(event.target.value)}
              />
            </div>
            {integrations.length > COLLAPSED_PROVIDER_COUNT ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                aria-pressed={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "Popular only" : "Browse all"}
              </Button>
            ) : null}
          </div>

          {connectedIntegrations.length > 0 ? (
            <ProviderGroupLabel
              label="Connected"
              detail={`${connectedIntegrations.length} provider${connectedIntegrations.length === 1 ? "" : "s"}`}
            />
          ) : null}
          {connectedIntegrations.length > 0 ? (
            <div className="space-y-3">
              {connectedIntegrations.map((integration) => (
                <ConnectedProviderCard
                  key={integration.id}
                  integration={integration}
                  activatingCredentialID={activatingCredentialID}
                  removingCredentialID={removingCredentialID}
                  onActivate={(connection) => void activate(connection)}
                  onConnect={() => setDialog(integration)}
                  onRename={(connection) =>
                    setRename({
                      integrationName: integration.name,
                      credentialID: connection.id!,
                      label: connection.label,
                    })
                  }
                  onRemove={(connection) => setRemoving({ integration, connection })}
                />
              ))}
            </div>
          ) : null}

          {visibleAvailableIntegrations.length > 0 ? (
            <ProviderGroupLabel
              label={expanded || normalizedQuery ? "Available providers" : "Popular providers"}
              detail={`${visibleAvailableIntegrations.length} shown`}
            />
          ) : null}
          {visibleAvailableIntegrations.length > 0 ? (
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border @3xl/settings:grid-cols-2">
              {visibleAvailableIntegrations.map((integration, index) => (
                <AvailableProviderRow
                  key={integration.id}
                  integration={integration}
                  className={cn(
                    visibleAvailableIntegrations.length % 2 === 1 &&
                      index === visibleAvailableIntegrations.length - 1 &&
                      "@3xl/settings:col-span-2",
                  )}
                  onConnect={() => setDialog(integration)}
                />
              ))}
            </div>
          ) : null}

          <InventoryState
            title="Providers"
            state={inventoryState(snapshot, "integrations")}
            count={connectedIntegrations.length + visibleAvailableIntegrations.length}
            total={integrations.length}
            empty="OpenCode returned no available provider integrations."
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Advanced provider sources"
        description="Add a custom integration catalog from a trusted well-known URL. Most providers do not need this."
        icon={Braces}
      >
        <SettingsGroup>
          <SettingsRow
            title="Custom integration catalog"
            description="OpenCode fetches and persists the integrations published by this source."
            control={
              <Button type="button" variant="outline" onClick={() => setWellknownOpen(true)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add source
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <ProviderConnectionDialog
        key={dialog?.id ?? "closed"}
        integration={dialog}
        projectID={project.id}
        location={location}
        onOpenChange={(open) => !open && setDialog(null)}
        onComplete={refresh}
      />
      <WellknownIntegrationDialog
        open={wellknownOpen}
        project={project}
        location={location}
        onOpenChange={setWellknownOpen}
        onComplete={refresh}
      />
      <CredentialLabelDialog
        key={rename?.credentialID ?? "closed"}
        credential={rename}
        project={project}
        location={location}
        onOpenChange={(open) => !open && setRename(null)}
        onComplete={refresh}
      />
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.connection.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? credentialRemovalDescription(removing) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingCredentialID !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removingCredentialID !== null}
              onClick={() => removing && void removeCredential(removing)}
            >
              Remove credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderGroupLabel({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <span className="text-meta text-muted-foreground">{detail}</span>
    </div>
  );
}

function ConnectedProviderCard({
  integration,
  activatingCredentialID,
  removingCredentialID,
  onActivate,
  onConnect,
  onRename,
  onRemove,
}: {
  integration: PalotIntegration;
  activatingCredentialID: string | null;
  removingCredentialID: string | null;
  onActivate(connection: PalotIntegrationConnection): void;
  onConnect(): void;
  onRename(connection: PalotIntegrationConnection): void;
  onRemove(connection: PalotIntegrationConnection): void;
}) {
  const credentials = integration.connections.filter(
    (connection) => connection.type === "credential",
  );
  const environment = integration.connections.filter((connection) => connection.type === "env");
  const connectable = integration.methods.some((method) => method.type !== "env");
  const summary = [
    credentials.length
      ? `${credentials.length} stored credential${credentials.length === 1 ? "" : "s"}`
      : null,
    environment.length
      ? `${environment.length} environment fallback${environment.length === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={`${integration.name} connections`}
    >
      <header className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/55 text-foreground">
          <ProviderIcon id={integration.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold wrap-anywhere">{integration.name}</h3>
          <p className="mt-1 text-compact text-muted-foreground">{summary}</p>
        </div>
        {connectable ? (
          <Button type="button" variant="outline" size="sm" onClick={onConnect}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add credential
          </Button>
        ) : null}
      </header>
      <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10">
        {integration.connections.map((connection) => {
          const selectable = connection.type === "credential" && !connection.active;
          const busy =
            connection.id === activatingCredentialID || connection.id === removingCredentialID;
          return (
            <div
              key={connection.id ?? `${connection.type}:${connection.label}`}
              role="group"
              aria-label={`${connection.label} connection`}
              className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0",
                  connection.type === "env" ? "rotate-45 rounded-[2px]" : "rounded-full",
                  connection.active
                    ? "bg-primary ring-2 ring-primary/15"
                    : "border border-muted-foreground/45 bg-background",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium wrap-anywhere">{connection.label}</span>
                  {connection.active ? <Badge variant="secondary">In use</Badge> : null}
                </div>
                <p className="mt-1 text-compact text-muted-foreground">
                  {connection.type === "credential"
                    ? "Stored credential"
                    : connection.active
                      ? "Environment variable"
                      : "Environment fallback · used when stored credentials are removed"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {selectable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy || activatingCredentialID !== null}
                    onClick={() => onActivate(connection)}
                  >
                    {connection.id === activatingCredentialID ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Use
                  </Button>
                ) : null}
                {connection.type === "credential" && connection.id ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Manage ${connection.label}`}
                          disabled={busy}
                        />
                      }
                    >
                      <Ellipsis aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => onRename(connection)}>
                        <Pencil aria-hidden="true" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onRemove(connection)}>
                        <Trash2 aria-hidden="true" />
                        Remove credential
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function AvailableProviderRow({
  integration,
  className,
  onConnect,
}: {
  integration: PalotIntegration;
  className?: string;
  onConnect(): void;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 bg-card p-4", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50 text-foreground">
        <ProviderIcon id={integration.id} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium wrap-anywhere">{integration.name}</div>
        <div className="font-mono text-code-compact wrap-anywhere text-muted-foreground">
          {integration.id}
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onConnect}>
        Connect
      </Button>
    </div>
  );
}

function credentialRemovalDescription({ integration, connection }: CredentialActionTarget): string {
  if (!connection.active) {
    return `This removes the stored credential from OpenCode. ${integration.name} will keep using its current credential.`;
  }
  const next = integration.connections.find(
    (candidate) => candidate.id !== connection.id && candidate.type === "credential",
  );
  if (next) {
    return `“${next.label}” will become active for ${integration.name} across this OpenCode service.`;
  }
  const environment = integration.connections.find((candidate) => candidate.type === "env");
  if (environment) {
    return `${integration.name} will fall back to ${environment.label} from the environment across this OpenCode service.`;
  }
  return `${integration.name} will no longer have a connection on this OpenCode service.`;
}

function WellknownIntegrationDialog({
  open,
  project,
  location,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  project: PalotProject;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await palot.addWellknownIntegration({
        url: url.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await onComplete();
      setUrl("");
      onOpenChange(false);
      toast.add({ type: "success", title: "Integration source added" });
    } catch (cause) {
      showError("Could not add integration source", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add integration source</DialogTitle>
          <DialogDescription>
            OpenCode fetches the source's well-known document and persists the discovered
            integration configuration.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          Source URL
          <Input
            type="url"
            value={url}
            placeholder="https://example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !validHttpUrl(url)} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Add source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialLabelDialog({
  credential,
  project,
  location,
  onOpenChange,
  onComplete,
}: {
  credential: { integrationName: string; credentialID: string; label: string } | null;
  project: PalotProject;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [label, setLabel] = useState(() => credential?.label ?? "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!credential) return;
    setBusy(true);
    try {
      await palot.updateCredential({
        credentialID: credential.credentialID,
        label: label.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await onComplete();
      onOpenChange(false);
      toast.add({ type: "success", title: `${credential.integrationName} credential renamed` });
    } catch (cause) {
      showError("Could not rename credential", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={Boolean(credential)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename credential</DialogTitle>
          <DialogDescription>
            The secret stays in OpenCode. Only its display label changes.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          Label
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !label.trim()} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TOOL_TABS = [
  ["plugins", "Plugins"],
  ["mcp", "MCP"],
  ["skills", "Skills"],
  ["commands", "Commands"],
  ["references", "References"],
  ["websearchProviders", "Web search"],
] as const;

function matchesInventory(query: string, ...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase());
}

export function ToolSettings({
  project,
  location,
  snapshot,
  pendingCapabilities = [],
  capabilityStates,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  pendingCapabilities?: SettingsCapability[];
  capabilityStates?: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<string>("plugins");
  const [queries, setQueries] = useState<Record<string, string>>({});
  const query = queries[tab] ?? "";
  const label = TOOL_TABS.find(([value]) => value === tab)![1];
  const mcpQuery = queries.mcp ?? "";
  const servers = (snapshot?.mcpServers ?? []).filter((server) =>
    matchesInventory(mcpQuery, server.name, server.status, server.error),
  );
  const resources = (snapshot?.mcpResources ?? []).filter((resource) =>
    matchesInventory(mcpQuery, resource.name, resource.description, resource.uri, resource.server),
  );
  const templates = (snapshot?.mcpResourceTemplates ?? []).filter((resource) =>
    matchesInventory(
      mcpQuery,
      resource.name,
      resource.description,
      resource.uriTemplate,
      resource.server,
    ),
  );
  const skills = (snapshot?.skills ?? []).filter((skill) =>
    matchesInventory(queries.skills ?? "", skill.name, skill.description, skill.location),
  );
  const commands = (snapshot?.commands ?? []).filter((command) =>
    matchesInventory(queries.commands ?? "", command.name, command.description, command.agent),
  );
  const references = (snapshot?.references ?? []).filter((reference) =>
    matchesInventory(
      queries.references ?? "",
      reference.name,
      reference.description,
      reference.source,
      reference.sourceType,
    ),
  );
  const websearchProviders = (snapshot?.websearchProviders ?? []).filter((provider) =>
    matchesInventory(queries.websearchProviders ?? "", provider.name, provider.id),
  );
  const state = (capability: SettingsCapability) =>
    capabilityStates?.[capability] ?? inventoryState(snapshot, capability, pendingCapabilities);
  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-w-0 gap-6">
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="Tool inventories" activateOnFocus>
            {TOOL_TABS.map(([value, name]) => (
              <TabsTrigger key={value} value={value}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()} by name, description, or source`}
            value={query}
            className="pl-9"
            onChange={(event) =>
              setQueries((current) => ({ ...current, [tab]: event.target.value }))
            }
          />
        </div>
        <TabsContent value="plugins" keepMounted className="data-hidden:hidden">
          <PluginSettings
            key={`${project.id}:${location.directory}:${location.workspaceID ?? ""}`}
            project={project}
            location={location}
            plugins={snapshot?.plugins ?? []}
            query={queries.plugins ?? ""}
            state={state("plugins")}
            refresh={refresh}
          />
        </TabsContent>
        <TabsContent value="mcp" keepMounted className="space-y-8 data-hidden:hidden">
          <SettingsSection
            title="MCP servers"
            description="Connect tools and data sources to this project."
            icon={PlugZap}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add server
              </Button>
            }
          >
            <SettingsGroup>
              <InventoryState
                title="MCP servers"
                state={state("mcp")}
                count={servers.length}
                total={snapshot?.mcpServers.length ?? 0}
                empty="No MCP servers are configured for this project."
              />
              {servers.map((server) => (
                <McpServerRow
                  key={server.name}
                  project={project}
                  location={location}
                  server={server}
                  refresh={refresh}
                />
              ))}
            </SettingsGroup>
          </SettingsSection>
          <InventorySection
            title="MCP resources"
            icon={Boxes}
            count={resources.length + templates.length}
            total={
              (snapshot?.mcpResources.length ?? 0) + (snapshot?.mcpResourceTemplates.length ?? 0)
            }
            state={state("mcpResources")}
          >
            {resources.map((resource) => (
              <InventoryRow
                key={`${resource.server}:${resource.uri}`}
                title={resource.name}
                description={resource.description ?? resource.uri}
                detail={`${resource.server} · ${resource.uri}`}
              />
            ))}
            {templates.map((resource) => (
              <InventoryRow
                key={`${resource.server}:${resource.uriTemplate}`}
                title={resource.name}
                description={resource.description ?? resource.uriTemplate}
                detail={`${resource.server} template · ${resource.uriTemplate}`}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="skills" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="Skills"
            icon={BrainCircuit}
            count={skills.length}
            total={snapshot?.skills.length ?? 0}
            state={state("skills")}
          >
            {skills.map((skill) => (
              <InventoryRow
                key={skill.id}
                title={skill.name}
                description={skill.description ?? skill.location}
                detail={[
                  skill.location,
                  skill.slash ? "slash command" : null,
                  skill.autoinvoke ? "auto-invoke" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="commands" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="Commands"
            icon={Command}
            count={commands.length}
            total={snapshot?.commands.length ?? 0}
            state={state("commands")}
          >
            {commands.map((command) => (
              <InventoryRow
                key={command.name}
                title={`/${command.name}`}
                description={command.description ?? "Reusable OpenCode command"}
                detail={[
                  command.agent ? `Agent ${command.agent}` : null,
                  command.subtask ? "subtask" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="references" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="References"
            icon={Link2}
            count={references.length}
            total={snapshot?.references.length ?? 0}
            state={state("references")}
          >
            {references.map((reference) => (
              <InventoryRow
                key={reference.name}
                title={reference.name}
                description={reference.description ?? reference.source}
                detail={`${reference.sourceType} · ${reference.source}`}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="websearchProviders" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="Web search providers"
            icon={Search}
            count={websearchProviders.length}
            total={snapshot?.websearchProviders.length ?? 0}
            state={state("websearchProviders")}
          >
            {websearchProviders.map((provider) => (
              <InventoryRow
                key={provider.id}
                title={provider.name}
                description={provider.id}
                detail="read-only"
              />
            ))}
          </InventorySection>
        </TabsContent>
      </Tabs>
      <AddMcpDialog
        open={addOpen}
        project={project}
        location={location}
        onOpenChange={setAddOpen}
        onComplete={refresh}
      />
    </>
  );
}

function pluginTarget(plugin: PalotPlugin): string | undefined {
  const source = plugin.source;
  return source.type === "package"
    ? source.target
    : source.type === "local"
      ? source.path
      : undefined;
}

export function PluginSettings({
  project,
  location,
  plugins,
  query = "",
  state = { status: "ready" },
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  plugins: PalotPlugin[];
  query?: string;
  state?: InventoryLoadState;
  refresh(): Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const builtinCount = plugins.filter((plugin) => plugin.source.type === "builtin").length;
  const scopedPlugins = plugins
    .filter((plugin) => showBuiltins || plugin.source.type !== "builtin")
    .sort((a, b) => Number(a.source.type === "builtin") - Number(b.source.type === "builtin"));
  const visiblePlugins = scopedPlugins.filter((plugin) =>
    matchesInventory(
      query,
      plugin.id,
      pluginTarget(plugin),
      plugin.source.type,
      plugin.source.type === "package" ? plugin.source.version : undefined,
      plugin.state.status,
      plugin.state.status === "failed" ? plugin.state.error : undefined,
    ),
  );
  const packagePlugins = plugins.filter((plugin) => plugin.source.type === "package");
  const operationPending =
    busy !== null ||
    plugins.some((plugin) => plugin.source.type === "package" && plugin.source.updating);
  const input = {
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
  const checkPlugins = useCheckPlugins(input);
  async function check() {
    if (operationPending) return;
    setBusy("check");
    try {
      await checkPlugins();
    } catch (cause) {
      showError("Could not check plugin updates", cause);
    } finally {
      setBusy(null);
    }
  }

  async function update(plugin: PalotPlugin) {
    const source = plugin.source;
    if (source.type !== "package" || !source.outdated || operationPending) return;
    setBusy(source.target);
    let failure: unknown;
    try {
      await palot.updatePlugins({ ...input, targets: [source.target] });
    } catch (cause) {
      failure = cause;
    }
    try {
      await refresh();
    } catch (cause) {
      failure = failure
        ? new Error(
            `${failure instanceof Error ? failure.message : String(failure)} Refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        : cause;
    }
    if (failure) showError(`Could not update ${plugin.id ?? source.target}`, failure);
    else toast.add({ type: "success", title: `${plugin.id ?? source.target} updated` });
    setBusy(null);
  }

  return (
    <SettingsSection
      title="Plugins"
      description="Inspect loaded plugins, check package versions, and apply updates through OpenCode."
      icon={Code2}
      action={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              operationPending ||
              packagePlugins.length === 0 ||
              state.status === "loading" ||
              state.status === "unavailable"
            }
            onClick={() => void check()}
          >
            <RefreshCw
              className={busy === "check" ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Check for updates
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground">
          {query.trim()
            ? `${visiblePlugins.length} of ${scopedPlugins.length} plugins`
            : `${scopedPlugins.length} ${scopedPlugins.length === 1 ? "plugin" : "plugins"}`}
          {!showBuiltins && builtinCount > 0 ? ` · ${builtinCount} built-in hidden` : ""}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-compact">
          Show built-in plugins
          <Switch checked={showBuiltins} onCheckedChange={setShowBuiltins} />
        </label>
      </div>
      <SettingsGroup>
        <InventoryState
          title="Plugins"
          state={state}
          count={visiblePlugins.length}
          total={scopedPlugins.length}
          empty={
            !showBuiltins && builtinCount > 0
              ? "No added plugins. Show built-in plugins to browse OpenCode defaults."
              : "No plugins were returned."
          }
        />
        {visiblePlugins.map((plugin, index) => {
          const source = plugin.source;
          const target = pluginTarget(plugin);
          const name = plugin.id ?? target ?? `Plugin ${index + 1}`;
          const updating = source.type === "package" && (busy === source.target || source.updating);
          const outdated = source.type === "package" && source.outdated;
          const failure = plugin.state.status === "failed" ? plugin.state : null;
          return (
            <div
              key={`${source.type}:${target ?? plugin.id ?? index}`}
              className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-start"
              role="group"
              aria-label={`${name} plugin`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 text-sm font-medium wrap-anywhere">{name}</h3>
                  <Badge variant={failure ? "destructive" : "outline"}>
                    {failure ? "Failed" : "Active"}
                  </Badge>
                  {outdated && !updating ? (
                    <Badge variant="secondary">Update available</Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-compact text-muted-foreground">
                  <span>{sentenceCase(source.type)}</span>
                  {source.type === "package" && source.version ? (
                    <span>{source.version}</span>
                  ) : null}
                </div>
                {target ? (
                  <p className="mt-1 text-compact leading-relaxed wrap-anywhere text-muted-foreground">
                    {target}
                  </p>
                ) : null}
                {failure ? (
                  <div className="mt-3 text-compact leading-relaxed wrap-anywhere text-destructive">
                    <p>OpenCode could not activate this plugin.</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                        Error details for {name}
                      </summary>
                      <pre className="mt-2 font-mono text-code-compact whitespace-pre-wrap wrap-anywhere">
                        {failure.error}
                        {failure.ref ? `\n${failure.ref}` : ""}
                      </pre>
                    </details>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-3 text-meta text-muted-foreground">
                  {plugin.features.server ? <span>Server</span> : null}
                  {plugin.features.tui ? <span>TUI</span> : null}
                  {plugin.features.rpc ? <span>RPC</span> : null}
                </div>
              </div>
              {source.type === "package" && (outdated || updating) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!outdated || operationPending}
                  onClick={() => void update(plugin)}
                >
                  {updating ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {updating ? "Updating" : "Update"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </SettingsGroup>
    </SettingsSection>
  );
}

function McpServerRow({
  project,
  location,
  server,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  server: PalotMcpServer;
  refresh(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const input = {
    server: server.name,
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
  async function run(action: "connect" | "disconnect" | "remove") {
    setBusy(true);
    try {
      if (action === "connect") await palot.connectMcpServer(input);
      if (action === "disconnect") await palot.disconnectMcpServer(input);
      if (action === "remove") await palot.removeMcpServer(input);
      await refresh();
    } catch (cause) {
      showError(`Could not ${action} ${server.name}`, cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={server.status} />
          <span className="text-sm font-medium wrap-anywhere">{server.name}</span>
          <Badge variant="outline">{server.status.replace("_", " ")}</Badge>
        </div>
        {server.error ? (
          <p className="mt-1 text-compact leading-relaxed wrap-anywhere text-destructive">
            {server.error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 @lg/settings:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => void run(server.status === "connected" ? "disconnect" : "connect")}
        >
          {server.status === "connected" ? "Disconnect" : "Connect"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${server.name}`}
          disabled={busy}
          onClick={() => void run("remove")}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function AddMcpDialog({
  open,
  project,
  location,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  project: PalotProject;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [type, setType] = useState<"remote" | "local">("remote");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [extra, setExtra] = useState("");
  const [cwd, setCwd] = useState("");
  const [oauth, setOauth] = useState(false);
  const [oauthClientID, setOauthClientID] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthCallbackPort, setOauthCallbackPort] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [startupTimeout, setStartupTimeout] = useState("");
  const [catalogTimeout, setCatalogTimeout] = useState("");
  const [executionTimeout, setExecutionTimeout] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [codemode, setCodemode] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      let config: PalotMcpConfig;
      const timeout = {
        ...(startupTimeout ? { startup: Number(startupTimeout) } : {}),
        ...(catalogTimeout ? { catalog: Number(catalogTimeout) } : {}),
        ...(executionTimeout ? { execution: Number(executionTimeout) } : {}),
      };
      if (type === "remote") {
        const headers = parseKeyValues(extra);
        const oauthConfig = {
          ...(oauthClientID.trim() ? { client_id: oauthClientID.trim() } : {}),
          ...(oauthClientSecret ? { client_secret: oauthClientSecret } : {}),
          ...(oauthScope.trim() ? { scope: oauthScope.trim() } : {}),
          ...(oauthCallbackPort ? { callback_port: Number(oauthCallbackPort) } : {}),
          ...(oauthRedirectUri.trim() ? { redirect_uri: oauthRedirectUri.trim() } : {}),
        };
        config = {
          type: "remote",
          url: target.trim(),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(oauth ? { oauth: oauthConfig } : {}),
          ...(Object.keys(timeout).length ? { timeout } : {}),
          disabled,
          codemode,
        };
      } else {
        const command = parseCommand(target);
        const environment = parseKeyValues(extra);
        config = {
          type: "local",
          command,
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          ...(Object.keys(environment).length ? { environment } : {}),
          ...(Object.keys(timeout).length ? { timeout } : {}),
          disabled,
          codemode,
        };
      }
      await palot.addMcpServer({
        server: name.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
        config,
      });
      await onComplete();
      setName("");
      setTarget("");
      setExtra("");
      setCwd("");
      setOauth(false);
      setOauthClientID("");
      setOauthClientSecret("");
      setOauthScope("");
      setOauthCallbackPort("");
      setOauthRedirectUri("");
      setStartupTimeout("");
      setCatalogTimeout("");
      setExecutionTimeout("");
      setDisabled(false);
      onOpenChange(false);
      toast.add({ type: "success", title: `${name.trim()} added` });
    } catch (cause) {
      showError("Could not add MCP server", cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            The server is registered for the current OpenCode location and connected immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Server name
            <Input
              value={name}
              placeholder="context7"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Transport
            <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="remote">Remote HTTP</SelectItem>
                <SelectItem value="local">Local command</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "Server URL" : "Command"}
            <Input
              value={target}
              placeholder={type === "remote" ? "https://mcp.example.com/mcp" : "bunx @example/mcp"}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          {type === "local" ? (
            <label className="grid gap-1.5 text-xs font-medium">
              Working directory <span className="font-normal text-muted-foreground">Optional</span>
              <Input
                value={cwd}
                placeholder="/path/to/project"
                onChange={(event) => setCwd(event.target.value)}
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "Headers" : "Environment variables"}
            <Textarea
              value={extra}
              placeholder={
                type === "remote" ? "Authorization=Bearer {env:MCP_TOKEN}" : "LOG_LEVEL=info"
              }
              className="min-h-24 font-mono"
              onChange={(event) => setExtra(event.target.value)}
            />
            <span className="text-micro font-normal text-muted-foreground">
              One NAME=value pair per line.
            </span>
          </label>
          {type === "remote" ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between text-xs">
                <span>
                  <span className="block font-medium">OAuth client</span>
                  <span className="block text-micro text-muted-foreground">
                    Submit client details to OpenCode. The client secret is write-only.
                  </span>
                </span>
                <Switch checked={oauth} onCheckedChange={(checked) => setOauth(Boolean(checked))} />
              </label>
              {oauth ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="OAuth client ID"
                    value={oauthClientID}
                    placeholder="Client ID"
                    onChange={(event) => setOauthClientID(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth client secret"
                    type="password"
                    value={oauthClientSecret}
                    placeholder="Client secret"
                    onChange={(event) => setOauthClientSecret(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth scope"
                    value={oauthScope}
                    placeholder="Scope"
                    onChange={(event) => setOauthScope(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth callback port"
                    type="number"
                    min={1}
                    max={65_535}
                    value={oauthCallbackPort}
                    placeholder="Callback port"
                    onChange={(event) => setOauthCallbackPort(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth redirect URI"
                    value={oauthRedirectUri}
                    placeholder="Redirect URI"
                    className="sm:col-span-2"
                    onChange={(event) => setOauthRedirectUri(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              aria-label="Startup timeout"
              type="number"
              min={0}
              value={startupTimeout}
              placeholder="Startup timeout"
              onChange={(event) => setStartupTimeout(event.target.value)}
            />
            <Input
              aria-label="Catalog timeout"
              type="number"
              min={0}
              value={catalogTimeout}
              placeholder="Catalog timeout"
              onChange={(event) => setCatalogTimeout(event.target.value)}
            />
            <Input
              aria-label="Execution timeout"
              type="number"
              min={0}
              value={executionTimeout}
              placeholder="Execution timeout"
              onChange={(event) => setExecutionTimeout(event.target.value)}
            />
          </div>
          <p className="text-micro text-muted-foreground">
            Optional timeout values use the OpenCode SDK units.
          </p>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">Start disabled</span>
              <span className="block text-micro text-muted-foreground">
                Register the server without connecting it.
              </span>
            </span>
            <Switch
              checked={disabled}
              onCheckedChange={(checked) => setDisabled(Boolean(checked))}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">Code Mode</span>
              <span className="block text-micro text-muted-foreground">
                Group MCP tools behind the dispatcher.
              </span>
            </span>
            <Switch
              checked={codemode}
              onCheckedChange={(checked) => setCodemode(Boolean(checked))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !name.trim() || !target.trim()}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentSettings({ snapshot }: { snapshot: PalotSettingsSnapshot | null }) {
  const agents = snapshot?.agents ?? [];
  return (
    <SettingsSection
      title="Available agents"
      description="Agent definitions come from built-ins, global configuration, project configuration, and agent files."
      icon={BrainCircuit}
    >
      <SettingsGroup>
        <InventoryState
          title="Agents"
          state={inventoryState(snapshot, "agents")}
          count={agents.length}
          total={agents.length}
          empty="No agents were returned for this project."
        />
        {agents.map((agent) => (
          <div key={agent.id} className="min-w-0 p-4">
            <div className="flex items-start gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <BrainCircuit
                  className="size-4"
                  style={{ color: agent.color ?? undefined }}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium wrap-anywhere">{agent.name}</h3>
                  <Badge variant="outline">{agent.mode}</Badge>
                  {agent.hidden ? <Badge variant="outline">hidden</Badge> : null}
                </div>
                <div className="mt-1 font-mono text-code-compact wrap-anywhere text-muted-foreground">
                  {agent.id}
                </div>
              </div>
            </div>
            <p className="mt-3 text-compact leading-relaxed wrap-anywhere text-muted-foreground">
              {agent.description ?? "No description provided."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-meta wrap-anywhere text-muted-foreground">
              <span>{agent.permissions.length} permission rules</span>
              {agent.steps ? <span>· {agent.steps} steps</span> : null}
              {agent.model ? (
                <span>
                  · {agent.model.providerID}/{agent.model.id}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}

function PermissionSettings({
  snapshot,
  pendingCapabilities,
  capabilityStates,
  refresh,
}: {
  snapshot: PalotSettingsSnapshot | null;
  pendingCapabilities: SettingsCapability[];
  capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
}) {
  const permissions = snapshot?.savedPermissions ?? [];
  const location = snapshot?.location;
  return (
    <>
      <SettingsSection
        title="Saved approvals"
        description="These project-scoped allow rules were created when you selected Always allow. Configured deny rules still win."
        icon={ShieldCheck}
      >
        <SettingsGroup>
          <InventoryState
            title="Saved approvals"
            state={
              capabilityStates.savedPermissions ??
              inventoryState(snapshot, "savedPermissions", pendingCapabilities)
            }
            count={permissions.length}
            total={permissions.length}
            empty="This project has no saved approvals."
          />
          {permissions.map((permission) => (
            <div
              key={permission.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="secondary">{permission.action}</Badge>
                  <code
                    className="min-w-0 text-code-compact wrap-anywhere"
                    title={permission.resource}
                  >
                    {permission.resource}
                  </code>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove saved approval for ${permission.resource}`}
                onClick={() =>
                  void palot
                    .removeSavedPermission({
                      id: permission.id,
                      projectID: permission.projectID,
                      directory: location?.directory ?? "",
                      ...(location?.workspaceID ? { workspaceID: location.workspaceID } : {}),
                    })
                    .then(refresh)
                    .catch((cause) => showError("Could not remove saved approval", cause))
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Configured policy"
        description="OpenCode exposes the effective config sources as read-only documents in this client version."
        icon={FileCog}
      >
        <SettingsGroup>
          <InventoryState
            title="Configured policy"
            state={
              capabilityStates.config ?? inventoryState(snapshot, "config", pendingCapabilities)
            }
            count={1}
            total={1}
          />
          {snapshot?.configSources.flatMap((source, sourceIndex) =>
            source.permissions.map((rule, ruleIndex) => (
              <SettingsRow
                key={`${sourceIndex}:${ruleIndex}:${rule.action}:${rule.resource}`}
                title={rule.action}
                description={rule.resource}
                status={source.path ?? source.type}
                control={<Badge variant="outline">{rule.effect}</Badge>}
              />
            )),
          )}
          {(capabilityStates.config ?? inventoryState(snapshot, "config", pendingCapabilities))
            .status === "ready" &&
          snapshot?.configSources.every((source) => source.permissions.length === 0) ? (
            <SettingsRow
              title="Permission rules"
              description="No explicit permission rules were returned. Edit the source JSON or agent file to change configured policy."
              control={<Badge variant="outline">Read-only API</Badge>}
            />
          ) : null}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function ConfigSettings({ snapshot }: { snapshot: PalotSettingsSnapshot | null }) {
  const inventory = configInventory(snapshot);
  return (
    <>
      <SettingsSection
        title="Configuration sources"
        description="OpenCode returns discovery entries from lowest to highest priority. The V2 client currently has no config update endpoint."
        icon={FileCog}
      >
        <SettingsGroup>
          <InventoryState
            title="Configuration sources"
            state={inventoryState(snapshot, "config")}
            count={snapshot?.configSources.length ?? 0}
            total={snapshot?.configSources.length ?? 0}
            empty="No configuration entries were returned."
          />
          {snapshot?.configSources.map((source, index) => (
            <div
              key={`${source.type}:${source.path}:${index}`}
              className="flex min-w-0 flex-wrap items-start gap-3 p-4 text-compact"
            >
              <FileCog className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                {source.path ?? source.type}
              </span>
              <Badge variant="outline">{source.type}</Badge>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Effective inventory"
        description="Sanitized values and counts from the discovered configuration documents. Read-only."
        icon={Boxes}
      >
        <SettingsGroup>
          <InventoryState
            title="Effective inventory"
            state={inventoryState(snapshot, "config")}
            count={inventory.length}
            total={inventory.length}
            empty="No inventory values were configured."
          />
          {inventory.map(([title, value]) => (
            <SettingsRow
              key={title}
              title={title}
              control={<Badge variant="outline">{value}</Badge>}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
      <InventorySection
        title="Formatters"
        state={inventoryState(snapshot, "config")}
        icon={Code2}
        count={
          snapshot?.configSources.reduce((count, source) => count + source.formatters.length, 0) ??
          0
        }
      >
        {snapshot?.configSources.flatMap((source, sourceIndex) =>
          source.formatters.map((formatter) => (
            <InventoryRow
              key={`${sourceIndex}:${formatter.id}`}
              title={formatter.id}
              description={
                formatter.executable
                  ? `${formatter.executable}${formatter.argumentCount ? ` + ${formatter.argumentCount} arguments` : ""}`
                  : "No command configured"
              }
              detail={[
                formatter.disabled ? "disabled" : "enabled",
                formatter.extensions.length ? formatter.extensions.join(", ") : null,
                formatter.environmentVariables.length
                  ? `${formatter.environmentVariables.length} environment variables`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )),
        )}
      </InventorySection>
      <InventorySection
        title="Language servers"
        state={inventoryState(snapshot, "config")}
        icon={Braces}
        count={
          snapshot?.configSources.reduce(
            (count, source) => count + source.languageServers.length,
            0,
          ) ?? 0
        }
      >
        {snapshot?.configSources.flatMap((source, sourceIndex) =>
          source.languageServers.map((server) => (
            <InventoryRow
              key={`${sourceIndex}:${server.id}`}
              title={server.id}
              description={
                server.executable
                  ? `${server.executable}${server.argumentCount ? ` + ${server.argumentCount} arguments` : ""}`
                  : "No command configured"
              }
              detail={[
                server.disabled ? "disabled" : "enabled",
                server.extensions.length ? server.extensions.join(", ") : null,
                server.environmentVariables.length
                  ? `${server.environmentVariables.length} environment variables`
                  : null,
                server.initializationKeys.length
                  ? `${server.initializationKeys.length} initialization keys`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )),
        )}
      </InventorySection>
      <SettingsSection title="Feature status" icon={Code2}>
        <SettingsGroup>
          <InventoryState
            title="Feature status"
            state={inventoryState(snapshot, "config")}
            count={1}
            total={1}
          />
          {inventoryState(snapshot, "config").status === "ready"
            ? [
                [
                  "Snapshots",
                  configValue(snapshot, "snapshots"),
                  "Filesystem undo and revert support",
                ],
                [
                  "Compaction",
                  configNestedValue(snapshot, "compaction", "auto"),
                  "Automatic context management",
                ],
                [
                  "Session warming",
                  configValue(snapshot, "warming"),
                  "Keep recent model sessions warm",
                ],
                [
                  "Formatter",
                  configValue(snapshot, "formatter"),
                  "Accepted by V2, not executed yet",
                ],
                [
                  "Language servers",
                  configValue(snapshot, "lsp"),
                  "Accepted by V2, not started yet",
                ],
              ].map(([title, value, description]) => (
                <SettingsRow
                  key={String(title)}
                  title={String(title)}
                  description={String(description)}
                  control={
                    <Badge variant={value === true ? "secondary" : "outline"}>
                      {formatConfigState(value)}
                    </Badge>
                  }
                />
              ))
            : null}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function AboutSettings({ snapshot }: { snapshot: PalotSettingsSnapshot | null }) {
  const runtime = useAtomValue(runtimeAtom);
  const [updateStatus, setUpdateStatus] = useState("");
  return (
    <>
      <SettingsSection title="Palot" icon={PalotMark as ComponentType<{ className?: string }>}>
        <SettingsGroup>
          <SettingsRow
            title="Desktop client"
            description="A native workspace for OpenCode V2 sessions, worktrees, approvals, and diffs."
            control={<BuildBadge />}
          />
          <SettingsRow
            title="Version"
            control={<code className="text-code-compact">{palotBuild.version}</code>}
          />
          <SettingsRow
            title="Channel"
            control={<code className="text-code-compact">{palotBuild.channel}</code>}
          />
          <SettingsRow
            title="Commit"
            description={
              palotBuild.dirty ? "Local build with uncommitted changes" : "Clean source revision"
            }
            control={
              <code className="max-w-80 text-code-compact" title={palotBuild.commitSha}>
                {palotBuild.commitSha.slice(0, 12)}
              </code>
            }
          />
          <SettingsRow
            title="Build number"
            control={<code className="text-code-compact">{palotBuild.buildNumber}</code>}
          />
          <SettingsRow
            title="OpenCode contract"
            control={
              <code className="text-code-compact">{palotBuild.openCodeContractVersion}</code>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="Help and legal"
        description="Project information opens on the official Palot GitHub repository."
        icon={ExternalLink}
      >
        <SettingsGroup>
          {ABOUT_LINKS.map((link) => (
            <SettingsRow
              key={link.href}
              title={link.title}
              description={link.description}
              control={
                <Button
                  render={<a href={link.href} target="_blank" rel="noreferrer" />}
                  variant="outline"
                >
                  Open
                  <ExternalLink data-icon="inline-end" aria-hidden="true" />
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="Updates" icon={RefreshCw}>
        <SettingsGroup>
          <SettingsRow
            title="Update from source"
            description="This codebase has no supported binary update channel yet. Follow the source installation and update instructions; Palot never downloads or installs an update automatically."
            control={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  window.open(PALOT_INSTALLATION_URL, "_blank", "noopener,noreferrer");
                  setUpdateStatus(
                    "Opened source installation and update instructions in your browser.",
                  );
                }}
              >
                View instructions
                <ExternalLink data-icon="inline-end" aria-hidden="true" />
              </Button>
            }
          />
        </SettingsGroup>
        <p className="sr-only" role="status" aria-live="polite">
          {updateStatus}
        </p>
      </SettingsSection>
      <SettingsSection title="OpenCode service" icon={Server}>
        <SettingsGroup>
          <SettingsRow
            title="Status"
            control={
              <Badge variant={runtime?.connected ? "secondary" : "destructive"}>
                {runtime?.phase ?? "unknown"}
              </Badge>
            }
          />
          <SettingsRow
            title="Version"
            control={<code className="text-code-compact">{runtime?.version ?? "Unavailable"}</code>}
          />
          <SettingsRow
            title="Process"
            description={runtime?.managed ? "Started by Palot" : "Discovered shared service"}
            control={<code className="text-code-compact">PID {runtime?.pid ?? "-"}</code>}
          />
          <SettingsRow
            title="Binary"
            control={
              <code
                className="max-w-80 text-code-compact wrap-anywhere"
                title={runtime?.binaryPath ?? ""}
              >
                {runtime?.binaryPath ?? "Not discovered"}
              </code>
            }
          />
          <SettingsRow
            title="Restart Palot"
            description="Restarts the development or installed client. The shared OpenCode service stays available."
            control={
              <Button
                type="button"
                variant="outline"
                onClick={() => void palot.restartApp("Restart requested from settings")}
              >
                Restart
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      {snapshot?.errors.length ? (
        <SettingsSection title="Partial API failures" icon={CircleAlert}>
          <SettingsGroup>
            {snapshot.errors.map((value, index) => (
              <SettingsRow
                key={`${value.capability}:${index}`}
                title={value.label}
                description={value.message}
              />
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : null}
    </>
  );
}

const PALOT_REPOSITORY_URL = "https://github.com/ItsWendell/palot";
const PALOT_INSTALLATION_URL = `${PALOT_REPOSITORY_URL}/blob/main/docs/installation.md#updating-and-uninstalling`;
const ABOUT_LINKS = [
  {
    title: "Documentation",
    description: "Setup, development, testing, and project documentation.",
    href: `${PALOT_REPOSITORY_URL}/tree/main/docs`,
  },
  {
    title: "Issues and support",
    description: "Report a bug, request a feature, or ask for help.",
    href: `${PALOT_REPOSITORY_URL}/issues`,
  },
  {
    title: "Security",
    description: "Read the security policy and report vulnerabilities privately.",
    href: `${PALOT_REPOSITORY_URL}/security/policy`,
  },
  {
    title: "Privacy",
    description: "Read what Palot stores and sends.",
    href: `${PALOT_REPOSITORY_URL}/blob/main/PRIVACY.md`,
  },
  {
    title: "Licenses",
    description: "Review Palot and third-party license notices.",
    href: `${PALOT_REPOSITORY_URL}/blob/main/apps/desktop/resources/licenses/THIRD_PARTY_NOTICES.md`,
  },
  {
    title: "Release notes",
    description: "See all published Palot releases and their notes.",
    href: `${PALOT_REPOSITORY_URL}/releases`,
  },
] as const;

type InventoryLoadState =
  | { status: "ready" | "loading" | "unavailable" }
  | { status: "error"; message: string };

function inventoryState(
  snapshot: PalotSettingsSnapshot | null,
  capability: SettingsCapability,
  pending: SettingsCapability[] = [],
): InventoryLoadState {
  // A nonempty plugin inventory proves the list succeeded. Its errors can also
  // contain activation diagnostics, which belong to the failed plugin rows.
  if (capability === "plugins" && snapshot?.plugins.length) return { status: "ready" };
  const error = snapshot?.errors.find((error) => error.capability === capability);
  if (error) return { status: "error", message: error.message };
  if (pending.includes(capability)) return { status: "loading" };
  return { status: snapshot ? "ready" : "unavailable" };
}

function InventoryState({
  title,
  state,
  count,
  total,
  empty,
}: {
  title: string;
  state: InventoryLoadState;
  count: number;
  total: number;
  empty?: string;
}) {
  if (state.status === "error")
    return (
      <div role="alert" className="space-y-1 p-4 text-compact leading-relaxed wrap-anywhere">
        <p className="font-medium text-destructive">
          {total > 0
            ? `Could not refresh ${title.toLowerCase()}. Showing the last loaded inventory.`
            : `Could not load ${title.toLowerCase()}.`}
        </p>
        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            Error details for {title.toLowerCase()}
          </summary>
          <pre className="mt-2 font-mono text-code-compact whitespace-pre-wrap wrap-anywhere">
            {state.message}
          </pre>
        </details>
      </div>
    );
  if (state.status === "loading")
    return (
      <p role="status" className="flex items-center gap-2 p-4 text-compact text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading {title.toLowerCase()}…
      </p>
    );
  if (state.status === "unavailable")
    return (
      <SettingsEmpty>
        {title} are unavailable. Refresh settings when OpenCode is connected.
      </SettingsEmpty>
    );
  if (count > 0) return null;
  return (
    <SettingsEmpty>
      {total > 0
        ? `No ${title.toLowerCase()} match this search.`
        : (empty ?? `No ${title.toLowerCase()} were returned.`)}
    </SettingsEmpty>
  );
}

function InventorySection({
  title,
  icon,
  count,
  total = count,
  state = { status: "ready" },
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  count: number;
  total?: number;
  state?: InventoryLoadState;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      title={title}
      icon={icon}
      action={
        state.status === "ready" ? (
          <span className="text-meta text-muted-foreground">
            {count === total ? `${total} total` : `${count} of ${total}`}
          </span>
        ) : undefined
      }
    >
      <SettingsGroup>
        <InventoryState title={title} state={state} count={count} total={total} />
        {children}
      </SettingsGroup>
    </SettingsSection>
  );
}

function InventoryRow({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 wrap-anywhere">
      <SettingsRow title={title} description={description} status={detail} />
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-10" aria-label="Loading settings">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-3">
          <div className="mx-4 h-5 w-32 animate-pulse rounded bg-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="mx-3 h-16 animate-pulse rounded-xl bg-muted/45" />
          ))}
        </section>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: PalotMcpServer["status"] }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full bg-muted-foreground/40",
        status === "connected" && "bg-success",
        status === "pending" && "animate-pulse bg-info",
        status === "failed" && "bg-destructive",
        status === "needs_auth" && "bg-warning",
      )}
      aria-label={status.replace("_", " ")}
    />
  );
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function modelRef(
  model: PalotSettingsSnapshot["catalog"]["models"][number],
  variant?: string,
): ModelRef {
  return {
    id: model.id,
    providerID: model.providerID,
    ...(variant ? { variant } : {}),
  };
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function parseKeyValues(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`Expected NAME=value, received “${trimmed}”.`);
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

function parseCommand(value: string): string[] {
  const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const command = parts.map((part) => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"));
  if (command.length === 0) throw new Error("Enter a command.");
  return command;
}

function configValue(snapshot: PalotSettingsSnapshot | null, key: string): unknown {
  for (let index = (snapshot?.configSources.length ?? 0) - 1; index >= 0; index -= 1) {
    const summary = snapshot?.configSources[index]?.summary;
    if (summary && key in summary) return summary[key as keyof typeof summary];
  }
  return undefined;
}

function configNestedValue(
  snapshot: PalotSettingsSnapshot | null,
  key: string,
  nested: string,
): unknown {
  if (key === "compaction" && nested === "auto") return configValue(snapshot, "compactionAuto");
  return undefined;
}

function configInventory(snapshot: PalotSettingsSnapshot | null): Array<[string, string]> {
  const fields = [
    ["Default model", "model"],
    ["Default agent", "defaultAgent"],
    ["Update policy", "update"],
    ["Sharing", "share"],
    ["Shell configured", "shell"],
    ["Enterprise configured", "enterprise"],
    ["Permission rules", "permissionCount"],
    ["Agent definitions", "agentCount"],
    ["Formatters", "formatterCount"],
    ["Language servers", "lspCount"],
    ["Watcher configured", "watcher"],
    ["Media configured", "media"],
    ["Tool output configured", "toolOutput"],
    ["MCP servers", "mcpServerCount"],
    ["Skills", "skillCount"],
    ["Commands", "commandCount"],
    ["Instructions", "instructionCount"],
    ["References", "referenceCount"],
    ["Web search provider", "websearchProvider"],
    ["Plugins", "pluginCount"],
    ["Providers", "providerCount"],
    ["Experimental policies", "experimentalPolicyCount"],
  ] as const;
  return fields.flatMap(([label, key]) => {
    const value = configValue(snapshot, key);
    if (value === undefined) return [];
    if (typeof value === "boolean") return [[label, value ? "Yes" : "No"]];
    return [[label, String(value)]];
  });
}

function formatConfigState(value: unknown) {
  if (value === undefined) return "Default";
  if (value === false) return "Disabled";
  if (value === true) return "Enabled";
  return "Configured";
}

function showError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "OpenCode rejected the request.",
  });
}
