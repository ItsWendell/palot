/**
 * The task composer's layout. `useComposer` wires the modules; this places them: the stack above
 * the card, the card's chips, editor and errors, and the row. Only the editor field subscribes to
 * the text, so typing re-renders that and nothing here; the launcher's panel, the `+` button and
 * the primary follow the launcher's own atoms.
 */

import { useAtomValue, useSetAtom, type Atom } from "jotai";
import { Mic, PhoneOff, PieChart } from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { requestGlobalCommandAtom } from "../../atoms/command-requests";
import { composerDirectSendAtomFamily } from "../../atoms/composer-state";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { useVoiceCall } from "../../hooks/use-voice-call";
import { emptyComposerDraft } from "../../lib/composer-draft";
import { composerEnterAction } from "../../lib/composer-shortcuts";
import { turnChangedFiles } from "../../lib/turn-changed-files";
import { supportsOpenCodeVoice } from "../../lib/voice/voice-support";
import { parseWorkspaceFileDrop } from "../../lib/workspace-file-drag";
import { ComposerQueue } from "../composer-queue";
import { ContextMeter } from "../context-meter";
import {
  ComposerFoldable,
  ComposerInputArea,
  type ComposerMode,
  ComposerOverflow,
  ComposerOverflowItem,
  ComposerPrimary,
  ComposerStop,
} from "../ui/composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { VoiceCallButton } from "../voice/voice-call-ui";
import { ComposerCard, type ComposerSlots } from "./composer-card";
import {
  ComposerAttachmentChips,
  ComposerBrowserComments,
  ComposerLineComments,
  ComposerUploadStatus,
} from "./composer-chips";
import { ComposerChipMenu } from "./composer-chip-menu";
import { ComposerEditorField } from "./composer-editor-field";
import { ComposerLauncherPanel, type ComposerLauncherData } from "./composer-launcher-panel";
import { ComposerAttachmentErrors, ComposerErrorLine } from "./composer-errors";
import { ComposerPrimaryControls } from "./composer-primary";
import { sameComposerProps, type ComposerProps } from "./composer-props";
import { ComposerNoticeLine } from "./composer-notice";
import { ComposerRow } from "./composer-row";
import {
  useComposerRequests,
  type ComposerRequest,
  type RequestField,
  type RequestPrimary,
} from "./composer-requests";
import { STOP_LABEL, type PrimaryAction } from "./primary-action";
import { useStandingSlots, type ComposerStandingTab } from "./composer-standing";
import { useSettledInputs } from "./use-settled-inputs";
import { useComposer, type ComposerController } from "./use-composer";
import { runsInComposer } from "./use-composer-commands";
import { useComposerLauncher, type ComposerLauncher } from "./use-composer-launcher";
import { useLatest } from "./use-latest";

export type { NewSessionComposerOptions } from "./composer-props";

const ComposerMultiModelDialog = lazy(() =>
  import("../composer-multi-model-dialog").then((module) => ({
    default: module.ComposerMultiModelDialog,
  })),
);
const NO_STANDING: ComposerStandingTab[] = [];
const NO_REQUESTS: ComposerRequest[] = [];

/** Mod+Enter, for asking whether the composer's steer keys would act on the queue right now. */
const STEER_KEY_PRESS = { key: "Enter", shiftKey: false, metaKey: true, ctrlKey: false };

/** While `+` holds the field the primary cannot send the search; it stops a running turn. */
const LAUNCHER_SEND: PrimaryAction = {
  kind: "send",
  label: "Send message",
  disabled: true,
  alternate: null,
  stop: false,
};
const LAUNCHER_STOP: PrimaryAction = {
  kind: "stop",
  label: STOP_LABEL,
  disabled: false,
  alternate: null,
  stop: false,
};

/** What still sits above the card: dialogs. */
function ComposerStack({
  composer: c,
  onOpenCreatedSession,
}: {
  composer: ComposerController;
  onOpenCreatedSession?(sessionID: string): void;
}) {
  return (
    <>
      {c.multiModelOpen && c.runtime && c.newTask ? (
        <Suspense fallback={null}>
          <ComposerMultiModelDialog
            models={c.catalogs.pickerModels}
            connectionID={c.runtime.connectionID}
            busy={c.sending}
            onSend={(models) => c.send.submitToModels(models, c.canSubmit)}
            onClose={() => {
              c.setMultiModelOpen(false);
              c.focus.focus();
            }}
            onOpenTask={(id) => {
              c.setMultiModelOpen(false);
              onOpenCreatedSession?.(id);
            }}
          />
        </Suspense>
      ) : null}
      {c.confirmDialog}
      {c.approvals.dialog}
    </>
  );
}

/** Voice in the `…` menu, once the row has folded the mic away. */
function VoiceOverflowItem() {
  const { snapshot } = useVoiceCall();
  const requestGlobalCommand = useSetAtom(requestGlobalCommandAtom);
  const idle = snapshot.phase === "idle";
  return (
    <ComposerOverflowItem value="voice" onClick={() => requestGlobalCommand("task.voice.toggle")}>
      {idle ? <Mic aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}
      {idle ? "Start voice chat" : "End voice chat"}
    </ComposerOverflowItem>
  );
}

/**
 * The row's end: the context pie and voice, which fold into `…` when the row runs out of room
 * (voice first), then the primary with Stop. In shell mode only the primary stays.
 */
function ComposerRowEnd({
  composer: c,
  requestPrimary,
  launching,
}: {
  composer: ComposerController;
  /** The open request's main action, when the field doubles as its answer. */
  requestPrimary: RequestPrimary | null;
  /** `+` holds the field. */
  launching: Atom<boolean>;
}) {
  const { context, runtime, session } = c;
  const shell = c.mode === "shell";
  const meter = !shell && !c.newTask && context.meterVisible;
  const voice = !shell && Boolean(runtime?.connected) && supportsOpenCodeVoice(runtime?.version);
  const percent = context.usage && !context.usage.compacted ? context.usage.percentage : null;
  return (
    <>
      {meter ? (
        <ComposerFoldable value="context" priority={2}>
          <ContextMeter
            usage={context.usage}
            sessionTokens={session.tokens}
            cost={session.cost}
            lastCompactedAt={context.lastCompactedAt}
            compacting={context.compacting}
            compactDisabledReason={context.compactDisabledReason}
            onCompact={() => void c.commands.run("compact", undefined, null)}
            onOpenDetails={c.openContext}
          />
        </ComposerFoldable>
      ) : null}
      {voice ? (
        <ComposerFoldable value="voice" priority={1}>
          <VoiceCallButton
            session={c.selection.session}
            connectionID={runtime?.connected ? runtime.connectionID : null}
            projectName={c.taskLocation.directory.replace(/\/+$/, "").split("/").at(-1) ?? null}
            supported
          />
        </ComposerFoldable>
      ) : null}
      <ComposerOverflow>
        {meter ? (
          <ComposerOverflowItem value="context" onClick={c.openContext}>
            <PieChart aria-hidden="true" />
            {percent === null ? "Context details" : `Context ${Math.round(percent)}% full`}
          </ComposerOverflowItem>
        ) : null}
        {voice ? <VoiceOverflowItem /> : null}
      </ComposerOverflow>
      <ComposerPrimarySlot composer={c} requestPrimary={requestPrimary} launching={launching} />
    </>
  );
}

/**
 * The primary, which alone in the row follows whether `+` holds the field: the search there is
 * neither a message nor a request's answer.
 */
function ComposerPrimarySlot({
  composer: c,
  requestPrimary,
  launching: launchingAtom,
}: {
  composer: ComposerController;
  requestPrimary: RequestPrimary | null;
  launching: Atom<boolean>;
}) {
  const launching = useAtomValue(launchingAtom);
  if (requestPrimary && !launching)
    return (
      <RequestPrimaryControls primary={requestPrimary} working={c.isWorking} onStop={c.stopTask} />
    );
  return (
    <ComposerPrimaryControls
      action={launching ? (c.isWorking ? LAUNCHER_STOP : LAUNCHER_SEND) : c.primary}
      sending={c.sending}
      waitingForUpload={c.send.waitingForUpload}
      steerShortcut={c.steerShortcut}
      queueFirstShortcut={c.queueFirstShortcut}
      compactTokens={c.compact.tokens}
      multiModel={c.newTask && c.mode === "normal" && !launching}
      onSubmit={(alternate) => void c.send.submit(alternate ?? undefined)}
      onStop={c.stopTask}
      onOpenMultiModel={() => c.setMultiModelOpen(true)}
    />
  );
}

/** The request's main action in the primary's place, with Stop beside it while the agent works. */
function RequestPrimaryControls({
  primary,
  working,
  onStop,
}: {
  primary: RequestPrimary;
  working: boolean;
  onStop(): void;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerPrimary
              {...primary.view}
              shortcut={["Enter"]}
              disabled={primary.disabled}
              onClick={primary.onPress}
            />
          }
        />
        <TooltipContent>{primary.view.name ?? primary.view.label} · Enter</TooltipContent>
      </Tooltip>
      {working ? (
        <Tooltip>
          <TooltipTrigger render={<ComposerStop aria-label={STOP_LABEL} onClick={onStop} />} />
          <TooltipContent>Stop the agent</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}

/** The queued messages, mounted in the card's queue slot. */
function ComposerPendingQueue({ composer: c }: { composer: ComposerController }) {
  const { blockedSteer } = c;
  const waiting = blockedSteer.waiting;
  // Copies a move to the top admits stand for messages already shown; they skip the idle grace.
  const [copies] = useState(() => new Map<string, string>());
  const requests = useSettledInputs(c.pendingInputs, c.isWorking, copies);
  return (
    <ComposerQueue
      ref={c.queueRef}
      sessionID={c.session.id}
      requests={requests}
      filesByID={c.queue.filesByID}
      working={c.isWorking || c.sending}
      editDisabled={Boolean(c.edit || c.contents.cancelingID || c.sending)}
      steerFirstShortcut={composerEnterAction(STEER_KEY_PRESS, c.enterState) === "steer-first"}
      copies={copies}
      moveDisabled={Boolean(c.contents.cancelingID)}
      blocked={
        waiting && blockedSteer.promptItems.length > 0
          ? {
              ...waiting,
              items: blockedSteer.promptItems,
              backgrounding: blockedSteer.backgrounding,
              retry: blockedSteer.prompt?.retry ?? false,
              error: blockedSteer.prompt?.error ?? null,
              onBackground: blockedSteer.background,
            }
          : null
      }
      editing={c.edit ? { onDiscard: c.queue.discardEdit } : null}
      onEdit={c.queue.edit}
      onDelete={c.queue.remove}
      onSteered={c.queue.steered}
    />
  );
}

/** Comments, attachments, mentions and upload progress, for the card's header slot. */
function ComposerChips({ composer: c }: { composer: ComposerController }) {
  const { contents, attachments } = c;
  const sendNow = useAtomValue(composerDirectSendAtomFamily(contents.scope));
  return (
    <>
      <ComposerLineComments
        comments={c.comments}
        onChange={(update) => contents.writer().setComments(update)}
        onSendNow={sendNow ?? undefined}
      />
      <ComposerBrowserComments
        comments={c.browserComments}
        onChange={(update) => contents.writer().setBrowserComments(update)}
      />
      <ComposerAttachmentChips
        contents={contents}
        files={c.files}
        onRemoveFile={(uri) =>
          contents.writer().setFiles((current) => current.filter((item) => item.uri !== uri))
        }
      />
      {attachments.upload ? (
        <ComposerUploadStatus upload={attachments.upload} onCancel={attachments.cancel} />
      ) : null}
      <ComposerAttachmentErrors errors={c.errors.attachmentErrors} />
    </>
  );
}

/**
 * The composer's text field as the request panel reads it. Only rare facts (empty or not) come
 * in as values; the text and the last keystroke are read when the panel acts.
 */
function useRequestField(
  c: ComposerController,
  launcher: ComposerLauncher,
  lastKeystrokeAt: () => number | null,
): RequestField {
  const { contents, focus } = c;
  const empty = !contents.facts.hasText;
  return useMemo(
    () => ({
      empty,
      hasDraft: () => {
        const current = contents.read();
        return (
          current.draft.text.trim().length > 0 ||
          current.files.length > 0 ||
          current.comments.length > 0 ||
          current.browserComments.length > 0
        );
      },
      text: () => contents.read().draft.text,
      setText: (text) => contents.writer().setDraft({ ...emptyComposerDraft(), text }),
      focus: focus.focus,
      lastKeystrokeAt,
      // The launcher takes Enter and the arrows while it is open, over a request too.
      suggestionsOpen: launcher.isOpen,
    }),
    // `contents` is rebuilt every render; its reads and writes go through stable atoms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empty, contents.scope, focus.focus, lastKeystrokeAt, launcher],
  );
}

/**
 * The card with the panel slot's precedence applied: the launcher while it is open (over a
 * request, which comes back when it closes), else the request, else a tab's panel. It alone
 * follows whether the launcher is open, so opening one re-renders the card's frame while the
 * row, the queue and the field it was handed stay as they are.
 */
function ComposerFrame({
  launcher,
  launcherPanel,
  mode,
  slots,
  ...card
}: ComponentProps<typeof ComposerCard> & { launcher: ComposerLauncher; launcherPanel: ReactNode }) {
  const open = useAtomValue(launcher.openAtom);
  const launching = useAtomValue(launcher.plusOpenAtom);
  const panel = open
    ? {
        key: "launcher",
        label: "Add to message",
        content: launcherPanel,
        onClose: () => launcher.dispatch({ type: "close" }),
      }
    : slots.panel;
  return (
    <ComposerCard
      {...card}
      mode={launching ? "launcher" : mode}
      slots={panel === slots.panel ? slots : { ...slots, panel }}
    />
  );
}

/** The last turn's state for the launcher's "Suggested" rows, read when it opens. */
function useLauncherSession(c: ComposerController, messages: ComposerProps["messages"]) {
  const usage = c.context.usage;
  const live = useLatest({
    messages,
    newTask: c.newTask,
    percent: usage && !usage.compacted ? usage.percentage : null,
  });
  return useCallback(() => {
    const { messages: all, newTask, percent } = live.current;
    if (newTask) return null;
    const lastUser = all.findLastIndex((message) => message.type === "user");
    return {
      contextPercent: percent,
      changedFiles: lastUser < 0 ? 0 : turnChangedFiles(all.slice(lastUser + 1)).length,
    };
  }, [live]);
}

function ComposerView(props: ComposerProps) {
  const c = useComposer(props);
  const { contents, mode, sending, attachments, errors, selection } = c;
  const workbench = useWorkbenchCommands(
    c.runtime ? { profileID: c.runtime.profileID, sessionID: c.session.id } : null,
  );
  const live = useLatest({ messages: props.messages });
  const launcher = useComposerLauncher({
    contents,
    focus: c.focus,
    mode,
    disabled: c.location.missing,
    sessionID: c.session.id,
    connectionID: c.runtime?.connectionID ?? "disconnected",
    location: c.taskLocation,
    actions: {
      attach: () => void attachments.pickFiles(),
      enterShell: () => c.history.setMode("shell"),
      sendToModels: c.openMultiModel,
      restoreStash: (id) => void c.stash.restore(id),
      deleteStash: (id) => c.stash.remove(id),
      runCommand(name) {
        if (!runsInComposer(name)) return false;
        void c.commands.run(name.toLowerCase(), undefined, null);
        return true;
      },
      chooseApprovals: (preset) => c.approvals.choose(preset),
      review: (args) => void c.send.submitCommand("review", args),
      reviewChanges() {
        const userMessageID = live.current.messages.findLast(
          (message) => message.type === "user",
        )?.id;
        if (!userMessageID) return;
        workbench.openTab(
          { kind: "turn-diff", location: c.session.location, userMessageID },
          { pane: "right" },
        );
      },
    },
  });
  const readLauncherSession = useLauncherSession(c, props.messages);
  const attachDisabled = !c.localAttachments || Boolean(attachments.upload);
  const approvalMode = c.approvals.mode;
  const approvalsDisabled = c.approvals.disabled;
  const launcherData = useMemo<ComposerLauncherData>(
    () => ({
      location: c.taskLocation,
      projectID: c.session.projectID,
      outputProjectID: c.projectID,
      sessionID: c.newTask ? null : c.session.id,
      workbenchSessionID: c.session.id,
      newTask: c.newTask,
      stashScope: c.stash.scope,
      attachDisabled,
      approvals: { mode: approvalMode, disabled: approvalsDisabled },
      session: readLauncherSession,
    }),
    [
      approvalMode,
      approvalsDisabled,
      attachDisabled,
      c.newTask,
      c.projectID,
      c.session.id,
      c.session.projectID,
      c.stash.scope,
      c.taskLocation,
      readLauncherSession,
    ],
  );
  // When the user last pressed a key in the field; a ref, so typing never re-renders this.
  const keystrokeRef = useRef<number | null>(null);
  const lastKeystrokeAt = useCallback(() => keystrokeRef.current, []);
  const field = useRequestField(c, launcher, lastKeystrokeAt);
  const requests = useComposerRequests({
    sessionID: c.session.id,
    requests: props.requests ?? NO_REQUESTS,
    guests: props.guests,
    field,
    agentOf: props.agentOf,
    sendInstead: c.requestOpen
      ? null
      : {
          label: c.isWorking ? "Steer it instead" : "Send it instead",
          run: () => void c.send.submit(),
        },
  });
  const standing = useStandingSlots(
    c.session.id,
    props.standing ?? NO_STANDING,
    requests.open,
    props.runningWork,
  );
  const slots: ComposerSlots = {
    notice: <ComposerNoticeLine composer={c} usageLimit={props.usageLimit ?? null} />,
    tabs: standing.tabs,
    panel: requests.open
      ? {
          key: `request:${requests.key}`,
          // The request names itself inside; the slot is the place it waits in.
          label: "Pending request",
          content: requests.content,
          // Escape leaves the request for the field; it never answers it.
          onClose: c.focus.focus,
        }
      : standing.panel,
    queue: <ComposerPendingQueue composer={c} />,
    header: <ComposerChips composer={c} />,
  };
  const cardMode: ComposerMode = mode === "shell" ? "shell" : requests.open ? "request" : "message";
  return (
    <ComposerFrame
      ref={c.rootRef}
      launcher={launcher}
      launcherPanel={<ComposerLauncherPanel launcher={launcher} data={launcherData} />}
      mode={cardMode}
      historyMode={mode}
      dragOverAtom={attachments.dragOverAtom}
      dropDisabled={mode !== "normal" || sending || c.requestOpen}
      onWorkspaceFileDrop={(data) => {
        const { directory, workspaceID } = c.taskLocation;
        const path = parseWorkspaceFileDrop(data, c.profileID, directory, workspaceID);
        if (path) c.mentions.mentionFile(path);
      }}
      contextBar={props.contextBar}
      stack={<ComposerStack composer={c} onOpenCreatedSession={props.onOpenCreatedSession} />}
      slots={slots}
      footer={
        <ComposerRow
          mode={mode}
          sending={sending}
          newTask={c.newTask}
          launcher={{
            openAtom: launcher.plusOpenAtom,
            listId: launcher.listId,
            disabled: c.location.missing,
            onToggle: () => launcher.toggle("button"),
            onOpenApprovals: () => launcher.openCategory("approvals"),
          }}
          onExitShell={() => c.history.setMode("normal")}
          onSelectionComplete={c.focus.focus}
          editorElement={c.editorElement}
          catalogs={c.catalogs}
          menus={c.menus}
          approvals={c.approvals}
          onManageModels={c.manageModels}
          // Only where it works today: a new task in normal mode (the row hides it in shell).
          onSendToModels={c.newTask && c.runtime ? c.openMultiModel : undefined}
          end={
            <ComposerRowEnd
              composer={c}
              requestPrimary={requests.primary}
              launching={launcher.plusOpenAtom}
            />
          }
        />
      }
    >
      <ComposerInputArea
        className="p-0"
        onKeyDownCapture={(event) => {
          // The request reads the previous keystroke, so this one counts only afterwards.
          requests.onFieldKeyDown(event);
          keystrokeRef.current = Date.now();
        }}
      >
        <ComposerEditorField
          contents={contents}
          inputRef={c.focus.inputRef}
          launcher={launcher}
          mode={mode}
          disabled={c.location.missing}
          placeholder={requests.placeholder ?? undefined}
          keys={{
            enterState: c.enterState,
            onStash: () => void c.stash.stash(),
            onRecall: c.history.recall,
            onEnter: (action) => {
              if (action === "steer-first") c.queueRef.current?.steerFirst();
              else if (action === "queue-first") void c.send.submit("queue", "suggested", true);
              // Mod+Enter names the delivery that is not the default; Enter uses the default.
              else void c.send.submit(action === "send" ? undefined : action);
            },
            onModeChange: c.history.setMode,
          }}
          onPaste={(event) => attachments.handlePaste(event, mode === "normal")}
        />
        <ComposerChipMenu rootRef={c.rootRef} />
      </ComposerInputArea>
      <ComposerErrorLine
        message={errors.messageError}
        selectionError={selection.error && !selection.catalogRecovery ? selection.error : null}
      />
    </ComposerFrame>
  );
}

export const Composer = memo(ComposerView, sameComposerProps);
