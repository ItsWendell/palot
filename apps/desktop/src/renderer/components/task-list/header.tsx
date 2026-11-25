/**
 * The column's header (New task, search, View), the filter chips that show only while a
 * filter is active, and the default footer line. Ported from the prototype's `ui/column.tsx`
 * without its experiments.
 */

import { ChevronDown, MessageCircle, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShortcutKbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatShortcut, shortcutAriaKeys, useShortcutKeys } from "@/lib/keyboard-shortcuts";
import { formatClockTime } from "@/lib/task-list/model/format";
import { CHATS, type Ordering, type StateFilter } from "@/lib/task-list/model/sections";
import {
  customizedKnobs,
  describeView,
  DETAIL_CHOICES,
  GROUPING_CHOICES,
  WORKING_CHOICES,
} from "@/lib/task-list/model/view";
import { useController, useTaskList } from "./context";
import { unreadInView } from "./controller";

const HEADER_BUTTON =
  "text-sidebar-foreground/55 hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/90 focus-visible:ring-inset";

export function ColumnHeader({
  onSearch,
  viewMenuItems,
}: {
  onSearch?: () => void;
  viewMenuItems?: ReactNode;
}) {
  const controller = useController();
  const newTaskKeys = useShortcutKeys("task.new");
  const newChatKeys = useShortcutKeys("chat.new");
  const searchKeys = useShortcutKeys("palette.open");
  return (
    <div data-slot="task-list-header" className="flex h-9 shrink-0 items-center gap-0.5 px-2 pb-1">
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div className="group/new relative flex h-7 min-w-0 flex-1 items-center rounded-md transition-colors hover:bg-(--palot-sidebar-hover)" />
          }
        >
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-sm text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset [&_[data-icon]]:size-(--theme-ui-icon-size) [&_svg]:size-(--theme-ui-icon-size)"
            aria-keyshortcuts={shortcutAriaKeys(newTaskKeys)}
            onClick={() => controller.startTask()}
          >
            <AppIcon name="add" aria-hidden="true" />
            <span className="truncate">New task</span>
            {newTaskKeys.length ? (
              <ShortcutKbd
                keys={newTaskKeys}
                className="ml-auto hidden group-hover/new:flex"
                keyClassName="h-4 min-w-4 bg-transparent px-0.5"
              />
            ) : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="More ways to start"
                  className="mr-0.5 text-sidebar-foreground/50 opacity-0 transition-opacity group-hover/new:opacity-100 focus-visible:opacity-100 hover:bg-transparent! hover:text-sidebar-foreground data-popup-open:opacity-100"
                />
              }
            >
              <ChevronDown aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => controller.startTask()}>
                <AppIcon name="add" aria-hidden="true" />
                New task
                {newTaskKeys.length ? (
                  <DropdownMenuShortcut>{formatShortcut(newTaskKeys)}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => controller.startTask(null)}>
                <MessageCircle aria-hidden="true" />
                New chat without a project
                {newChatKeys.length ? (
                  <DropdownMenuShortcut>{formatShortcut(newChatKeys)}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={() => controller.startTask(null)}>
            <MessageCircle aria-hidden="true" />
            New chat without a project
            {newChatKeys.length ? (
              <ContextMenuShortcut>{formatShortcut(newChatKeys)}</ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {onSearch ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search tasks"
                aria-keyshortcuts={shortcutAriaKeys(searchKeys)}
                className={HEADER_BUTTON}
                onClick={onSearch}
              />
            }
          >
            <AppIcon name="search" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>
            Search tasks {searchKeys.length ? <ShortcutKbd keys={searchKeys} /> : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <ViewMenu extraItems={viewMenuItems} />
    </div>
  );
}

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "needs-you", label: "Needs you" },
  { value: "working", label: "Working" },
  { value: "unseen", label: "Finished, unseen" },
  { value: "failed", label: "Failed" },
];

/** One View knob: a small labelled radio group. */
function Knob<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: (value: T) => boolean;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="pb-0.5">{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
        {choices.map((choice) => (
          <DropdownMenuRadioItem
            key={choice.value}
            value={choice.value}
            closeOnClick={false}
            disabled={disabled?.(choice.value)}
          >
            {choice.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/**
 * Everything about arrangement in one menu: the three knobs, then ordering, filters, show
 * snoozed and settled, expand and collapse, load older, and the app's entries.
 */
function ViewMenu({ extraItems }: { extraItems?: ReactNode }) {
  const controller = useController();
  const options = useTaskList((state) => state.options);
  const view = useTaskList((state) => state.view);
  const customized = customizedKnobs(view).length > 0;
  const projects = useTaskList((state) => state.projects);
  const servers = useTaskList((state) => state.servers);
  const { filters } = options;
  const filtered = Boolean(filters.project || filters.states.length || filters.server);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={customized ? "View, customized" : "View"}
                  className={cn(HEADER_BUTTON, "relative")}
                />
              }
            />
          }
        >
          <SlidersHorizontal aria-hidden="true" />
          {customized ? (
            <span
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-sidebar"
              aria-hidden="true"
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pt-2 pb-1">
            <span className="block text-sm font-medium text-foreground">View</span>
            <span className="mt-0.5 block text-meta leading-snug font-normal text-muted-foreground">
              {describeView(view)}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <Knob
          label="Group by"
          value={view.grouping}
          choices={GROUPING_CHOICES}
          onChange={(grouping) => controller.setView({ grouping })}
          disabled={(value) => value === "server" && servers.length < 2}
        />
        <Knob
          label="Working tasks"
          value={view.working}
          choices={WORKING_CHOICES}
          onChange={(working) => controller.setView({ working })}
        />
        <Knob
          label="Row detail"
          value={view.rowDetail}
          choices={DETAIL_CHOICES}
          onChange={(rowDetail) => controller.setView({ rowDetail })}
        />
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Order by
            <span className="ml-auto text-meta text-muted-foreground">
              {options.ordering === "activity" ? "Activity" : "Created"}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup
              value={options.ordering}
              onValueChange={(value) => controller.setOrdering(value as Ordering)}
            >
              <DropdownMenuRadioItem value="activity">Last activity</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Filter
            {filtered ? (
              <span className="ml-auto size-1.5 rounded-full bg-info" aria-label="active" />
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Project</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup
                  value={filters.project ?? ""}
                  onValueChange={(value) =>
                    controller.setFilters((current) => ({
                      ...current,
                      project: (value as string) || null,
                    }))
                  }
                >
                  {/* A chat is a task with no project; chats filter like a project. */}
                  <DropdownMenuRadioItem value={CHATS}>
                    <MessageCircle aria-hidden="true" />
                    Chats
                  </DropdownMenuRadioItem>
                  {projects.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      {project.name}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem value="">All projects</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>State</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {STATE_FILTERS.map((state) => (
                  <DropdownMenuCheckboxItem
                    key={state.value}
                    closeOnClick={false}
                    checked={filters.states.includes(state.value)}
                    onCheckedChange={(checked) =>
                      controller.setFilters((current) => ({
                        ...current,
                        states: checked
                          ? [...current.states, state.value]
                          : current.states.filter((value) => value !== state.value),
                      }))
                    }
                  >
                    {state.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {servers.length > 1 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Server</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuRadioGroup
                    value={filters.server ?? ""}
                    onValueChange={(value) =>
                      controller.setFilters((current) => ({
                        ...current,
                        server: (value as string) || null,
                      }))
                    }
                  >
                    <DropdownMenuRadioItem value="">All servers</DropdownMenuRadioItem>
                    {servers.map((server) => (
                      <DropdownMenuRadioItem key={server.id} value={server.id}>
                        {server.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          closeOnClick={false}
          checked={options.showSnoozed}
          onCheckedChange={(showSnoozed) => controller.setShow({ showSnoozed })}
        >
          Show snoozed
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          closeOnClick={false}
          checked={options.showSettled}
          onCheckedChange={(showSettled) => controller.setShow({ showSettled })}
        >
          Show settled
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => controller.setAllGroups(true)}>
          Expand all
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => controller.setAllGroups(false)}>
          Collapse all
        </DropdownMenuItem>
        <LoadOlderItem />
        <MarkAllReadItem />
        {extraItems}
        {customized ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem closeOnClick={false} onClick={() => controller.resetView()}>
              <span className="text-muted-foreground">Customized ·</span>
              Reset to defaults
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MarkAllReadItem() {
  const controller = useController();
  const count = useTaskList((state) => unreadInView(state).length);
  return (
    <DropdownMenuItem disabled={count === 0} onClick={() => void controller.markAllRead()}>
      Mark all as read
    </DropdownMenuItem>
  );
}

function LoadOlderItem() {
  const controller = useController();
  const hasOlder = useTaskList((state) => state.hasOlder);
  const loading = useTaskList((state) => state.loadingOlder);
  return (
    <DropdownMenuItem disabled={!hasOlder || loading} onClick={() => controller.loadOlder()}>
      {loading ? "Loading older tasks…" : "Load older tasks"}
    </DropdownMenuItem>
  );
}

/** One removable chip per active filter, and nothing at all otherwise. */
export function FilterChips() {
  const controller = useController();
  const filters = useTaskList((state) => state.options.filters);
  const projects = useTaskList((state) => state.projects);
  const servers = useTaskList((state) => state.servers);
  const chips: { key: string; label: string; clear(): void }[] = [];
  if (filters.project)
    chips.push({
      key: "project",
      label:
        filters.project === CHATS
          ? "Chats"
          : `Project: ${projects.find((project) => project.id === filters.project)?.name ?? filters.project}`,
      clear: () => controller.setFilters((current) => ({ ...current, project: null })),
    });
  if (filters.states.length)
    chips.push({
      key: "state",
      label: `State: ${filters.states.map((state) => STATE_FILTERS.find((item) => item.value === state)?.label).join(", ")}`,
      clear: () => controller.setFilters((current) => ({ ...current, states: [] })),
    });
  if (filters.server)
    chips.push({
      key: "server",
      label: `Server: ${servers.find((server) => server.id === filters.server)?.name ?? filters.server}`,
      clear: () => controller.setFilters((current) => ({ ...current, server: null })),
    });
  if (chips.length === 0) return null;
  return (
    <div data-slot="task-list-filters" className="flex shrink-0 flex-wrap gap-1 px-2.5 pb-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-5 max-w-full items-center gap-0.5 rounded-full bg-sidebar-accent pr-0.5 pl-2 text-micro text-sidebar-foreground/80"
        >
          <span className="truncate">{chip.label}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${chip.label}`}
            className="size-4 rounded-full text-sidebar-foreground/55 hover:bg-transparent! hover:text-sidebar-foreground"
            onClick={chip.clear}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
    </div>
  );
}

/**
 * The default footer: one quiet line with the connection state, or a notice with Reconnect
 * when a server is offline. The app replaces it with its Palot menu through `footer`.
 */
/** The footer's warning when a server is offline, with Reconnect; nothing while all are online. */
export function ConnectionNotice() {
  const controller = useController();
  const servers = useTaskList((state) => state.servers);
  const offline = servers.filter((server) => !server.online);
  if (offline.length === 0) return null;
  const first = offline[0]!;
  const label =
    servers.length === 1
      ? "OpenCode disconnected"
      : `${first.name} offline${offline.length > 1 ? ` (+${offline.length - 1})` : ""}`;
  return (
    <div
      data-slot="task-list-footer"
      className="flex shrink-0 items-center gap-2 border-t border-sidebar-border/60 px-3 py-2 text-meta"
    >
      <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sidebar-foreground/85">{label}</span>
        {first.lastSeenAt ? (
          <span className="block truncate text-micro text-sidebar-foreground/45">
            Last seen {formatClockTime(first.lastSeenAt)}
          </span>
        ) : null}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="text-meta"
        onClick={() => controller.reconnect(offline.length === 1 ? first.id : undefined)}
      >
        Reconnect
      </Button>
    </div>
  );
}

export function ColumnFooter() {
  const servers = useTaskList((state) => state.servers);
  if (servers.some((server) => !server.online)) return <ConnectionNotice />;
  const summary =
    servers.length <= 1
      ? "OpenCode connected"
      : `${servers.length} of ${servers.length} servers connected`;
  return (
    <div
      data-slot="task-list-footer"
      className="flex h-9 shrink-0 items-center gap-2 px-4 pb-1 text-meta text-sidebar-foreground/50"
    >
      <span className="size-1.5 rounded-full bg-success/80" aria-hidden="true" />
      <span className="truncate">{summary}</span>
    </div>
  );
}
