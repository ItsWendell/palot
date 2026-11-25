import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef, useState } from "react";
import { requestGlobalCommandAtom } from "../../atoms/command-requests";
import { requestSessionStopAtom } from "../../atoms/session-stop";
import { autoBackgroundOnSteerAtom, defaultDeliveryAtom } from "../../atoms/ui";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { useComposerPermissions } from "../../hooks/use-composer-permissions";
import { useSessionGoal } from "../../hooks/use-session-goal";
import { useProjectCatalog } from "../../hooks/use-session-catalog";
import { recentPromptScope } from "../../lib/composer-recent-prompts";
import type { ComposerEnterState } from "../../lib/composer-shortcuts";
import { formatShortcut, useShortcutKeys } from "../../lib/keyboard-shortcuts";
import { projectForSession, type PendingRequestView } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { useApprovalChoice } from "../approval-selector";
import type { ComposerQueueHandle } from "../composer-queue";
import { useComposerConfirm } from "./composer-confirm-dialog";
import type { ComposerProps } from "./composer-props";
import { requestsBlockSend, type ComposerRequest } from "./composer-requests";
import { composerCanSubmit, primaryAction } from "./primary-action";
import { useBlockedSteer } from "./use-blocked-steer";
import { useComposerAttachments, useComposerFileDrop } from "./use-composer-attachments";
import { useComposerCatalogs } from "./use-composer-catalogs";
import { useComposerCommands } from "./use-composer-commands";
import { useComposerContext } from "./use-composer-context";
import { draftScopeFor, useComposerDraft } from "./use-composer-draft";
import { useComposerErrors } from "./use-composer-errors";
import { useComposerFocus } from "./use-composer-focus";
import { useComposerHistory } from "./use-composer-history";
import { useComposerLocation } from "./use-composer-location";
import { useComposerMentions } from "./use-composer-mentions";
import { useComposerMenus } from "./use-composer-menus";
import { useComposerPrefetch } from "./use-composer-prefetch";
import { useComposerSend } from "./use-composer-send";
import { useComposerShortcuts } from "./use-composer-shortcuts";
import { useComposerStash } from "./use-composer-stash";
import { useLatest, type ComposerLiveProps } from "./use-latest";
import { useQueueActions } from "./use-queue-actions";

const NO_PENDING_INPUTS: PendingRequestView[] = [];
const NO_REQUESTS: ComposerRequest[] = [];

/**
 * Wires the composer's modules for one render: the draft, sending, commands, history, queue
 * actions, catalogs and the derived state of the row. It never subscribes to the text.
 */
export function useComposer({
  session,
  messages,
  isWorking,
  onMessageAdmitted,
  onModelsChange,
  onCreateSession,
  onCreateSessionError,
  pendingInputs = NO_PENDING_INPUTS,
  runningWork,
  requests = NO_REQUESTS,
  onNavigateToNewTask,
}: ComposerProps) {
  const newTask = Boolean(onCreateSession);
  // Questions, forms and subagents' requests hold the message back until they are answered.
  const requestOpen = requestsBlockSend(requests, session.id);
  const runtime = useAtomValue(runtimeAtom);
  const profileID = runtime?.profileID;
  // A new task has no goal yet; only an existing task can be replacing one.
  const goal = useSessionGoal(session.id, session.location, { enabled: !newTask });
  const draftScope = draftScopeFor(profileID, session, newTask);
  const contents = useComposerDraft(draftScope);
  const { files, comments, browserComments, sending, edit } = contents;
  const defaultDelivery = useAtomValue(defaultDeliveryAtom);
  const delivery = edit?.delivery ?? defaultDelivery;
  const autoBackground = useAtomValue(autoBackgroundOnSteerAtom);
  const localAttachments = runtime?.capabilities?.localFileAttachments !== false;
  const projects = useProjectCatalog();
  // Recent prompts, outputs and stashes are shared by the project's tasks on this connection.
  const projectID = projectForSession(projects, session)?.id ?? session.projectID;
  const recentScope = recentPromptScope(profileID, projectID);
  const permissions = useComposerPermissions(session, newTask, draftScope);
  const location = useComposerLocation({ session, projects, runtime, newTask, draftScope });
  const errorScope = JSON.stringify([
    draftScope,
    session.id,
    session.parentID,
    runtime?.connectionID,
    edit?.id,
  ]);
  const errors = useComposerErrors(errorScope);
  const attachments = useComposerAttachments({
    scopeKey: errorScope,
    connectionID: runtime?.connectionID,
    localAttachments,
    isSending: () => contents.store.get(contents.stateAtom).sending,
    writer: () => contents.writer(),
    errors,
  });
  const focus = useComposerFocus(draftScope, requestOpen);
  const live = useLatest<ComposerLiveProps>({ messages, pendingInputs });
  const menus = useComposerMenus();
  const history = useComposerHistory({
    draftScope,
    forceNormal: { request: requestOpen, editing: edit !== null },
    recentScope,
    live,
    contents,
    errors,
    focus: focus.focus,
  });
  const mode = history.mode;
  const blockedSteer = useBlockedSteer({
    sessionID: session.id,
    messages,
    runningWork,
    live,
    autoBackground,
  });
  const queue = useQueueActions({
    sessionID: session.id,
    messages,
    live,
    contents,
    errors,
    focus,
    blockedSteer,
    canWatchSteer: isWorking && !newTask && !session.parentID,
  });
  const catalogs = useComposerCatalogs({
    session,
    newTask,
    draftScope,
    profileID,
    projects,
    agentsWanted: menus.active === "agent" || menus.agentCycle?.scope === draftScope,
    onModelsChange,
  });
  const selection = catalogs.selection;
  const taskLocation = selection.session.location;
  useComposerPrefetch(taskLocation, session.projectID);
  const context = useComposerContext({
    messages,
    models: catalogs.catalog.models,
    connected: Boolean(runtime?.connected),
    working: isWorking,
    sending,
    suggestCompaction: !newTask && mode === "normal" && edit === null,
  });
  // The notice's "Send as is" holds until compacting first is no longer suggested.
  const [sendAsIs, setSendAsIs] = useState(false);
  if (sendAsIs && context.compactSuggestion === null) setSendAsIs(false);
  const compactFirst = context.compactSuggestion !== null && !sendAsIs;
  const stash = useComposerStash({
    profileID,
    projectID,
    contents,
    errors,
    available:
      mode === "normal" && edit === null && !sending && !attachments.upload && !requestOpen,
    focus: focus.focus,
  });
  const mentions = useComposerMentions(contents, focus);
  const rootRef = useRef<HTMLDivElement>(null);
  // The text field's element, for popups that hand focus back to it when they close.
  const editorElement = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>("[data-palot-composer-input]") ?? null,
    [],
  );
  useComposerFileDrop({
    rootRef,
    attachments,
    disabled: mode !== "normal" || sending || requestOpen,
  });
  const queueRef = useRef<ComposerQueueHandle>(null);
  const [multiModelOpen, setMultiModelOpen] = useState(false);
  const openMultiModel = useCallback(() => setMultiModelOpen(true), []);
  const steerShortcut = formatShortcut(useShortcutKeys("composer.steer"));
  const queueFirstShortcut = formatShortcut(useShortcutKeys("composer.queue-first"));
  const requestSessionStop = useSetAtom(requestSessionStopAtom);
  const requestGlobalCommand = useSetAtom(requestGlobalCommandAtom);
  const workbench = useWorkbenchCommands(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  useComposerShortcuts({
    draftScope,
    disabled: requestOpen || location.missing,
    rootRef,
    selectionDisabled: sending || selection.busy,
    attachDisabled: sending || Boolean(attachments.upload),
    catalogs,
    menus,
    attach: () => void attachments.pickFiles(),
    setMode: history.setMode,
  });
  const commands = useComposerCommands({
    session,
    messages,
    pendingInputs,
    connectionID: runtime?.connectionID,
    profileID,
    newTask,
    blocked: requestOpen || location.missing,
    contents,
    errors,
    focus,
    catalogs,
    menus,
    queue,
    onNavigateToNewTask,
  });
  const { confirm, dialog: confirmDialog } = useComposerConfirm();
  const send = useComposerSend({
    session,
    runtime,
    working: isWorking,
    mode,
    delivery,
    compactSuggested: compactFirst,
    goal,
    confirm,
    recentScope,
    contents,
    errors,
    attachments,
    history,
    blockedSteer,
    commands,
    catalogs,
    permissions,
    location,
    onCreateSession,
    onMessageAdmitted,
    onCreateSessionError,
    onQueuedFirst: (id) => queueRef.current?.moveFirst(id, "send"),
  });
  const manageModels = useCallback(
    () => requestGlobalCommand("settings.open:models"),
    [requestGlobalCommand],
  );
  const openContext = useCallback(() => {
    workbench.openTab({ kind: "context", location: session.location }, { pane: "right" });
  }, [session.location, workbench]);
  const stopTask = () => {
    // The transcript says "Stopping" until the run ends.
    requestSessionStop(session.id);
    void palot.interrupt(session.id);
  };

  const hasContext = files.length > 0 || comments.length > 0 || browserComments.length > 0;
  const canSubmit = composerCanSubmit({
    shell: mode === "shell",
    hasText: contents.facts.hasText,
    btw: contents.facts.btw,
    hasContext,
    uploading: Boolean(attachments.upload),
    selectionBlocked: selection.blocked,
    permissionsBusy: permissions.busy,
    locationMissing: location.missing,
    requestOpen,
    sending,
    canceling: Boolean(contents.cancelingID),
    connected: runtime?.connected !== false,
  });
  const primary = primaryAction({
    working: isWorking,
    canSubmit,
    shell: mode === "shell",
    editing: edit !== null,
    delivery,
    compactSuggested: compactFirst,
  });
  const enterState: ComposerEnterState = {
    empty: !contents.facts.hasText && !hasContext && !attachments.upload,
    working: isWorking && !newTask,
    queued: pendingInputs.filter((request) => request.delivery === "queue").length,
    editing: Boolean(edit || contents.cancelingID),
    shell: mode === "shell",
    submitting: sending,
    delivery,
  };
  const approvalsDisabled = sending || selection.busy || !runtime?.connected;
  // The launcher's Approvals entry chooses; Full access confirms in this dialog first.
  const approvalChoice = useApprovalChoice({
    busy: permissions.busy,
    disabled: approvalsDisabled,
    onSelect: permissions.select,
    onSelectionComplete: focus.focus,
  });
  const approvals = {
    /** Remounts the model popover when the connection or draft changes. */
    identity: JSON.stringify([runtime?.connectionID, draftScope]),
    mode: permissions.mode,
    disabled: approvalsDisabled || approvalChoice.updating,
    choose: approvalChoice.choose,
    dialog: approvalChoice.dialog,
  };

  return {
    session,
    isWorking,
    newTask,
    requestOpen,
    runtime,
    profileID,
    projects,
    projectID,
    taskLocation,
    mode,
    sending,
    edit,
    files,
    comments,
    browserComments,
    localAttachments,
    pendingInputs,
    contents,
    errors,
    attachments,
    focus,
    history,
    blockedSteer,
    queue,
    catalogs,
    selection,
    context,
    stash,
    mentions,
    menus,
    commands,
    send,
    location,
    confirmDialog,
    rootRef,
    editorElement,
    queueRef,
    multiModelOpen,
    setMultiModelOpen,
    openMultiModel,
    steerShortcut,
    queueFirstShortcut,
    canSubmit,
    primary,
    enterState,
    approvals,
    /** Compacting before the next send: the history it would summarize, and the choice. */
    compact: { tokens: context.compactSuggestion, sendAsIs, setSendAsIs },
    stopTask,
    manageModels,
    openContext,
  };
}

export type ComposerController = ReturnType<typeof useComposer>;
