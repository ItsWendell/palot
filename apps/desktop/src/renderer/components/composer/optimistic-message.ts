import type { QueryClient } from "@tanstack/react-query";
import type { PalotMessage } from "../../../shared";
import type { SessionExecutionState } from "../../atoms/workspace";
import type { ComposerAdmissionEffects } from "../../lib/composer-admission";
import { convergeMessageReceipt } from "../../lib/message-reconcile";
import { updateSessionActivity } from "../../lib/session-activity-query";

type MessagesUpdate = (current: Map<string, PalotMessage[]>) => Map<string, PalotMessage[]>;

/**
 * Shows a submitted prompt in the transcript and marks its task running before the server
 * confirms, then adopts the server's message ID or takes both back if dispatch failed.
 */
export function optimisticMessageEffects({
  queryClient,
  connectionID,
  setMessages,
  steer,
  onAdmitted,
  onShown,
  onReceipt,
  onRollback,
}: {
  queryClient: QueryClient;
  connectionID: string;
  setMessages(update: MessagesUpdate): void;
  /** The prompt steers the running turn rather than waiting in the queue. */
  steer: boolean;
  /** Runs before the message shows. */
  onAdmitted(): void;
  /** Runs once the message shows in the transcript. */
  onShown(message: PalotMessage): void;
  onReceipt(optimisticID: string, receiptID: string): void;
  onRollback(optimisticID: string, startedAt: number): void;
}): Pick<ComposerAdmissionEffects, "admitOptimistic" | "convergeReceipt" | "rollbackOptimistic"> {
  const previousExecution = new Map<string, SessionExecutionState | undefined>();
  return {
    admitOptimistic: ({ sessionID, message, execution }) => {
      onAdmitted();
      let nextExecution = execution;
      updateSessionActivity(
        queryClient,
        connectionID,
        (current) => {
          const previous = current.execution.get(sessionID);
          previousExecution.set(sessionID, previous);
          if (previous?.status === "running") nextExecution = previous;
          if (previous?.status === "running") return current;
          return {
            ...current,
            activeIDs: new Set(current.activeIDs).add(sessionID),
            execution: new Map(current.execution).set(sessionID, execution),
          };
        },
        [sessionID],
      );
      setMessages((current) => {
        const runStartedAt =
          steer && nextExecution.status === "running"
            ? (nextExecution.startedAt ?? message.createdAt)
            : undefined;
        const optimistic = runStartedAt === undefined ? message : { ...message, runStartedAt };
        return new Map(current).set(sessionID, [...(current.get(sessionID) ?? []), optimistic]);
      });
      onShown(message);
    },
    convergeReceipt: (sessionID, optimisticID, receipt) => {
      onReceipt(optimisticID, receipt.id);
      setMessages((current) => {
        const existing = current.get(sessionID) ?? [];
        const updated = convergeMessageReceipt(
          existing,
          optimisticID,
          receipt.id,
          receipt.createdAt ?? null,
        );
        return new Map(current).set(sessionID, updated);
      });
    },
    rollbackOptimistic: (sessionID, optimisticID, startedAt) => {
      onRollback(optimisticID, startedAt);
      setMessages((current) =>
        new Map(current).set(
          sessionID,
          (current.get(sessionID) ?? []).filter((message) => message.id !== optimisticID),
        ),
      );
      updateSessionActivity(
        queryClient,
        connectionID,
        (current) => {
          if (current.execution.get(sessionID)?.startedAt !== startedAt) return current;
          const execution = new Map(current.execution);
          const activeIDs = new Set(current.activeIDs);
          const previous = previousExecution.get(sessionID);
          if (previous) execution.set(sessionID, previous);
          else execution.delete(sessionID);
          if (previous?.status === "running") activeIDs.add(sessionID);
          else activeIDs.delete(sessionID);
          return { ...current, activeIDs, execution };
        },
        [sessionID],
      );
    },
  };
}
