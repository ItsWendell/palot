import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";

function messageTypeOrder(message: PalotMessage): number {
  if (message.type === "user") return 0;
  if (message.type === "assistant") return 1;
  return 2;
}

export function compareMessages(left: PalotMessage, right: PalotMessage): number {
  // Admission order is provisional. Once hydrated, OpenCode's message timestamp
  // reflects delivery order, which can place compaction ahead of pending steers.
  const leftTime = (left.optimistic === true ? left.timelineAt : undefined) ?? left.createdAt;
  const rightTime = (right.optimistic === true ? right.timelineAt : undefined) ?? right.createdAt;
  const chronological = leftTime - rightTime || messageTypeOrder(left) - messageTypeOrder(right);
  if (chronological !== 0) return chronological;
  return left.type === "user" && right.type === "user" ? left.id.localeCompare(right.id) : 0;
}

export function convergeMessageReceipt(
  messages: PalotMessage[],
  optimisticID: string,
  receiptID: string,
  receiptCreatedAt: number | null = null,
): PalotMessage[] {
  const optimistic = messages.find((message) => message.id === optimisticID);
  const receipt = messages.find((message) => message.id === receiptID);
  if (receipt) {
    const reconciled = reconcileMessage(receipt, optimistic, false) ?? receipt;
    const converged =
      receiptCreatedAt === null
        ? reconciled
        : { ...reconciled, createdAt: receiptCreatedAt, timelineAt: receiptCreatedAt };
    return messages.flatMap((message) => {
      if (message.id === optimisticID) return [converged];
      return message.id === receiptID ? [] : [message];
    });
  }
  return messages.map((message) =>
    message.id === optimisticID
      ? {
          ...message,
          id: receiptID,
          ...(receiptCreatedAt === null
            ? {}
            : { createdAt: receiptCreatedAt, timelineAt: receiptCreatedAt }),
        }
      : message,
  );
}

export function reconcileMessage(
  server: PalotMessage | undefined,
  current: PalotMessage | undefined,
  preferCurrent: boolean,
): PalotMessage | undefined {
  const chosen = preferCurrent ? (current ?? server) : (server ?? current);
  if (!chosen || !current) return chosen;
  const preferred = chosen === current ? chosen : withLiveToolProgress(chosen, current);
  const delivery = preferred.delivery ?? current.delivery;
  const timelineAt = current.timelineAt ?? preferred.timelineAt;
  const promotedAt = preferred.promotedAt ?? current.promotedAt;
  const runStartedAt = preferred.runStartedAt ?? current.runStartedAt;
  const runCompletedAt = preferred.runCompletedAt ?? current.runCompletedAt;
  const firstTokenAt = preferred.firstTokenAt ?? current.firstTokenAt;
  const firstTokenRecordedAt = preferred.firstTokenRecordedAt ?? current.firstTokenRecordedAt;
  if (
    delivery === preferred.delivery &&
    timelineAt === preferred.timelineAt &&
    promotedAt === preferred.promotedAt &&
    runStartedAt === preferred.runStartedAt &&
    runCompletedAt === preferred.runCompletedAt &&
    firstTokenAt === preferred.firstTokenAt &&
    firstTokenRecordedAt === preferred.firstTokenRecordedAt
  ) {
    return preferred;
  }
  return {
    ...preferred,
    ...(delivery === undefined ? {} : { delivery }),
    ...(timelineAt === undefined ? {} : { timelineAt }),
    ...(promotedAt === undefined ? {} : { promotedAt }),
    ...(runStartedAt === undefined ? {} : { runStartedAt }),
    ...(runCompletedAt === undefined ? {} : { runCompletedAt }),
    ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
    ...(firstTokenRecordedAt === undefined ? {} : { firstTokenRecordedAt }),
  };
}

function emptyRecord(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function runningState(part: PalotMessageContent | undefined): Record<string, JsonValue> | null {
  const state = part?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return state.status === "running" ? state : null;
}

/**
 * OpenCode does not store a running tool's progress (`session.tool.progress`, such as the calls a
 * Code Mode script has made so far), so a fetched copy of a running call has empty metadata.
 * Keep the progress the live events delivered until the call settles.
 */
export function withLiveToolProgress(
  server: PalotMessage,
  current: PalotMessage | undefined,
): PalotMessage {
  if (!current) return server;
  let content: PalotMessageContent[] | null = null;
  server.content.forEach((part, index) => {
    if (!part.id) return;
    const state = runningState(part);
    if (!state) {
      // A script moved to the background: keep the calls the live events showed.
      const settled = recordState(part);
      const previous = recordState(current.content.find((candidate) => candidate.id === part.id));
      if (!settled || !previous) return;
      const metadata = withRetainedScriptCalls(previous.metadata, settled.metadata);
      if (metadata === settled.metadata || metadata === undefined) return;
      content ??= [...server.content];
      content[index] = { ...part, state: { ...settled, metadata } };
      return;
    }
    if (!emptyRecord(state.metadata)) return;
    const live = runningState(current.content.find((candidate) => candidate.id === part.id));
    if (!live || emptyRecord(live.metadata)) return;
    content ??= [...server.content];
    content[index] = { ...part, state: { ...state, metadata: live.metadata! } };
  });
  return content ? { ...server, content } : server;
}

function recordState(part: PalotMessageContent | undefined): Record<string, JsonValue> | null {
  const state = part?.state;
  return state && typeof state === "object" && !Array.isArray(state) ? state : null;
}

/**
 * OpenCode drops the calls (`toolCalls`) a Code Mode script made once it moves the script to the
 * background (`jobID`), and reports none after. Keep the calls Palot already saw, for as long as
 * this transcript stays loaded, so they stay rows; a reload no longer has them.
 */
export function withRetainedScriptCalls(
  previous: JsonValue | undefined,
  next: JsonValue | undefined,
): JsonValue | undefined {
  if (!isRecord(next) || !isRecord(previous)) return next;
  if (typeof next.jobID !== "string") return next;
  if (Array.isArray(next.toolCalls) && next.toolCalls.length > 0) return next;
  if (!Array.isArray(previous.toolCalls) || previous.toolCalls.length === 0) return next;
  return { ...next, toolCalls: previous.toolCalls };
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeMessages(
  server: PalotMessage[],
  current: PalotMessage[],
  preferCurrent: boolean,
): PalotMessage[] {
  const serverByID = new Map(server.map((message) => [message.id, message]));
  const currentByID = new Map(current.map((message) => [message.id, message]));
  const ids = new Set([...currentByID.keys(), ...serverByID.keys()]);
  return [...ids]
    .map((id) => reconcileMessage(serverByID.get(id), currentByID.get(id), preferCurrent))
    .filter((message): message is PalotMessage => Boolean(message))
    .toSorted(compareMessages);
}

export function mergeOptimisticMessages(
  authoritative: PalotMessage[],
  current: PalotMessage[],
): PalotMessage[] {
  const optimistic = current.filter((message) => message.optimistic === true);
  return optimistic.length > 0 ? mergeMessages(authoritative, optimistic, false) : authoritative;
}
