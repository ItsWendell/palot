import {
  Archive,
  BellRing,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleDot,
  FolderPlus,
  FolderGit2,
  Ellipsis,
  ListFilter,
  LoaderCircle,
  PinOff,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import type { LocationRef } from "@opencode/client";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import type { PalotProject } from "../../shared";
import { groupedScheduledSessionIDsAtom } from "../atoms/automations";
import {
  attentionSyncStateAtom,
  dispatchSessionTriageAtom,
  sessionTriageErrorAtom,
  sessionTriageLoadingAtom,
  sessionTriageSnapshotAtom,
} from "../atoms/inbox";
import {
  inboxFiltersAtom,
  inboxShelvesAtom,
  inboxViewPreferencesAtom,
  type InboxFilters,
  type InboxStateFilter,
  type InboxViewPreferences,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionInbox } from "../hooks/use-session-inbox";
import { useSessionTitleEditor } from "../hooks/use-session-title-editor";
import {
  useProjectCatalog,
  useRootSessionPagination,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import { useVcsInfoMap, vcsLocationKey } from "../hooks/use-vcs-info";
import { cn } from "../lib/cn";
import { ScrollArea } from "./ui/scroll-area";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { openCodeKeys } from "../lib/opencode-query";
import {
  formatSnoozeMenuTime,
  formatSnoozeWakeTime,
  sessionSnoozeChoices,
} from "../lib/session-snooze";
import {
  inboxSessionState,
  orderInboxSessions,
  sameInboxSessionView,
  type InboxSessionView,
} from "../lib/session-inbox";
import { formatRelativeTime, orderProjects, sessionActivityAt } from "../lib/view-models";
import type { OpenCodeVcsInfo } from "../services/opencode-vcs";
import { listRootSessionInfo } from "../services/opencode-catalog";
import { mapSession } from "../services/opencode-mappers";
import { AddProjectDialog } from "./add-project-dialog";
import { ProjectPickerContent } from "./project-picker";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ContextMenuItem } from "./ui/context-menu";
import { SessionContextMenu } from "./session-context-menu";
import { useSessionWindowDrag } from "../hooks/use-session-window-drag";
import {
  InboxCardSurface,
  InboxStateGlyph,
  INBOX_CARD_ACTION_BUTTON_CLASS as INBOX_ACTION_BUTTON_CLASS,
} from "./inbox-card-surface";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarContent } from "./ui/sidebar";
import {
  sidebarItemVariants,
  sidebarSectionIconVariants,
  sidebarSectionLabelVariants,
  sidebarSectionTriggerVariants,
} from "./ui/sidebar-styles";
import { toast } from "./ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Switch } from "./ui/switch";

export function InboxSidebarContent() {
  const { openSession, preloadSession } = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const [filters, setFilters] = useAtom(inboxFiltersAtom);
  const remoteFilter = useQuery({
    queryKey: openCodeKeys.search(
      runtime?.connectionID ?? "disconnected",
      `project:${filters.projectID ?? ""}`,
    ),
    enabled: canFetchOpenCode(runtime) && Boolean(filters.projectID),
    queryFn: ({ signal }) =>
      listRootSessionInfo(
        {
          limit: 100,
          ...(filters.projectID ? { project: filters.projectID } : {}),
        },
        signal,
      ),
    retry: false,
  });
  const remoteSessions = useMemo(
    () => remoteFilter.data?.data.map(mapSession) ?? [],
    [remoteFilter.data],
  );
  const remoteSessionIDs = useMemo(
    () => (remoteFilter.data ? new Set(remoteSessions.map((session) => session.id)) : null),
    [remoteFilter.data, remoteSessions],
  );
  const snapshot = useSessionInbox(remoteSessions);
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const groupedScheduledSessionIDs = useAtomValue(groupedScheduledSessionIDsAtom);
  const triageError = useAtomValue(sessionTriageErrorAtom);
  const triageLoading = useAtomValue(sessionTriageLoadingAtom);
  const triageSnapshot = useAtomValue(sessionTriageSnapshotAtom);
  const attentionState = useAtomValue(attentionSyncStateAtom);
  const pagination = useRootSessionPagination();
  const dispatch = useSetAtom(dispatchSessionTriageAtom);
  const [shelves, setShelves] = useAtom(inboxShelvesAtom);
  const [viewPreferences, setViewPreferences] = useAtom(inboxViewPreferencesAtom);
  const [pendingSessionID, setPendingSessionID] = useState<string | null>(null);
  const selectedID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return value ?? null;
    },
  });
  const visible = useMemo(() => orderProjects(projects, sessions), [projects, sessions]);
  const projectIDs = useMemo(() => new Set(visible.map((project) => project.id)), [visible]);
  const mutationsDisabled = triageLoading || triageSnapshot === null || triageError !== null;

  useEffect(() => {
    if (filters.projectID && !projectIDs.has(filters.projectID)) {
      setFilters((current) => ({ ...current, projectID: null }));
    }
  }, [filters.projectID, projectIDs, setFilters]);
  const filtered = useMemo(() => {
    const matchesState = (item: InboxSessionView) =>
      filters.states.length === 0 ||
      filters.states.some((state) => {
        if (state === "attention") return item.attention;
        if (state === "running") return item.running;
        if (state === "failed") return item.failed;
        return catalogSessionIsUnread(item.session);
      });
    const apply = (items: InboxSessionView[]) =>
      items.filter((item) => {
        if (!item.attention && groupedScheduledSessionIDs.has(item.session.id)) return false;
        if (filters.projectID && item.project?.id !== filters.projectID) return false;
        if (!matchesState(item)) return false;
        if (filters.projectID && remoteSessionIDs) return remoteSessionIDs.has(item.session.id);
        return true;
      });
    return {
      pinned: orderInboxSessions(apply(snapshot.pinned), viewPreferences),
      inbox: orderInboxSessions(apply(snapshot.inbox), viewPreferences),
      snoozed: orderInboxSessions(apply(snapshot.snoozed), viewPreferences),
      settled: orderInboxSessions(apply(snapshot.settled), viewPreferences),
    };
  }, [filters, groupedScheduledSessionIDs, remoteSessionIDs, snapshot, viewPreferences]);
  const actionContext = useRef({ filtered, mutationsDisabled, selectedID });
  useLayoutEffect(() => {
    actionContext.current = { filtered, mutationsDisabled, selectedID };
  }, [filtered, mutationsDisabled, selectedID]);
  const branchLocations = useMemo(() => {
    const locations = new Map<string, LocationRef>();
    for (const item of [...filtered.pinned, ...filtered.inbox]) {
      locations.set(vcsLocationKey(item.session.location), item.session.location);
    }
    return [...locations.values()];
  }, [filtered.inbox, filtered.pinned]);
  const branches = useVcsInfoMap(branchLocations);

  const selectSession = useCallback(
    (sessionID: string) => {
      setPendingSessionID(sessionID);
      requestAnimationFrame(() => {
        void openSession(sessionID)
          .catch(() => undefined)
          .finally(() =>
            setPendingSessionID((current) => (current === sessionID ? null : current)),
          );
      });
    },
    [openSession],
  );

  const runAction = useCallback(
    async (item: InboxSessionView, action: "settle" | "inbox" | "pin" | "unpin" | "wake") => {
      const current = actionContext.current;
      if (current.mutationsDisabled) return;
      if (action === "settle" && !item.canSettle) {
        toast.add({
          type: "warning",
          title: item.running ? "Task is still working" : "Task needs input",
          description: "Resolve the active work before settling this task.",
        });
        return;
      }
      const next =
        action === "settle" && current.selectedID === item.session.id
          ? [...current.filtered.inbox, ...current.filtered.pinned].find(
              (candidate) => candidate.session.id !== item.session.id,
            )
          : null;
      await dispatch(
        action === "settle"
          ? {
              type: "settle",
              sessionID: item.session.id,
              at: Date.now(),
              through: item.activityThrough,
            }
          : { type: action, sessionID: item.session.id, at: Date.now() },
      );
      if (next) void openSession(next.session.id);
      if (action === "settle") {
        toast.add({
          type: "success",
          title: "Task settled",
          actionProps: {
            children: "Undo",
            onClick: () =>
              void dispatch({ type: "inbox", sessionID: item.session.id, at: Date.now() }),
          },
        });
      }
    },
    [dispatch, openSession],
  );

  const snooze = useCallback(
    async (item: InboxSessionView, until: number) => {
      if (mutationsDisabled) return;
      await dispatch({
        type: "snooze",
        sessionID: item.session.id,
        at: Date.now(),
        until,
        through: item.activityThrough,
      });
      toast.add({
        type: "success",
        title: "Task snoozed",
        description: `Returns ${formatSnoozeWakeTime(until)}.`,
        actionProps: {
          children: "Undo",
          onClick: () =>
            void dispatch({ type: "wake", sessionID: item.session.id, at: Date.now() }),
        },
      });
    },
    [dispatch, mutationsDisabled],
  );

  return (
    <>
      <InboxToolbar
        projects={visible}
        filters={filters}
        onFiltersChange={setFilters}
        viewPreferences={viewPreferences}
        onViewPreferencesChange={setViewPreferences}
        onShelvesChange={setShelves}
        pagination={pagination}
        runtime={runtime}
      />
      <SidebarContent className="min-h-0 overflow-hidden">
        <ScrollArea className="h-full min-h-0">
          <div className="space-y-1 px-2 pt-0.5 pb-2">
            {triageError ? (
              <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                Inbox state could not be saved. All loaded tasks remain visible.
              </div>
            ) : null}
            {attentionState !== "ready" ? (
              <div role="status" className="px-2 py-1.5 text-meta text-muted-foreground">
                {attentionState === "syncing" ? "Syncing requests…" : "Request status unavailable"}
              </div>
            ) : null}
            {triageLoading || remoteFilter.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                Loading inbox
              </div>
            ) : null}
            <RichSection
              title="Pinned"
              open={shelves.pinned}
              onOpenChange={(value) => setShelves((current) => ({ ...current, pinned: value }))}
              items={filtered.pinned}
              selectedID={pendingSessionID ?? selectedID}
              onSelect={selectSession}
              onPreload={preloadSession}
              onAction={runAction}
              onSnooze={snooze}
              actionsDisabled={mutationsDisabled}
              branches={branches}
            />
            <RichSection
              title="Inbox"
              open={shelves.inbox}
              onOpenChange={(value) => setShelves((current) => ({ ...current, inbox: value }))}
              items={filtered.inbox}
              selectedID={pendingSessionID ?? selectedID}
              onSelect={selectSession}
              onPreload={preloadSession}
              onAction={runAction}
              onSnooze={snooze}
              actionsDisabled={mutationsDisabled}
              empty={
                attentionState === "ready"
                  ? pagination.hasNextPage
                    ? "No loaded tasks are in the inbox"
                    : "Inbox is clear"
                  : undefined
              }
              branches={branches}
            />
            {viewPreferences.showSnoozed && filtered.snoozed.length > 0 ? (
              <CompactShelf
                title="Snoozed"
                open={shelves.snoozed}
                onOpenChange={(value) => setShelves((current) => ({ ...current, snoozed: value }))}
                items={filtered.snoozed}
                selectedID={pendingSessionID ?? selectedID}
                onSelect={selectSession}
                onPreload={preloadSession}
                onAction={runAction}
                onSnooze={snooze}
                actionsDisabled={mutationsDisabled}
              />
            ) : null}
            {viewPreferences.showSettled ? (
              <CompactShelf
                title="Settled"
                open={shelves.settled}
                onOpenChange={(value) => setShelves((current) => ({ ...current, settled: value }))}
                items={filtered.settled}
                selectedID={pendingSessionID ?? selectedID}
                onSelect={selectSession}
                onPreload={preloadSession}
                onAction={runAction}
                onSnooze={snooze}
                actionsDisabled={mutationsDisabled}
              />
            ) : null}
          </div>
        </ScrollArea>
      </SidebarContent>
    </>
  );
}

const STATE_FILTERS: ReadonlyArray<{ value: InboxStateFilter; label: string }> = [
  { value: "attention", label: "Needs input" },
  { value: "running", label: "Running" },
  { value: "failed", label: "Failed" },
  { value: "unread", label: "Unread" },
];
const INBOX_ORDERING_LABELS: Record<InboxViewPreferences["ordering"], string> = {
  newest: "Newest",
  oldest: "Oldest",
  attention: "Needs input first",
};
type InboxShelves = { pinned: boolean; inbox: boolean; snoozed: boolean; settled: boolean };

export function InboxToolbar({
  projects,
  filters,
  onFiltersChange,
  viewPreferences,
  onViewPreferencesChange,
  onShelvesChange,
  pagination,
  runtime,
  filterItems,
  optionItems,
  additionalFilterCount = 0,
  onClearFilters,
}: {
  projects: PalotProject[];
  filters: InboxFilters;
  onFiltersChange(update: InboxFilters | ((current: InboxFilters) => InboxFilters)): void;
  viewPreferences: InboxViewPreferences;
  onViewPreferencesChange(
    update: InboxViewPreferences | ((current: InboxViewPreferences) => InboxViewPreferences),
  ): void;
  onShelvesChange(update: InboxShelves | ((current: InboxShelves) => InboxShelves)): void;
  pagination: Pick<
    ReturnType<typeof useRootSessionPagination>,
    "hasNextPage" | "isFetchingNextPage" | "loadMore"
  >;
  runtime: ReturnType<typeof useAtomValue<typeof runtimeAtom>>;
  filterItems?: ReactNode;
  optionItems?: ReactNode;
  additionalFilterCount?: number;
  onClearFilters?(): void;
}) {
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const activeCount =
    Number(Boolean(filters.projectID)) + filters.states.length + additionalFilterCount;
  const selectedProject = projects.find((project) => project.id === filters.projectID);
  const toggleState = (state: InboxStateFilter, checked: boolean) =>
    onFiltersChange((current) => ({
      ...current,
      states: checked
        ? [...current.states, state]
        : current.states.filter((candidate) => candidate !== state),
    }));

  return (
    <>
      <div className="flex h-8 shrink-0 items-center justify-between px-2.5 pb-1">
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label={activeCount ? `Filter tasks, ${activeCount} active` : "Filter tasks"}
                />
              }
            >
              <ListFilter aria-hidden="true" />
              {activeCount > 0 ? (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-sidebar" />
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-1.5">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
                  Add filter…
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9">
                  <FolderGit2 aria-hidden="true" />
                  <span>Project</span>
                  {selectedProject ? (
                    <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
                      {selectedProject.name}
                    </span>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-80 p-1">
                  <ProjectPickerContent
                    projects={projects}
                    value={filters.projectID}
                    allLabel="All projects"
                    onValueChange={(projectID) =>
                      onFiltersChange((current) => ({ ...current, projectID }))
                    }
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9">
                  <CircleDot aria-hidden="true" />
                  <span>State</span>
                  {filters.states.length > 0 ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {filters.states.length}
                    </span>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48 p-1">
                  {STATE_FILTERS.map((state) => (
                    <DropdownMenuCheckboxItem
                      key={state.value}
                      checked={filters.states.includes(state.value)}
                      onCheckedChange={(checked) => toggleState(state.value, checked)}
                      closeOnClick={false}
                    >
                      {state.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {filterItems}
              {activeCount > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-muted-foreground"
                    onClick={() => {
                      onFiltersChange({ projectID: null, states: [] });
                      onClearFilters?.();
                    }}
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                        aria-label="Inbox view settings"
                      />
                    }
                  />
                }
              >
                <SlidersHorizontal aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>View settings</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-64 gap-3 p-3">
              <div className="space-y-1.5">
                <label htmlFor="inbox-ordering" className="text-xs font-medium">
                  Ordering
                </label>
                <Select
                  value={viewPreferences.ordering}
                  onValueChange={(ordering) => {
                    if (!ordering) return;
                    onViewPreferencesChange((current) => ({ ...current, ordering }));
                  }}
                >
                  <SelectTrigger id="inbox-ordering" className="w-full">
                    <SelectValue>{INBOX_ORDERING_LABELS[viewPreferences.ordering]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                    <SelectItem value="attention">Needs input first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="h-px bg-border/50" />
              <InboxViewToggle
                label="Unread first"
                checked={viewPreferences.unreadFirst}
                onCheckedChange={(unreadFirst) =>
                  onViewPreferencesChange((current) => ({ ...current, unreadFirst }))
                }
              />
              <InboxViewToggle
                label="Show snoozed"
                checked={viewPreferences.showSnoozed}
                onCheckedChange={(showSnoozed) =>
                  onViewPreferencesChange((current) => ({ ...current, showSnoozed }))
                }
              />
              <InboxViewToggle
                label="Show settled"
                checked={viewPreferences.showSettled}
                onCheckedChange={(showSettled) =>
                  onViewPreferencesChange((current) => ({ ...current, showSettled }))
                }
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label="Add project folder"
                  onClick={() => setAddProjectOpen(true)}
                />
              }
            >
              <FolderPlus aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Add project folder</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label="Inbox options"
                />
              }
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                disabled={!pagination.hasNextPage || pagination.isFetchingNextPage}
                onClick={() => void pagination.loadMore()}
              >
                {pagination.isFetchingNextPage ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {pagination.hasNextPage ? "Load older tasks" : "All tasks loaded"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  onShelvesChange({ pinned: true, inbox: true, snoozed: true, settled: true })
                }
              >
                Expand all sections
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onShelvesChange({ pinned: false, inbox: false, snoozed: false, settled: false })
                }
              >
                Collapse all sections
              </DropdownMenuItem>
              {optionItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {addProjectOpen && (
        <AddProjectDialog
          initialProfileID={runtime?.profileID}
          onClose={() => setAddProjectOpen(false)}
        />
      )}
    </>
  );
}

function InboxViewToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <label className="flex min-h-7 cursor-pointer items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function RichSection({
  title,
  empty,
  open,
  onOpenChange,
  items,
  ...props
}: SectionProps & {
  title: string;
  empty?: string;
  open?: boolean;
  onOpenChange?(value: boolean): void;
}) {
  if (!items.length && !empty) return null;
  const content = (
    <div className="space-y-0.5">
      {items.map((item) => (
        <InboxCard key={item.session.id} item={item} {...props} />
      ))}
      {!items.length ? (
        <div className="px-2.5 py-4 text-xs text-muted-foreground">{empty}</div>
      ) : null}
    </div>
  );
  if (open === undefined || !onOpenChange) {
    return (
      <section aria-label={title} className="pb-2">
        <div className={sidebarSectionLabelVariants()}>
          {title}
          {items.length ? <span className="ml-auto tabular-nums">{items.length}</span> : null}
        </div>
        {content}
      </section>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <SectionTrigger title={title} count={items.length} open={open} />
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  );
}

interface SectionProps {
  items: InboxSessionView[];
  selectedID: string | null;
  onSelect(id: string): void;
  onPreload(id: string): void;
  onAction(item: InboxSessionView, action: "settle" | "inbox" | "pin" | "unpin" | "wake"): void;
  onSnooze?(item: InboxSessionView, until: number): void;
  actionsDisabled: boolean;
  branches?: ReadonlyMap<string, OpenCodeVcsInfo>;
}

type InboxRowProps = Omit<SectionProps, "items"> & { item: InboxSessionView };

const InboxCard = memo(function InboxCard({
  item,
  selectedID,
  onSelect,
  onPreload,
  onAction,
  onSnooze,
  actionsDisabled,
  branches,
}: InboxRowProps) {
  const title = useSessionTitleEditor(item.session);
  const windowDrag = useSessionWindowDrag(item.session.id);
  const selected = selectedID === item.session.id;
  const vcs = branches?.get(vcsLocationKey(item.session.location));
  const row = (
    <InboxCardSurface
      item={item}
      selected={selected}
      vcs={vcs}
      hint={windowDrag.hint}
      buttonProps={{
        ...windowDrag.handleProps,
        className: "cursor-grab active:cursor-grabbing",
        onClick: () => onSelect(item.session.id),
        onMouseEnter: () => onPreload(item.session.id),
        onFocus: () => onPreload(item.session.id),
        onDoubleClick: (event) => {
          event.preventDefault();
          title.start();
        },
      }}
      titleEditor={
        title.editing ? (
          <Input
            autoFocus
            aria-label="Task title"
            value={title.draft}
            className="pointer-events-auto relative z-20 h-7 px-1.5 text-compact! text-sidebar-foreground/90"
            onChange={(event) => title.setDraft(event.target.value)}
            onBlur={() => void title.commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") title.cancel();
            }}
          />
        ) : undefined
      }
      actions={
        <>
          {item.section === "pinned" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={INBOX_ACTION_BUTTON_CLASS}
                    aria-label="Unpin task"
                    disabled={actionsDisabled}
                    onClick={() => void onAction(item, "unpin")}
                  />
                }
              >
                <PinOff aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Unpin</TooltipContent>
            </Tooltip>
          ) : null}
          {item.canSettle && !actionsDisabled ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn("h-6 gap-0.5 px-2 text-micro!", INBOX_ACTION_BUTTON_CLASS)}
                    aria-label="Settle task"
                    onClick={() => void onAction(item, "settle")}
                  />
                }
              >
                <Check aria-hidden="true" />
                Settle
              </TooltipTrigger>
              <TooltipContent>Settle</TooltipContent>
            </Tooltip>
          ) : null}
          {onSnooze ? (
            <SnoozeButton item={item} onSnooze={onSnooze} disabled={actionsDisabled} />
          ) : null}
        </>
      }
    />
  );
  return (
    <SessionContextMenu
      trigger={row}
      session={item.session}
      project={item.project}
      moveDisabled={item.running}
      snoozeDisabled={actionsDisabled}
      onSnooze={onSnooze ? (until) => onSnooze(item, until) : undefined}
      onRename={title.start}
    >
      <ContextMenuItem
        disabled={actionsDisabled}
        onClick={() => void onAction(item, item.section === "pinned" ? "unpin" : "pin")}
      >
        {item.section === "pinned" ? "Unpin" : "Pin"}
      </ContextMenuItem>
    </SessionContextMenu>
  );
}, sameInboxCardProps);

function sameInboxCardProps(previous: InboxRowProps, next: InboxRowProps): boolean {
  const location = vcsLocationKey(previous.item.session.location);
  return (
    sameInboxSessionView(previous.item, next.item) &&
    previous.selectedID === next.selectedID &&
    previous.onSelect === next.onSelect &&
    previous.onPreload === next.onPreload &&
    previous.onAction === next.onAction &&
    previous.onSnooze === next.onSnooze &&
    previous.actionsDisabled === next.actionsDisabled &&
    location === vcsLocationKey(next.item.session.location) &&
    previous.branches?.get(location) === next.branches?.get(location)
  );
}

export function SnoozeButton({
  item,
  onSnooze,
  disabled,
}: {
  item: InboxSessionView;
  onSnooze(item: InboxSessionView, until: number): void;
  disabled: boolean;
}) {
  const [displayNow] = useState(() => Date.now());
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn("-mr-0.5", INBOX_ACTION_BUTTON_CLASS)}
                  aria-label="Snooze task"
                  disabled={disabled}
                />
              }
            />
          }
        >
          <Clock3 aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Snooze</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
          {sessionSnoozeChoices.map(([label, resolve]) => (
            <DropdownMenuItem key={label} onClick={() => void onSnooze(item, resolve(Date.now()))}>
              <span>{label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatSnoozeMenuTime(resolve(displayNow))}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompactShelf({
  title,
  open,
  onOpenChange,
  items,
  ...props
}: SectionProps & { title: string; open: boolean; onOpenChange(value: boolean): void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <SectionTrigger title={title} count={items.length} open={open} />
      <CollapsibleContent>
        <div className="space-y-px pb-2">
          {items.map((item) => (
            <CompactRow key={item.session.id} item={item} {...props} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SectionTrigger({
  title,
  count,
  open,
  badge,
  action,
  label,
}: {
  title: string;
  count: number;
  open: boolean;
  badge?: ReactNode;
  action?: ReactNode;
  label?: string;
}) {
  const trigger = (
    <CollapsibleTrigger
      render={
        <button
          type="button"
          aria-label={label}
          className={cn(
            sidebarSectionTriggerVariants(),
            action && "col-span-3 col-start-1 row-start-1 grid grid-cols-subgrid",
          )}
        />
      }
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{title}</span>
        {badge}
      </span>
      {action ? <span className="w-7" aria-hidden="true" /> : null}
      <span className="ml-auto flex items-center">
        <span className="ml-auto mr-2 text-micro text-sidebar-foreground/45 tabular-nums transition-colors group-hover/section-label:text-sidebar-foreground/70 group-focus-visible/section-label:text-sidebar-foreground/70">
          {count}
        </span>
        {open ? (
          <ChevronDown className={sidebarSectionIconVariants()} aria-hidden="true" />
        ) : (
          <ChevronRight
            className={sidebarSectionIconVariants({ direction: "right" })}
            aria-hidden="true"
          />
        )}
      </span>
    </CollapsibleTrigger>
  );
  return action ? (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center">
      {trigger}
      <div className="relative z-10 col-start-2 row-start-1 flex items-center justify-center">
        {action}
      </div>
    </div>
  ) : (
    trigger
  );
}

const CompactRow = memo(function CompactRow({
  item,
  selectedID,
  onSelect,
  onPreload,
  onAction,
  onSnooze,
  actionsDisabled,
}: InboxRowProps) {
  const windowDrag = useSessionWindowDrag(item.session.id);
  const action = item.section === "snoozed" ? "wake" : "inbox";
  const row = (
    <InboxCompactRowSurface
      item={item}
      selected={selectedID === item.session.id}
      hint={windowDrag.hint}
      buttonProps={{
        ...windowDrag.handleProps,
        onClick: () => onSelect(item.session.id),
        onMouseEnter: () => onPreload(item.session.id),
        onFocus: () => onPreload(item.session.id),
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size={action === "wake" ? "sm" : "icon-sm"}
              className={cn(
                "absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover/compact:opacity-100 group-has-[:focus-visible]/compact:opacity-100",
                INBOX_ACTION_BUTTON_CLASS,
              )}
              aria-label={action === "wake" ? "Wake task" : "Unsettle task"}
              disabled={actionsDisabled}
              onClick={() => void onAction(item, action)}
            />
          }
        >
          {action === "wake" ? <BellRing aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
          {action === "wake" ? "Wake" : null}
        </TooltipTrigger>
        <TooltipContent>{action === "wake" ? "Wake" : "Unsettle"}</TooltipContent>
      </Tooltip>
    </InboxCompactRowSurface>
  );
  return (
    <SessionContextMenu
      trigger={row}
      session={item.session}
      project={item.project}
      snoozeDisabled={actionsDisabled}
      onSnooze={onSnooze ? (until) => onSnooze(item, until) : undefined}
    >
      <ContextMenuItem disabled={actionsDisabled} onClick={() => void onAction(item, "pin")}>
        Pin
      </ContextMenuItem>
      <ContextMenuItem disabled={actionsDisabled} onClick={() => void onAction(item, action)}>
        {action === "wake" ? "Wake" : "Unsettle"}
      </ContextMenuItem>
    </SessionContextMenu>
  );
}, sameCompactRowProps);

export function InboxCompactRowSurface({
  item,
  selected,
  hint,
  buttonProps,
  connectionBadge,
  children,
  ...props
}: ComponentProps<"div"> & {
  item: InboxSessionView;
  selected: boolean;
  hint?: ReactNode;
  buttonProps: ComponentProps<"button">;
  connectionBadge?: ReactNode;
  children?: ReactNode;
}) {
  const visualState = inboxSessionState(item, !selected && catalogSessionIsUnread(item.session));
  return (
    <div
      {...props}
      className={cn("group/compact relative", props.className)}
      data-inbox-compact-row
    >
      {hint}
      <button
        {...buttonProps}
        type="button"
        className={cn(
          "flex w-full cursor-grab items-center text-left active:cursor-grabbing",
          sidebarItemVariants(),
          selected && "bg-(--palot-sidebar-selected)",
          buttonProps.className,
        )}
      >
        {item.section === "snoozed" ? <Clock3 aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1 truncate text-compact font-normal">
          {item.session.title ?? "Untitled task"}
        </span>
        {connectionBadge}
        <span className="flex min-w-0 max-w-28 shrink-0 items-center gap-1 text-right text-micro text-muted-foreground group-hover/compact:opacity-0 group-has-[:focus-visible]/compact:opacity-0">
          {item.section === "snoozed" && item.snoozedUntil ? (
            <>
              <InboxStateGlyph state={visualState} />
              {formatSnoozeWakeTime(item.snoozedUntil)}
            </>
          ) : (
            <>
              <span className="truncate">{item.projectName}</span>
              <span className="flex shrink-0 items-center gap-1">
                · <InboxStateGlyph state={visualState} />
                {formatRelativeTime(sessionActivityAt(item.session))}
              </span>
            </>
          )}
        </span>
      </button>
      {children}
    </div>
  );
}

function sameCompactRowProps(previous: InboxRowProps, next: InboxRowProps): boolean {
  return (
    sameInboxSessionView(previous.item, next.item) &&
    previous.selectedID === next.selectedID &&
    previous.onSelect === next.onSelect &&
    previous.onPreload === next.onPreload &&
    previous.onAction === next.onAction &&
    previous.onSnooze === next.onSnooze &&
    previous.actionsDisabled === next.actionsDisabled
  );
}
