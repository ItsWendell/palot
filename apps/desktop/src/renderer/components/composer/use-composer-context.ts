import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { PalotMessage, PalotModel } from "../../../shared";
import { compactBeforeSendSuggestionAtom, contextMeterVisibleAtom } from "../../atoms/ui";
import {
  compactionRunning,
  getContextUsage,
  lastAssistantActivityAt,
  lastCompletedCompactionAt,
} from "../../lib/context-usage";
import { useCompactSuggestion } from "../context-meter";

/** Context-window usage for the meter, and whether to suggest compacting before the next send. */
export function useComposerContext({
  messages,
  models,
  connected,
  working,
  sending,
  suggestCompaction,
}: {
  messages: PalotMessage[];
  models: PalotModel[];
  connected: boolean;
  working: boolean;
  sending: boolean;
  /** An ordinary prompt in an existing task, where compacting first can help. */
  suggestCompaction: boolean;
}) {
  const usage = useMemo(() => getContextUsage(messages, models), [models, messages]);
  const meterVisible = useAtomValue(contextMeterVisibleAtom);
  const suggestionEnabled = useAtomValue(compactBeforeSendSuggestionAtom);
  const compacting = useMemo(() => compactionRunning(messages), [messages]);
  const lastCompactedAt = useMemo(() => lastCompletedCompactionAt(messages), [messages]);
  const lastActivityAt = useMemo(() => lastAssistantActivityAt(messages), [messages]);
  const compactSuggestion = useCompactSuggestion({
    usage,
    lastActivityAt,
    enabled: suggestionEnabled && suggestCompaction && !working && !compacting,
  });
  const compactDisabledReason = !connected
    ? "Connect to OpenCode to compact."
    : compacting
      ? "Compaction is already running."
      : working
        ? "Wait for the current turn to finish."
        : sending
          ? "Wait for the message to send."
          : !usage
            ? "Nothing to compact yet."
            : null;
  return {
    usage,
    meterVisible,
    compacting,
    lastCompactedAt,
    /** Tokens compacting first would summarize; null when it is not suggested. */
    compactSuggestion,
    compactDisabledReason,
  };
}
