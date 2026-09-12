import {
  FileDiff,
  FileCode2,
  Files,
  Gauge,
  PanelBottom,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { Component, Suspense, lazy, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";
import {
  workbenchTabTitle,
  type WorkbenchContextState,
  type WorkbenchPaneID,
  type WorkbenchScope,
  type WorkbenchTab,
} from "../../lib/workbench-tabs";
import { cn } from "../../lib/cn";
import { showErrorToast } from "../../lib/toast-error";
import { openNewWorkbenchTerminal } from "../../services/workbench-terminal";
import { Button } from "../ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

const ChangesTab = lazy(() =>
  import("../workbench-tabs/changes-tab").then((module) => ({ default: module.ChangesTab })),
);
const ContextTab = lazy(() =>
  import("../workbench-tabs/context-tab").then((module) => ({ default: module.ContextTab })),
);
const FileDiffTab = lazy(() =>
  import("../workbench-tabs/file-diff-tab").then((module) => ({ default: module.FileDiffTab })),
);
const FileTab = lazy(() =>
  import("../workbench-tabs/file-tab").then((module) => ({ default: module.FileTab })),
);
const TerminalTab = lazy(() =>
  import("../workbench-tabs/terminal-tab").then((module) => ({ default: module.TerminalTab })),
);
const CommandTab = lazy(() =>
  import("../workbench-tabs/command-tab").then((module) => ({ default: module.CommandTab })),
);

export function WorkbenchPane({
  pane,
  scope,
  context,
  location,
}: {
  pane: WorkbenchPaneID;
  scope: WorkbenchScope;
  context: WorkbenchContextState;
  location: { directory: string; workspaceID?: string };
}) {
  const runtime = useAtomValue(runtimeAtom);
  const state = context[pane];
  const commands = useWorkbenchCommands(scope);
  const closeTab = useCallback(
    (tab: WorkbenchTab) => {
      commands.closeTab(pane, tab.id);
    },
    [commands, pane],
  );
  const openTerminal = useCallback(async () => {
    if (runtime?.profileID !== scope.profileID)
      throw new Error("Focus this connection before opening a terminal");
    await openNewWorkbenchTerminal(
      scope.sessionID,
      location,
      commands.openTab,
      { pane },
      runtime?.connectionID,
    );
  }, [
    commands,
    location,
    pane,
    scope.sessionID,
    scope.profileID,
    runtime?.profileID,
    runtime?.connectionID,
  ]);
  const changesOpen = [...context.right.tabs, ...context.bottom.tabs].some(
    (tab) => tab.kind === "changes",
  );
  const contextOpen = [...context.right.tabs, ...context.bottom.tabs].some(
    (tab) => tab.kind === "context",
  );
  const openContext = useCallback(() => {
    commands.openTab({ kind: "context", location }, { pane });
  }, [commands, location, pane]);
  const openChanges = useCallback(() => {
    commands.openTab(
      {
        kind: "changes",
        location,
        mode: "working",
        sourceSessionID: scope.sessionID,
      },
      { pane },
    );
  }, [commands, location, pane, scope.sessionID]);

  return (
    <section
      className="palot-workbench-surface @container/workbench flex size-full min-h-0 min-w-0 flex-col bg-background"
      aria-label={pane === "right" ? "Right workbench" : "Bottom workbench"}
      data-workbench-pane={pane}
      data-shell-surface={pane}
    >
      <Tabs
        value={state.activeTabID}
        onValueChange={(value) => {
          if (typeof value === "string") commands.activateTab(pane, value);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <header
          className={cn(
            "palot-workbench-surface-header window-drag flex h-(--shell-header-height) min-h-(--shell-header-height) min-w-0 items-center bg-background",
            pane === "right" ? "pr-(--window-controls-width)" : "pr-2",
          )}
        >
          <TabsList
            variant="line"
            activateOnFocus
            className="window-no-drag h-full min-w-0 flex-1 justify-start gap-1 overflow-x-auto rounded-none px-2 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {state.tabs.map((tab) => (
              <WorkbenchTabItem
                key={tab.id}
                tab={tab}
                pane={pane}
                active={state.activeTabID === tab.id}
                closeTab={() => closeTab(tab)}
                moveTab={() =>
                  commands.moveTab(pane, pane === "right" ? "bottom" : "right", tab.id)
                }
                closeOtherTabs={() => {
                  commands.closeOtherTabs(pane, tab.id);
                }}
                closeTabsToEnd={() => {
                  commands.closeTabsToEnd(pane, tab.id);
                }}
                closeTabsToStart={() => {
                  const index = state.tabs.findIndex((candidate) => candidate.id === tab.id);
                  const tabs = state.tabs.slice(0, index);
                  for (const candidate of tabs) commands.closeTab(pane, candidate.id);
                }}
                closeAllTabs={() => {
                  for (const candidate of state.tabs) commands.closeTab(pane, candidate.id);
                }}
                hasTabsBefore={state.tabs[0]?.id !== tab.id}
                hasTabsAfter={state.tabs.at(-1)?.id !== tab.id}
                setPinned={(pinned) => commands.setTabPinned(pane, tab.id, pinned)}
              />
            ))}
          </TabsList>
          <WorkbenchSurfaceMenu
            changesOpen={changesOpen}
            contextOpen={contextOpen}
            openContext={openContext}
            openChanges={openChanges}
            openTerminal={openTerminal}
          />
        </header>
        {state.tabs.length === 0 ? (
          <WorkbenchEmpty
            pane={pane}
            changesOpen={changesOpen}
            contextOpen={contextOpen}
            openContext={openContext}
            openChanges={openChanges}
            openTerminal={openTerminal}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {state.tabs.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                keepMounted
                className="flex min-h-0 flex-1 flex-col overflow-hidden data-hidden:hidden"
              >
                <WorkbenchTabBoundary
                  resetKey={`${tab.id}:${state.activeTabID}`}
                  close={() => closeTab(tab)}
                >
                  <Suspense fallback={<WorkbenchSkeleton />}>
                    <WorkbenchTabContent
                      tab={tab}
                      pane={pane}
                      scope={scope}
                      active={state.activeTabID === tab.id}
                    />
                  </Suspense>
                </WorkbenchTabBoundary>
              </TabsContent>
            ))}
          </div>
        )}
      </Tabs>
    </section>
  );
}

function WorkbenchSurfaceMenu({
  changesOpen,
  contextOpen,
  openContext,
  openChanges,
  openTerminal,
}: {
  changesOpen: boolean;
  contextOpen: boolean;
  openContext(): void;
  openChanges(): void;
  openTerminal(): Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="window-no-drag ml-1 size-7 shrink-0 [&_svg]:size-4"
            aria-label="Open workbench surface"
          />
        }
      >
        <Plus aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {!contextOpen ? (
          <DropdownMenuItem onClick={openContext}>
            <Gauge /> Context
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() =>
            void openTerminal().catch((error) => showErrorToast("Could not open terminal", error))
          }
        >
          <SquareTerminal /> Terminal
        </DropdownMenuItem>
        {!changesOpen ? (
          <DropdownMenuItem onClick={openChanges}>
            <FileDiff /> Changes
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkbenchTabItem({
  tab,
  pane,
  active,
  closeTab,
  moveTab,
  closeOtherTabs,
  closeTabsToEnd,
  closeTabsToStart,
  closeAllTabs,
  hasTabsBefore,
  hasTabsAfter,
  setPinned,
}: {
  tab: WorkbenchTab;
  pane: WorkbenchPaneID;
  active: boolean;
  closeTab(): void;
  moveTab(): void;
  closeOtherTabs(): void;
  closeTabsToEnd(): void;
  closeTabsToStart(): void;
  closeAllTabs(): void;
  hasTabsBefore: boolean;
  hasTabsAfter: boolean;
  setPinned(pinned: boolean): void;
}) {
  const title = workbenchTabTitle(tab);
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) tabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={tabRef}
            className="group/tab relative flex h-7 min-w-24 max-w-48 shrink-0 items-center rounded-md data-[popup-open]:bg-muted"
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              closeTab();
            }}
          />
        }
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${title}`}
          className="absolute left-1 z-10 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            closeTab();
          }}
        >
          <span className="relative size-3.5">
            {tab.kind === "terminal" || tab.kind === "command" ? (
              <SquareTerminal
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "context" ? (
              <Gauge
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "changes" ? (
              <Files
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "file" ? (
              <FileCode2
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : (
              <FileDiff
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            )}
            <X
              className="absolute inset-0 size-3.5 opacity-0 transition-opacity group-hover/tab:opacity-100"
              aria-hidden="true"
            />
          </span>
        </button>
        <TabsTrigger
          value={tab.id}
          onFocus={() => tabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })}
          className="h-full min-w-0 flex-1 justify-start rounded-md py-0 pr-5 pl-7 font-normal after:hidden hover:bg-muted/60 data-active:bg-card data-active:shadow-sm data-active:ring-1 data-active:ring-border/80 dark:data-active:bg-card"
        >
          <span className="truncate" title={title}>
            {title}
          </span>
          {tab.kind === "changes" || tab.kind === "file-diff" ? (
            <span
              className="absolute right-2 size-1.5 rounded-full bg-info"
              title={tab.resource.mode === "branch" ? "Branch change" : "Working tree change"}
              aria-label={tab.resource.mode === "branch" ? "Branch change" : "Working tree change"}
            />
          ) : null}
        </TabsTrigger>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={closeTab}>Close</ContextMenuItem>
          <ContextMenuItem onClick={closeOtherTabs}>Close others</ContextMenuItem>
          <ContextMenuItem disabled={!hasTabsBefore} onClick={closeTabsToStart}>
            Close to the left
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasTabsAfter} onClick={closeTabsToEnd}>
            Close to the right
          </ContextMenuItem>
          <ContextMenuItem onClick={closeAllTabs}>Close all</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={moveTab}>
            {pane === "right" ? <PanelBottom /> : <PanelRight />}
            Move to {pane === "right" ? "bottom" : "right"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setPinned(!tab.pinned)}>
            {tab.pinned ? <PinOff /> : <Pin />}
            {tab.pinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WorkbenchTabContent({
  tab,
  pane,
  scope,
  active,
}: {
  tab: WorkbenchTab;
  pane: WorkbenchPaneID;
  scope: WorkbenchScope;
  active: boolean;
}) {
  if (tab.kind === "context") return <ContextTab tab={tab} />;
  if (tab.kind === "changes") return <ChangesTab tab={tab} pane={pane} scope={scope} />;
  if (tab.kind === "file") return <FileTab tab={tab} />;
  if (tab.kind === "file-diff") return <FileDiffTab tab={tab} />;
  if (tab.kind === "command") return <CommandTab tab={tab} active={active} />;
  return <TerminalTab tab={tab} />;
}

function WorkbenchEmpty({
  pane,
  changesOpen,
  contextOpen,
  openContext,
  openChanges,
  openTerminal,
}: {
  pane: WorkbenchPaneID;
  changesOpen: boolean;
  contextOpen: boolean;
  openContext(): void;
  openChanges(): void;
  openTerminal(): Promise<void>;
}) {
  return (
    <Empty className="min-h-0 flex-1 rounded-none p-5">
      <EmptyHeader>
        <EmptyTitle>Open a surface</EmptyTitle>
        <EmptyDescription>
          Choose what to show in the {pane === "right" ? "right" : "bottom"} panel.
        </EmptyDescription>
      </EmptyHeader>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 @min-[34rem]/workbench:grid-cols-2">
        {!contextOpen ? (
          <WorkbenchSurfaceCard
            icon={<Gauge aria-hidden="true" />}
            title="Context"
            description="Inspect context usage and projected messages."
            onClick={openContext}
          />
        ) : null}
        <WorkbenchSurfaceCard
          icon={<SquareTerminal aria-hidden="true" />}
          title="Terminal"
          description="Start a shell in this workspace."
          onClick={() =>
            void openTerminal().catch((error) => showErrorToast("Could not open terminal", error))
          }
        />
        {!changesOpen ? (
          <WorkbenchSurfaceCard
            icon={<FileDiff aria-hidden="true" />}
            title="Changes"
            description="Review working changes in this workspace."
            onClick={openChanges}
          />
        ) : null}
      </div>
    </Empty>
  );
}

function WorkbenchSurfaceCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-24 min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      onClick={onClick}
    >
      <span className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4">
        {icon}
        {title}
      </span>
      <span className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="min-h-28 flex-1" />
    </div>
  );
}

class WorkbenchTabBoundary extends Component<
  { children: ReactNode; close(): void; resetKey: string },
  { error: Error | null; retry: number }
> {
  override state: { error: Error | null; retry: number } = { error: null, retry: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Tab unavailable</EmptyTitle>
          <EmptyDescription>{this.state.error.message}</EmptyDescription>
        </EmptyHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState(({ retry }) => ({ error: null, retry: retry + 1 }))}
          >
            Retry
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={this.props.close}>
            Close
          </Button>
        </div>
      </Empty>
    );
  }
}
