import { useEffect, useEffectEvent, useState, type ReactElement, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { Check, Ellipsis, LoaderCircle, PinOff, Plus, Server, Undo2 } from "lucide-react";
import type { SessionTriageCommand } from "../../shared";
import {
  inboxFiltersAtom,
  inboxShelvesAtom,
  inboxViewPreferencesAtom,
  sidebarModeAtom,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { overviewProjectFilterAtom, overviewProjectSectionsAtom } from "../atoms/connections";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionWindowDrag } from "../hooks/use-session-window-drag";
import { useOwnedVcsInfoMap, ownedVcsLocationKey } from "../hooks/use-vcs-info";
import { orderInboxSessions, type InboxSection, type InboxSessionView } from "../lib/session-inbox";
import { projectName } from "../lib/view-models";
import { showErrorToast } from "../lib/toast-error";
import { ConnectionBadge, connectionDescription } from "./connection-badge";
import { SessionContextMenu } from "./session-context-menu";
import { ContextMenuItem } from "./ui/context-menu";
import {
  InboxToolbar,
  SectionTrigger,
  SnoozeButton,
  InboxCompactRowSurface,
} from "./inbox-sidebar";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { sessionSnoozeChoices } from "../lib/session-snooze";
import { InboxCardSurface, INBOX_CARD_ACTION_BUTTON_CLASS } from "./inbox-card-surface";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarContent } from "./ui/sidebar";
import { ScrollArea } from "./ui/scroll-area";
import { sidebarItemVariants } from "./ui/sidebar-styles";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Overview = ReturnType<typeof useConnectionOverview>;
type Connection = Overview["connections"][number];
type OwnedItem = InboxSessionView & { connection: Connection };
type Command = SessionTriageCommand extends infer C
  ? C extends SessionTriageCommand
    ? Omit<C, "profileID">
    : never
  : never;
const sections: InboxSection[] = ["pinned", "inbox", "snoozed", "settled"];
const pageSize = 40;

/** The same interaction layer owns every row density, with an explicit server. */
function OwnedSessionInteractions({
  item,
  disabled,
  onRename,
  onSnooze,
  renderRow,
  children,
}: {
  item: OwnedItem;
  disabled: boolean;
  onRename(): void;
  onSnooze(until: number): void;
  renderRow(drag: ReturnType<typeof useSessionWindowDrag>): ReactElement;
  children: ReactNode;
}) {
  const owner = item.connection.phase === "ready" ? (item.connection.runtime ?? null) : null;
  const drag = useSessionWindowDrag(item.session.id, owner);
  return (
    <SessionContextMenu
      owner={owner}
      disabled={disabled}
      trigger={renderRow(drag)}
      session={item.session}
      project={item.project}
      moveDisabled={item.running || disabled}
      snoozeDisabled={disabled}
      onRename={disabled ? undefined : onRename}
      onSnooze={onSnooze}
    >
      {children}
    </SessionContextMenu>
  );
}

async function attempt(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    showErrorToast(label, error);
  }
}

export function MultiConnectionSidebar({ searchOpen = false }: { searchOpen?: boolean }) {
  const overview = useConnectionOverview();
  const navigation = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const mode = useAtomValue(sidebarModeAtom);
  const [preferences, setPreferences] = useAtom(inboxViewPreferencesAtom);
  const [inboxFilters, setInboxFilters] = useAtom(inboxFiltersAtom);
  const [projectFilter, setProjectFilter] = useAtom(overviewProjectFilterAtom);
  const [projectSections, setProjectSections] = useAtom(overviewProjectSectionsAtom);
  const filters = { ...inboxFilters, projectID: projectFilter };
  const [shelves, setShelves] = useAtom(inboxShelvesAtom);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [renameItem, setRenameItem] = useState<OwnedItem | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const renameConnection = overview.connections.find(
    (connection) => connection.profile.id === renameItem?.connection.profile.id,
  );
  const canRename =
    renameConnection?.runtime?.connected === true &&
    renameConnection.phase === "ready" &&
    renameConnection.triageReady;
  const selectedID = useRouterState({
    select: (state) =>
      state.matches
        .map((match) => (match.params as { sessionID?: string }).sessionID)
        .find(Boolean),
  });
  const included = overview.connections.filter((c) =>
    overview.includedProfileIDs.includes(c.profile.id),
  );
  const visible = included.filter(
    (c) => overview.visibleProfileIDs === null || overview.visibleProfileIDs.includes(c.profile.id),
  );
  const projects = included.flatMap((connection) =>
    connection.projects.map((project) => ({
      ...project,
      id: JSON.stringify([connection.profile.id, project.id]),
      name: `${projectName(project)} · ${connectionDescription(connection.profile)}`,
    })),
  );
  // Resolve only catalog-backed owner/project pairs. A stale or unmonitored
  // selection remains escapable through All projects / Clear filters.
  const projectOwner = included.find((connection) =>
    connection.projects.some(
      (project) => JSON.stringify([connection.profile.id, project.id]) === projectFilter,
    ),
  );
  const selectedProjectID = projectOwner?.projects.find(
    (project) => JSON.stringify([projectOwner.profile.id, project.id]) === projectFilter,
  )?.id;
  const selectedProjectProfileID = projectOwner?.profile.id;
  const selectedProjectConnectionID = projectOwner?.runtime?.connectionID;
  const projectOwnerReady =
    projectOwner?.runtime?.connected === true && projectOwner.phase === "ready";
  const hydrateProject = useEffectEvent((profileID: string, projectID: string) => {
    void attempt("Could not load project tasks", () => overview.loadProject(profileID, projectID));
  });
  useEffect(() => {
    if (
      projectOwnerReady &&
      selectedProjectProfileID &&
      selectedProjectID &&
      selectedProjectConnectionID
    ) {
      hydrateProject(selectedProjectProfileID, selectedProjectID);
    }
  }, [projectOwnerReady, selectedProjectProfileID, selectedProjectID, selectedProjectConnectionID]);
  const matches = (item: OwnedItem) => {
    if (
      filters.projectID &&
      filters.projectID !== JSON.stringify([item.connection.profile.id, item.session.projectID])
    )
      return false;
    if (
      query.trim() &&
      !`${item.session.title} ${item.projectName} ${connectionDescription(item.connection.profile)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
      return false;
    return (
      filters.states.length === 0 ||
      filters.states.some((state) =>
        state === "unread"
          ? item.session.idleAt !== undefined &&
            (item.session.viewedAt === undefined || item.session.viewedAt < item.session.idleAt)
          : state === "attention"
            ? item.attention
            : state === "running"
              ? item.running
              : item.failed,
      )
    );
  };
  const items = visible
    .flatMap((connection) =>
      sections.flatMap((section) =>
        connection.inbox[section].map((item) => ({ ...item, connection })),
      ),
    )
    .filter(matches);
  const ordered = (list: OwnedItem[]) => orderInboxSessions(list, preferences) as OwnedItem[];
  const rowKey = (item: OwnedItem) => JSON.stringify([item.connection.profile.id, item.session.id]);
  let richRemaining = limit;
  const richLocations =
    mode === "inbox"
      ? (["pinned", "inbox"] as const).flatMap((section) => {
          if (!shelves[section]) return [];
          const rows = ordered(items.filter((item) => item.section === section)).slice(
            0,
            richRemaining,
          );
          richRemaining -= rows.length;
          return rows.flatMap((item) => {
            const owner = item.connection.runtime;
            return owner?.connected && item.connection.phase === "ready"
              ? [{ connectionID: owner.connectionID, location: item.session.location }]
              : [];
          });
        })
      : [];
  const branches = useOwnedVcsInfoMap(richLocations);
  const run = async (item: OwnedItem, action: () => Promise<unknown>) => {
    const key = rowKey(item);
    setBusy((current) => new Set(current).add(key));
    await attempt(`Could not update task on ${item.connection.profile.name}`, action);
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const dispatch = (item: OwnedItem, command: Command) =>
    void run(item, () => overview.dispatch(item.connection.profile.id, command));
  const renderRow = (item: OwnedItem) => {
    const { connection, session } = item;
    const connected = connection.runtime?.connected === true && connection.phase === "ready";
    const disabled = !connected || !connection.triageReady || busy.has(rowKey(item));
    const command = (type: "pin" | "unpin" | "inbox" | "wake") =>
      dispatch(item, { type, sessionID: session.id, at: Date.now() });
    const selected = selectedID === session.id && runtime?.profileID === connection.profile.id;
    const preload = () => {
      if (connected) void navigation.preloadSession(session.id, connection.profile.id);
    };
    const buttonProps = {
      "aria-current": selected ? ("page" as const) : undefined,
      "aria-label": `${session.title} · ${connectionDescription(connection.profile)}`,
      title: `${session.title ?? "Untitled task"} · ${connectionDescription(connection.profile)} · ${connected ? "Connected" : "Disconnected"}`,
      onClick: () =>
        void attempt("Could not open task", () =>
          navigation.openSession(session.id, { profileID: connection.profile.id }),
        ),
      onPointerEnter: preload,
      onFocus: preload,
    };
    const startRename = () => {
      setRenameItem(item);
      setTitle(session.title ?? "");
    };
    const settle = () =>
      dispatch(item, {
        type: "settle",
        sessionID: session.id,
        at: Date.now(),
        through: item.activityThrough,
      });
    const badge =
      connection.profile.kind === "local" ? null : (
        <ConnectionBadge
          profile={connection.profile}
          connected={connected}
          compact
          iconOnly={mode === "inbox" && (item.section === "pinned" || item.section === "inbox")}
        />
      );
    const menu = (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={mode === "inbox" ? INBOX_CARD_ACTION_BUTTON_CLASS : undefined}
              aria-label={`Actions for ${session.title} on ${connectionDescription(connection.profile)}`}
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{connectionDescription(connection.profile)}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => command(item.pinnedAt !== null ? "unpin" : "pin")}
          >
            {item.pinnedAt !== null ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          {item.section === "settled" ? (
            <DropdownMenuItem disabled={disabled} onClick={() => command("inbox")}>
              Move to inbox
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={disabled || !item.canSettle}
              onClick={() =>
                dispatch(item, {
                  type: "settle",
                  sessionID: session.id,
                  at: Date.now(),
                  through: item.activityThrough,
                })
              }
            >
              Settle
            </DropdownMenuItem>
          )}
          {item.section === "snoozed" ? (
            <DropdownMenuItem disabled={disabled} onClick={() => command("wake")}>
              Wake
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={disabled}>Snooze until</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {sessionSnoozeChoices.map(([label, resolve]) => (
                  <DropdownMenuItem
                    key={label}
                    onClick={() =>
                      dispatch(item, {
                        type: "snooze",
                        sessionID: session.id,
                        at: Date.now(),
                        until: resolve(Date.now()),
                        through: item.activityThrough,
                      })
                    }
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={disabled} onClick={startRename}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || item.running || item.attention}
            onClick={() =>
              void run(item, () => overview.archive(connection.profile.id, session.id))
            }
          >
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    return (
      <OwnedSessionInteractions
        key={rowKey(item)}
        item={item}
        disabled={disabled}
        onRename={startRename}
        onSnooze={(until) =>
          dispatch(item, {
            type: "snooze",
            sessionID: session.id,
            at: Date.now(),
            until,
            through: item.activityThrough,
          })
        }
        renderRow={(windowDrag) => {
          if (mode === "inbox" && (item.section === "pinned" || item.section === "inbox"))
            return (
              <InboxCardSurface
                key={rowKey(item)}
                item={item}
                hint={windowDrag.hint}
                vcs={
                  connection.runtime
                    ? branches.get(
                        ownedVcsLocationKey({
                          connectionID: connection.runtime.connectionID,
                          location: session.location,
                        }),
                      )
                    : undefined
                }
                selected={selected}
                profileID={connection.profile.id}
                connectionBadge={badge}
                buttonProps={{
                  ...windowDrag.handleProps,
                  ...buttonProps,
                  className: connected ? "cursor-grab active:cursor-grabbing" : undefined,
                  onDoubleClick: (event) => {
                    event.preventDefault();
                    if (!disabled) startRename();
                  },
                }}
                actions={
                  <>
                    {item.pinnedAt !== null ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Unpin task"
                        className={INBOX_CARD_ACTION_BUTTON_CLASS}
                        disabled={disabled}
                        onClick={() => command("unpin")}
                      >
                        <PinOff aria-hidden="true" />
                      </Button>
                    ) : null}
                    {item.canSettle && !disabled ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-6 gap-0.5 px-2 text-micro!",
                          INBOX_CARD_ACTION_BUTTON_CLASS,
                        )}
                        aria-label="Settle task"
                        onClick={settle}
                      >
                        <Check aria-hidden="true" />
                        Settle
                      </Button>
                    ) : null}
                    <SnoozeButton
                      item={item}
                      disabled={disabled}
                      onSnooze={(_, until) =>
                        dispatch(item, {
                          type: "snooze",
                          sessionID: session.id,
                          at: Date.now(),
                          until,
                          through: item.activityThrough,
                        })
                      }
                    />
                    {menu}
                  </>
                }
              />
            );
          if (mode === "inbox")
            return (
              <InboxCompactRowSurface
                key={rowKey(item)}
                item={item}
                selected={selected}
                hint={windowDrag.hint}
                buttonProps={{ ...windowDrag.handleProps, ...buttonProps }}
                connectionBadge={badge}
              >
                <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/compact:opacity-100 group-has-[:focus-visible]/compact:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={item.section === "snoozed" ? "Wake task" : "Unsettle task"}
                    disabled={disabled}
                    onClick={() => command(item.section === "snoozed" ? "wake" : "inbox")}
                  >
                    <Undo2 aria-hidden="true" />
                  </Button>
                  {menu}
                </div>
              </InboxCompactRowSurface>
            );
          return (
            <div key={rowKey(item)} className="group flex min-w-0 items-center gap-0.5">
              {windowDrag.hint}
              <button
                type="button"
                {...windowDrag.handleProps}
                {...buttonProps}
                className={sidebarItemVariants({
                  className: cn(
                    "flex min-w-0 flex-1 items-center gap-2",
                    connected && "cursor-grab active:cursor-grabbing",
                  ),
                })}
                data-active={selected}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {session.title ?? "Untitled task"}
                </span>
                {item.attention || item.failed || item.running ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-info"
                    role="img"
                    aria-label={
                      item.attention ? "Needs attention" : item.running ? "Working" : "Failed"
                    }
                  />
                ) : null}
                {badge}
              </button>
              {menu}
            </div>
          );
        }}
      >
        <ContextMenuItem
          disabled={disabled}
          onClick={() => command(item.pinnedAt !== null ? "unpin" : "pin")}
        >
          {item.pinnedAt !== null ? "Unpin" : "Pin"}
        </ContextMenuItem>
        {item.section === "settled" ? (
          <ContextMenuItem disabled={disabled} onClick={() => command("inbox")}>
            Move to inbox
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={disabled || !item.canSettle} onClick={settle}>
            Settle
          </ContextMenuItem>
        )}
        {item.section === "snoozed" ? (
          <ContextMenuItem disabled={disabled} onClick={() => command("wake")}>
            Wake
          </ContextMenuItem>
        ) : null}
      </OwnedSessionInteractions>
    );
  };
  let remaining = limit;
  const boundedRows = (list: OwnedItem[]) => {
    const rows = list.slice(0, remaining);
    remaining -= rows.length;
    return rows.map(renderRow);
  };

  return (
    <>
      <InboxToolbar
        projects={projects}
        filters={filters}
        onFiltersChange={(update) => {
          const next = typeof update === "function" ? update(filters) : update;
          setProjectFilter(next.projectID);
          setInboxFilters((current) => ({ ...current, states: next.states }));
          setLimit(pageSize);
        }}
        viewPreferences={preferences}
        onViewPreferencesChange={setPreferences}
        onShelvesChange={(update) => {
          if (mode === "inbox") {
            setShelves(update);
            return;
          }
          // The toolbar's expand/collapse-all commands apply to the displayed mode.
          const next = typeof update === "function" ? update(shelves) : update;
          setProjectSections((current) => ({
            ...current,
            ...Object.fromEntries(
              visible.flatMap((connection) =>
                connection.projects.map((project) => [
                  JSON.stringify([connection.profile.id, project.id]),
                  next.inbox,
                ]),
              ),
            ),
          }));
        }}
        runtime={runtime}
        additionalFilterCount={Number(overview.visibleProfileIDs !== null)}
        onClearFilters={() => overview.setVisibleProfileIDs(null)}
        pagination={{
          hasNextPage: visible.some((c) => c.hasMore),
          isFetchingNextPage: visible.some((c) => c.loadingMore),
          loadMore: async () => {
            await Promise.all(
              visible
                .filter((c) => c.hasMore && c.runtime?.connected && c.phase === "ready")
                .map((c) =>
                  attempt(`Could not load tasks from ${c.profile.name}`, () =>
                    overview.loadMore(c.profile.id),
                  ),
                ),
            );
          },
        }}
        filterItems={
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-9">
              <Server aria-hidden="true" />
              <span>Servers</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-sm">
              <DropdownMenuItem onClick={() => overview.setVisibleProfileIDs(null)}>
                All servers
              </DropdownMenuItem>
              {included.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.profile.id}
                  closeOnClick={false}
                  checked={
                    overview.visibleProfileIDs === null ||
                    overview.visibleProfileIDs.includes(c.profile.id)
                  }
                  onCheckedChange={(checked) =>
                    overview.setVisibleProfileIDs(
                      checked
                        ? [
                            ...new Set([
                              ...(overview.visibleProfileIDs ?? overview.includedProfileIDs),
                              c.profile.id,
                            ]),
                          ]
                        : (overview.visibleProfileIDs ?? overview.includedProfileIDs).filter(
                            (id) => id !== c.profile.id,
                          ),
                    )
                  }
                >
                  {connectionDescription(c.profile)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        }
        optionItems={
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Enabled servers</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-sm">
                {overview.connections.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.profile.id}
                    closeOnClick={false}
                    checked={overview.includedProfileIDs.includes(c.profile.id)}
                    onCheckedChange={(checked) =>
                      overview.setIncludedProfileIDs(
                        checked
                          ? [...overview.includedProfileIDs, c.profile.id]
                          : overview.includedProfileIDs.filter((id) => id !== c.profile.id),
                      )
                    }
                  >
                    Enable {connectionDescription(c.profile)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {included.map((c) => (
                  <DropdownMenuItem
                    key={c.profile.id}
                    disabled={c.phase === "loading"}
                    onClick={() =>
                      void attempt("Could not refresh connection", () =>
                        c.runtime?.connected
                          ? overview.refresh(c.profile.id)
                          : overview.connect(c.profile.id),
                      )
                    }
                  >
                    {c.runtime?.connected ? "Refresh" : "Retry"} {connectionDescription(c.profile)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        }
      />
      <SidebarContent className="min-h-0 overflow-hidden">
        <ScrollArea className="h-full min-h-0">
          <div className="space-y-1 px-2 pt-0.5 pb-2">
            {searchOpen ? (
              <form
                className="flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  setLimit(pageSize);
                  void attempt("Could not search connections", () => overview.search(query));
                }}
              >
                <Input
                  aria-label="Search across connections"
                  placeholder="Search all connections…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(pageSize);
                  }}
                />
                <Button variant="ghost" size="sm" disabled={overview.searching} type="submit">
                  {overview.searching ? "Searching…" : "Search"}
                </Button>
              </form>
            ) : null}
            {visible.map((c) =>
              c.phase !== "ready" || !c.runtime?.connected || c.attentionState !== "ready" ? (
                <div
                  key={c.profile.id}
                  className="rounded-md px-2 py-1.5 text-meta text-muted-foreground"
                  role="status"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={connectionDescription(c.profile)}
                    >
                      {c.profile.name}
                    </span>
                    <ConnectionBadge
                      profile={c.profile}
                      connected={Boolean(c.runtime?.connected)}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {c.phase === "ready" && c.runtime?.connected ? (
                      <span>
                        {c.attentionState === "syncing"
                          ? "Syncing requests…"
                          : "Request status unavailable"}
                      </span>
                    ) : c.phase === "loading" ? (
                      <>
                        <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                        Connecting…
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate" title={c.error ?? undefined}>
                          {c.error ?? "Disconnected"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : null,
            )}
            {visible.length === 0 ? (
              <p className="px-2 text-meta text-muted-foreground">
                No servers visible. Choose servers in Filter tasks.
              </p>
            ) : null}
            {mode === "inbox"
              ? sections.map((section) => {
                  if (
                    (section === "snoozed" && !preferences.showSnoozed) ||
                    (section === "settled" && !preferences.showSettled)
                  )
                    return null;
                  const rows = ordered(items.filter((item) => item.section === section));
                  if (!rows.length && (section === "pinned" || section === "snoozed")) return null;
                  return (
                    <Collapsible
                      key={section}
                      open={shelves[section]}
                      onOpenChange={(open) => setShelves((s) => ({ ...s, [section]: open }))}
                    >
                      <SectionTrigger
                        title={section[0]!.toUpperCase() + section.slice(1)}
                        count={rows.length}
                        open={shelves[section]}
                      />
                      <CollapsibleContent>
                        {shelves[section] ? (
                          rows.length ? (
                            <div
                              className={
                                section === "pinned" || section === "inbox"
                                  ? "space-y-0.5"
                                  : "space-y-px pb-2"
                              }
                            >
                              {boundedRows(rows)}
                            </div>
                          ) : section === "inbox" ? (
                            <div className="px-2.5 py-4 text-xs text-muted-foreground">
                              {visible.some(
                                (c) => !c.runtime?.connected || c.attentionState === "error",
                              )
                                ? "Request status unavailable"
                                : visible.some((c) => c.attentionState !== "ready")
                                  ? "Checking for requests…"
                                  : visible.some((c) => c.hasMore)
                                    ? "No loaded tasks are in the inbox"
                                    : "Inbox is clear"}
                            </div>
                          ) : null
                        ) : null}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              : visible.flatMap((connection) =>
                  connection.projects.map((project) => {
                    const key = JSON.stringify([connection.profile.id, project.id]);
                    const open = projectSections[key] ?? true;
                    const rows = ordered(
                      items.filter(
                        (item) =>
                          item.connection.profile.id === connection.profile.id &&
                          item.session.projectID === project.id,
                      ),
                    );
                    return (
                      <Collapsible
                        key={key}
                        data-project-section
                        data-profile-id={connection.profile.id}
                        data-project-id={project.id}
                        open={open}
                        onOpenChange={(value) =>
                          setProjectSections((current) => ({ ...current, [key]: value }))
                        }
                        aria-label={`${projectName(project)} · ${connectionDescription(connection.profile)}`}
                      >
                        <SectionTrigger
                          title={projectName(project)}
                          count={rows.length}
                          open={open}
                          label={`${projectName(project)} ${rows.length} · ${connectionDescription(connection.profile)}`}
                          badge={
                            connection.profile.kind !== "local" ? (
                              <ConnectionBadge
                                profile={connection.profile}
                                connected={connection.runtime?.connected === true}
                                compact
                              />
                            ) : null
                          }
                          action={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`New task in ${projectName(project)} on ${connectionDescription(connection.profile)}`}
                              disabled={
                                !connection.runtime?.connected || connection.phase !== "ready"
                              }
                              onClick={() =>
                                void attempt("Could not open new task", () =>
                                  navigation.openNewTask(project.id, connection.profile.id),
                                )
                              }
                            >
                              <Plus aria-hidden="true" />
                            </Button>
                          }
                        />
                        <CollapsibleContent>{open ? boundedRows(rows) : null}</CollapsibleContent>
                      </Collapsible>
                    );
                  }),
                )}
            {items.length > limit ? (
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + pageSize)}>
                Show more tasks
              </Button>
            ) : null}
          </div>
        </ScrollArea>
      </SidebarContent>
      <Dialog
        open={renameItem !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setRenameItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename task</DialogTitle>
            <DialogDescription>
              {renameItem ? connectionDescription(renameItem.connection.profile) : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameItem || !title.trim() || !canRename) return;
              setSaving(true);
              void (async () => {
                try {
                  await overview.rename(
                    renameItem.connection.profile.id,
                    renameItem.session.id,
                    title.trim(),
                  );
                  setRenameItem(null);
                } catch (error) {
                  showErrorToast("Could not rename task", error);
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            <Input
              aria-label="Task title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
            <DialogFooter>
              <Button type="submit" disabled={saving || !title.trim() || !canRename}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
