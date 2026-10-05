import {
  FileDiff,
  Globe2,
  FileCode2,
  Files,
  Gauge,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  PanelBottom,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";
import { useBrowserSession } from "../../hooks/use-browser-session";
import type { Browser } from "@opencode/plugin-browser/rpc";
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
import { palot } from "../../services/palot";
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
const BtwTab = lazy(() =>
  import("../workbench-tabs/btw-tab").then((module) => ({ default: module.BtwTab })),
);
const ContextTab = lazy(() =>
  import("../workbench-tabs/context-tab").then((module) => ({ default: module.ContextTab })),
);
const FileDiffTab = lazy(() =>
  import("../workbench-tabs/file-diff-tab").then((module) => ({ default: module.FileDiffTab })),
);
const TurnDiffTab = lazy(() =>
  import("../workbench-tabs/turn-diff-tab").then((module) => ({ default: module.TurnDiffTab })),
);
const FileTab = lazy(() =>
  import("../workbench-tabs/file-tab").then((module) => ({ default: module.FileTab })),
);
const WorkspaceFilesTab = lazy(() =>
  import("../workbench-tabs/workspace-files-tab").then((module) => ({
    default: module.WorkspaceFilesTab,
  })),
);
const TerminalTab = lazy(() =>
  import("../workbench-tabs/terminal-tab").then((module) => ({ default: module.TerminalTab })),
);
const CommandTab = lazy(() =>
  import("../workbench-tabs/command-tab").then((module) => ({ default: module.CommandTab })),
);
const BrowserTab = lazy(() =>
  import("../workbench-tabs/browser-tab").then((module) => ({ default: module.BrowserTab })),
);

export function WorkbenchPane({
  pane,
  scope,
  context,
  location,
  visible = true,
  expanded = false,
  onToggleExpanded,
}: {
  pane: WorkbenchPaneID;
  scope: WorkbenchScope;
  context: WorkbenchContextState;
  location: { directory: string; workspaceID?: string };
  visible?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const browserEnabled = useAtomValue(experimentalBrowserAtom);
  const browser = useBrowserSession(scope);
  const state = context[pane];
  const commands = useWorkbenchCommands(scope);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const measure = () => {
      const left = list.scrollLeft > 1;
      const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
      setScrollEdges((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const item of list.children) observer.observe(item);
    list.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", measure);
    };
  }, [state.tabs, browser?.state.tabs]);
  const browserCommand = useCallback(
    async (action: Parameters<typeof palot.browserCommand>[1], placement?: WorkbenchPaneID) => {
      if (!browser?.bindingID) {
        showErrorToast(
          "Browser unavailable",
          new Error(browser?.error ?? "Browser is still connecting to this task"),
        );
        return;
      }
      try {
        return placement
          ? await palot.browserCommand(browser.bindingID, action, placement)
          : await palot.browserCommand(browser.bindingID, action);
      } catch (error) {
        showErrorToast("Could not control browser", error);
      }
    },
    [browser?.bindingID, browser?.error],
  );
  const closeTab = useCallback(
    (tab: WorkbenchTab) => {
      if (tab.kind === "browser") {
        if (tab.resource.browserTabID) {
          void browserCommand({
            type: "tabs.close",
            tabID: tab.resource.browserTabID as Browser.TabID,
          });
        } else {
          showErrorToast("Browser unavailable", new Error("Browser page is still connecting"));
        }
      } else commands.closeTab(pane, tab.id);
    },
    [browserCommand, commands, pane],
  );
  const closeTabs = useCallback(
    (tabs: WorkbenchTab[]) => {
      for (const tab of tabs) closeTab(tab);
    },
    [closeTab],
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
  const filesOpen = [...context.right.tabs, ...context.bottom.tabs].some(
    (tab) =>
      tab.kind === "workspace-files" &&
      tab.resource.location.directory === location.directory &&
      tab.resource.location.workspaceID === location.workspaceID,
  );
  const openFiles = useCallback(() => {
    commands.openTab({ kind: "workspace-files", location }, { pane });
  }, [commands, location, pane]);
  const openBrowser = useCallback(async () => {
    const pageID = await browserCommand({ type: "tabs.open", focus: true }, pane);
    if (!pageID) return;
    commands.openTab(
      { kind: "browser", location, browserTabID: pageID },
      { pane, moveExisting: true },
    );
  }, [browserCommand, commands, location, pane]);
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
          if (typeof value !== "string") return;
          commands.activateTab(pane, value);
          const selected = state.tabs.find((tab) => tab.id === value);
          if (selected?.kind === "browser" && selected.resource.browserTabID) {
            void browserCommand({
              type: "tabs.focus",
              tabID: selected.resource.browserTabID as Browser.TabID,
            });
          }
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <header
          className={cn(
            "palot-workbench-surface-header window-drag flex h-(--shell-header-height) min-h-(--shell-header-height) min-w-0 items-center border-b bg-background/90",
            pane === "right" ? "pr-(--window-controls-width)" : "pr-2",
          )}
        >
          <div
            className="relative h-full min-w-0 flex-1"
            data-scroll-left={scrollEdges.left}
            data-scroll-right={scrollEdges.right}
          >
            <TabsList
              ref={tabListRef}
              variant="line"
              activateOnFocus
              className="window-no-drag h-full! w-full min-w-0 justify-start gap-1 overflow-x-auto rounded-none px-2 pt-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {state.tabs.map((tab, index) => (
                <WorkbenchTabItem
                  key={tab.id}
                  tab={tab}
                  pane={pane}
                  active={state.activeTabID === tab.id}
                  browserPage={
                    tab.kind === "browser"
                      ? browser?.state.tabs.find((page) => page.id === tab.resource.browserTabID)
                      : undefined
                  }
                  separator={
                    index > 0 &&
                    state.activeTabID !== tab.id &&
                    state.activeTabID !== state.tabs[index - 1]?.id
                  }
                  closeTab={() => closeTab(tab)}
                  moveTab={() =>
                    commands.moveTab(pane, pane === "right" ? "bottom" : "right", tab.id)
                  }
                  closeOtherTabs={() =>
                    closeTabs(state.tabs.filter((candidate) => candidate.id !== tab.id))
                  }
                  closeTabsToEnd={() => closeTabs(state.tabs.slice(index + 1))}
                  closeTabsToStart={() => closeTabs(state.tabs.slice(0, index))}
                  closeAllTabs={() => closeTabs(state.tabs)}
                  hasTabsBefore={state.tabs[0]?.id !== tab.id}
                  hasTabsAfter={state.tabs.at(-1)?.id !== tab.id}
                  setPinned={(pinned) => commands.setTabPinned(pane, tab.id, pinned)}
                />
              ))}
            </TabsList>
            <span
              className="palot-workbench-tab-fade palot-workbench-tab-fade-left"
              aria-hidden="true"
            />
            <span
              className="palot-workbench-tab-fade palot-workbench-tab-fade-right"
              aria-hidden="true"
            />
          </div>
          <WorkbenchSurfaceMenu
            changesOpen={changesOpen}
            contextOpen={contextOpen}
            filesOpen={filesOpen}
            openFiles={openFiles}
            openBrowser={browserEnabled ? openBrowser : undefined}
            openContext={openContext}
            openChanges={openChanges}
            openTerminal={openTerminal}
          />
          {pane === "right" && onToggleExpanded ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="window-no-drag ml-1 size-7 shrink-0 [&_svg]:size-4"
              aria-label={expanded ? "Restore right workbench" : "Expand right workbench"}
              aria-pressed={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
          ) : null}
        </header>
        {state.tabs.length === 0 ? (
          <WorkbenchEmpty
            pane={pane}
            changesOpen={changesOpen}
            contextOpen={contextOpen}
            filesOpen={filesOpen}
            openFiles={openFiles}
            openBrowser={browserEnabled ? openBrowser : undefined}
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
                aria-hidden={!(visible && state.requestedOpen && state.activeTabID === tab.id)}
                inert={!(visible && state.requestedOpen && state.activeTabID === tab.id)}
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
                      active={visible && state.requestedOpen && state.activeTabID === tab.id}
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
  filesOpen,
  openFiles,
  openBrowser,
  openContext,
  openChanges,
  openTerminal,
}: {
  changesOpen: boolean;
  contextOpen: boolean;
  filesOpen: boolean;
  openFiles(): void;
  openBrowser?: () => void;
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
        {!filesOpen ? (
          <DropdownMenuItem onClick={openFiles}>
            <Files /> Files
          </DropdownMenuItem>
        ) : null}
        {openBrowser ? (
          <DropdownMenuItem onClick={openBrowser}>
            <Globe2 /> Browser
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
  browserPage,
  separator,
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
  browserPage?: { title?: string; url?: string };
  separator: boolean;
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
  const title =
    tab.kind === "browser"
      ? browserPage?.url === "about:blank"
        ? "New tab"
        : browserPage?.title || browserPage?.url || "New tab"
      : workbenchTabTitle(tab);
  const tooltip = tab.kind === "browser" ? browserPage?.url || title : title;
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
            className={cn(
              "group/tab relative flex h-6 min-w-24 max-w-48 shrink-0 items-center rounded-md data-[popup-open]:bg-muted",
              separator && "palot-workbench-tab-separator",
            )}
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
          aria-label={`Close ${title}`}
          className="absolute left-1 z-10 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
            ) : tab.kind === "btw" ? (
              <MessageCircleQuestion
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "browser" ? (
              <Globe2
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "context" ? (
              <Gauge
                className="absolute inset-0 size-3.5 transition-opacity group-hover/tab:opacity-0"
                aria-hidden="true"
              />
            ) : tab.kind === "changes" || tab.kind === "workspace-files" ? (
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
          className="h-full min-w-0 flex-1 justify-start rounded-md py-0 pr-5 pl-7 font-normal after:hidden hover:bg-muted/60 data-active:bg-card data-active:ring-1 data-active:ring-border/70 dark:data-active:bg-card"
        >
          <span className="truncate" title={tooltip}>
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
          {tab.kind !== "browser" ? (
            <ContextMenuItem onClick={() => setPinned(!tab.pinned)}>
              {tab.pinned ? <PinOff /> : <Pin />}
              {tab.pinned ? "Unpin" : "Pin"}
            </ContextMenuItem>
          ) : null}
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
  if (tab.kind === "btw") return <BtwTab tab={tab} />;
  if (tab.kind === "browser")
    return tab.resource.browserTabID ? (
      <BrowserTab scope={scope} tabID={tab.resource.browserTabID} active={active} />
    ) : (
      <Empty className="min-h-0 flex-1">
        <EmptyHeader>
          <EmptyTitle>Connecting to browser…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  if (tab.kind === "context") return <ContextTab tab={tab} active={active} />;
  if (tab.kind === "changes")
    return <ChangesTab tab={tab} pane={pane} scope={scope} active={active} />;
  if (tab.kind === "file") return <FileTab tab={tab} active={active} />;
  if (tab.kind === "workspace-files")
    return <WorkspaceFilesTab tab={tab} pane={pane} scope={scope} active={active} />;
  if (tab.kind === "file-diff") return <FileDiffTab tab={tab} active={active} />;
  if (tab.kind === "turn-diff") return <TurnDiffTab tab={tab} active={active} />;
  if (tab.kind === "command") return <CommandTab tab={tab} active={active} />;
  return <TerminalTab tab={tab} />;
}

function WorkbenchEmpty({
  pane,
  changesOpen,
  contextOpen,
  filesOpen,
  openFiles,
  openBrowser,
  openContext,
  openChanges,
  openTerminal,
}: {
  pane: WorkbenchPaneID;
  changesOpen: boolean;
  contextOpen: boolean;
  filesOpen: boolean;
  openFiles(): void;
  openBrowser?: () => void;
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
        {!filesOpen ? (
          <WorkbenchSurfaceCard
            icon={<Files aria-hidden="true" />}
            title="Files"
            description="Browse and search workspace files."
            onClick={openFiles}
          />
        ) : null}
        {openBrowser ? (
          <WorkbenchSurfaceCard
            icon={<Globe2 aria-hidden="true" />}
            title="Browser"
            description="View browser pages for this task."
            onClick={openBrowser}
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
