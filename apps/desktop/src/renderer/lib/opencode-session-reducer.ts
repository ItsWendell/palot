/** Incremental OpenCode event projection for the active Palot transcript. */

import type { ModelRef, TokenUsageInfo } from "@opencode/client";
import type {
  JsonValue,
  PalotEvent,
  PalotFileAttachment,
  PalotMessage,
  PalotMessageContent,
  PalotSession,
} from "../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import {
  createStreamingPatchInputState,
  streamingPatchInputFromJson,
  streamPatchInput,
} from "./streaming-patch-input";

const MAX_LIVE_TOOL_OUTPUT = 256_000;

function record(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function boundedToolMetadata(value: unknown): JsonValue {
  const metadata = record(value);
  const output = string(metadata.output);
  if (output === null || output.length <= MAX_LIVE_TOOL_OUTPUT) return metadata;
  return {
    ...metadata,
    output: `[Earlier output truncated]\n${output.slice(-MAX_LIVE_TOOL_OUTPUT)}`,
    truncated: true,
  };
}

function isShellTool(part: PalotMessageContent): boolean {
  return part.name === "shell" || part.name === "local_shell";
}

function settledToolMetadata(part: PalotMessageContent, value: JsonValue): JsonValue {
  if (!isShellTool(part)) return value;
  return boundedToolMetadata({
    ...record(record(part.state).metadata),
    ...record(value),
  });
}

function sessionID(event: PalotEvent): string | null {
  const data = record(event.data);
  return string(data.sessionID) ?? string(record(data.form).sessionID);
}

type RelatedExecutionState = SessionExecutionState & { parentID?: string };
type ProjectedExecutionState = RelatedExecutionState & {
  settled?: RelatedExecutionState;
};

function relatedExecutionState(
  state: SessionExecutionState | undefined,
): ProjectedExecutionState | undefined {
  return state as ProjectedExecutionState | undefined;
}

function ownExecutionState(
  state: SessionExecutionState | undefined,
): RelatedExecutionState | undefined {
  const projected = relatedExecutionState(state);
  return projected?.settled ?? projected;
}

function executionParentID(state: SessionExecutionState | undefined): string | null {
  return relatedExecutionState(state)?.parentID ?? ownExecutionState(state)?.parentID ?? null;
}

function withExecutionParent(
  state: SessionExecutionState,
  parentID: string | null,
): RelatedExecutionState {
  return parentID ? { ...state, parentID } : state;
}

export function sameSessionExecutionState(
  left: SessionExecutionState | undefined,
  right: SessionExecutionState | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftProjected = relatedExecutionState(left);
  const rightProjected = relatedExecutionState(right);
  return (
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.parentID === right.parentID &&
    left.error?.type === right.error?.type &&
    left.error?.message === right.error?.message &&
    sameSessionExecutionState(leftProjected?.settled, rightProjected?.settled)
  );
}

export function sameSessionRuntimeStatus(
  left: SessionRuntimeStatus | undefined,
  right: SessionRuntimeStatus | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.type !== right.type) return false;
  if (left.type !== "retry" || right.type !== "retry") return true;
  return (
    left.attempt === right.attempt && left.message === right.message && left.next === right.next
  );
}

function compactionMessageID(eventID: string): string {
  return eventID.replace(/^evt_/, "msg_");
}

function eventMessageID(eventID: string): string {
  return eventID.replace(/^evt_/, "msg_");
}

function eventMessage(
  event: PalotEvent,
  type: string,
  data: Record<string, JsonValue>,
): PalotMessage {
  const createdAt = number(data.timestamp) ?? event.createdAt;
  return {
    id: string(data.messageID) ?? eventMessageID(event.id),
    type,
    createdAt,
    completedAt: createdAt,
    text: string(data.text),
    agent: type === "agent-switched" ? string(data.agent) : null,
    model: type === "model-switched" ? model(data.model) : null,
    tokens: null,
    finish: null,
    content: [],
    data,
  };
}

function projectActiveChildren(
  states: Map<string, SessionExecutionState>,
  firstSessionID: string | null,
): Map<string, SessionExecutionState> {
  let next = states;
  let id = firstSessionID;
  const visited = new Set<string>();

  while (id && !visited.has(id)) {
    visited.add(id);
    const current = next.get(id);
    const own = ownExecutionState(current);
    const children = [...next.values()].filter(
      (state) =>
        executionParentID(state) === id &&
        (own?.startedAt == null ||
          state.status === "running" ||
          (state.startedAt !== null
            ? state.startedAt >= own.startedAt
            : state.completedAt !== null && state.completedAt >= own.startedAt)),
    );
    const hasActiveChild = children.some((state) => state.status === "running");
    const failedChild = children.find((state) => state.status === "failed");
    const interruptedChild = children.find((state) => state.status === "interrupted");
    let updated = current;

    if (hasActiveChild && current?.status !== "running") {
      const settled = own ?? { status: "inactive", startedAt: null, completedAt: null };
      updated = withExecutionParent(
        {
          status: "running",
          startedAt: settled.startedAt,
          completedAt: null,
          settled,
        } as ProjectedExecutionState,
        executionParentID(current),
      );
    } else if (!hasActiveChild && failedChild) {
      const settled = own ?? { status: "inactive", startedAt: null, completedAt: null };
      updated = withExecutionParent(
        {
          status: "failed",
          startedAt: settled.startedAt,
          completedAt: failedChild.completedAt,
          settled,
        } as ProjectedExecutionState,
        executionParentID(current),
      );
    } else if (!hasActiveChild && interruptedChild) {
      const settled = own ?? { status: "inactive", startedAt: null, completedAt: null };
      updated = withExecutionParent(
        {
          status: "interrupted",
          startedAt: settled.startedAt,
          completedAt: interruptedChild.completedAt,
          settled,
        } as ProjectedExecutionState,
        executionParentID(current),
      );
    } else if (!hasActiveChild && relatedExecutionState(current)?.settled) {
      updated = relatedExecutionState(current)?.settled;
    }

    if (updated && updated !== current) {
      if (next === states) next = new Map(states);
      next.set(id, updated);
    }
    id = executionParentID(updated ?? current);
  }

  return next;
}

function model(value: JsonValue | undefined): ModelRef | null {
  const data = record(value);
  const id = string(data.id);
  const providerID = string(data.providerID);
  if (!id || !providerID) return null;
  const variant = string(data.variant);
  return { id, providerID, ...(variant ? { variant } : {}) };
}

function tokens(value: JsonValue | undefined): TokenUsageInfo | null {
  const data = record(value);
  const cache = record(data.cache);
  const input = number(data.input);
  const output = number(data.output);
  const reasoning = number(data.reasoning);
  const read = number(cache.read);
  const write = number(cache.write);
  if ([input, output, reasoning, read, write].some((item) => item === null)) return null;
  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
    cache: { read: read ?? 0, write: write ?? 0 },
  };
}

function executionError(value: JsonValue | undefined): SessionExecutionState["error"] {
  const error = record(value);
  const nested = record(error.data);
  const message = string(error.message) ?? string(nested.message);
  if (!message) return undefined;
  return { type: string(error.type) ?? string(error.name), message };
}

function assistantFallback(messageID: string, createdAt: number): PalotMessage {
  return {
    id: messageID,
    type: "assistant",
    createdAt,
    completedAt: null,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
}

function assistant(event: PalotEvent): PalotMessage | null {
  const data = record(event.data);
  const id = string(data.assistantMessageID);
  if (!id) return null;
  const agent = string(data.agent);
  const selectedModel = model(data.model);
  return {
    id,
    type: "assistant",
    createdAt:
      event.type === "session.step.started"
        ? (event.data.started ?? event.createdAt)
        : event.createdAt,
    completedAt: null,
    text: null,
    agent: agent ?? null,
    model: selectedModel ?? null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
}

function admittedAttachment(
  value: JsonValue,
  messageID: string,
  index: number,
): PalotFileAttachment | null {
  const data = record(value);
  const source = record(data.source);
  const mime = string(data.mime);
  if (!mime) return null;
  return {
    uri: string(source.uri) ?? `opencode-inline:${messageID}:attachment-${index + 1}`,
    name: string(data.name) ?? `Attachment ${index + 1}`,
    mime,
    size: null,
  };
}

function admittedMention(value: JsonValue | undefined) {
  const data = record(value);
  const start = number(data.start);
  const end = number(data.end);
  const text = string(data.text);
  if (start === null || end === null || text === null) return null;
  return { start, end, text };
}

function enqueuedUser(event: PalotEvent): PalotMessage | null {
  const data = record(event.data);
  const id = string(data.inboxID);
  const input = record(data.item);
  const prompt = record(input.payload);
  const delivery = input.delivery === "steer" || input.delivery === "queue" ? input.delivery : null;
  if (!id || string(input.type) !== "user") return null;
  const attachments = Array.isArray(prompt.files)
    ? prompt.files.flatMap((value, index) => {
        const data = record(value);
        if (admittedMention(data.mention)) return [];
        const attachment = admittedAttachment(value, id, index);
        return attachment ? [attachment] : [];
      })
    : [];
  const fileReferences = Array.isArray(prompt.files)
    ? prompt.files.flatMap((value) => {
        const data = record(value);
        const source = record(data.source);
        const mention = admittedMention(data.mention);
        const uri = string(source.uri);
        if (!mention || !uri) return [];
        return [{ uri, name: string(data.name) ?? mention.text, mention }];
      })
    : [];
  const skillReferences = Array.isArray(prompt.skills)
    ? prompt.skills.flatMap((value) => {
        const data = record(value);
        const mention = admittedMention(data.mention);
        const skillID = string(data.id);
        const text = string(data.text);
        return mention && skillID ? [{ id: skillID, mention, ...(text ? { text } : {}) }] : [];
      })
    : [];
  return {
    id,
    type: "user",
    optimistic: true,
    createdAt: event.createdAt,
    ...(delivery ? { delivery } : {}),
    completedAt: event.createdAt,
    text: string(prompt.text) ?? "",
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    ...(attachments.length > 0 ? { files: attachments } : {}),
    ...(fileReferences.length > 0 ? { fileReferences } : {}),
    ...(skillReferences.length > 0 ? { skillReferences } : {}),
    content: [],
    data: null,
  };
}

function updateMessage(
  messages: PalotMessage[],
  messageID: string,
  update: (message: PalotMessage) => PalotMessage,
  fallback?: PalotMessage,
): PalotMessage[] {
  const index = messages.findIndex((message) => message.id === messageID);
  if (index === -1) return fallback ? [...messages, update(fallback)] : messages;
  const current = messages[index];
  if (!current) return messages;
  const nextMessage = update(current);
  if (nextMessage === current) return messages;
  const next = [...messages];
  next[index] = nextMessage;
  return next;
}

function partAt(
  message: PalotMessage,
  ordinal: number | null,
  type: "text" | "reasoning",
  update: (part: PalotMessageContent) => PalotMessageContent,
  explicitID?: string | null,
): PalotMessage {
  const id = explicitID ?? `${message.id}:${type}:${ordinal ?? message.content.length}`;
  const identifiedIndex = message.content.findIndex((part) => part.id === id);
  const typedIndex =
    ordinal === null
      ? -1
      : message.content.reduce(
          (match, part, index) =>
            part.type === type && match.remaining === 0
              ? { index, remaining: -1 }
              : part.type === type && match.remaining > 0
                ? { ...match, remaining: match.remaining - 1 }
                : match,
          { index: -1, remaining: ordinal },
        ).index;
  const index = identifiedIndex >= 0 ? identifiedIndex : typedIndex;
  const current = index >= 0 ? message.content[index] : undefined;
  const part =
    current?.type === type ? (current.id ? current : { ...current, id }) : { type, id, text: "" };
  const nextPart = update(part);
  if (current === nextPart) return message;
  const content = [...message.content];
  if (index >= 0) content[index] = nextPart;
  else content.push(nextPart);
  return { ...message, content };
}

function toolPart(
  message: PalotMessage,
  id: string,
  update: (part: PalotMessageContent) => PalotMessageContent,
  name = "tool",
): PalotMessage {
  const index = message.content.findIndex((part) => part.id === id);
  const current = index >= 0 ? message.content[index] : undefined;
  const part = current ?? { type: "tool", id, name, state: { status: "pending" } };
  const nextPart = update(part);
  const content = [...message.content];
  if (index >= 0) content[index] = nextPart;
  else content.push(nextPart);
  return { ...message, content };
}

function compactionMessage(
  id: string,
  createdAt: number,
  input: {
    status: "running" | "completed" | "failed";
    completedAt?: number;
    reason?: "auto" | "manual";
    text?: string;
    recent?: string;
    error?: string;
    model?: ModelRef | null;
    providerState?: JsonValue;
    cost?: number;
    tokens?: TokenUsageInfo;
  },
): PalotMessage {
  return {
    id,
    type: "compaction",
    createdAt,
    completedAt: input.status === "running" ? null : (input.completedAt ?? createdAt),
    text: null,
    agent: null,
    model: input.model ?? null,
    tokens: null,
    finish: input.status === "failed" ? "error" : null,
    ...(input.providerState !== undefined ? { providerState: input.providerState } : {}),
    content: [
      {
        type: "compaction",
        id,
        time: { created: createdAt },
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
        text: input.text ?? "",
        ...(input.recent !== undefined ? { recent: input.recent } : {}),
        ...(input.error ? { error: input.error } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.tokens ? { tokens: input.tokens } : {}),
      },
    ],
    data: null,
  };
}

function parseToolInput(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function reasoningPresentation(value: JsonValue | undefined) {
  const presentation = record(value).presentation;
  return presentation === "thought" || presentation === "preamble" || presentation === "recap"
    ? presentation
    : undefined;
}

export function applyOpenCodeEvents(
  messages: PalotMessage[],
  selectedSessionID: string,
  events: PalotEvent[],
): PalotMessage[] {
  let next = messages;
  for (const event of events) {
    if (sessionID(event) !== selectedSessionID) continue;
    const data = record(event.data);
    const messageID = string(data.assistantMessageID);

    if (event.type === "session.inbox.enqueued") {
      const value = enqueuedUser(event);
      if (value) {
        next = updateMessage(
          next,
          value.id,
          (current) =>
            current.data === null
              ? {
                  ...value,
                  ...(current.optimistic === true ? { optimistic: true } : {}),
                  files: value.files ?? current.files,
                  ...(current.timelineAt !== undefined ? { timelineAt: current.timelineAt } : {}),
                  ...(current.runStartedAt !== undefined
                    ? { runStartedAt: current.runStartedAt }
                    : {}),
                }
              : current,
          value,
        );
      }
      continue;
    }
    if (event.type === "session.inbox.cancelled") {
      const inputID = string(data.inboxID);
      if (inputID) next = next.filter((message) => message.id !== inputID);
      continue;
    }
    if (event.type === "session.inbox.delivery.changed") {
      const inputID = string(data.inboxID);
      if (inputID) {
        const activeRun = next.findLast(
          (message) =>
            message.id !== inputID &&
            message.type === "user" &&
            message.runStartedAt !== undefined &&
            message.runCompletedAt === undefined,
        )?.runStartedAt;
        next = updateMessage(next, inputID, (message) => {
          if (data.delivery === "steer") {
            return {
              ...message,
              delivery: "steer",
              ...(activeRun === undefined ? {} : { runStartedAt: activeRun }),
            };
          }
          const { promotedAt: _, runStartedAt: __, runCompletedAt: ___, ...queued } = message;
          return { ...queued, delivery: "queue" };
        });
      }
      continue;
    }
    if (event.type === "session.inbox.delivered") {
      const inputID = string(data.inboxID);
      if (inputID) {
        const activeRun = next.findLast(
          (message) =>
            message.type === "user" &&
            message.runStartedAt !== undefined &&
            message.runCompletedAt === undefined,
        )?.runStartedAt;
        next = updateMessage(next, inputID, (message) => ({
          ...message,
          promotedAt: event.createdAt,
          ...(message.delivery === "steer" && activeRun !== undefined
            ? { runStartedAt: activeRun }
            : {}),
        }));
      }
      continue;
    }

    if (event.type === "session.execution.started") {
      const index = next.findLastIndex(
        (message) =>
          message.type === "user" &&
          message.runStartedAt === undefined &&
          (message.promotedAt !== undefined || message.delivery !== "queue"),
      );
      const current = next[index];
      if (current) {
        const copy = [...next];
        copy[index] = { ...current, runStartedAt: event.createdAt };
        next = copy;
      }
      continue;
    }

    if (event.type === "session.synthetic") {
      const value = eventMessage(event, "synthetic", data);
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.instructions.updated") {
      const value = eventMessage(event, "system", data);
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.skill.activated") {
      const skill = data.id ?? data.skill;
      const value = eventMessage(event, "skill", {
        ...data,
        ...(skill === undefined ? {} : { skill }),
      });
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.agent.selected") {
      const value = eventMessage(event, "agent-switched", data);
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.model.selected") {
      const value = eventMessage(event, "model-switched", data);
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.moved") {
      const value = eventMessage(event, "location-switched", data);
      next = updateMessage(next, value.id, (current) => current, value);
      continue;
    }
    if (event.type === "session.shell.started") {
      const shell = record(data.shell);
      const shellID = string(shell.id) ?? string(data.callID);
      if (shellID) {
        const command = shell.command ?? data.command;
        const startedAt = number(record(shell.time).started) ?? event.createdAt;
        const value = {
          ...eventMessage(event, "shell", {
            ...shell,
            shellID,
            status: shell.status ?? "running",
            ...(command === undefined ? {} : { command }),
          }),
          createdAt: startedAt,
          completedAt: null,
        };
        next = updateMessage(next, value.id, (current) => current, value);
      }
      continue;
    }
    if (event.type === "session.shell.ended") {
      const shell = record(data.shell);
      const shellID = string(shell.id) ?? string(data.callID);
      if (shellID) {
        const shellTime = record(shell.time);
        const startedAt = number(shellTime.started) ?? event.createdAt;
        const completedAt = number(shellTime.completed) ?? event.createdAt;
        const index = next.findLastIndex(
          (message) => message.type === "shell" && string(record(message.data).shellID) === shellID,
        );
        const current = next[index];
        if (current) {
          const copy = [...next];
          copy[index] = {
            ...current,
            createdAt: startedAt,
            completedAt,
            data: {
              ...record(current.data),
              ...shell,
              shellID,
              status: shell.status ?? "exited",
              output:
                typeof data.output === "string"
                  ? { output: data.output, cursor: 0, size: data.output.length, truncated: false }
                  : (data.output ?? null),
            },
          };
          next = copy;
        } else {
          next = [
            ...next,
            {
              ...eventMessage(event, "shell", {
                ...shell,
                shellID,
                status: shell.status ?? "exited",
                output:
                  typeof data.output === "string"
                    ? { output: data.output, cursor: 0, size: data.output.length, truncated: false }
                    : (data.output ?? null),
              }),
              createdAt: startedAt,
              completedAt,
            },
          ];
        }
      }
      continue;
    }

    if (event.type === "session.compaction.started") {
      const inputID = string(data.inputID);
      const id = inputID ?? compactionMessageID(event.id);
      const value = compactionMessage(id, event.createdAt, {
        status: "running",
        ...(data.reason === "auto" || data.reason === "manual" ? { reason: data.reason } : {}),
        recent: string(data.recent) ?? "",
      });
      next = updateMessage(next, id, (current) => current, value);
      continue;
    }
    if (event.type === "session.compaction.delta") {
      const index = next.findLastIndex(
        (message) => message.type === "compaction" && message.completedAt === null,
      );
      const current = next[index];
      const part = current?.content[0];
      if (current && part?.type === "compaction") {
        const copy = [...next];
        copy[index] = {
          ...current,
          content: [{ ...part, text: `${part.text ?? ""}${string(data.text) ?? ""}` }],
        };
        next = copy;
      } else {
        next = [
          ...next,
          compactionMessage(
            string(data.inputID) ?? compactionMessageID(event.id),
            event.createdAt,
            {
              status: "running",
              text: string(data.text) ?? "",
            },
          ),
        ];
      }
      continue;
    }
    if (event.type === "session.compaction.ended" || event.type === "session.compaction.failed") {
      const index = next.findLastIndex(
        (message) => message.type === "compaction" && message.completedAt === null,
      );
      const current = next[index];
      // Completion has no required message identity. Hydration may already have
      // settled the live row; recover from message.list instead of inventing one.
      if (!current) continue;
      const error = record(data.error);
      const cost = number(data.cost);
      const usage = tokens(data.tokens);
      const copy = [...next];
      copy[index] = compactionMessage(current.id, current.createdAt, {
        status: event.type === "session.compaction.ended" ? "completed" : "failed",
        completedAt: event.createdAt,
        ...(cost !== null ? { cost } : {}),
        ...(usage ? { tokens: usage } : {}),
        ...(data.reason === "auto" || data.reason === "manual" ? { reason: data.reason } : {}),
        ...(event.type === "session.compaction.ended"
          ? {
              text: string(data.text) ?? "",
              recent: string(data.recent) ?? "",
              model: model(data.model),
              ...(data.providerState !== undefined ? { providerState: data.providerState } : {}),
            }
          : { error: string(error.message) ?? "Compaction failed" }),
      });
      next = copy;
      continue;
    }

    if (event.type === "session.step.started") {
      const value = assistant(event);
      if (value) {
        next = updateMessage(
          next,
          value.id,
          (current) => ({
            ...current,
            streamedAt: undefined,
            firstTokenAt: undefined,
            createdAt: event.data.started ?? event.createdAt,
            content: current.content.map((part) =>
              part.streaming ? { ...part, streaming: false } : part,
            ),
            completedAt: null,
            finish: null,
            data: { ...record(current.data), retry: null, error: null },
          }),
          value,
        );
      }
      continue;
    }
    if (event.type === "session.step.streamed") {
      if (messageID) {
        next = updateMessage(
          next,
          messageID,
          (message) => ({ ...message, streamedAt: event.createdAt }),
          assistantFallback(messageID, event.createdAt),
        );
      }
      continue;
    }
    if (event.type === "session.retry.scheduled") {
      const retryMessageID =
        string(data.assistantMessageID) ??
        next.findLast((message) => message.type === "assistant" && message.completedAt === null)
          ?.id ??
        next.findLast((message) => message.type === "assistant")?.id;
      if (retryMessageID) {
        next = updateMessage(
          next,
          retryMessageID,
          (message) => ({
            ...message,
            completedAt: null,
            data: {
              ...record(message.data),
              retry: {
                attempt: data.attempt ?? null,
                at: number(data.at),
                error: data.error ?? null,
              },
            },
          }),
          assistantFallback(retryMessageID, event.createdAt),
        );
      }
      continue;
    }
    if (!messageID) {
      if (
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        const runStartedAt = next.findLast(
          (message) =>
            message.type === "user" &&
            message.runStartedAt !== undefined &&
            message.runCompletedAt === undefined,
        )?.runStartedAt;
        if (runStartedAt !== undefined) {
          next = next.map((message) =>
            message.type === "user" &&
            message.runStartedAt === runStartedAt &&
            message.runCompletedAt === undefined
              ? { ...message, runCompletedAt: event.createdAt }
              : message,
          );
        }
        const index = next.findLastIndex(
          (message) => message.type === "assistant" && message.completedAt === null,
        );
        const current = next[index];
        if (current) {
          const copy = [...next];
          copy[index] = { ...current, completedAt: event.createdAt };
          next = copy;
        }
      }
      continue;
    }

    const ordinal = number(data.ordinal);
    const partID = string(data.partID);
    if (
      (ordinal !== null || partID !== null) &&
      (event.type === "session.text.started" ||
        event.type === "session.text.delta" ||
        event.type === "session.text.ended")
    ) {
      next = updateMessage(
        next,
        messageID,
        (message) => {
          if (event.type === "session.text.delta" && message.completedAt !== null) return message;
          const updated = partAt(
            message,
            ordinal,
            "text",
            (part) =>
              event.type === "session.text.delta" && part.streaming === false
                ? part
                : {
                    ...part,
                    streaming: event.type !== "session.text.ended",
                    ...(event.type === "session.text.started"
                      ? { time: { created: event.createdAt } }
                      : {}),
                    text:
                      event.type === "session.text.delta"
                        ? `${part.text ?? ""}${string(data.delta) ?? ""}`
                        : event.type === "session.text.ended"
                          ? (string(data.text) ?? part.text ?? "")
                          : // Durable started may replay after newer ephemeral deltas.
                            // Only a finalized/restarted lifecycle resets the body.
                            part.streaming === false
                            ? ""
                            : (part.text ?? ""),
                  },
            partID,
          );
          if (updated === message) return message;
          return {
            ...updated,
            text: updated.content
              .filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join(""),
            ...(event.type === "session.text.delta" && message.firstTokenAt === undefined
              ? { firstTokenAt: event.createdAt }
              : {}),
          };
        },
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (
      (ordinal !== null || partID !== null) &&
      (event.type === "session.reasoning.started" ||
        event.type === "session.reasoning.delta" ||
        event.type === "session.reasoning.ended")
    ) {
      next = updateMessage(
        next,
        messageID,
        (message) => {
          if (event.type === "session.reasoning.delta" && message.completedAt !== null)
            return message;
          const updated = partAt(
            message,
            ordinal,
            "reasoning",
            (part) =>
              event.type === "session.reasoning.delta" && part.streaming === false
                ? part
                : {
                    ...part,
                    streaming: event.type !== "session.reasoning.ended",
                    ...(reasoningPresentation(data.state)
                      ? { presentation: reasoningPresentation(data.state) }
                      : {}),
                    ...(event.type === "session.reasoning.started"
                      ? { time: { created: event.createdAt } }
                      : event.type === "session.reasoning.ended"
                        ? {
                            time: {
                              created: part.time?.created ?? event.createdAt,
                              completed: event.createdAt,
                            },
                          }
                        : {}),
                    text:
                      event.type === "session.reasoning.delta"
                        ? `${part.text ?? ""}${string(data.delta) ?? ""}`
                        : event.type === "session.reasoning.ended"
                          ? (string(data.text) ?? part.text ?? "")
                          : part.streaming === false
                            ? ""
                            : (part.text ?? ""),
                  },
            partID,
          );
          if (updated === message) return message;
          return event.type === "session.reasoning.delta" && message.firstTokenAt === undefined
            ? { ...updated, firstTokenAt: event.createdAt }
            : updated;
        },
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }

    const toolID = string(data.id);
    if (toolID && event.type === "session.tool.input.started") {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(
            message,
            toolID,
            (part) => ({
              ...part,
              name: string(data.name) ?? part.name,
              time: { created: event.createdAt },
              state: {
                status: "streaming",
                input: "",
                ...(string(data.name) === "patch" || string(data.name) === "apply_patch"
                  ? { inputStream: createStreamingPatchInputState() }
                  : {}),
              },
            }),
            string(data.name) ?? "tool",
          ),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (toolID && event.type === "session.tool.input.delta") {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(message, toolID, (part) => {
            const state = record(part.state);
            const delta = string(data.delta) ?? "";
            if (part.name === "patch" || part.name === "apply_patch") {
              const stream = streamPatchInput(
                streamingPatchInputFromJson(state.inputStream) ?? createStreamingPatchInputState(),
                delta,
              );
              return {
                ...part,
                state: {
                  ...state,
                  status: "streaming",
                  input: { patchText: stream.document.text },
                  inputStream: stream,
                },
              };
            }
            return {
              ...part,
              state: {
                ...state,
                status: "streaming",
                input: `${string(state.input) ?? ""}${delta}`,
              },
            };
          }),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (toolID && event.type === "session.tool.input.ended") {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(message, toolID, (part) => ({
            ...part,
            state: {
              ...record(part.state),
              status: "running",
              input:
                typeof data.text === "string"
                  ? parseToolInput(data.text)
                  : (record(part.state).input ?? {}),
              metadata: {},
            },
          })),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (toolID && event.type === "session.tool.called") {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(
            message,
            toolID,
            (part) => ({
              ...part,
              name: string(data.name) ?? part.name,
              ...(typeof data.executed === "boolean" ? { executed: data.executed } : {}),
              ...(data.state !== undefined ? { providerState: data.state } : {}),
              time: {
                created: part.time?.created ?? event.createdAt,
                ran: event.createdAt,
              },
              state: {
                ...record(part.state),
                status: "running",
                input: data.input ?? record(part.state).input ?? {},
                metadata: {},
              },
            }),
            string(data.name) ?? "tool",
          ),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (toolID && event.type === "session.tool.progress") {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(message, toolID, (part) => ({
            ...part,
            state: {
              ...record(part.state),
              ...(data.structured !== undefined ? { structured: data.structured } : {}),
              ...(data.content !== undefined ? { content: data.content } : {}),
              metadata: isShellTool(part)
                ? boundedToolMetadata(data.metadata)
                : (data.metadata ?? {}),
            },
          })),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (toolID && (event.type === "session.tool.success" || event.type === "session.tool.failed")) {
      next = updateMessage(
        next,
        messageID,
        (message) =>
          toolPart(message, toolID, (part) => ({
            ...part,
            ...(typeof data.executed === "boolean" ? { executed: data.executed } : {}),
            ...(data.resultState !== undefined ? { providerResultState: data.resultState } : {}),
            time: {
              created: part.time?.created ?? event.createdAt,
              ran: part.time?.ran ?? part.time?.created ?? event.createdAt,
              completed: event.createdAt,
            },
            state: {
              ...record(part.state),
              status: event.type === "session.tool.success" ? "completed" : "error",
              ...(data.content !== undefined ? { content: data.content } : {}),
              ...(data.structured !== undefined ? { structured: data.structured } : {}),
              ...(data.result !== undefined ? { result: data.result } : {}),
              ...(data.metadata !== undefined
                ? {
                    metadata: settledToolMetadata(part, data.metadata),
                  }
                : {}),
              ...(data.error !== undefined ? { error: data.error } : {}),
            },
          })),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
      continue;
    }
    if (event.type === "session.step.ended" || event.type === "session.step.failed") {
      const usage = tokens(data.tokens);
      const finish =
        event.type === "session.step.failed"
          ? "error"
          : (string(data.finish) as PalotMessage["finish"]);
      next = updateMessage(
        next,
        messageID,
        (message) => ({
          ...message,
          completedAt: event.createdAt,
          tokens: usage ?? message.tokens,
          finish: finish ?? message.finish,
          ...(typeof data.rawFinish === "string" ? { rawFinish: data.rawFinish } : {}),
          ...(data.providerState !== undefined ? { providerState: data.providerState } : {}),
          data:
            event.type === "session.step.failed"
              ? { ...record(message.data), error: data.error ?? null, retry: null }
              : { ...record(message.data), retry: null },
        }),
        messageID ? assistantFallback(messageID, event.createdAt) : undefined,
      );
    }
  }
  return next;
}

export function applyExecutionEvents(
  states: Map<string, SessionExecutionState>,
  events: PalotEvent[],
): Map<string, SessionExecutionState> {
  let next = states;
  for (const event of events) {
    const id = sessionID(event);
    if (!id) continue;
    const data = record(event.data);
    const current = next.get(id);
    const parentID = executionParentID(current);

    if (event.type === "session.created") {
      const createdParentID = string(data.parentID);
      if (!createdParentID) continue;
      const updated = withExecutionParent(
        current ?? { status: "inactive", startedAt: null, completedAt: null },
        createdParentID,
      );
      if (next === states) next = new Map(states);
      next.set(id, updated);
      next = projectActiveChildren(next, createdParentID);
      continue;
    }
    if (event.type === "session.deleted") {
      if (!current) continue;
      if (next === states) next = new Map(states);
      next.delete(id);
      next = projectActiveChildren(next, parentID);
      continue;
    }

    let updated: SessionExecutionState | null = null;
    if (event.type === "session.status") {
      const status = record(data.status);
      if (status.type === "busy") {
        updated = withExecutionParent(
          {
            status: "running",
            startedAt:
              current?.status === "running"
                ? (current.startedAt ?? event.createdAt)
                : event.createdAt,
            completedAt: null,
          },
          parentID,
        );
      } else if (status.type === "idle" && current?.status === "running") {
        updated = withExecutionParent(
          { status: "succeeded", startedAt: current.startedAt, completedAt: event.createdAt },
          parentID,
        );
      }
    } else if (
      event.type === "session.execution.started" ||
      event.type === "session.step.started"
    ) {
      updated = withExecutionParent(
        {
          status: "running",
          startedAt:
            current?.status === "running"
              ? (current.startedAt ?? event.createdAt)
              : event.createdAt,
          completedAt: null,
        },
        parentID,
      );
    } else if (event.type === "session.execution.succeeded") {
      updated = withExecutionParent(
        {
          status: "succeeded",
          startedAt: current?.startedAt ?? null,
          completedAt: event.createdAt,
        },
        parentID,
      );
    } else if (event.type === "session.execution.failed") {
      const error = executionError(data.error);
      updated = withExecutionParent(
        {
          status: error?.type === "MessageAbortedError" ? "interrupted" : "failed",
          startedAt: current?.startedAt ?? null,
          completedAt: event.createdAt,
          ...(error ? { error } : {}),
        },
        parentID,
      );
    } else if (event.type === "session.execution.interrupted") {
      updated = withExecutionParent(
        {
          status: "interrupted",
          startedAt: current?.startedAt ?? null,
          completedAt: event.createdAt,
        },
        parentID,
      );
    }
    if (!updated || sameSessionExecutionState(current, updated)) continue;
    if (next === states) next = new Map(states);
    next.set(id, updated);
    next = projectActiveChildren(
      next,
      updated.status === "running" ? executionParentID(updated) : id,
    );
  }
  return next;
}

export function applySessionStatusEvents(
  statuses: Map<string, SessionRuntimeStatus>,
  events: PalotEvent[],
): Map<string, SessionRuntimeStatus> {
  let next = statuses;
  for (const event of events) {
    const id = sessionID(event);
    if (!id) continue;
    let status: SessionRuntimeStatus | null = null;
    if (event.type === "session.status") {
      const value = record(record(event.data).status);
      if (value.type === "idle" || value.type === "busy") status = { type: value.type };
      if (value.type === "retry") {
        const attempt = number(value.attempt);
        const message = string(value.message);
        const nextRetry = number(value.next);
        if (attempt !== null && message && nextRetry !== null) {
          status = { type: "retry", attempt, message, next: nextRetry };
        }
      }
    } else if (event.type === "session.retry.scheduled") {
      const data = record(event.data);
      const error = record(data.error);
      const attempt = number(data.attempt);
      const nextRetry = number(data.at);
      const message = string(error.message);
      if (attempt !== null && nextRetry !== null && message) {
        status = { type: "retry", attempt, message, next: nextRetry };
      }
    } else if (
      event.type === "session.execution.started" ||
      event.type === "session.step.started"
    ) {
      status = { type: "busy" };
    } else if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      status = { type: "idle" };
    } else if (event.type === "session.deleted") {
      if (!next.has(id)) continue;
      if (next === statuses) next = new Map(statuses);
      next.delete(id);
      continue;
    }
    if (!status) continue;
    const current = next.get(id);
    if (sameSessionRuntimeStatus(current, status)) continue;
    if (next === statuses) next = new Map(statuses);
    next.set(id, status);
  }
  return next;
}

export function applyShellEvents(
  shells: Map<string, Set<string>>,
  events: PalotEvent[],
): Map<string, Set<string>> {
  let next = shells;
  for (const event of events) {
    const id = sessionID(event);
    if (!id) continue;
    const data = record(event.data);
    const shell = record(data.shell);
    const shellID = string(shell.id) ?? string(data.callID);

    if (event.type === "session.deleted") {
      if (!next.has(id)) continue;
      if (next === shells) next = new Map(shells);
      next.delete(id);
      continue;
    }
    if (!shellID) continue;

    const started = event.type === "session.shell.started";
    const ended = event.type === "session.shell.ended";
    if (!started && !ended) continue;

    const current = next.get(id) ?? new Set<string>();
    const active = new Set(current);
    if (started && string(shell.status) !== "exited") active.add(shellID);
    if (ended || ["exited", "timeout", "killed"].includes(string(shell.status) ?? "")) {
      active.delete(shellID);
    }
    if (active.size === current.size && [...active].every((value) => current.has(value))) continue;
    if (next === shells) next = new Map(shells);
    if (active.size > 0) next.set(id, active);
    else next.delete(id);
  }
  return next;
}

export function reconcileShellSnapshot(
  shells: Map<string, Set<string>>,
  sessionID: string,
  messages: PalotMessage[],
): Map<string, Set<string>> {
  const active = new Set(
    messages.flatMap((message) => {
      if (message.type !== "shell") return [];
      const data = record(message.data);
      const shellID = string(data.shellID) ?? string(data.callID);
      const status = string(data.status);
      const running = status ? status === "running" : message.completedAt === null;
      return running && shellID ? [shellID] : [];
    }),
  );
  const current = shells.get(sessionID);
  if (current?.size === active.size && [...active].every((shellID) => current.has(shellID))) {
    return shells;
  }
  const next = new Map(shells);
  if (active.size > 0) next.set(sessionID, active);
  else next.delete(sessionID);
  return next;
}

export function reconcileExecutionSnapshot(
  states: Map<string, SessionExecutionState>,
  activeSessionIDs: string[],
  knownSessions: Array<string | Pick<PalotSession, "id" | "parentID">>,
  protectedSessionIDs: ReadonlySet<string> = new Set(),
): Map<string, SessionExecutionState> {
  const active = new Set(activeSessionIDs);
  const known = new Set(
    knownSessions.map((session) => (typeof session === "string" ? session : session.id)),
  );
  let next = states;
  for (const session of knownSessions) {
    if (typeof session === "string" || !session.parentID) continue;
    const current = next.get(session.id);
    if (executionParentID(current) === session.parentID) continue;
    if (next === states) next = new Map(states);
    const updated = withExecutionParent(
      ownExecutionState(current) ?? { status: "inactive", startedAt: null, completedAt: null },
      session.parentID,
    );
    if (sameSessionExecutionState(current, updated)) continue;
    next.set(session.id, updated);
  }
  for (const [sessionID, state] of states) {
    if (executionParentID(state)) known.add(sessionID);
  }

  for (const sessionID of known) {
    if (active.has(sessionID) || protectedSessionIDs.has(sessionID)) continue;
    const state = next.get(sessionID);
    const own = ownExecutionState(state);
    if (own && own.status !== "running" && own.status !== "inactive") continue;
    const updated = withExecutionParent(
      { status: "inactive", startedAt: null, completedAt: null },
      executionParentID(state),
    );
    if (sameSessionExecutionState(state, updated)) continue;
    if (next === states) next = new Map(states);
    next.set(sessionID, updated);
  }

  for (const sessionID of active) {
    if (protectedSessionIDs.has(sessionID)) continue;
    const state = next.get(sessionID);
    if (state?.status === "running" && !relatedExecutionState(state)?.settled) continue;
    const updated = withExecutionParent(
      { status: "running", startedAt: null, completedAt: null },
      executionParentID(state),
    );
    if (sameSessionExecutionState(state, updated)) continue;
    if (next === states) next = new Map(states);
    next.set(sessionID, updated);
  }

  const parents = new Set<string>();
  for (const state of next.values()) {
    const parentID = executionParentID(state);
    if (parentID) parents.add(parentID);
  }
  for (const parentID of parents) {
    next = projectActiveChildren(next, parentID);
  }

  return next;
}

export interface SessionReconcileTargets {
  messages: boolean;
  requests: boolean;
  diffs: boolean;
}

export function sessionReconcileTargets(
  events: PalotEvent[],
  selectedSessionID: string,
): SessionReconcileTargets {
  const targets: SessionReconcileTargets = { messages: false, requests: false, diffs: false };
  for (const event of events) {
    if (sessionID(event) !== selectedSessionID) continue;
    if (
      event.type === "session.step.ended" ||
      event.type === "session.step.failed" ||
      event.type === "session.tool.success" ||
      event.type === "session.tool.failed" ||
      event.type === "session.inbox.enqueued" ||
      event.type === "session.inbox.cancelled" ||
      event.type === "session.inbox.delivered" ||
      event.type === "session.inbox.delivery.changed" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted" ||
      event.type === "session.synthetic" ||
      event.type === "session.skill.activated" ||
      event.type === "session.agent.selected" ||
      event.type === "session.model.selected" ||
      event.type === "session.moved" ||
      event.type === "session.instructions.updated" ||
      event.type === "session.shell.started" ||
      event.type === "session.shell.ended" ||
      event.type === "session.compaction.ended" ||
      event.type === "session.compaction.failed" ||
      event.type === "session.retry.scheduled" ||
      event.type === "session.revert.committed"
    ) {
      targets.messages = true;
    }
    if (
      event.type === "session.revert.staged" ||
      event.type === "session.revert.cleared" ||
      event.type === "session.revert.committed"
    ) {
      targets.diffs = true;
    }
  }
  return targets;
}

export function needsMissingMessageRecovery(
  messages: PalotMessage[],
  selectedSessionID: string,
  events: PalotEvent[],
): boolean {
  const known = new Set(messages.map((message) => message.id));
  for (const event of events) {
    if (sessionID(event) !== selectedSessionID || event.type !== "session.step.started") continue;
    const messageID = string(record(event.data).assistantMessageID);
    if (messageID) known.add(messageID);
  }
  return events.some((event) => {
    if (sessionID(event) !== selectedSessionID || event.type === "session.step.started")
      return false;
    const messageID = string(record(event.data).assistantMessageID);
    return Boolean(messageID && !known.has(messageID));
  });
}

export function needsSessionReconcile(events: PalotEvent[], selectedSessionID: string): boolean {
  const targets = sessionReconcileTargets(events, selectedSessionID);
  return targets.messages || targets.requests || targets.diffs;
}

export function needsWorkspaceReconcile(events: PalotEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "server.connected" ||
      event.type === "worktree.updated" ||
      event.type === "session.created" ||
      event.type === "session.deleted" ||
      event.type === "session.moved",
  );
}
