import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect, useEffectEvent, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../../shared";
import { askBtw } from "../../atoms/btw";
import {
  composerDirectBrowserSendAtomFamily,
  composerDirectSendAtomFamily,
} from "../../atoms/composer-state";
import type { PalotBrowserComment } from "../../../shared/browser-contract";
import type { ComposerDelivery } from "../../atoms/ui";
import { messagesForProfileAtom } from "../../atoms/workspace";
import { useBrowserSession } from "../../hooks/use-browser-session";
import { useComposerPermissions } from "../../hooks/use-composer-permissions";
import { settledSessionGoal } from "../../hooks/use-session-goal";
import { liveBrowserComments } from "../../lib/browser-comments";
import { draftAfterBtw, parseBtwQuestion } from "../../lib/btw";
import { BUILTIN_COMMANDS } from "../../lib/builtin-commands";
import { admitComposerSubmission } from "../../lib/composer-admission";
import {
  emptyComposerDraft,
  projectComposerSubmission,
  type ComposerSubmission,
} from "../../lib/composer-draft";
import type { ComposerMode } from "../../lib/composer-history";
import { recentPromptFromSubmission, saveRecentPrompt } from "../../lib/composer-recent-prompts";
import { resolveModelSelection } from "../../lib/model-selection";
import type { ReviewComment } from "../../lib/review-comments";
import { replacesGoal, type SessionGoal } from "../../lib/session-goal";
import { showErrorToast } from "../../lib/toast-error";
import { palot } from "../../services/palot";
import type { NewSessionComposerOptions } from "./composer-props";
import type { ComposerConfirm } from "./composer-confirm-dialog";
import { optimisticMessageEffects } from "./optimistic-message";
import { sendToModels } from "./send-to-models";
import type { BlockedSteer } from "./use-blocked-steer";
import type { ComposerAttachments } from "./use-composer-attachments";
import type { ComposerCatalogs } from "./use-composer-catalogs";
import type { ComposerCommands } from "./use-composer-commands";
import type { ComposerContents, ComposerDraftState } from "./use-composer-draft";
import { errorText, type ComposerErrors } from "./use-composer-errors";
import type { ComposerHistory } from "./use-composer-history";
import type { ComposerLocation } from "./use-composer-location";

/** A slash command still running after this long gives the composer back; it reports failure later. */
const COMMAND_DETACH_MS = 3_000;

const EMPTY_SUBMISSION: ComposerSubmission = {
  kind: "prompt",
  text: "",
  files: [],
  skills: [],
  agents: [],
  references: [],
};

type Permissions = ReturnType<typeof useComposerPermissions>;

/**
 * Sending: prompts and slash commands with optimistic admission and rollback, the task a new-task
 * composer creates first, shell commands, `/btw`, "Send to several models" and a review comment
 * sent on its own.
 */
export function useComposerSend({
  session,
  runtime,
  working,
  mode,
  delivery,
  compactSuggested,
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
  onQueuedFirst,
}: {
  session: PalotSession;
  runtime: OpenCodeRuntimeStatus | null;
  /** A turn is running in this task. */
  working: boolean;
  mode: ComposerMode;
  /** The delivery for a message sent while the agent works. */
  delivery: ComposerDelivery;
  compactSuggested: boolean;
  goal: SessionGoal | null;
  confirm: ComposerConfirm;
  recentScope: string | null;
  contents: ComposerDraftState;
  errors: ComposerErrors;
  attachments: ComposerAttachments;
  history: ComposerHistory;
  blockedSteer: BlockedSteer;
  commands: ComposerCommands;
  catalogs: ComposerCatalogs;
  permissions: Permissions;
  location: ComposerLocation;
  onCreateSession?(options: NewSessionComposerOptions): Promise<PalotSession | null>;
  onMessageAdmitted?(): void;
  onCreateSessionError?(error: unknown): void;
  /** A message sent with Alt+Enter was queued; move it ahead of the other queued ones. */
  onQueuedFirst?(inputID: string): Promise<void> | void;
}) {
  const { store, stateAtom, draftAtom, setSending } = contents;
  const { catalog, selection } = catalogs;
  const queryClient = useQueryClient();
  const setMessages = useSetAtom(messagesForProfileAtom(runtime?.profileID ?? "unscoped"));
  const browser = useBrowserSession({
    profileID: runtime?.profileID ?? "unscoped",
    sessionID: session.id,
  });

  /** A prompt sent during an upload, held until the upload finishes. */
  const [waitingForUpload, setWaitingForUpload] = useState(false);

  /** Nothing is being sent, canceled into the composer or switched right now. */
  function busyExceptUpload(): boolean {
    const state = store.get(stateAtom);
    return Boolean(
      location.missing ||
      state.sending ||
      state.cancelingID ||
      selection.blocked ||
      permissions.isBusy(),
    );
  }

  /** Nothing else is being sent, canceled into the composer, uploaded or switched right now. */
  function busy(): boolean {
    return busyExceptUpload() || attachments.busy();
  }

  /**
   * Holds a send made while an attachment uploads: the composer shows it as sending, and it goes
   * once the upload finishes. A failed or canceled upload drops it; the upload reports why.
   */
  async function awaitUpload(): Promise<boolean> {
    setSending(true);
    setWaitingForUpload(true);
    try {
      return await attachments.settled();
    } finally {
      setWaitingForUpload(false);
      setSending(false);
    }
  }

  function browserCommentsToSend(contentsToSend: ComposerContents) {
    return liveBrowserComments(
      contentsToSend.browserComments,
      browser?.bindingID ?? null,
      browser?.state.tabs ?? [],
    );
  }

  async function createTarget(): Promise<PalotSession | null> {
    selection.assertConnection();
    permissions.assertReady();
    if (!onCreateSession) return session;
    const created = await onCreateSession({
      approvalMode: permissions.draftMode,
      agent: selection.session.agent,
      model: selection.creationModel,
    });
    selection.assertConnection();
    if (created) {
      selection.rememberCreated();
      permissions.resetDraft();
    }
    return created;
  }

  async function submitShell(submitted: ComposerContents) {
    const command = submitted.draft.text.trim();
    if (!command || busy()) return;
    errors.clear();
    const connectionID = runtime?.connectionID;
    await admitComposerSubmission({
      submission: { ...EMPTY_SUBMISSION, text: command },
      files: [],
      delivery: "steer",
      optimistic: false,
      createTarget,
      dispatch: async (sessionID) => {
        selection.assertConnection();
        await palot.runShell({ sessionID, command }, connectionID);
        return null;
      },
      effects: {
        setSending,
        clearLocal: () => {
          // Attachments and comments stay for the next prompt; shell only consumes the text.
          if (store.get(draftAtom) === submitted.draft) store.set(draftAtom, emptyComposerDraft());
          history.reset();
          history.rememberShell(command);
          onMessageAdmitted?.();
        },
        admitOptimistic: () => undefined,
        convergeReceipt: () => undefined,
        rollbackOptimistic: () => undefined,
        reportCreationError: (error) => onCreateSessionError?.(error),
        reportDispatchError: (error) => {
          location.reportFailure(error);
          errors.report(errorText(error, "Could not run the shell command."));
        },
      },
    });
  }

  function askSideQuestion(submitted: ComposerContents, question: string) {
    const state = store.get(stateAtom);
    if (state.sending || state.cancelingID) return;
    try {
      if (!question) throw new Error("Enter a question after /btw.");
      if (onCreateSession) throw new Error("Open an existing conversation before using /btw.");
      if (!runtime?.connected) throw new Error("Connect to OpenCode before using /btw.");
      askBtw(
        store,
        {
          profileID: runtime.profileID,
          connectionID: runtime.connectionID,
          sessionID: session.id,
          location: session.location,
        },
        question,
      );
      errors.clear();
      contents.writer(submitted.edit).setDraft(draftAfterBtw(submitted.draft));
    } catch (error) {
      errors.report(errorText(error, "Could not ask this question."));
    }
  }

  /**
   * The goal a `/goal <objective>` would replace. Sent before the task's goal has loaded, it
   * waits (bounded) for that read; on timeout or failure it keeps the goal the render had.
   */
  async function goalToReplace(): Promise<SessionGoal | null> {
    if (onCreateSession || !runtime) return goal;
    const settled = settledSessionGoal(queryClient, runtime.connectionID, session.id);
    if (!(settled instanceof Promise)) return settled === undefined ? goal : settled;
    // Holds the composer meanwhile, so a second Enter does not send it twice.
    setSending(true);
    try {
      const loaded = await settled;
      return loaded === undefined ? goal : loaded;
    } finally {
      setSending(false);
    }
  }

  /** Sends what the composer holds: a shell command, a `/btw` question, or a prompt or command. */
  async function submit(
    deliveryOverride?: ComposerDelivery,
    compaction: "suggested" | "skip" = "suggested",
    /** Alt+Enter: while the agent works, queue the message ahead of the queued ones. */
    first = false,
  ) {
    const submitted = contents.read();
    if (mode === "shell") {
      await submitShell(submitted);
      return;
    }
    const question = parseBtwQuestion(submitted.draft.text);
    if (question !== null) {
      askSideQuestion(submitted, question);
      return;
    }
    if (attachments.busy() && !busyExceptUpload()) {
      if (!(await awaitUpload())) return;
      // The draft may have changed meanwhile, and now holds the uploaded files.
      await submit(deliveryOverride, compaction, first);
      return;
    }
    await submitPrompt({
      submission: projectComposerSubmission(submitted.draft),
      contents: submitted,
      deliveryOverride,
      compaction,
      direct: false,
      first,
    });
  }

  /**
   * Admits prompt contents through the normal send path. `direct` sends contents that are not in
   * the composer (a review comment sent from its popup) and leaves the draft and attachments alone.
   */
  async function submitPrompt(input: {
    submission: ComposerSubmission;
    contents: ComposerContents;
    deliveryOverride?: ComposerDelivery;
    compaction: "suggested" | "skip";
    direct: boolean;
    first?: boolean;
  }): Promise<boolean> {
    const { submission, contents: submitted, deliveryOverride, compaction, direct } = input;
    // Only a prompt to a working task is queued first; otherwise Alt+Enter sends like Enter.
    const first =
      input.first === true && working && !onCreateSession && submission.kind === "prompt";
    let admittedID: string | null = null;
    const { files, comments, browserComments } = submitted;
    let sent = false;
    if (
      (!submission.text.trim() &&
        files.length === 0 &&
        submission.skills.length === 0 &&
        comments.length === 0 &&
        browserComments.length === 0) ||
      busy()
    )
      return false;
    if (submission.kind === "command" && (comments.length > 0 || browserComments.length > 0)) {
      errors.report("Remove comments before running a slash command.");
      return false;
    }
    if (
      submission.kind === "command" &&
      files.length > 0 &&
      BUILTIN_COMMANDS.some((command) => command.name === submission.command.toLowerCase())
    ) {
      errors.report("Remove picked attachments before running a slash command.");
      return false;
    }
    if (!direct) errors.clear();

    if (
      submission.kind === "command" &&
      submission.command.toLowerCase() === "goal" &&
      replacesGoal(await goalToReplace(), submission.arguments) &&
      !(await confirm({
        title: "Replace the current goal?",
        description: "The task keeps its history, and the new objective starts from round 1.",
        confirmLabel: "Replace goal",
      }))
    )
      return false;

    if (
      submission.kind === "command" &&
      (await commands.run(submission.command.toLowerCase(), submission.arguments, submitted))
    )
      return false;

    // OpenCode runs a steered compaction before prompts sent after it, so the prompt stays verbatim.
    if (compaction === "suggested" && compactSuggested) {
      setSending(true);
      try {
        await palot.compactSession(session.id);
      } catch (error) {
        setSending(false);
        showErrorToast("Could not compact before sending", error);
        return false;
      }
    }

    const effectiveDelivery = first
      ? "queue"
      : working && !onCreateSession
        ? (deliveryOverride ?? delivery)
        : "steer";
    const submittedBrowserComments = browserCommentsToSend(submitted);
    const submittedComments = comments.map(({ path, comment, selection: range, side }) => ({
      path,
      comment,
      selection: range,
      ...(side ? { side } : {}),
      origin: "review" as const,
    }));
    const modelInput = resolveModelSelection(
      catalog.models,
      selection.session.model,
      catalog.defaultModel,
    ).model?.capabilities.input;
    const mentionInput = {
      ...(submission.agents.length ? { agentReferences: submission.agents } : {}),
      ...(submission.references.length ? { directoryReferences: submission.references } : {}),
    };
    const watchSteer =
      working && effectiveDelivery === "steer" && !onCreateSession && !session.parentID;
    await admitComposerSubmission({
      submission,
      files,
      comments: submittedComments,
      browserComments: submittedBrowserComments,
      delivery: effectiveDelivery,
      optimistic: submission.kind !== "command",
      ...(submission.kind === "command" ? { detachAfterMs: COMMAND_DETACH_MS } : {}),
      createTarget,
      dispatch: (sessionID, messageID) => {
        selection.assertConnection();
        admittedID = messageID;
        return submission.kind === "command"
          ? palot.runCommand({
              sessionID,
              command: submission.command,
              modelInput,
              ...(files.length ? { files } : {}),
              ...(submission.arguments ? { arguments: submission.arguments } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              ...mentionInput,
              delivery: effectiveDelivery,
            })
          : palot.sendComposerPrompt({
              sessionID,
              id: messageID,
              text: submission.text,
              ...(submittedComments.length ? { comments: submittedComments } : {}),
              ...(submittedBrowserComments.length
                ? { browserComments: submittedBrowserComments }
                : {}),
              modelInput,
              ...(files.length ? { files } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              ...mentionInput,
              delivery: effectiveDelivery,
            });
      },
      effects: {
        setSending,
        clearLocal: () => {
          sent = true;
          // A comment sent on its own was never in the composer; keep the draft as it is.
          if (direct) return;
          contents.clearSubmitted(submitted);
          history.reset();
          saveRecentPrompt(
            recentScope,
            recentPromptFromSubmission({
              draft: submitted.draft,
              files,
              comments,
              createdAt: Date.now(),
            }),
          );
        },
        ...optimisticMessageEffects({
          queryClient,
          connectionID: runtime?.connectionID ?? "disconnected",
          setMessages,
          steer: effectiveDelivery === "steer",
          onAdmitted: () => onMessageAdmitted?.(),
          onShown: (message) => {
            if (watchSteer) blockedSteer.track(message.id, message.createdAt);
          },
          onReceipt: blockedSteer.converge,
          onRollback: blockedSteer.forget,
        }),
        reportCreationError: (error) => onCreateSessionError?.(error),
        reportDispatchError: (error) => {
          location.reportFailure(error);
          // The comment editor keeps a direct send's comment and reports the failure itself.
          if (direct) return;
          errors.report(errorText(error, "Palot could not send the attachment."));
        },
      },
    });
    // The message is in the queue; moving it is reported on its own and never loses it.
    if (first && sent && admittedID) await onQueuedFirst?.(admittedID);
    return sent;
  }

  const sendCommentNow = useEffectEvent(
    (comments: { review?: ReviewComment; browser?: PalotBrowserComment }) =>
      submitPrompt({
        submission: EMPTY_SUBMISSION,
        contents: {
          draft: emptyComposerDraft(),
          files: [],
          comments: comments.review ? [comments.review] : [],
          browserComments: comments.browser ? [comments.browser] : [],
          edit: null,
        },
        compaction: "skip",
        direct: true,
      }),
  );
  /**
   * Runs a slash command that is not in the composer (a launcher pick such as `/review`): the
   * draft stays as it is, and delivery, a new task's creation and errors work as for a typed one.
   */
  async function submitCommand(command: string, args: string): Promise<boolean> {
    const text = args.trim();
    if (busy()) return false;
    errors.clear();
    const sent = await submitPrompt({
      submission: {
        kind: "command",
        command,
        ...(text ? { arguments: text } : {}),
        text: text ? `/${command} ${text}` : `/${command}`,
        files: [],
        skills: [],
        agents: [],
        references: [],
      },
      contents: {
        draft: emptyComposerDraft(),
        files: [],
        comments: [],
        browserComments: [],
        edit: null,
      },
      compaction: "skip",
      direct: true,
    });
    if (!sent) errors.report(`Could not run /${command}.`);
    return sent;
  }

  const setDirectSender = useSetAtom(composerDirectSendAtomFamily(contents.scope));
  const setDirectBrowserSender = useSetAtom(composerDirectBrowserSendAtomFamily(contents.scope));
  const newTask = Boolean(onCreateSession);
  useEffect(() => {
    // New-task composers have no task to send to yet.
    if (newTask) return;
    setDirectSender(() => (comment: ReviewComment) => sendCommentNow({ review: comment }));
    setDirectBrowserSender(
      () => (comment: PalotBrowserComment) => sendCommentNow({ browser: comment }),
    );
    return () => {
      setDirectSender(null);
      setDirectBrowserSender(null);
    };
  }, [newTask, setDirectBrowserSender, setDirectSender]);

  const submitToModels = sendToModels({
    newTask: onCreateSession,
    mode,
    contents,
    history,
    selection,
    permissions,
    recentScope,
    browserComments: browserCommentsToSend,
  });

  return { submit, submitCommand, submitToModels, waitingForUpload };
}
