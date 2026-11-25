import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";
import type { PalotMessage, PalotSession } from "../../../shared";
import {
  composerActionRequestAtom,
  requestGlobalCommandAtom,
  type ComposerActionRequest,
} from "../../atoms/command-requests";
import { useCacheSession, useTaskTitleLookup } from "../../hooks/use-session-catalog";
import { browserCommentsFromMessage, retainedComposerFiles } from "../../lib/browser-comments";
import { emptyComposerDraft } from "../../lib/composer-draft";
import { composerDraftWithRetainedFiles } from "../../lib/composer-restoration";
import { findModelForQuery } from "../../lib/model-picker";
import {
  modelPickerUsageAtom,
  modelPreferenceKey,
  rememberRecentModel,
} from "../../lib/model-preferences";
import { reviewCommentsFromMessage } from "../../lib/review-comments";
import { primaryAgents } from "../../lib/selection-memory";
import { showErrorToast } from "../../lib/toast-error";
import type { PendingRequestView } from "../../lib/view-models";
import { palot } from "../../services/palot";
import type { ComposerCatalogs } from "./use-composer-catalogs";
import type { ComposerContents, ComposerDraftState } from "./use-composer-draft";
import { errorText, type ComposerErrors } from "./use-composer-errors";
import type { ComposerFocus } from "./use-composer-focus";
import type { ComposerMenus } from "./use-composer-menus";
import type { QueueActions } from "./use-queue-actions";

/** Slash commands that run a global palette command; `task` ones need an existing task. */
const SLASH_GLOBAL_COMMANDS: Readonly<Record<string, { id: string; task: boolean }>> = {
  fork: { id: "task.fork", task: true },
  export: { id: "task.export", task: true },
  open: { id: "task.files.open", task: true },
  mcp: { id: "settings.open:tools", task: false },
  reload: { id: "server.reloadConfiguration", task: false },
};
/** Commands `run` handles itself; every other command goes to OpenCode with the draft's text. */
const PALOT_COMMANDS = new Set([
  "compact",
  "new",
  "clear",
  "model",
  "agent",
  "undo",
  "revert",
  "redo",
  "restore",
  ...Object.keys(SLASH_GLOBAL_COMMANDS),
]);

/** Whether Palot runs this command without arguments, so a launcher pick can run it at once. */
export function runsInComposer(commandName: string): boolean {
  return PALOT_COMMANDS.has(commandName.toLowerCase());
}

/** A palette request older than this was meant for a composer that has since gone. */
const COMPOSER_ACTION_TTL_MS = 5_000;

/**
 * Slash commands Palot runs itself (compact, new, model, agent, undo, redo, restore and the
 * palette commands), from the draft or from the command palette.
 */
export function useComposerCommands({
  session,
  messages,
  pendingInputs,
  connectionID,
  profileID,
  newTask,
  blocked,
  contents,
  errors,
  focus,
  catalogs,
  menus,
  queue,
  onNavigateToNewTask,
}: {
  session: PalotSession;
  messages: PalotMessage[];
  pendingInputs: PendingRequestView[];
  connectionID: string | undefined;
  profileID: string | undefined;
  newTask: boolean;
  /** A request card or a missing workspace owns the composer. */
  blocked: boolean;
  contents: ComposerDraftState;
  errors: ComposerErrors;
  focus: ComposerFocus;
  catalogs: ComposerCatalogs;
  menus: ComposerMenus;
  queue: QueueActions;
  onNavigateToNewTask?(): void;
}) {
  const { catalog, pickerModels, preferenceScope, selection } = catalogs;
  const draftScope = contents.scope;
  const cacheSession = useCacheSession();
  const taskTitle = useTaskTitleLookup();
  const requestGlobalCommand = useSetAtom(requestGlobalCommandAtom);
  const setModelPickerUsage = useSetAtom(modelPickerUsageAtom);
  const { setSending } = contents;

  /** Reports a failure unless the user has moved to another task's composer meanwhile. */
  function reportHere(error: unknown, fallback: string) {
    if (focus.isActive(draftScope)) errors.report(errorText(error, fallback));
  }

  /**
   * Runs a Palot-handled slash command; false when the command is not one. `submitted` is the
   * draft the command was typed in, retired once it ran. Commands from the palette leave a typed
   * draft alone: undo and redo restore the reverted prompt only into an empty composer.
   */
  async function run(
    commandName: string,
    args: string | undefined,
    submitted: ComposerContents | null,
  ): Promise<boolean> {
    const fromDraft = submitted !== null;
    const current = contents.read();
    const writer = contents.writer();
    const clearDraft = () => {
      if (submitted) contents.clearSubmitted(submitted);
    };
    const restoresDraft =
      fromDraft ||
      (!current.draft.text.trim() &&
        current.files.length === 0 &&
        current.comments.length === 0 &&
        current.browserComments.length === 0);
    const restore = (target: PalotMessage | undefined) => {
      if (!restoresDraft) return;
      writer.setDraft(
        target ? composerDraftWithRetainedFiles(target, taskTitle) : emptyComposerDraft(),
      );
      writer.setFiles(target ? retainedComposerFiles(target) : []);
      writer.setComments(() => (target ? (reviewCommentsFromMessage(target) ?? []) : []));
      writer.setBrowserComments(() => (target ? (browserCommentsFromMessage(target) ?? []) : []));
    };
    if (commandName === "compact") {
      try {
        setSending(true);
        await palot.compactSession(session.id);
        clearDraft();
      } catch (error) {
        errors.report(errorText(error, "Compaction failed"));
      } finally {
        setSending(false);
      }
      return true;
    }
    if (commandName === "new" || commandName === "clear") {
      clearDraft();
      if (!newTask) onNavigateToNewTask?.();
      return true;
    }
    if (commandName === "model") {
      clearDraft();
      const arg = args?.trim();
      if (arg) {
        // Same matching as the picker's search; visible models win over hidden ones.
        const providerNames = new Map(
          catalog.providers.map((provider) => [provider.id, provider.name]),
        );
        const matched =
          findModelForQuery(pickerModels, arg, providerNames) ??
          findModelForQuery(catalog.models, arg, providerNames);
        if (matched) {
          try {
            await selection.selectModel({ providerID: matched.providerID, id: matched.id });
            setModelPickerUsage((usage) =>
              rememberRecentModel(usage, preferenceScope, modelPreferenceKey(matched)),
            );
          } catch (error) {
            showErrorToast("Could not switch models", error);
          }
          return true;
        }
      }
      menus.open("model");
      return true;
    }
    if (commandName === "agent") {
      clearDraft();
      const arg = args?.trim().toLowerCase();
      const matched = arg
        ? primaryAgents(catalogs.agents).find(
            (agent) => agent.id.toLowerCase() === arg || agent.name.toLowerCase() === arg,
          )
        : undefined;
      if (matched) {
        try {
          await selection.selectAgent(matched);
        } catch (error) {
          showErrorToast("Could not switch agents", error);
        }
        return true;
      }
      menus.open("agent");
      return true;
    }
    const globalCommand = SLASH_GLOBAL_COMMANDS[commandName];
    if (globalCommand) {
      if (globalCommand.task && newTask) {
        errors.report(`Open an existing conversation before using /${commandName}.`);
        return true;
      }
      clearDraft();
      requestGlobalCommand(globalCommand.id);
      return true;
    }
    if (commandName === "undo" || commandName === "revert") {
      const userMessages = messages.filter((message) => message.type === "user");
      const boundary = session.revert
        ? userMessages.findIndex((message) => message.id === session.revert?.messageID)
        : userMessages.length;
      const target = userMessages[Math.max(0, boundary) - 1];
      if (!target) {
        if (fromDraft) writer.setDraft(emptyComposerDraft());
        return true;
      }
      const pending = pendingInputs.find(
        (request) => request.type === "input" && request.id === target.id,
      );
      if (pending) {
        try {
          await queue.edit(pending);
        } catch (error) {
          reportHere(error, "Revert failed");
        }
        return true;
      }
      try {
        setSending(true);
        await palot.interrupt(session.id, connectionID);
        await palot.waitForSessionIdle(session.id, connectionID);
        const updated = await palot.stageSessionRevert(
          { sessionID: session.id, messageID: target.id },
          connectionID,
        );
        if (updated) cacheSession(updated);
        restore(target);
      } catch (error) {
        reportHere(error, "Revert failed");
      } finally {
        setSending(false);
      }
      return true;
    }
    if (commandName === "redo") {
      if (!session.revert) {
        if (fromDraft) writer.setDraft(emptyComposerDraft());
        return true;
      }
      const userMessages = messages.filter((message) => message.type === "user");
      const boundary = userMessages.findIndex(
        (message) => message.id === session.revert?.messageID,
      );
      const target = boundary < 0 ? undefined : userMessages[boundary + 1];
      try {
        setSending(true);
        await palot.interrupt(session.id, connectionID);
        await palot.waitForSessionIdle(session.id, connectionID);
        const updated = target
          ? await palot.stageSessionRevert(
              { sessionID: session.id, messageID: target.id },
              connectionID,
            )
          : await palot.clearSessionRevert(session.id, connectionID);
        if (updated) cacheSession(updated);
        restore(target);
      } catch (error) {
        reportHere(error, "Redo failed");
      } finally {
        setSending(false);
      }
      return true;
    }
    if (commandName === "restore") {
      if (!session.revert) {
        if (fromDraft) writer.setDraft(emptyComposerDraft());
        return true;
      }
      try {
        setSending(true);
        const updated = await palot.clearSessionRevert(session.id);
        if (updated) cacheSession(updated);
        if (fromDraft) {
          writer.setDraft(emptyComposerDraft());
          writer.setFiles([]);
        }
      } catch (error) {
        errors.report(errorText(error, "Restore failed"));
      } finally {
        setSending(false);
      }
      return true;
    }
    return false;
  }

  // Palette task actions that need this composer's draft or menus.
  const handleAction = useEffectEvent((request: ComposerActionRequest) => {
    if (blocked) return;
    if (request.action === "model" || request.action === "agent") {
      if (!contents.sending && !selection.busy) menus.open(request.action);
      return;
    }
    void run(request.action, undefined, null);
  });

  const actionRequest = useAtomValue(composerActionRequestAtom);
  const { store } = contents;
  useEffect(() => {
    const request = actionRequest;
    if (!request || newTask || request.sessionID !== session.id) return;
    if (request.profileID !== null && request.profileID !== profileID) return;
    store.set(composerActionRequestAtom, null);
    if (Date.now() - request.requestedAt > COMPOSER_ACTION_TTL_MS) return;
    handleAction(request);
  }, [actionRequest, newTask, profileID, session.id, store]);

  return { run };
}

export type ComposerCommands = ReturnType<typeof useComposerCommands>;
