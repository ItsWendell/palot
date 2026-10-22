import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ClipboardCopy,
  Clock3,
  Download,
  FileUp,
  FolderGit2,
  GitFork,
  History,
  LoaderCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { usePalotNavigation } from "../hooks/use-navigation";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { useSessionFork } from "../hooks/use-session-fork";
import { SessionForkHistoryDialog } from "./session-history-dialog";
import { SessionCopyDialog } from "./session-copy-dialog";
import { useCacheSession } from "../hooks/use-session-catalog";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { removeSession as removeCatalogSession } from "../lib/session-catalog-query";
import { useCreateProjectCopy, useProjectWorktrees } from "../hooks/use-project-worktrees";
import { getOpenCodeVcsStatus } from "../services/opencode-vcs";
import { formatSnoozeMenuTime, sessionSnoozeChoices } from "../lib/session-snooze";
import {
  formatShortcut,
  useShortcutKeys,
  type KeyboardShortcutID,
} from "../lib/keyboard-shortcuts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { toast } from "./ui/toast";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export function SessionContextMenu({
  trigger,
  session,
  project,
  owner,
  disabled = false,
  moveDisabled = false,
  snoozeDisabled = false,
  onSnooze,
  onRename,
  children,
}: {
  trigger: ReactElement;
  session: PalotSession;
  project?: PalotProject | null;
  /** Undefined uses the active runtime; null deliberately has no owner. */
  owner?: OpenCodeRuntimeStatus | null;
  disabled?: boolean;
  moveDisabled?: boolean;
  snoozeDisabled?: boolean;
  onSnooze?: (until: number) => void | Promise<void>;
  onRename?: () => void;
  children?: ReactNode;
}) {
  const { openNewTask, openScheduled } = usePalotNavigation();
  const forkSession = useSessionFork(owner);
  const queryClient = useQueryClient();
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const unavailable = disabled || (owner !== undefined && !ownerAvailable(owner));
  const store = useStore();
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const [forking, setForking] = useState(false);
  const [forkHistoryOpen, setForkHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const transfer = useSessionTransfer(session, owner, unavailable);
  const sessionMove = useSessionMove(session, project, owner, unavailable || moveDisabled);

  const fork = useCallback(async () => {
    if (unavailable || forking) return;
    setForking(true);
    try {
      await forkSession({ sessionID: session.id });
    } catch (error) {
      showErrorToast("Could not fork task", error);
    } finally {
      setForking(false);
    }
  }, [forkSession, forking, session.id, unavailable]);
  const deleteSession = useCallback(async () => {
    if (unavailable || deleting) return;
    setDeleting(true);
    try {
      await palot.removeSession(session.id, runtime?.connectionID);
      removeCatalogSession(queryClient, runtime?.connectionID ?? "disconnected", session.id);
      setDeleteOpen(false);
      if (
        selectedSessionID === session.id &&
        store.get(runtimeAtom)?.connectionID === runtime?.connectionID &&
        store.get(selectedSessionIDAtom) === session.id
      )
        await openNewTask(session.projectID, runtime?.profileID);
    } catch (error) {
      showErrorToast("Could not delete task", error);
    } finally {
      setDeleting(false);
    }
  }, [
    deleting,
    openNewTask,
    queryClient,
    runtime?.connectionID,
    runtime?.profileID,
    store,
    selectedSessionID,
    session.id,
    session.projectID,
    unavailable,
  ]);
  return (
    <>
      {transfer.serverCopyDialog}
      {sessionMove.dialog}
      <ContextMenu>
        <ContextMenuTrigger render={trigger} />
        <ContextMenuContent>
          {children ? (
            <>
              <ContextMenuGroup>{children}</ContextMenuGroup>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={unavailable}
              onClick={() => void openSessionWindow(session.id, runtime?.connectionID)}
            >
              <PanelsTopLeft aria-hidden="true" />
              Open in new window
            </ContextMenuItem>
            <ContextMenuItem disabled={unavailable || forking} onClick={() => void fork()}>
              {forking ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <GitFork aria-hidden="true" />
              )}
              Fork
            </ContextMenuItem>
            <ContextMenuItem disabled={unavailable} onClick={() => setForkHistoryOpen(true)}>
              Fork from prompt…
            </ContextMenuItem>
            {onRename ? (
              <ContextMenuItem disabled={unavailable} onClick={onRename}>
                Rename
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              disabled={unavailable || runtime?.capabilities?.scheduledAutomations === false}
              title={
                runtime?.capabilities?.scheduledAutomations === false
                  ? "Scheduled follow-ups are unavailable on this connection"
                  : undefined
              }
              onClick={() =>
                void openScheduled({
                  mode: "create",
                  sessionID: session.id,
                  profileID: runtime?.profileID,
                })
              }
            >
              <CalendarClock aria-hidden="true" />
              Schedule follow-up
            </ContextMenuItem>
            <SessionTransferItems transfer={transfer} />
            {onSnooze ? (
              <SessionSnoozeMenu disabled={unavailable || snoozeDisabled} onSnooze={onSnooze} />
            ) : null}
            <SessionMoveMenu session={session} project={project} owner={owner} move={sessionMove} />
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={unavailable || deleting}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            Delete task
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {forkHistoryOpen ? (
        <SessionForkHistoryDialog
          session={session}
          owner={unavailable ? null : owner}
          onClose={() => setForkHistoryOpen(false)}
        />
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {session.title ?? "this task"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the task and all of its child tasks from OpenCode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unavailable || deleting}
              onClick={() => void deleteSession()}
            >
              {deleting ? "Deleting..." : "Delete task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface SessionHistoryActions {
  loadingOlder: boolean;
  previousTurn(): void;
  nextTurn(): void;
  openTimeline(): void;
  forkFromPrompt(): void;
  /** Opens Find in task. */
  find?(): void;
}

/** Shortcut hint that stays out of the menu item's accessible name. */
function MenuShortcut({ id }: { id: KeyboardShortcutID }) {
  const keys = useShortcutKeys(id);
  if (keys.length === 0) return null;
  return <DropdownMenuShortcut aria-hidden="true">{formatShortcut(keys)}</DropdownMenuShortcut>;
}

async function openSessionWindow(sessionID: string, connectionID?: string): Promise<void> {
  try {
    await palot.openSessionWindow(sessionID, connectionID);
  } catch (error) {
    showErrorToast("Could not open task in a new window", error);
  }
}

export function SessionExportMenu({
  session,
  historyActions,
}: {
  session: PalotSession;
  historyActions?: SessionHistoryActions;
}) {
  const connectionID = useAtomValue(runtimeAtom)?.connectionID;
  const transfer = useSessionTransfer(session);
  return (
    <>
      {transfer.serverCopyDialog}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="window-no-drag shrink-0"
              aria-label="Task actions"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-w-(--available-width)">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void openSessionWindow(session.id, connectionID)}>
              <PanelsTopLeft aria-hidden="true" />
              Open in new window
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {historyActions ? (
            <>
              <DropdownMenuGroup>
                {historyActions.find ? (
                  <DropdownMenuItem onClick={historyActions.find}>
                    <Search aria-hidden="true" />
                    Find in task
                    <MenuShortcut id="task.find" />
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={historyActions.loadingOlder}
                  onClick={historyActions.previousTurn}
                >
                  <ArrowUp aria-hidden="true" />
                  Previous user turn
                  <MenuShortcut id="task.turn.previous" />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.nextTurn}>
                  <ArrowDown aria-hidden="true" />
                  Next user turn
                  <MenuShortcut id="task.turn.next" />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.openTimeline}>
                  <History aria-hidden="true" />
                  Prompt timeline
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.forkFromPrompt}>
                  <GitFork aria-hidden="true" />
                  Fork from prompt…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <SessionTransferItems transfer={transfer} dropdown />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ownerAvailable(owner: OpenCodeRuntimeStatus | null): boolean {
  return Boolean(owner?.connected && owner.phase === "connected");
}

function useSessionTransfer(
  session: PalotSession,
  owner?: OpenCodeRuntimeStatus | null,
  disabled = false,
) {
  const { openSession } = usePalotNavigation();
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const unavailable = disabled || (owner !== undefined && !ownerAvailable(owner));
  const cacheSession = useCacheSession(runtime);
  const [transferring, setTransferring] = useState<"copy" | "export" | "import" | null>(null);
  const [serverCopy, setServerCopy] = useState<{
    session: PalotSession;
    source: OpenCodeRuntimeStatus;
  } | null>(null);
  const exportSession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("export");
    try {
      const path = await palot.exportSession(session.id, session.title, runtime?.connectionID);
      if (path) toast.add({ type: "success", title: "Task exported", description: path });
    } catch (error) {
      showErrorToast("Could not export task", error);
    } finally {
      setTransferring(null);
    }
  }, [session.id, session.title, transferring, runtime?.connectionID, unavailable]);
  const importSession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("import");
    try {
      const imported = await palot.importSession(session.location, runtime?.connectionID);
      if (!imported) return;
      cacheSession(imported);
      await openSession(imported.id, { profileID: runtime?.profileID });
    } catch (error) {
      showErrorToast("Could not import task", error);
    } finally {
      setTransferring(null);
    }
  }, [
    cacheSession,
    openSession,
    runtime?.connectionID,
    runtime?.profileID,
    session.location,
    transferring,
    unavailable,
  ]);
  const copySession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("copy");
    try {
      await palot.copySessionMarkdown(session.id, runtime?.connectionID);
      toast.add({ type: "success", title: "Conversation copied as Markdown" });
    } catch (error) {
      showErrorToast("Could not copy conversation", error);
    } finally {
      setTransferring(null);
    }
  }, [session.id, transferring, runtime?.connectionID, unavailable]);
  return {
    transferring,
    unavailable,
    exportSession,
    copySession,
    importSession,
    openServerCopy: () => {
      if (runtime?.connected) setServerCopy({ session, source: runtime });
    },
    serverCopyDialog: serverCopy ? (
      <SessionCopyDialog
        session={serverCopy.session}
        source={serverCopy.source}
        onClose={() => setServerCopy(null)}
      />
    ) : null,
  };
}

function SessionTransferItems({
  transfer,
  dropdown = false,
}: {
  transfer: ReturnType<typeof useSessionTransfer>;
  dropdown?: boolean;
}) {
  const { transferring, unavailable, exportSession, copySession, importSession } = transfer;
  const Item = dropdown ? DropdownMenuItem : ContextMenuItem;
  return (
    <>
      <Item disabled={unavailable || Boolean(transferring)} onClick={() => void exportSession()}>
        {transferring === "export" ? <LoaderCircle className="animate-spin" /> : <Download />}
        Export task
      </Item>
      <Item disabled={unavailable || Boolean(transferring)} onClick={() => void copySession()}>
        {transferring === "copy" ? <LoaderCircle className="animate-spin" /> : <ClipboardCopy />}
        Copy conversation as Markdown
      </Item>
      <Item disabled={unavailable || Boolean(transferring)} onClick={transfer.openServerCopy}>
        <PanelsTopLeft />
        Copy task to server…
      </Item>
      {!dropdown ? (
        <Item disabled={unavailable || Boolean(transferring)} onClick={() => void importSession()}>
          {transferring === "import" ? <LoaderCircle className="animate-spin" /> : <FileUp />}
          Import task
        </Item>
      ) : null}
    </>
  );
}

function SessionSnoozeMenu({
  disabled,
  onSnooze,
}: {
  disabled: boolean;
  onSnooze: (until: number) => void | Promise<void>;
}) {
  const [displayNow] = useState(() => Date.now());
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <Clock3 aria-hidden="true" />
        Snooze
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        <ContextMenuGroup>
          {sessionSnoozeChoices.map(([label, resolve]) => (
            <ContextMenuItem
              key={label}
              disabled={disabled}
              onClick={() => void onSnooze(resolve(Date.now()))}
            >
              <span>{label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatSnoozeMenuTime(resolve(displayNow))}
              </span>
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

type SessionMoveTarget = { kind: "existing"; directory: string } | { kind: "new" };

interface PendingSessionMove {
  target: SessionMoveTarget;
  connectionID: string | undefined;
  /** Uncommitted paths in the source checkout; null when they could not be read. */
  files: string[] | null;
}

/**
 * Moving a task relocates the task only: OpenCode's session.move does not carry
 * uncommitted edits, and a new worktree starts from the last commit. Before moving, the
 * source checkout is checked; edits (or an unreadable status) ask for confirmation that
 * says where they stay. Lives above the menu so the confirmation outlives it.
 */
function useSessionMove(
  session: PalotSession,
  project: PalotProject | null | undefined,
  owner: OpenCodeRuntimeStatus | null | undefined,
  disabled: boolean,
) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const cacheSession = useCacheSession(runtime);
  const createProjectCopy = useCreateProjectCopy(project, owner);
  const [moving, setMoving] = useState(false);
  const [pending, setPending] = useState<PendingSessionMove | null>(null);
  const unavailable = disabled || moving || !project;
  const createUnavailable = runtime?.capabilities?.worktreeCreate === false;
  const source = session.location.directory;
  const sourceLabel = checkoutLabel(source, project);

  const perform = useCallback(
    async (target: SessionMoveTarget, connectionID: string | undefined) => {
      setMoving(true);
      try {
        if (target.kind === "existing") {
          const moved = await palot.moveSession(session.id, target.directory, connectionID);
          if (moved) cacheSession(moved);
          toast.add({
            type: "success",
            title: "Task moved",
            description: `Now working in ${checkoutLabel(target.directory, project)}.`,
          });
        } else {
          const copy = await createProjectCopy.mutateAsync(source);
          const moved = await palot.moveSession(session.id, copy.directory, connectionID);
          if (moved) cacheSession(moved);
          toast.add({
            type: "success",
            title: "Task moved to a new worktree",
            description: directoryLabel(copy.directory),
          });
        }
      } catch (error) {
        showErrorToast(
          target.kind === "existing"
            ? "Could not move task"
            : "Could not move task to a new worktree",
          error,
        );
      } finally {
        setMoving(false);
      }
    },
    [cacheSession, createProjectCopy, project, session.id, source],
  );

  const request = useCallback(
    async (target: SessionMoveTarget) => {
      if (unavailable) return;
      if (target.kind === "existing" && target.directory === source) return;
      if (target.kind === "new" && createUnavailable) return;
      const connectionID = runtime?.connectionID;
      setMoving(true);
      let files: string[] | null;
      try {
        files = (await getOpenCodeVcsStatus(session.location, undefined, connectionID)).map(
          (file) => file.file,
        );
      } catch {
        files = null;
      }
      if (files?.length === 0) {
        await perform(target, connectionID);
        return;
      }
      setMoving(false);
      setPending({ target, connectionID, files });
    },
    [createUnavailable, perform, runtime?.connectionID, session.location, source, unavailable],
  );

  const destination = pending
    ? pending.target.kind === "new"
      ? "a new worktree"
      : checkoutLabel(pending.target.directory, project)
    : "";
  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <FolderGit2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Move task to {destination}?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.files
              ? `${pending.files.length} uncommitted ${pending.files.length === 1 ? "change stays" : "changes stay"} in ${sourceLabel}. Only the task moves to ${destination}; its edits are not copied.`
              : `Palot couldn't check ${sourceLabel} for uncommitted changes. Only the task moves to ${destination}; any edits stay in ${sourceLabel}.`}
            {pending?.target.kind === "new" ? " A new worktree starts from the last commit." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending?.files?.length ? (
          <div
            className="max-h-36 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-code-compact text-muted-foreground"
            aria-label={`Uncommitted changes in ${sourceLabel}`}
          >
            {pending.files.slice(0, 20).map((file) => (
              <div key={file} className="truncate" title={file}>
                {file}
              </div>
            ))}
            {pending.files.length > 20 ? <div>+{pending.files.length - 20} more</div> : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={moving}
            onClick={() => {
              const confirmed = pending;
              setPending(null);
              if (confirmed) void perform(confirmed.target, confirmed.connectionID);
            }}
          >
            Move task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { moving, unavailable, createUnavailable, sourceLabel, request, dialog };
}

function SessionMoveMenu({
  session,
  project,
  owner,
  move,
}: {
  session: PalotSession;
  project?: PalotProject | null;
  owner?: OpenCodeRuntimeStatus | null;
  move: ReturnType<typeof useSessionMove>;
}) {
  const directoriesQuery = useProjectWorktrees(project, false, owner);
  const { moving, unavailable } = move;

  const loadDirectories = useCallback(() => {
    if (unavailable || !project || directoriesQuery.isFetching) return;
    void directoriesQuery.refetch().then((result) => {
      if (result.error) showErrorToast("Could not load worktrees", result.error);
    });
  }, [directoriesQuery, project, unavailable]);

  const directories = directoriesQuery.data;
  const loading = directoriesQuery.isFetching;
  const targets = directories?.filter(
    (item, index, items) =>
      item.directory !== session.location.directory &&
      items.findIndex((candidate) => candidate.directory === item.directory) === index,
  );
  const mainTarget = targets?.find((item) => item.directory === project?.canonical);
  const worktreeTargets = targets?.filter((item) => item !== mainTarget);

  const renderTarget = (item: NonNullable<typeof targets>[number]) => (
    <ContextMenuItem
      key={item.directory}
      disabled={unavailable}
      title={item.directory}
      onClick={() => void move.request({ kind: "existing", directory: item.directory })}
    >
      <FolderGit2 aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {item.directory === project?.canonical ? "Main checkout" : directoryLabel(item.directory)}
      </span>
    </ContextMenuItem>
  );

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        disabled={unavailable}
        onMouseEnter={() => void loadDirectories()}
        onFocus={() => void loadDirectories()}
      >
        <FolderGit2 aria-hidden="true" />
        Move to worktree
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        <ContextMenuGroup>
          <ContextMenuLabel className="max-w-60">
            Moves the task only. Uncommitted edits stay in {move.sourceLabel}.
          </ContextMenuLabel>
          <ContextMenuItem
            disabled={unavailable || move.createUnavailable}
            title={
              move.createUnavailable
                ? "Creating worktrees is unavailable on this connection"
                : undefined
            }
            onClick={() => void move.request({ kind: "new" })}
          >
            {moving ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            New worktree
          </ContextMenuItem>
          {mainTarget ? renderTarget(mainTarget) : null}
        </ContextMenuGroup>
        {loading || !directories || !targets?.length || worktreeTargets?.length ? (
          <ContextMenuSeparator />
        ) : null}
        <ContextMenuGroup>
          {loading && !directories ? (
            <ContextMenuItem disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Loading worktrees
            </ContextMenuItem>
          ) : null}
          {!loading && directories && !targets?.length ? (
            <ContextMenuItem disabled>
              <Check aria-hidden="true" />
              Current worktree
            </ContextMenuItem>
          ) : null}
          {worktreeTargets?.map(renderTarget)}
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function directoryLabel(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}

function checkoutLabel(directory: string, project: PalotProject | null | undefined): string {
  return directory === project?.canonical ? "the main checkout" : directoryLabel(directory);
}
