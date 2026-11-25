/**
 * The app's side of the task list: one data source per window (`TaskListSourceProvider`), and
 * `AppTaskList`, which mounts `<TaskList>` with the app's row menu, View menu entries, footer
 * and delete confirmation. The provider re-renders as the catalog streams; its children and the
 * rows do not, because the source object never changes and rows read it through `subscribe`.
 */

import { CheckCheck, FolderCog, FolderGit2, FolderPlus, Trash2, Upload } from "lucide-react";
import { useAtomValue } from "jotai";
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { SESSION_TRIAGE_BATCH_LIMIT, type OpenCodeRuntimeStatus } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import { runtimeAtom } from "../atoms/workspace";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useCacheSession } from "../hooks/use-session-catalog";
import { useSessionWindowDrag } from "../hooks/use-session-window-drag";
import { useTaskDeleteRequest, useTaskListSource } from "../hooks/use-task-list-source";
import { inboxIdleSince } from "../lib/session-inbox";
import { CHATS } from "../lib/task-list/model/sections";
import type { TaskListDataSource } from "../lib/task-list/source/data-source";
import { taskID } from "../lib/task-list/source/ids";
import { createStore, useStoreSelector, type Store } from "../lib/task-list/store";
import type { Task } from "../lib/task-list/types";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { AddProjectDialog } from "./add-project-dialog";
import { MoveToProjectDialog } from "./move-to-project-dialog";
import { SessionContextMenu } from "./session-context-menu";
import { announceSettledBatch } from "./settle-idle-menu";
import {
  ConnectionNotice,
  TaskList,
  usePersistedTaskListPreferences,
  type RowMenuContext,
  type TaskListHandle,
  type TaskListPreferences,
} from "./task-list";
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
import { ContextMenuItem } from "./ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./ui/dropdown-menu";

/** The runtime each server's task menu acts through; null while that server is not ready. */
type Owners = ReadonlyMap<string, OpenCodeRuntimeStatus | null>;

interface TaskListHostValue {
  source: TaskListDataSource;
  owners: Store<{ byServer: Owners }>;
}

const TaskListHostContext = createContext<TaskListHostValue | null>(null);

function useTaskListHost(): TaskListHostValue {
  const value = useContext(TaskListHostContext);
  if (!value) throw new Error("AppTaskList needs a TaskListSourceProvider");
  return value;
}

/** Runtimes compared by what the menu and the drag gesture read. */
function sameRuntime(a: OpenCodeRuntimeStatus | null, b: OpenCodeRuntimeStatus | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.connectionID === b.connectionID &&
    a.profileID === b.profileID &&
    a.connected === b.connected &&
    a.phase === b.phase &&
    a.capabilities === b.capabilities
  );
}

/** One per window: the list's data, and the runtime each server's rows act through. */
export function TaskListSourceProvider({ children }: { children: ReactNode }) {
  const source = useTaskListSource();
  const runtime = useAtomValue(runtimeAtom);
  const { connections } = useConnectionOverview();
  const [owners] = useState(() => createStore<{ byServer: Owners }>({ byServer: new Map() }));
  useLayoutEffect(() => {
    const previous = owners.get().byServer;
    const next = new Map<string, OpenCodeRuntimeStatus | null>();
    for (const entry of connections)
      next.set(entry.profile.id, entry.phase === "ready" ? (entry.runtime ?? null) : null);
    // The focused server acts through the workspace's runtime, as the task menu does today.
    if (runtime?.profileID) next.set(runtime.profileID, runtime);
    for (const [id, value] of next) {
      const before = previous.get(id);
      if (before !== undefined && sameRuntime(before, value)) next.set(id, before);
    }
    const changed =
      next.size !== previous.size || [...next].some(([id, value]) => previous.get(id) !== value);
    if (changed) owners.set({ byServer: next });
  }, [connections, owners, runtime]);
  const value = useMemo(() => ({ source, owners }), [owners, source]);
  return <TaskListHostContext.Provider value={value}>{children}</TaskListHostContext.Provider>;
}

export interface AppTaskListProps {
  /**
   * The pinned column owns the window's list keys, the list order for "settle opens the next"
   * and the notification reveal; a peek or the compact sheet is a second view of the same
   * tasks and owns none of them.
   */
  primary: boolean;
  onSearch(): void;
  footer: ReactNode;
}

export function AppTaskList({ primary, onSearch, footer }: AppTaskListProps) {
  const { source } = useTaskListHost();
  const [preferences, setPreferences] = usePersistedTaskListPreferences();
  const handle = useRef<TaskListHandle>(null);
  // Outside the View menu: the menu unmounts its items when it closes.
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const addProjectProfileID = useAtomValue(runtimeAtom)?.profileID;

  useEffect(() => {
    if (!primary) return;
    source.setListOrder(() => handle.current?.listOrder() ?? []);
    return () => source.setListOrder(null);
  }, [primary, source]);

  // A notification (or anything else) that points at a request: show its row.
  const attentionTarget = useAtomValue(attentionTargetAtom);
  const runtime = useAtomValue(runtimeAtom);
  useEffect(() => {
    if (!primary || !attentionTarget || !runtime?.profileID) return;
    const tasks = source.getSnapshot().tasks;
    const id =
      tasks.find((task) =>
        task.requests.some((request) => request.id === attentionTarget.requestID),
      )?.id ?? taskID(runtime.profileID, attentionTarget.sessionID);
    // After the list has taken the source's latest snapshot.
    const frame = requestAnimationFrame(() => handle.current?.reveal(id));
    return () => cancelAnimationFrame(frame);
  }, [attentionTarget, primary, runtime?.profileID, source]);

  return (
    <>
      <TaskList
        handleRef={handle}
        source={source}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        renderRowMenu={renderRowMenu}
        onSearch={onSearch}
        viewMenuItems={
          <ViewMenuItems preferences={preferences} onAddProject={() => setAddProjectOpen(true)} />
        }
        footer={
          <>
            <ConnectionNotice />
            {footer}
          </>
        }
        globalKeys={primary}
      />
      {primary ? <DeleteConfirmation source={source} /> : null}
      {addProjectOpen ? (
        <AddProjectDialog
          initialProfileID={addProjectProfileID}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}
    </>
  );
}

const renderRowMenu = (task: Task, row: ReactElement, menu: RowMenuContext) => (
  <TaskRowMenu task={task} row={row} menu={menu} />
);

/** Buttons, fields and links inside a row keep their own presses; the row is the drag handle. */
const INTERACTIVE = "button, a, input, textarea, select, [contenteditable='true']";

/**
 * The app's task menu around a row, with the list's own entries first, and the drag-out gesture
 * that opens the task in a new window.
 */
function TaskRowMenu({ task, row, menu }: { task: Task; row: ReactElement; menu: RowMenuContext }) {
  const { source, owners } = useTaskListHost();
  const owner = useStoreSelector(owners, (state) => state.byServer.get(task.serverID) ?? null);
  const meta = source.meta(task.id);
  const drag = useSessionWindowDrag(meta?.sessionID ?? "", owner);
  const [moveOpen, setMoveOpen] = useState(false);
  if (!meta) return row;
  const handle = drag.handleProps;
  const own = (event: ReactPointerEvent<HTMLElement>) =>
    event.target instanceof Element &&
    event.target !== event.currentTarget &&
    event.target.closest(INTERACTIVE) !== null;
  const rowProps = row.props as HTMLAttributes<HTMLElement>;
  const trigger = cloneElement(
    row as ReactElement<HTMLAttributes<HTMLElement>>,
    {
      "data-session-id": meta.sessionID,
      "data-session-drag-handle": handle["data-session-drag-handle"],
      draggable: false,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        rowProps.onPointerDown?.(event);
        if (!own(event)) handle.onPointerDown(event);
      },
      onPointerMove: handle.onPointerMove,
      onPointerUp: handle.onPointerUp,
      onPointerCancel: handle.onPointerCancel,
      onLostPointerCapture: handle.onLostPointerCapture,
      onClickCapture: handle.onClickCapture,
      onDragStart: handle.onDragStart,
    } as HTMLAttributes<HTMLElement>,
  );
  return (
    <>
      {drag.hint}
      {moveOpen ? (
        <MoveToProjectDialog
          session={meta.session}
          owner={owner}
          onClose={() => setMoveOpen(false)}
        />
      ) : null}
      <SessionContextMenu
        trigger={trigger}
        session={meta.session}
        project={meta.project}
        owner={owner}
        disabled={!meta.online}
        moveDisabled={meta.running}
        snoozeDisabled={!meta.canTriage}
        onSnooze={menu.snooze}
        onRename={menu.rename}
        showReadItem={false}
      >
        {menu.items}
        {meta.chat ? (
          <ContextMenuItem
            disabled={meta.running || !meta.online}
            onClick={() => setMoveOpen(true)}
          >
            Move to project…
          </ContextMenuItem>
        ) : null}
      </SessionContextMenu>
    </>
  );
}

/** Entries after the list's own in the View menu: bulk settle, and folders, import and worktrees in one submenu. */
function ViewMenuItems({
  preferences,
  onAddProject,
}: {
  preferences: TaskListPreferences;
  onAddProject(): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const { openSession, openWorktrees } = usePalotNavigation();
  const cacheSession = useCacheSession();

  const importTask = async () => {
    try {
      const imported = await palot.importSession(undefined, runtime?.connectionID);
      if (!imported) return;
      cacheSession(imported);
      await openSession(imported.id, { profileID: runtime?.profileID });
    } catch (error) {
      showErrorToast("Could not import task", error);
    }
  };

  return (
    <>
      <DropdownMenuSeparator />
      <SettleIdleItems preferences={preferences} />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderCog aria-hidden="true" />
          Projects and import
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuItem onClick={onAddProject}>
            <FolderPlus aria-hidden="true" />
            Add project folder…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void importTask()}>
            <Upload aria-hidden="true" />
            Import task…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void openWorktrees()}>
            <FolderGit2 aria-hidden="true" />
            Manage worktrees
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const IDLE_CHOICES = [
  { label: "Idle for 1 day", idleForMs: DAY_MS },
  { label: "Idle for 3 days", idleForMs: 3 * DAY_MS },
  { label: "Idle for 1 week", idleForMs: 7 * DAY_MS },
  { label: "All idle tasks", idleForMs: 0 },
] as const;

/**
 * Settle every inbox task that can settle and has been idle for a chosen time, within the
 * project and server filters, as the Inbox's section menu did.
 */
function SettleIdleItems({ preferences }: { preferences: TaskListPreferences }) {
  const { source } = useTaskListHost();
  const [now, setNow] = useState(() => Date.now());
  const [candidates, setCandidates] = useState<{ id: string; idleSince: number }[]>([]);
  const refresh = () => {
    const at = Date.now();
    const { project, server } = preferences.filters;
    const next: { id: string; idleSince: number }[] = [];
    for (const task of source.getSnapshot().tasks) {
      if (server && task.serverID !== server) continue;
      if (project && (project === CHATS ? task.projectID !== null : task.projectID !== project))
        continue;
      const meta = source.meta(task.id);
      if (!meta || meta.section !== "inbox" || !meta.canSettle || !meta.canTriage) continue;
      next.push({ id: task.id, idleSince: inboxIdleSince(meta, at) });
    }
    setNow(at);
    setCandidates(next);
  };
  const settle = async (ids: string[]) => {
    const batch = ids.slice(0, SESSION_TRIAGE_BATCH_LIMIT);
    if (batch.length === 0) return;
    try {
      const undo = await source.actions.settle(batch);
      announceSettledBatch({ count: batch.length, undo: async () => undo?.() });
    } catch (error) {
      showErrorToast("Could not settle tasks", error);
    }
  };
  return (
    <DropdownMenuSub onOpenChange={(open) => open && refresh()}>
      <DropdownMenuSubTrigger>
        <CheckCheck aria-hidden="true" />
        Settle idle tasks
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">
        {IDLE_CHOICES.map((choice) => {
          const ids = candidates
            .filter((candidate) => now - candidate.idleSince >= choice.idleForMs)
            .map((candidate) => candidate.id);
          return (
            <DropdownMenuItem
              key={choice.label}
              disabled={ids.length === 0}
              onClick={() => void settle(ids)}
            >
              {choice.label}
              <span className="ml-auto text-meta text-muted-foreground tabular-nums">
                {ids.length}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The confirmation `requestDelete` asks for; the row menu's own Delete keeps its dialog. */
function DeleteConfirmation({ source }: { source: TaskListDataSource }) {
  const { pending, deleting, confirm, cancel } = useTaskDeleteRequest(source);
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {pending?.title ?? "this task"}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the task and all of its child tasks from OpenCode.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => void confirm()}
          >
            {deleting ? "Deleting..." : "Delete task"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
