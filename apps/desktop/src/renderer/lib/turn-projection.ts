/** Pure chronological projection from OpenCode messages into visible timeline rows. */

import type { FileDiffInfo, LocationRef, ModelRef } from "@opencode/client";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import { compareMessages } from "./message-reconcile";
import { projectToolExecution } from "./tool-executions";
import { transcriptPromptLabel, type TranscriptPromptAnchor } from "./transcript-outline";
import {
  ACTIVITY_CATEGORIES,
  SESSION_PROJECTION_PRESETS,
  activityCategory,
  type ActivityCategory,
  type ResolvedSessionProjectionPolicy,
} from "./session-projection-policy";
import { isTool, messageText, type PendingRequestView } from "./view-models";

export interface TurnPart {
  message: PalotMessage;
  part: PalotMessageContent;
  index: number;
}

export interface TurnActivityGroup {
  id: string;
  kind:
    | "content"
    | "reasoning"
    | "tools"
    | "compaction"
    | "input"
    | "boundary"
    | "subagent"
    | "subagent-tool";
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "interrupted";
  entries: TurnPart[];
  messages?: PalotMessage[];
  categories?: ActivityCategory[];
  presentation?: "grouped" | "individual";
  defaultOpen?: boolean;
  forceOpen?: boolean;
  detailsDefaultOpen?: boolean;
  showReasoningSummaries?: boolean;
  currentAction?: string;
  pinned?: boolean;
  groupSameFileReads?: boolean;
}

export interface TurnPostFinalItem {
  id: string;
  kind: "file" | "change" | "diff";
  name: string;
  mime?: string;
  uri?: string;
  patch?: string;
  additions?: number;
  deletions?: number;
}

export interface TranscriptTurn {
  id: string;
  kind?: "conversation" | "boundary" | "shell" | "compaction" | "subagent";
  user: PalotMessage | null;
  users: PalotMessage[];
  rootBoundary?: TurnActivityGroup | null;
  activity: TurnActivityGroup[];
  blockingRequests: PendingRequestView[];
  final: TurnPart | null;
  postFinal: TurnPostFinalItem[];
  tokensPerSecond: number | null;
  status: "working" | "completed" | "failed" | "interrupted";
  startedAt: number;
  finalStartedAt: number | null;
  workCompletedAt: number | null;
  completedAt: number | null;
  canCollapse: boolean;
  shouldAutoCollapse: boolean;
  shell?: TurnPart;
  context?: {
    agent: string | null;
    model: ModelRef | null;
    location: LocationRef | null;
  };
}

export interface TranscriptProjectionRow {
  id: string;
  turn: TranscriptTurn;
  forkBeforeMessageID?: string;
}

export type TranscriptPresentationRowKind =
  | "user-message"
  | "boundary"
  | "shell"
  | "activity"
  | "requests"
  | "assistant-message"
  | "post-final"
  | "turn-status";

interface TranscriptPresentationRowBase {
  id: string;
  kind: TranscriptPresentationRowKind;
  turnID: string;
  firstInTurn: boolean;
  lastInTurn: boolean;
}

export type TranscriptPresentationRow =
  | (TranscriptPresentationRowBase & { kind: "user-message"; message: PalotMessage })
  | (TranscriptPresentationRowBase & { kind: "boundary"; group: TurnActivityGroup })
  | (TranscriptPresentationRowBase & { kind: "shell"; entry: TurnPart })
  | (TranscriptPresentationRowBase & { kind: "activity"; turn: TranscriptTurn })
  | (TranscriptPresentationRowBase & { kind: "requests"; requests: PendingRequestView[] })
  | (TranscriptPresentationRowBase & {
      kind: "assistant-message";
      turn: TranscriptTurn;
      final: TurnPart;
      forkBeforeMessageID?: string;
    })
  | (TranscriptPresentationRowBase & { kind: "post-final"; items: TurnPostFinalItem[] })
  | (TranscriptPresentationRowBase & { kind: "turn-status"; turn: TranscriptTurn });

export interface TranscriptBackgroundToolSource {
  part: PalotMessageContent;
  index: number;
  messageCreatedAt: number;
}

export interface TranscriptBackgroundResponseSource {
  part: PalotMessageContent;
  messageCreatedAt: number;
}

export interface TranscriptBackgroundFacts {
  subagentTools: TranscriptBackgroundToolSource[];
  subagentResponses: TranscriptBackgroundResponseSource[];
  shellTools: TranscriptBackgroundToolSource[];
  shellMessages: PalotMessage[];
}

export interface SessionTranscriptProjection {
  rows: TranscriptProjectionRow[];
  prompts: readonly TranscriptPromptAnchor[];
  presentationRows: TranscriptPresentationRow[];
  inlineRequestIDs: Set<string>;
  composerMessages: PalotMessage[];
  background: TranscriptBackgroundFacts;
}

export interface SessionTranscriptProjectionInput {
  messages: PalotMessage[];
  execution?: SessionExecutionState | null;
  requests?: PendingRequestView[];
  diffs?: FileDiffInfo[];
  runtimeStatus?: SessionRuntimeStatus | null;
  initialLocation?: LocationRef | null;
  policy?: ResolvedSessionProjectionPolicy;
}

export interface SessionTranscriptProjector {
  project(input: SessionTranscriptProjectionInput): SessionTranscriptProjection;
}

export interface ReasoningContent {
  title: string | null;
  body: string;
}

export function splitReasoningContent(value: string): ReasoningContent {
  const text = value.trim();
  const match = text.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) return { title: null, body: text };
  return {
    title: match[1]?.trim() || null,
    body: text.slice(match[0].length).trimEnd(),
  };
}

function parts(message: PalotMessage): PalotMessageContent[] {
  return message.content.length > 0
    ? message.content
    : [{ type: "text", text: message.text ?? "" }];
}

function messageData(message: PalotMessage): Record<string, JsonValue> {
  return recordValue(message.data);
}

function structuredError(message: PalotMessage): {
  type: string | null;
  message: string | null;
} | null {
  const error = recordValue(messageData(message).error);
  const nested = recordValue(error.data);
  const type = stringValue(error.type) ?? stringValue(error.name);
  const detail = stringValue(error.message) ?? stringValue(nested.message);
  return type || detail ? { type, message: detail } : null;
}

function interruptedError(error: { type: string | null; message: string | null } | null): boolean {
  if (!error) return false;
  return (
    error.type === "MessageAbortedError" ||
    error.message?.trim().toLowerCase() === "step interrupted"
  );
}

function interruptionDetail(message: string | null): string | undefined {
  if (!message || message.trim().toLowerCase() === "step interrupted") {
    return "The active step stopped before a response was completed.";
  }
  return message;
}

function retryData(message: PalotMessage): Record<string, JsonValue> | null {
  const retry = recordValue(messageData(message).retry);
  return typeof retry.at === "number" || typeof retry.attempt === "number" ? retry : null;
}

function modelRef(value: JsonValue | undefined): ModelRef | null {
  const data = recordValue(value);
  const id = stringValue(data.id);
  const providerID = stringValue(data.providerID);
  if (!id || !providerID) return null;
  const variant = stringValue(data.variant);
  return { id, providerID, ...(variant ? { variant } : {}) };
}

function boundaryPart(message: PalotMessage): PalotMessageContent | null {
  const data = messageData(message);
  if (message.type === "synthetic" || message.type === "system") {
    const description = stringValue(data.description);
    const metadata = recordValue(data.metadata);
    const visibleSystemDescription =
      message.type !== "system" || data.userVisible === true || metadata.userVisible === true;
    return description && visibleSystemDescription
      ? {
          type: "timeline-boundary",
          id: message.id,
          name: description,
          data: { kind: message.type, tone: "neutral" },
        }
      : null;
  }
  if (message.type === "skill") return null;
  return null;
}

function subagentResponseBody(value: string): string {
  const match = value.match(/^<subagent\b[^>]*>\s*([\s\S]*?)\s*<\/subagent>\s*$/);
  return (match?.[1] ?? value).trim();
}

function subagentResponsePart(message: PalotMessage): PalotMessageContent | null {
  if (message.type !== "synthetic") return null;
  const data = messageData(message);
  const metadata = recordValue(data.metadata);
  if (metadata.source !== "subagent") return null;
  const state = stringValue(metadata.state) ?? "completed";
  const status =
    state === "running"
      ? "running"
      : state === "failed" || state === "error"
        ? "failed"
        : state === "interrupted" || state === "cancelled"
          ? "interrupted"
          : "completed";
  const response = subagentResponseBody(message.text ?? stringValue(data.text) ?? "");
  return {
    type: "subagent-response",
    id: message.id,
    name: stringValue(data.description) ?? "Subagent response",
    text: response,
    status,
    data: {
      ...(stringValue(metadata.childID) ? { childID: stringValue(metadata.childID)! } : {}),
      ...(stringValue(metadata.agent) ? { agent: stringValue(metadata.agent)! } : {}),
      state,
    },
  };
}

function shellPart(message: PalotMessage): PalotMessageContent {
  const data = messageData(message);
  const status = stringValue(data.status) ?? (message.completedAt === null ? "running" : "exited");
  const output = recordValue(data.output);
  const outputText = unwrapShellTransport(stringValue(output.output));
  const exit = typeof data.exit === "number" ? data.exit : null;
  const failed = status !== "running" && (status !== "exited" || (exit !== null && exit !== 0));
  return {
    type: "tool",
    id: stringValue(data.shellID) ?? message.id,
    name: "shell",
    time: {
      created: message.createdAt,
      ...(message.completedAt === null ? {} : { completed: message.completedAt }),
    },
    state: {
      status: status === "running" ? "running" : failed ? "error" : "completed",
      input: {
        command: stringValue(data.command) ?? "",
        ...(stringValue(data.cwd) ? { workdir: stringValue(data.cwd)! } : {}),
      },
      ...(outputText ? { content: [{ type: "text", text: outputText }] } : {}),
      metadata: {
        ...(exit === null ? {} : { exit }),
        standalone: true,
        ...(typeof output.truncated === "boolean" ? { truncated: output.truncated } : {}),
        ...(typeof output.cursor === "number" ? { cursor: output.cursor } : {}),
        ...(typeof output.size === "number" ? { size: output.size } : {}),
        ...(status === "timeout" ? { timeout: true } : {}),
      },
      ...(failed
        ? {
            error:
              status === "timeout"
                ? { type: "ShellTimeoutError", message: "Shell command timed out" }
                : status === "killed"
                  ? { type: "ShellKilledError", message: "Shell command was killed" }
                  : {
                      type: "ShellExitError",
                      message: `Shell command exited with code ${exit ?? "unknown"}`,
                    },
          }
        : {}),
    },
  };
}

function unwrapShellTransport(value: string | null): string | null {
  if (!value) return value;
  const match = value.match(
    /^<shell\b(?=[^>]*\bid="[^"]+")(?=[^>]*\bstate="[^"]+")(?=[^>]*\bcommand="[^"]*")[^>]*>\s*([\s\S]*?)\s*<\/shell>\s*$/,
  );
  return match?.[1] ?? value;
}

function assistantBoundaryParts(
  message: PalotMessage,
  latestAssistant: boolean,
): PalotMessageContent[] {
  if (message.type !== "assistant") return [];
  const retry = retryData(message);
  if (retry && latestAssistant) {
    const error = recordValue(retry.error);
    const attempt = typeof retry.attempt === "number" ? retry.attempt : null;
    return [
      {
        type: "timeline-boundary",
        id: `${message.id}:retry`,
        name: attempt === null ? "Retrying response" : `Retrying response, attempt ${attempt}`,
        text: stringValue(error.message) ?? undefined,
        status: "running",
        data: {
          kind: "retry",
          tone: "progress",
          ...(typeof retry.at === "number" ? { at: retry.at } : {}),
        },
      },
    ];
  }
  const error = structuredError(message);
  if (!error) return [];
  const interrupted = interruptedError(error);
  if (!interrupted && !latestAssistant) return [];
  return [
    {
      type: "timeline-boundary",
      id: `${message.id}:${interrupted ? "interrupted" : "error"}`,
      name: interrupted ? "Response interrupted" : "Response failed",
      text: interrupted ? interruptionDetail(error.message) : (error.message ?? undefined),
      status: interrupted ? "interrupted" : "failed",
      data: {
        kind: interrupted ? "interrupted" : "error",
        tone: interrupted ? "neutral" : "error",
      },
    },
  ];
}

function projectedPartsUncached(
  message: PalotMessage,
  latestAssistant: boolean,
): PalotMessageContent[] {
  if (message.type === "shell") return [shellPart(message)];
  const subagentResponse = subagentResponsePart(message);
  if (subagentResponse) return [subagentResponse];
  const boundary = boundaryPart(message);
  if (boundary) return [boundary];
  if (message.type !== "assistant" && message.type !== "compaction") return [];
  return [
    ...parts(message).filter((part) => part.type !== "text" || messageText(message, part).trim()),
    ...assistantBoundaryParts(message, latestAssistant),
  ];
}

interface MessageProjectionFacts {
  latestParts: PalotMessageContent[];
  historicalParts: PalotMessageContent[];
  activityOnly: boolean;
  subagentResponse: boolean;
  subagentTools: TranscriptBackgroundToolSource[];
  subagentResponses: TranscriptBackgroundResponseSource[];
  shellTools: TranscriptBackgroundToolSource[];
}

const messageProjectionFactsCache = new WeakMap<PalotMessage, MessageProjectionFacts>();

function messageProjectionFacts(message: PalotMessage): MessageProjectionFacts {
  const cached = messageProjectionFactsCache.get(message);
  if (cached) return cached;

  const latestParts = projectedPartsUncached(message, true);
  const historicalParts =
    message.type === "assistant" ? projectedPartsUncached(message, false) : latestParts;
  const visible = latestParts.filter(
    (part) =>
      part.type === "reasoning" ||
      part.type === "text" ||
      part.type === "tool" ||
      part.type === "compaction",
  );
  const last = visible.at(-1);
  const subagentTools: TranscriptBackgroundToolSource[] = [];
  const subagentResponses: TranscriptBackgroundResponseSource[] = [];
  const shellTools: TranscriptBackgroundToolSource[] = [];
  for (const [index, part] of latestParts.entries()) {
    if (part.type === "subagent-response") {
      subagentResponses.push({ part, messageCreatedAt: message.createdAt });
      continue;
    }
    if (!isTool(part)) continue;
    const source = { part, index, messageCreatedAt: message.createdAt };
    const name = part.name?.toLowerCase();
    if (name === "shell" || name === "local_shell") shellTools.push(source);
    if (projectToolExecution(part, index).kind === "subagent") subagentTools.push(source);
  }
  const facts = {
    latestParts,
    historicalParts,
    activityOnly:
      message.type === "assistant" &&
      !structuredError(message) &&
      !retryData(message) &&
      (message.finish === "tool-calls" || !last || last.type !== "text"),
    subagentResponse: subagentResponses.length > 0,
    subagentTools,
    subagentResponses,
    shellTools,
  };
  messageProjectionFactsCache.set(message, facts);
  return facts;
}

function projectedParts(message: PalotMessage, latestAssistant = true): PalotMessageContent[] {
  const facts = messageProjectionFacts(message);
  return latestAssistant ? facts.latestParts : facts.historicalParts;
}

function runtimeBoundaryPart(status: SessionRuntimeStatus | null): PalotMessageContent | null {
  if (status?.type !== "retry") return null;
  return {
    type: "timeline-boundary",
    id: "runtime:retry",
    name: `Retrying response, attempt ${status.attempt}`,
    text: status.message,
    status: "running",
    data: { kind: "retry", tone: "progress", at: status.next },
  };
}

function executionBoundaryPart(
  execution: SessionExecutionState | null,
  messages: PalotMessage[],
): PalotMessageContent | null {
  if (!execution || (execution.status !== "failed" && execution.status !== "interrupted"))
    return null;
  if (execution.status === "interrupted" && !execution.error) return null;
  const interrupted =
    execution.status === "interrupted" || interruptedError(execution.error ?? null);
  if (
    messages.some((message) => {
      const error = structuredError(message);
      return error !== null && interruptedError(error) === interrupted;
    })
  ) {
    return null;
  }
  return {
    type: "timeline-boundary",
    id: interrupted ? "execution:interrupted" : "execution:error",
    name: interrupted ? "Response interrupted" : "Response failed",
    text: interrupted
      ? interruptionDetail(execution.error?.message ?? null)
      : execution.error?.message,
    status: interrupted ? "interrupted" : "failed",
    data: {
      kind: interrupted ? "interrupted" : "error",
      tone: interrupted ? "neutral" : "error",
    },
  };
}

function visibleText(entry: TurnPart): boolean {
  return entry.part.type === "text" && Boolean(messageText(entry.message, entry.part).trim());
}

function visibleReasoning(entry: TurnPart): boolean {
  return entry.part.type === "reasoning" && Boolean(messageText(entry.message, entry.part).trim());
}

function visibleCompaction(entry: TurnPart): boolean {
  return entry.part.type === "compaction";
}

function toolStatus(part: PalotMessageContent): {
  normalized: "pending" | "running" | "complete" | "error";
  raw: JsonValue | undefined;
} {
  const raw = recordValue(part.state).status;
  return {
    raw,
    normalized:
      raw === "completed" || raw === "complete"
        ? "complete"
        : raw === "running" || raw === "error"
          ? raw
          : "pending",
  };
}

function entryID(entry: TurnPart): string {
  return entry.part.id ?? `${entry.message.id}:${entry.part.type}:${entry.index}`;
}

function latestCompleteSentence(value: string): string | null {
  const sentences = value.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(?:["')\]}]+)?/g);
  return sentences?.at(-1)?.trim() ?? null;
}

function firstCompleteSentence(value: string): string | null {
  return (
    value
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]+(?:["')\]}]+)?/)?.[0]
      ?.trim() ?? null
  );
}

function latestReasoningHeading(value: string): string | null {
  let latest: string | null = null;
  let latestIndex = -1;
  for (const match of value.matchAll(/^\s*(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1\s*$/gm)) {
    if ((match.index ?? -1) <= latestIndex) continue;
    latest = match[2]?.trim() ?? latest;
    latestIndex = match.index ?? latestIndex;
  }
  for (const match of value.matchAll(/^\s*#{1,6}\s+(\S.*)\s*$/gm)) {
    if ((match.index ?? -1) <= latestIndex) continue;
    latest = match[1]?.trim() ?? latest;
    latestIndex = match.index ?? latestIndex;
  }
  return latest;
}

function firstReasoningHeading(value: string): string | null {
  const emphasis = /^\s*(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1\s*$/m.exec(value);
  const heading = /^\s*#{1,6}\s+(\S.*)\s*$/m.exec(value);
  if (!emphasis) return heading?.[1]?.trim() ?? null;
  if (!heading) return emphasis[2]?.trim() ?? null;
  return (emphasis.index ?? 0) < (heading.index ?? 0)
    ? (emphasis[2]?.trim() ?? null)
    : (heading[1]?.trim() ?? null);
}

export function createReasoningTitle(value: string): string {
  const text = value.trim();
  const title =
    splitReasoningContent(text).title ??
    latestReasoningHeading(text) ??
    latestCompleteSentence(text);
  if (title) return title;
  const fallback = text.replace(/\s+/g, " ");
  if (!fallback) return "Reasoning";
  return fallback.length > 96 ? `${fallback.slice(0, 95)}…` : fallback;
}

const TOOL_ACTIVITY_TITLES = {
  read: "Reading files",
  search: "Searching the project",
  edit: "Editing files",
  command: "Running commands",
  web: "Researching",
  delegate: "Delegating work",
  skill: "Loading skills",
  input: "Gathering input",
  orchestrate: "Orchestrating tools",
} as const;

type ToolActivity = keyof typeof TOOL_ACTIVITY_TITLES;

const TOOL_ACTIVITY_BY_CATEGORY: Record<ActivityCategory, ToolActivity> = {
  reasoning: "command",
  read: "read",
  "code-search": "search",
  edit: "edit",
  command: "command",
  web: "web",
  delegation: "delegate",
  other: "orchestrate",
};

function recordValue(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fileName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? value;
}

function quoted(value: string, limit = 72): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const shortened = compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
  return `'${shortened}'`;
}

function targetedToolTitle(entry: TurnPart, activity: ToolActivity): string | null {
  const state = recordValue(entry.part.state);
  const input = recordValue(state.input);
  const path = stringValue(input.path) ?? stringValue(input.file);
  const name = path ? quoted(fileName(path)) : null;

  if (activity === "read" && name) return `Reading file ${name}`;
  if (activity === "edit" && name) return `Editing ${name}`;
  if (activity === "edit") {
    const execution = projectToolExecution(entry.part, entry.index);
    const targets = execution.kind === "file-change" ? execution.targetFiles.map(fileName) : [];
    if (targets.length === 1) return `Editing ${quoted(targets[0]!)}`;
    if (targets.length === 2) return `Editing ${quoted(targets[0]!)} and ${quoted(targets[1]!)}`;
    if (targets.length > 2) {
      return `Editing ${quoted(targets[0]!)}, ${quoted(targets[1]!)} and ${targets.length - 2} more`;
    }
  }
  if (activity === "search") {
    const pattern = stringValue(input.pattern) ?? stringValue(input.query);
    if (pattern) return `Searching for ${quoted(pattern)}`;
  }
  if (activity === "command") {
    const command = stringValue(input.command);
    if (command) return `Running ${quoted(command)}`;
  }
  if (activity === "web") {
    const query = stringValue(input.query) ?? stringValue(input.url);
    if (query) return `Researching ${quoted(query)}`;
  }
  if (activity === "delegate") {
    const description = stringValue(input.description);
    if (description) return `Delegating ${quoted(description)}`;
  }
  if (activity === "skill") {
    const skill = stringValue(input.name) ?? stringValue(input.id);
    if (skill) return `Loading ${quoted(skill)}`;
  }
  return null;
}

function inferredToolTitle(entries: TurnPart[]): string {
  const tools = entries.filter((entry) => isTool(entry.part));
  const latestTool = tools.at(-1);
  if (!latestTool) return "Working";
  const activities = [
    ...new Set(
      tools.map((entry) => {
        const execution = projectToolExecution(entry.part, entry.index);
        if (execution.kind === "skill") return "skill";
        return TOOL_ACTIVITY_BY_CATEGORY[activityCategory(entry.part, entry.index)];
      }),
    ),
  ];
  if (tools.length > 1 || activities.length > 1) {
    const labels: Record<ToolActivity, string> = {
      read: "Read files",
      search: "searched code",
      edit: "edited files",
      command: "ran commands",
      web: "researched",
      delegate: "delegated work",
      skill: "loaded skills",
      input: "gathered input",
      orchestrate: "orchestrated tools",
    };
    const selected = activities.slice(0, 3).map((activity) => labels[activity]);
    const summary = selected.join(", ");
    return `${summary[0]?.toUpperCase()}${summary.slice(1)}`;
  }
  const execution = projectToolExecution(latestTool.part, latestTool.index);
  const activity =
    execution.kind === "skill"
      ? "skill"
      : TOOL_ACTIVITY_BY_CATEGORY[activityCategory(latestTool.part, latestTool.index)];
  return targetedToolTitle(latestTool, activity) ?? TOOL_ACTIVITY_TITLES[activity];
}

function latestReasoningTitle(entries: TurnPart[], thoughtsOnly = false): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.part.type !== "reasoning") continue;
    if (thoughtsOnly && entry.part.presentation && entry.part.presentation !== "thought") continue;
    return createReasoningTitle(messageText(entry.message, entry.part));
  }
  return null;
}

function runningToolTitle(entries: TurnPart[]): string | null {
  const running = entries.filter((entry) => {
    if (!isTool(entry.part)) return false;
    const status = toolStatus(entry.part);
    return status.normalized === "running" || status.raw === "streaming";
  });
  const first = running[0];
  if (!first) return null;
  const title = inferredToolTitle([first]);
  return running.length === 1 ? title : `${title} and ${running.length - 1} more`;
}

function leadingReasoningTitle(entries: TurnPart[]): string | null {
  for (const entry of entries) {
    if (isTool(entry.part)) break;
    if (entry.part.type !== "reasoning") continue;
    const text = messageText(entry.message, entry.part).trim();
    const title =
      splitReasoningContent(text).title ??
      firstReasoningHeading(text) ??
      firstCompleteSentence(text);
    if (title) return title;
  }
  return null;
}

function firstToolPhaseTitle(entries: TurnPart[]): string {
  const first = entries.find((entry) => isTool(entry.part));
  if (!first) return "Working";
  const execution = projectToolExecution(first.part, first.index);
  if (execution.kind === "skill") return "Preparing the task";
  switch (activityCategory(first.part, first.index)) {
    case "read":
    case "code-search":
      return "Exploring the project";
    case "edit":
      return "Implementing changes";
    case "command":
      return "Running commands";
    case "web":
      return "Researching";
    case "delegation":
      return "Delegating work";
    case "reasoning":
    case "other":
      return "Working";
  }
}

function activeGroupTitle(entries: TurnPart[], currentAction: string | undefined): string {
  return leadingReasoningTitle(entries) ?? currentAction ?? firstToolPhaseTitle(entries);
}

function currentActivityAction(entries: TurnPart[]): string | undefined {
  const tool = runningToolTitle(entries);
  if (tool) return tool;
  return entries.some(
    (entry) =>
      entry.part.type === "reasoning" &&
      entry.part.time?.completed === undefined &&
      entry.message.completedAt === null,
  )
    ? "Reasoning…"
    : undefined;
}

function activityTitle(
  kind: TurnActivityGroup["kind"],
  entries: TurnPart[],
  status: TurnActivityGroup["status"],
): string {
  if (kind === "compaction") return "Compacting context";
  if (kind === "boundary") return entries[0]?.part.name ?? "Session update";
  if (kind === "subagent") return entries[0]?.part.name ?? "Subagent response";
  if (kind === "subagent-tool") return inferredToolTitle(entries);
  if (kind === "reasoning") {
    return latestReasoningTitle(entries) ?? "Thinking";
  }
  if (kind === "input") return "";
  if (status === "running") {
    return (
      runningToolTitle(entries) ?? latestReasoningTitle(entries, true) ?? inferredToolTitle(entries)
    );
  }
  return inferredToolTitle(entries);
}

function activityStatus(entries: TurnPart[]): TurnActivityGroup["status"] {
  if (
    entries.some(
      (entry) =>
        (entry.part.type === "timeline-boundary" && entry.part.status === "failed") ||
        (entry.part.type === "subagent-response" && entry.part.status === "failed") ||
        (isTool(entry.part) && toolStatus(entry.part).normalized === "error") ||
        (entry.part.type === "compaction" && entry.part.status === "failed"),
    )
  ) {
    return "failed";
  }
  if (
    entries.some((entry) => {
      if (isTool(entry.part)) {
        const status = toolStatus(entry.part);
        return status.normalized === "running" || status.raw === "streaming";
      }
      if (entry.part.type === "timeline-boundary") return entry.part.status === "running";
      if (entry.part.type === "compaction") return entry.part.status === "running";
      if (entry.part.type === "reasoning") {
        return entry.part.time?.completed === undefined && entry.message.completedAt === null;
      }
      return entry.part.status === "running" || entry.message.completedAt === null;
    })
  ) {
    return "running";
  }
  const tools = entries.filter((entry) => isTool(entry.part));
  if (tools.length > 0 && tools.every((entry) => toolStatus(entry.part).normalized === "pending")) {
    return "pending";
  }
  if (entries.some((entry) => entry.part.status === "interrupted")) return "interrupted";
  return "completed";
}

type ActivityItem = TurnPart | { message: PalotMessage };

function joinedSummary(labels: string[]): string {
  if (labels.length === 0) return "Worked";
  if (labels.length === 1) return labels[0]!;
  const sentence = labels.map((label, index) =>
    index === 0 ? label : `${label[0]?.toLowerCase()}${label.slice(1)}`,
  );
  if (sentence.length === 2) return sentence.join(" and ");
  return `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`;
}

function semanticActivityTitle(entries: TurnPart[]): string {
  let readsWithoutPaths = 0;
  let searches = 0;
  let editsWithoutFiles = 0;
  let commands = 0;
  let web = 0;
  let delegation = 0;
  let skills = 0;
  let other = 0;
  const readFiles = new Set<string>();
  const listedDirectories = new Set<string>();
  const changedFiles = new Set<string>();

  for (const entry of entries) {
    if (entry.part.type === "reasoning") {
      continue;
    }
    if (!isTool(entry.part)) continue;
    const execution = projectToolExecution(entry.part, entry.index);
    switch (activityCategory(entry.part, entry.index)) {
      case "read":
        if (execution.kind === "skill") {
          skills += 1;
        } else if (execution.kind === "read") {
          if (execution.path) readFiles.add(execution.path);
          else readsWithoutPaths += 1;
        } else if (execution.kind === "list") {
          listedDirectories.add(execution.path);
        }
        break;
      case "code-search":
        searches += 1;
        break;
      case "edit": {
        if (execution.kind !== "file-change") break;
        const files = execution.targetFiles.length
          ? execution.targetFiles
          : execution.files.map((file) => file.file);
        if (files.length === 0) editsWithoutFiles += 1;
        else files.forEach((file) => changedFiles.add(file));
        break;
      }
      case "command":
        commands += 1;
        break;
      case "web":
        web += 1;
        break;
      case "delegation":
        delegation += 1;
        break;
      case "other":
        other += 1;
        break;
      case "reasoning":
        break;
    }
  }

  const editCount = changedFiles.size + editsWithoutFiles;
  const readCount = readFiles.size + readsWithoutPaths;
  return joinedSummary([
    ...(readCount ? [`Read ${readCount} ${readCount === 1 ? "file" : "files"}`] : []),
    ...(listedDirectories.size
      ? [
          `Listed ${listedDirectories.size} ${listedDirectories.size === 1 ? "directory" : "directories"}`,
        ]
      : []),
    ...(searches ? [`Searched code ${searches} ${searches === 1 ? "time" : "times"}`] : []),
    ...(editCount ? [`Changed ${editCount} ${editCount === 1 ? "file" : "files"}`] : []),
    ...(commands ? [`Ran ${commands} ${commands === 1 ? "command" : "commands"}`] : []),
    ...(web ? [`Researched ${web} ${web === 1 ? "source" : "sources"}`] : []),
    ...(delegation ? [`Delegated ${delegation} ${delegation === 1 ? "task" : "tasks"}`] : []),
    ...(skills ? [`Loaded ${skills} ${skills === 1 ? "skill" : "skills"}`] : []),
    ...(other ? [`Used ${other} other ${other === 1 ? "tool" : "tools"}`] : []),
  ]);
}

function groupActivity(
  items: ActivityItem[],
  policy: ResolvedSessionProjectionPolicy,
  safeguards: {
    interrupted: boolean;
    interruptedEntryID: string | null;
    blockingMessageIDs: Set<string>;
    protectAllForBlocking: boolean;
  },
): TurnActivityGroup[] {
  const groups: TurnActivityGroup[] = [];
  let current: TurnActivityGroup | null = null;
  let currentFailed = false;
  let currentSubagent = false;

  const flush = () => {
    if (!current) return;
    current.status = activityStatus(current.entries);
    if (current.presentation === "grouped" && current.status === "failed") {
      current.defaultOpen = true;
    }
    current.defaultOpen =
      current.status === "running" && policy.keepCurrentActivityExpanded
        ? true
        : current.defaultOpen;
    current.currentAction =
      current.status === "running" ? currentActivityAction(current.entries) : undefined;
    current.title =
      current.presentation === "grouped" && current.status === "completed"
        ? policy.groupTitle === "latest-reasoning"
          ? (leadingReasoningTitle(current.entries) ?? semanticActivityTitle(current.entries))
          : semanticActivityTitle(current.entries) === "Worked"
            ? policy.showReasoningSummaries
              ? (leadingReasoningTitle(current.entries) ?? "Worked")
              : "Worked"
            : semanticActivityTitle(current.entries)
        : current.presentation === "grouped" && current.status === "running"
          ? activeGroupTitle(current.entries, current.currentAction)
          : activityTitle(current.kind, current.entries, current.status);
    if (current.currentAction === current.title) current.currentAction = undefined;
    groups.push(current);
    current = null;
    currentFailed = false;
    currentSubagent = false;
  };

  const appendProcessEntry = (entry: TurnPart) => {
    const previous = current?.entries.at(-1);
    if (
      current &&
      entry.part.type === "reasoning" &&
      entry.part.presentation === "preamble" &&
      current.entries.length > 0
    ) {
      flush();
    } else if (
      current &&
      isTool(entry.part) &&
      previous?.part.type === "reasoning" &&
      previous.part.presentation === "recap"
    ) {
      flush();
    }
    const category = activityCategory(entry.part, entry.index);
    const preference = policy.categories[category];
    const status = activityStatus([entry]);
    const execution = isTool(entry.part) ? projectToolExecution(entry.part, entry.index) : null;
    const subagent = execution?.kind === "subagent";
    const interruptedEntry = safeguards.interruptedEntryID === entryID(entry);
    const blocking =
      safeguards.protectAllForBlocking || safeguards.blockingMessageIDs.has(entry.message.id);
    if (
      preference.presentation === "hidden" &&
      status === "completed" &&
      !safeguards.interrupted &&
      !blocking
    ) {
      flush();
      return;
    }
    if (subagent !== currentSubagent && current) flush();
    const presentation =
      blocking ||
      interruptedEntry ||
      preference.presentation === "individual" ||
      preference.presentation === "hidden" ||
      status === "interrupted"
        ? "individual"
        : "grouped";

    if (presentation === "individual") {
      flush();
      current = {
        id: entryID(entry),
        kind: isTool(entry.part) ? "tools" : "reasoning",
        title:
          entry.part.type === "reasoning" && !policy.showReasoningSummaries
            ? status === "running"
              ? "Working"
              : "Worked"
            : activityTitle(isTool(entry.part) ? "tools" : "reasoning", [entry], status),
        status,
        entries: [entry],
        categories: [category],
        presentation,
        defaultOpen: blocking,
        forceOpen: blocking,
        detailsDefaultOpen: preference.details === "expanded",
        showReasoningSummaries: policy.showReasoningSummaries,
        pinned: blocking || preference.foldedTurn === "pinned",
        groupSameFileReads: policy.groupSameFileReads,
      };
      currentSubagent = subagent;
      flush();
      return;
    }

    if (current && (current.kind === "reasoning" || current.kind === "tools") && currentFailed) {
      flush();
    }
    if (
      (current?.kind === "reasoning" || current?.kind === "tools") &&
      current.presentation === "grouped" &&
      current.detailsDefaultOpen === (preference.details === "expanded") &&
      current.pinned === (preference.foldedTurn === "pinned")
    ) {
      if (isTool(entry.part)) current.kind = "tools";
      current.entries.push(entry);
      current.categories = [...new Set([...(current.categories ?? []), category])];
      currentFailed = status === "failed";
      currentSubagent = subagent;
      return;
    }

    flush();
    current = {
      id: entryID(entry),
      kind: isTool(entry.part) ? "tools" : "reasoning",
      title: isTool(entry.part) ? "Working" : "Thinking",
      status,
      entries: [entry],
      categories: [category],
      presentation,
      defaultOpen: false,
      forceOpen: false,
      detailsDefaultOpen: preference.details === "expanded",
      showReasoningSummaries: policy.showReasoningSummaries,
      pinned: preference.foldedTurn === "pinned",
      groupSameFileReads: policy.groupSameFileReads,
    };
    currentFailed = status === "failed";
    currentSubagent = subagent;
  };

  for (const item of items) {
    if (!("part" in item)) {
      if (current?.kind === "input") {
        current.messages?.push(item.message);
      } else {
        flush();
        current = {
          id: item.message.id,
          kind: "input",
          title: "",
          status: "completed",
          entries: [],
          messages: [item.message],
        };
      }
      continue;
    }
    const entry = item;
    if (entry.part.type === "compaction") {
      flush();
      current = {
        id: entryID(entry),
        kind: "compaction",
        title: "Compacting context",
        status: activityStatus([entry]),
        entries: [entry],
      };
      flush();
      continue;
    }
    if (entry.part.type === "timeline-boundary") {
      flush();
      current = {
        id: entryID(entry),
        kind: "boundary",
        title: entry.part.name ?? "Session update",
        status: activityStatus([entry]),
        entries: [entry],
      };
      flush();
      continue;
    }
    if (entry.part.type === "subagent-response") {
      flush();
      current = {
        id: entryID(entry),
        kind: "subagent",
        title: entry.part.name ?? "Subagent response",
        status: activityStatus([entry]),
        entries: [entry],
      };
      flush();
      continue;
    }

    if (entry.part.type === "reasoning") {
      if (!visibleReasoning(entry)) continue;
      appendProcessEntry(entry);
      continue;
    }

    if (isTool(entry.part)) {
      appendProcessEntry(entry);
      continue;
    }

    if (current?.kind === "content") {
      current.entries.push(entry);
    } else {
      flush();
      current = {
        id: entryID(entry),
        kind: "content",
        title: "",
        status: activityStatus([entry]),
        entries: [entry],
      };
    }
  }

  flush();
  return policy.groupSameFileReads ? combineIndividualReadGroups(groups) : groups;
}

function combineIndividualReadGroups(groups: TurnActivityGroup[]): TurnActivityGroup[] {
  const combined: TurnActivityGroup[] = [];
  for (const group of groups) {
    const path = individualReadGroupPath(group);
    const previous = combined.at(-1);
    if (path && previous && individualReadGroupPath(previous) === path) {
      combined[combined.length - 1] = {
        ...previous,
        entries: [...previous.entries, ...group.entries],
      };
      continue;
    }
    combined.push(group);
  }
  return combined;
}

function individualReadGroupPath(group: TurnActivityGroup): string | null {
  if (
    group.presentation !== "individual" ||
    group.status !== "completed" ||
    group.categories?.length !== 1 ||
    group.categories[0] !== "read"
  ) {
    return null;
  }
  const paths = group.entries.flatMap((entry) => {
    if (!isTool(entry.part)) return [];
    const execution = projectToolExecution(entry.part, entry.index);
    return execution.kind === "read" && execution.path !== "Unknown path" ? [execution.path] : [];
  });
  return paths.length === group.entries.length && paths.every((path) => path === paths[0])
    ? (paths[0] ?? null)
    : null;
}

function failed(entries: TurnPart[], assistants: PalotMessage[]): boolean {
  const latestAssistant = assistants.findLast((message) => message.type === "assistant");
  if (
    latestAssistant?.finish === "error" &&
    !interruptedError(structuredError(latestAssistant)) &&
    retryData(latestAssistant) === null
  ) {
    return true;
  }
  return entries.some(
    (entry) =>
      (isTool(entry.part) && toolStatus(entry.part).normalized === "error") ||
      (entry.part.type === "timeline-boundary" && entry.part.status === "failed") ||
      (entry.part.type === "subagent-response" && entry.part.status === "failed") ||
      (entry.part.type === "compaction" && entry.part.status === "failed"),
  );
}

function assistantTokensPerSecond(messages: PalotMessage[]): Map<string, number | null> {
  const rates = new Map<string, number | null>();
  let outputTokens = 0;
  let durationMs = 0;
  let allStreamed = true;

  for (const message of messages) {
    if (message.type === "user" || message.type === "synthetic") {
      outputTokens = 0;
      durationMs = 0;
      allStreamed = true;
      continue;
    }
    if (message.type !== "assistant") continue;

    outputTokens += message.tokens?.output ?? 0;
    if (message.streamedAt === undefined) {
      allStreamed = false;
    } else {
      durationMs += Math.max(0, message.streamedAt - message.createdAt);
    }
    const rate = outputTokens / (durationMs / 1_000);
    rates.set(
      message.id,
      allStreamed &&
        outputTokens > 0 &&
        durationMs > 0 &&
        Number.isFinite(outputTokens) &&
        Number.isFinite(durationMs) &&
        Number.isFinite(rate)
        ? rate
        : null,
    );
  }

  return rates;
}

function postFinalItems(entries: TurnPart[]): TurnPostFinalItem[] {
  const items: TurnPostFinalItem[] = [];
  const seen = new Set<string>();
  const add = (item: TurnPostFinalItem) => {
    const key = `${item.kind}:${item.uri ?? item.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const entry of entries) {
    if (!isTool(entry.part)) continue;
    const content = recordValue(entry.part.state).content;
    if (!Array.isArray(content)) continue;
    for (const value of content) {
      const file = recordValue(value);
      if (file.type !== "file") continue;
      const uri = stringValue(file.uri);
      const mime = stringValue(file.mime);
      if (mime?.startsWith("image/")) continue;
      const name = stringValue(file.name) ?? (uri ? fileName(uri) : "Generated file");
      add({
        id: `${entryID(entry)}:${uri ?? name}`,
        kind: "file",
        name,
        ...(mime ? { mime } : {}),
        ...(uri ? { uri } : {}),
      });
    }
  }
  return items;
}

function postFinalDiffs(diffs: FileDiffInfo[]): TurnPostFinalItem[] {
  return diffs.map((diff) => ({
    id: `diff:${diff.file}`,
    kind: "diff",
    name: diff.file,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
  }));
}

function finalStart(final: TurnPart | null): number | null {
  if (!final) return null;
  return (
    final.part.time?.created ?? (final.index === 0 ? (final.message.firstTokenAt ?? null) : null)
  );
}

function hasFinal(final: TurnPart | null): boolean {
  return final !== null;
}

function finalArtifacts(
  final: TurnPart | null,
  entries: TurnPart[],
  diffs: FileDiffInfo[],
  working: boolean,
): TurnPostFinalItem[] {
  if (working) return [];
  if (!final) return postFinalDiffs(diffs);
  const diffNames = new Set(diffs.map((diff) => diff.file));
  const items = postFinalItems(entries).filter(
    (item) => item.kind !== "change" || !diffNames.has(item.name),
  );
  const seen = new Set(items.map((item) => `${item.kind}:${item.name}`));
  for (const item of postFinalDiffs(diffs)) {
    const key = `${item.kind}:${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function executionTerminal(execution: SessionExecutionState | null): boolean {
  return (
    execution?.status === "succeeded" ||
    execution?.status === "failed" ||
    execution?.status === "interrupted"
  );
}

function isPostFinalPart(part: PalotMessageContent): boolean {
  return part.type === "file" || part.type === "patch";
}

function collapseState(input: {
  finalStarted: boolean;
  cancelled: boolean;
  failed: boolean;
  hasActivity: boolean;
  hasBlockingRequest: boolean;
}) {
  const canCollapse =
    input.finalStarted &&
    !input.cancelled &&
    !input.failed &&
    input.hasActivity &&
    !input.hasBlockingRequest;
  return { canCollapse, shouldAutoCollapse: canCollapse };
}

function project(
  id: string,
  messages: PalotMessage[],
  execution: SessionExecutionState | null,
  hasAuthoritativeStatus: boolean,
  blockingRequests: PendingRequestView[],
  diffs: FileDiffInfo[],
  runtimeStatus: SessionRuntimeStatus | null,
  context: TranscriptTurn["context"],
  policy: ResolvedSessionProjectionPolicy,
  tokensPerSecond: number | null,
): TranscriptTurn {
  const users: PalotMessage[] = [];
  const assistants: PalotMessage[] = [];
  let shell: PalotMessage | undefined;
  let latestAssistant: PalotMessage | undefined;
  for (const message of messages) {
    if (message.type === "user") users.push(message);
    if (message.type === "shell" && !shell) shell = message;
    if (["assistant", "compaction", "shell"].includes(message.type)) assistants.push(message);
    if (message.type === "assistant") latestAssistant = message;
  }
  const user = users[0] ?? null;
  const entries: TurnPart[] = [];
  const entriesByMessage = new Map<PalotMessage, TurnPart[]>();
  for (const message of messages) {
    if (message.type === "user") continue;
    const messageEntries = projectedParts(
      message,
      message.type !== "assistant" || message === latestAssistant,
    ).map((part, index) => ({ message, part, index }));
    if (messageEntries.length === 0) continue;
    entriesByMessage.set(message, messageEntries);
    entries.push(...messageEntries);
  }
  const shellEntry = shell ? entries.find((entry) => isTool(entry.part)) : undefined;
  const runtimeBoundary = runtimeBoundaryPart(runtimeStatus);
  let runtimeBoundaryEntry: TurnPart | null = null;
  if (runtimeBoundary && !messages.some((message) => retryData(message) !== null)) {
    const source = messages.at(-1) ?? {
      id: `${id}:runtime`,
      type: "assistant",
      createdAt: runtimeStatus?.type === "retry" ? runtimeStatus.next : 0,
      completedAt: null,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
    };
    runtimeBoundaryEntry = { message: source, part: runtimeBoundary, index: 0 };
    entries.push(runtimeBoundaryEntry);
  }
  const executionBoundary = executionBoundaryPart(execution, messages);
  let executionBoundaryEntry: TurnPart | null = null;
  if (executionBoundary) {
    const source = messages.at(-1)!;
    executionBoundaryEntry = { message: source, part: executionBoundary, index: 0 };
    entries.push(executionBoundaryEntry);
  }
  const working =
    execution?.status === "running" ||
    runtimeStatus?.type === "busy" ||
    runtimeStatus?.type === "retry" ||
    (!hasAuthoritativeStatus && assistants.some((message) => message.completedAt === null));
  const hasFailed = failed(entries, assistants);
  const lastVisible = entries.findLast(
    (entry) =>
      visibleText(entry) ||
      visibleReasoning(entry) ||
      visibleCompaction(entry) ||
      isTool(entry.part),
  );
  const final =
    lastVisible && visibleText(lastVisible) && lastVisible.message.finish !== "tool-calls"
      ? lastVisible
      : null;
  const runStartedAt = users.find((message) => message.runStartedAt !== undefined)?.runStartedAt;
  const runCompletedAt = users.findLast(
    (message) => message.runCompletedAt !== undefined,
  )?.runCompletedAt;
  const historicalCompletion =
    execution === null &&
    runtimeStatus?.type !== "busy" &&
    runtimeStatus?.type !== "retry" &&
    assistants.length > 0 &&
    assistants.every((message) => message.completedAt !== null) &&
    (runCompletedAt !== undefined ||
      assistants.some((message) => message.finish !== null && message.finish !== "tool-calls"));
  const postFinal =
    executionTerminal(execution) || historicalCompletion
      ? finalArtifacts(final, entries, diffs, false)
      : [];
  const activityItems: ActivityItem[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (message.type === "user") {
      if (messageIndex > 0) activityItems.push({ message });
      continue;
    }
    for (const entry of entriesByMessage.get(message) ?? []) {
      if (isPostFinalPart(entry.part)) continue;
      if (
        final &&
        entry.message === final.message &&
        entry.part === final.part &&
        entry.index === final.index
      ) {
        continue;
      }
      activityItems.push(entry);
    }
  }
  if (runtimeBoundaryEntry) activityItems.push(runtimeBoundaryEntry);
  if (executionBoundaryEntry) activityItems.push(executionBoundaryEntry);
  const executionInterrupted =
    execution?.status === "interrupted" || interruptedError(execution?.error ?? null);
  const assistantInterrupted = latestAssistant
    ? interruptedError(structuredError(latestAssistant))
    : false;
  const interrupted = executionInterrupted || assistantInterrupted;
  const blockingMessageIDs = new Set(
    blockingRequests.flatMap((request) => (request.ownerMessageID ? [request.ownerMessageID] : [])),
  );
  const interruptedEntry = interrupted
    ? activityItems.findLast(
        (item): item is TurnPart =>
          "part" in item && (item.part.type === "reasoning" || isTool(item.part)),
      )
    : undefined;
  let activity = groupActivity(activityItems, policy, {
    interrupted,
    interruptedEntryID: interruptedEntry ? entryID(interruptedEntry) : null,
    blockingMessageIDs,
    protectAllForBlocking: blockingRequests.length > 0 && blockingMessageIDs.size === 0,
  });
  const rootBoundary =
    messages[0]?.type === "synthetic" && activity[0]?.kind === "boundary" ? activity[0] : null;
  if (rootBoundary) activity = activity.slice(1);
  const firstAssistant = assistants[0];
  const lastAssistant = assistants.at(-1);
  const firstMessage = messages[0];
  const startedAt =
    execution?.startedAt ??
    runStartedAt ??
    (firstMessage && messageProjectionFacts(firstMessage).subagentResponse
      ? firstMessage.createdAt
      : null) ??
    firstAssistant?.createdAt ??
    user?.createdAt ??
    0;
  const completedAt = working
    ? null
    : (runCompletedAt ??
      execution?.completedAt ??
      lastAssistant?.completedAt ??
      lastAssistant?.createdAt ??
      null);
  const status = working
    ? "working"
    : interrupted
      ? "interrupted"
      : execution?.status === "failed" || hasFailed
        ? "failed"
        : "completed";
  if (status === "working" && policy.keepCurrentActivityExpanded) {
    const lastProcessIndex = activity.findLastIndex(
      (group) => group.kind === "reasoning" || group.kind === "tools",
    );
    if (lastProcessIndex >= 0 && !activity[lastProcessIndex]!.defaultOpen) {
      activity = activity.map((group, index) =>
        index === lastProcessIndex ? { ...group, defaultOpen: true } : group,
      );
    }
  }
  if (status === "interrupted") {
    const lastActiveIndex = activity.findLastIndex(
      (group) => group.status === "running" || group.status === "pending",
    );
    if (lastActiveIndex >= 0) {
      activity = activity.map((group, index) =>
        index === lastActiveIndex ? { ...group, status: "interrupted" } : group,
      );
    }
  }
  const finalStartedAt = finalStart(final);
  const workCompletedAt = finalStartedAt;
  const collapse = collapseState({
    finalStarted: hasFinal(final),
    cancelled: status === "interrupted",
    failed: hasFailed || status === "failed",
    hasActivity: activity.length > 0,
    hasBlockingRequest: blockingRequests.length > 0,
  });
  collapse.shouldAutoCollapse &&=
    policy.foldCompletedTurns && (status !== "working" || !policy.keepCurrentActivityExpanded);
  return {
    id,
    kind:
      messages[0]?.type === "shell"
        ? "shell"
        : messages[0]?.type === "compaction"
          ? "compaction"
          : messages[0] && messageProjectionFacts(messages[0]).subagentResponse
            ? "subagent"
            : messages[0]?.type === "user" ||
                messages.some((message) => message.type === "assistant")
              ? "conversation"
              : "boundary",
    user,
    users,
    rootBoundary,
    activity,
    blockingRequests,
    final,
    postFinal,
    tokensPerSecond: working ? null : tokensPerSecond,
    status,
    startedAt,
    finalStartedAt,
    workCompletedAt,
    completedAt,
    ...collapse,
    ...(shellEntry ? { shell: shellEntry } : {}),
    ...(context ? { context } : {}),
  };
}

interface TimelineGroup {
  id: string;
  kind: NonNullable<TranscriptTurn["kind"]>;
  messages: PalotMessage[];
  activityOnly: boolean;
  context: NonNullable<TranscriptTurn["context"]>;
}

interface TimelineGrouping {
  groups: TimelineGroup[];
  orderedMessages: PalotMessage[];
  userMessages: PalotMessage[];
  contextMessage: PalotMessage | null;
  background: TranscriptBackgroundFacts;
}

interface CachedTurnProjection {
  kind: NonNullable<TranscriptTurn["kind"]>;
  messages: PalotMessage[];
  execution: SessionExecutionState | null;
  hasAuthoritativeStatus: boolean;
  requests: PendingRequestView[];
  diffs: FileDiffInfo[];
  runtimeStatus: SessionRuntimeStatus | null;
  context: NonNullable<TranscriptTurn["context"]>;
  policyKey: string;
  tokensPerSecond: number | null;
  turn: TranscriptTurn;
}

interface CachedComposerProjection {
  userMessages: PalotMessage[];
  contextTokens: number;
  contextModel: PalotMessage["model"];
  messages: PalotMessage[];
}

function tokenTotal(message: PalotMessage): number {
  if (!message.tokens) return 0;
  return (
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  );
}

function timelineKind(
  message: PalotMessage,
  facts: MessageProjectionFacts,
): NonNullable<TranscriptTurn["kind"]> {
  if (message.type === "shell") return "shell";
  if (message.type === "compaction") return "compaction";
  if (message.type === "synthetic" && facts.subagentResponse) return "subagent";
  if (message.type === "user" || message.type === "assistant") return "conversation";
  return "boundary";
}

function groupTimelineMessages(
  messages: PalotMessage[],
  initialLocation: LocationRef | null,
  assumeOrdered = false,
): TimelineGrouping {
  const groups: TimelineGroup[] = [];
  const userMessages: PalotMessage[] = [];
  const subagentTools: TranscriptBackgroundToolSource[] = [];
  const subagentResponses: TranscriptBackgroundResponseSource[] = [];
  const shellTools: TranscriptBackgroundToolSource[] = [];
  const shellMessages: PalotMessage[] = [];
  let contextMessage: PalotMessage | null = null;
  let previousMessage: PalotMessage | null = null;
  let activeAgent: string | null = null;
  let activeModel: ModelRef | null = null;
  let activeLocation = initialLocation;

  for (const message of messages) {
    if (!assumeOrdered && previousMessage && compareMessages(previousMessage, message) > 0) {
      return groupTimelineMessages(messages.toSorted(compareMessages), initialLocation, true);
    }
    previousMessage = message;
    const data = messageData(message);
    if (message.type === "agent-switched") activeAgent = stringValue(data.agent) ?? activeAgent;
    if (message.type === "model-switched") activeModel = modelRef(data.model) ?? activeModel;
    if (message.type === "location-switched") {
      const location = recordValue(data.location);
      const directory = stringValue(location.directory);
      const workspaceID = stringValue(location.workspaceID);
      if (directory) activeLocation = { directory, ...(workspaceID ? { workspaceID } : {}) };
    }
    if (message.type === "assistant") {
      activeAgent = message.agent ?? activeAgent;
      activeModel = message.model ?? activeModel;
    }
    if (message.type === "user") userMessages.push(message);
    if (message.type === "assistant" && tokenTotal(message) > 0) contextMessage = message;
    if (message.type === "shell") shellMessages.push(message);

    const facts = messageProjectionFacts(message);
    subagentTools.push(...facts.subagentTools);
    subagentResponses.push(...facts.subagentResponses);
    shellTools.push(...facts.shellTools);

    const visible =
      message.type === "user" || message.type === "assistant" || facts.latestParts.length > 0;
    if (!visible) continue;
    const kind = timelineKind(message, facts);
    const activityOnly = facts.activityOnly;
    const previous = groups.at(-1);
    if (
      kind === "conversation" &&
      activityOnly &&
      previous?.kind === "conversation" &&
      previous.activityOnly
    ) {
      previous.messages.push(message);
      previous.context = { agent: activeAgent, model: activeModel, location: activeLocation };
      continue;
    }
    groups.push({
      id: message.id,
      kind,
      messages: [message],
      activityOnly,
      context: { agent: activeAgent, model: activeModel, location: activeLocation },
    });
  }

  return {
    groups,
    orderedMessages: messages,
    userMessages,
    contextMessage,
    background: { subagentTools, subagentResponses, shellTools, shellMessages },
  };
}

function sameReferences<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameExecutionState(
  left: SessionExecutionState | null,
  right: SessionExecutionState | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.status === right.status &&
      left.startedAt === right.startedAt &&
      left.completedAt === right.completedAt &&
      left.parentID === right.parentID &&
      left.error?.type === right.error?.type &&
      left.error?.message === right.error?.message)
  );
}

function sameRuntimeStatus(
  left: SessionRuntimeStatus | null,
  right: SessionRuntimeStatus | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.type !== right.type) return false;
  if (left.type !== "retry" || right.type !== "retry") return true;
  return (
    left.attempt === right.attempt && left.message === right.message && left.next === right.next
  );
}

function projectionPolicyKey(policy: ResolvedSessionProjectionPolicy): string {
  return [
    policy.foldCompletedTurns,
    policy.groupTitle,
    policy.groupSameFileReads,
    policy.showReasoningSummaries,
    policy.keepCurrentActivityExpanded,
    ...ACTIVITY_CATEGORIES.flatMap((category) => {
      const value = policy.categories[category];
      return [value.presentation, value.details, value.foldedTurn];
    }),
  ].join("\0");
}

function sameCachedTurn(
  cached: CachedTurnProjection,
  input: Omit<CachedTurnProjection, "turn">,
): boolean {
  return (
    cached.kind === input.kind &&
    cached.policyKey === input.policyKey &&
    cached.hasAuthoritativeStatus === input.hasAuthoritativeStatus &&
    sameReferences(cached.messages, input.messages) &&
    sameExecutionState(cached.execution, input.execution) &&
    sameReferences(cached.requests, input.requests) &&
    sameReferences(cached.diffs, input.diffs) &&
    sameRuntimeStatus(cached.runtimeStatus, input.runtimeStatus) &&
    sameTurnContext(cached.context, input.context) &&
    cached.tokensPerSecond === input.tokensPerSecond
  );
}

function sameModelRef(left: PalotMessage["model"], right: PalotMessage["model"]): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.providerID === right.providerID &&
      left.variant === right.variant)
  );
}

function sameLocationRef(left: LocationRef | null, right: LocationRef | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.directory === right.directory &&
      left.workspaceID === right.workspaceID)
  );
}

function sameTurnContext(
  left: NonNullable<TranscriptTurn["context"]>,
  right: NonNullable<TranscriptTurn["context"]>,
): boolean {
  return (
    left.agent === right.agent &&
    sameModelRef(left.model, right.model) &&
    sameLocationRef(left.location, right.location)
  );
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function sameBackgroundToolSource(
  left: TranscriptBackgroundToolSource,
  right: TranscriptBackgroundToolSource,
): boolean {
  return (
    left.part === right.part &&
    left.index === right.index &&
    left.messageCreatedAt === right.messageCreatedAt
  );
}

function sameBackgroundResponseSource(
  left: TranscriptBackgroundResponseSource,
  right: TranscriptBackgroundResponseSource,
): boolean {
  return left.part === right.part && left.messageCreatedAt === right.messageCreatedAt;
}

function reuseArray<T>(
  previous: T[] | undefined,
  next: T[],
  equal: (left: T, right: T) => boolean,
) {
  if (!previous) return next;
  const reused = next.map((value, index) => {
    const prior = previous[index];
    return prior !== undefined && equal(prior, value) ? prior : value;
  });
  return sameReferences(previous, reused) ? previous : reused;
}

type UnpositionedTranscriptPresentationRow<
  Row extends TranscriptPresentationRow = TranscriptPresentationRow,
> = Row extends TranscriptPresentationRow ? Omit<Row, "firstInTurn" | "lastInTurn"> : never;

function unpositionedPresentationRows(
  source: TranscriptProjectionRow,
): UnpositionedTranscriptPresentationRow[] {
  const { turn } = source;
  const rows: UnpositionedTranscriptPresentationRow[] = [];
  if (turn.kind === "shell" && turn.shell) {
    rows.push({ id: `${turn.id}:shell`, kind: "shell", turnID: turn.id, entry: turn.shell });
    return rows;
  }
  if (turn.user) {
    rows.push({
      id: `${turn.id}:user:${turn.user.id}`,
      kind: "user-message",
      turnID: turn.id,
      message: turn.user,
    });
  }
  if (turn.rootBoundary) {
    rows.push({
      id: `${turn.id}:boundary:${turn.rootBoundary.id}`,
      kind: "boundary",
      turnID: turn.id,
      group: turn.rootBoundary,
    });
  }
  if (turn.activity.length > 0) {
    rows.push({ id: `${turn.id}:activity`, kind: "activity", turnID: turn.id, turn });
  }
  const blockingRequests = turn.blockingRequests.filter((request) => request.type !== "input");
  if (blockingRequests.length > 0) {
    rows.push({
      id: `${turn.id}:requests`,
      kind: "requests",
      turnID: turn.id,
      requests: blockingRequests,
    });
  }
  if (turn.final) {
    const finalID = turn.final.part.id ?? turn.final.message.id;
    rows.push({
      id: `${turn.id}:assistant:${finalID}`,
      kind: "assistant-message",
      turnID: turn.id,
      turn,
      final: turn.final,
      ...(source.forkBeforeMessageID ? { forkBeforeMessageID: source.forkBeforeMessageID } : {}),
    });
  }
  if (turn.postFinal.length > 0) {
    rows.push({
      id: `${turn.id}:post-final`,
      kind: "post-final",
      turnID: turn.id,
      items: turn.postFinal,
    });
  }
  if (
    turn.status === "working" &&
    (turn.kind === undefined || turn.kind === "conversation" || turn.kind === "subagent")
  ) {
    rows.push({ id: `${turn.id}:turn-status`, kind: "turn-status", turnID: turn.id, turn });
  }
  return rows;
}

function samePresentationRow(
  left: TranscriptPresentationRow,
  right: TranscriptPresentationRow,
): boolean {
  if (
    left.id !== right.id ||
    left.kind !== right.kind ||
    left.turnID !== right.turnID ||
    left.firstInTurn !== right.firstInTurn ||
    left.lastInTurn !== right.lastInTurn
  ) {
    return false;
  }
  if (left.kind === "user-message" && right.kind === "user-message") {
    return left.message === right.message;
  }
  if (left.kind === "boundary" && right.kind === "boundary") return left.group === right.group;
  if (left.kind === "shell" && right.kind === "shell") return left.entry === right.entry;
  if (left.kind === "activity" && right.kind === "activity") return left.turn === right.turn;
  if (left.kind === "requests" && right.kind === "requests") {
    return (
      left.requests.length === right.requests.length &&
      left.requests.every((request, index) => request === right.requests[index])
    );
  }
  if (left.kind === "assistant-message" && right.kind === "assistant-message") {
    return (
      left.final === right.final &&
      left.forkBeforeMessageID === right.forkBeforeMessageID &&
      left.turn.user === right.turn.user &&
      left.turn.activity.length === right.turn.activity.length &&
      left.turn.status === right.turn.status &&
      left.turn.tokensPerSecond === right.turn.tokensPerSecond &&
      left.turn.startedAt === right.turn.startedAt &&
      left.turn.workCompletedAt === right.turn.workCompletedAt &&
      left.turn.completedAt === right.turn.completedAt
    );
  }
  if (left.kind === "post-final" && right.kind === "post-final") {
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) => item === right.items[index])
    );
  }
  if (left.kind === "turn-status" && right.kind === "turn-status") return left.turn === right.turn;
  return false;
}

function projectPresentationRows(
  rows: TranscriptProjectionRow[],
  previous: TranscriptPresentationRow[] | undefined,
): TranscriptPresentationRow[] {
  const previousByID = new Map(previous?.map((row) => [row.id, row]) ?? []);
  const next = rows.flatMap((source) => {
    const semanticRows = unpositionedPresentationRows(source);
    return semanticRows.map((row, index) => {
      const nextRow = {
        ...row,
        firstInTurn: index === 0,
        lastInTurn: index === semanticRows.length - 1,
      } as TranscriptPresentationRow;
      const prior = previousByID.get(row.id);
      return prior && samePresentationRow(prior, nextRow) ? prior : nextRow;
    });
  });
  return previous && sameReferences(previous, next) ? previous : next;
}

class CachedSessionTranscriptProjector implements SessionTranscriptProjector {
  private turns = new Map<string, CachedTurnProjection>();
  private previous: SessionTranscriptProjection | null = null;
  private composer: CachedComposerProjection | null = null;

  project({
    messages,
    execution = null,
    requests = [],
    diffs = [],
    runtimeStatus = null,
    initialLocation = null,
    policy = SESSION_PROJECTION_PRESETS.compact,
  }: SessionTranscriptProjectionInput): SessionTranscriptProjection {
    const timeline = groupTimelineMessages(messages, initialLocation);
    const { groups } = timeline;
    const tokensPerSecondByMessageID = assistantTokensPerSecond(timeline.orderedMessages);
    let diffGroupIndex = -1;
    let lastConversationIndex = -1;
    let lastCompletedAssistantIndex = -1;
    let lastPendingAssistantIndex = -1;
    const groupIndexByMessageID = new Map<string, number>();

    for (const [index, group] of groups.entries()) {
      if (group.kind === "conversation") lastConversationIndex = index;
      let hasAssistant = false;
      for (const message of group.messages) {
        groupIndexByMessageID.set(message.id, index);
        if (message.type !== "assistant") continue;
        hasAssistant = true;
        if (message.completedAt === null) lastPendingAssistantIndex = index;
        else lastCompletedAssistantIndex = index;
      }
      if (group.kind === "conversation" && hasAssistant) diffGroupIndex = index;
    }

    const pendingAssistantIndex =
      lastPendingAssistantIndex > lastCompletedAssistantIndex ? lastPendingAssistantIndex : -1;
    const activeConversationIndex =
      pendingAssistantIndex >= 0 ? pendingAssistantIndex : lastConversationIndex;
    const executionGroupIndex =
      execution === null
        ? -1
        : executionTerminal(execution) && diffGroupIndex >= 0
          ? diffGroupIndex
          : activeConversationIndex;
    const runtimeGroupIndex =
      execution?.status === "running" && executionGroupIndex >= 0
        ? executionGroupIndex
        : activeConversationIndex;
    const requestGroupIndex = executionGroupIndex >= 0 ? executionGroupIndex : runtimeGroupIndex;
    const requestsByGroup = groups.map(() => [] as PendingRequestView[]);
    for (const request of requests) {
      if (request.type === "input") continue;
      const target = request.ownerMessageID
        ? groupIndexByMessageID.get(request.ownerMessageID)
        : requestGroupIndex;
      if (target === undefined || target < 0 || groups[target]?.kind !== "conversation") continue;
      requestsByGroup[target]!.push(request);
    }

    const forkBeforeMessageIDs = Array.from<string | undefined>({ length: groups.length });
    let nextUserMessageID: string | undefined;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      forkBeforeMessageIDs[index] = nextUserMessageID;
      const user = groups[index]?.messages.find((message) => message.type === "user");
      if (user) nextUserMessageID = user.id;
    }

    const policyKey = projectionPolicyKey(policy);
    const hasAuthoritativeStatus = execution !== null || runtimeStatus !== null;
    const nextTurnCache = new Map<string, CachedTurnProjection>();
    const turns = groups.map((group, index) => {
      const firstMessage = group.messages[0]!;
      const groupStartedAt = firstMessage.runStartedAt ?? firstMessage.createdAt;
      const appliesToTurn =
        group.kind === "conversation" &&
        index === executionGroupIndex &&
        execution !== null &&
        (execution.status === "running" ||
          execution.status === "inactive" ||
          (execution.completedAt !== null && execution.completedAt >= groupStartedAt));
      const groupExecution = appliesToTurn ? execution : null;
      const groupRequests = requestsByGroup[index]!;
      const groupDiffs = group.kind === "conversation" && index === diffGroupIndex ? diffs : [];
      const groupRuntime =
        group.kind === "conversation" && index === runtimeGroupIndex ? runtimeStatus : null;
      const incomplete = group.messages.some(
        (message) =>
          ["assistant", "compaction", "shell"].includes(message.type) &&
          message.completedAt === null,
      );
      const signature = {
        kind: group.kind,
        messages: group.messages,
        execution: groupExecution,
        hasAuthoritativeStatus: incomplete && hasAuthoritativeStatus,
        requests: groupRequests,
        diffs: groupDiffs,
        runtimeStatus: groupRuntime,
        context: group.context,
        policyKey,
        tokensPerSecond:
          tokensPerSecondByMessageID.get(
            group.messages.findLast((message) => message.type === "assistant")?.id ?? "",
          ) ?? null,
      };
      const cached = this.turns.get(group.id);
      const turn =
        cached && sameCachedTurn(cached, signature)
          ? cached.turn
          : project(
              group.id,
              group.messages,
              groupExecution,
              signature.hasAuthoritativeStatus,
              groupRequests,
              groupDiffs,
              groupRuntime,
              group.context,
              policy,
              signature.tokensPerSecond,
            );
      nextTurnCache.set(group.id, { ...signature, turn });
      return turn;
    });
    this.turns = nextTurnCache;

    const previousRowsByID = new Map(this.previous?.rows.map((row) => [row.id, row]) ?? []);
    const nextPrompts: TranscriptPromptAnchor[] = [];
    let samePrompts = true;
    let rows = turns.map((turn, index) => {
      if (turn.user && !turn.user.optimistic && !(turn.kind === "shell" && turn.shell)) {
        const label = transcriptPromptLabel(turn.user);
        const prior = this.previous?.prompts[nextPrompts.length];
        if (
          prior?.messageID === turn.user.id &&
          prior.turnID === turn.id &&
          prior.rowIndex === index &&
          prior.label === label
        ) {
          nextPrompts.push(prior);
        } else {
          samePrompts = false;
          nextPrompts.push({ messageID: turn.user.id, turnID: turn.id, rowIndex: index, label });
        }
      }
      const forkBeforeMessageID = forkBeforeMessageIDs[index];
      const previous = previousRowsByID.get(turn.id);
      if (previous?.turn === turn && previous.forkBeforeMessageID === forkBeforeMessageID) {
        return previous;
      }
      return {
        id: turn.id,
        turn,
        ...(forkBeforeMessageID ? { forkBeforeMessageID } : {}),
      };
    });
    const prompts =
      samePrompts && this.previous?.prompts.length === nextPrompts.length
        ? this.previous.prompts
        : nextPrompts;
    if (this.previous && sameReferences(this.previous.rows, rows)) rows = this.previous.rows;
    const presentationRows = projectPresentationRows(rows, this.previous?.presentationRows);

    let inlineRequestIDs = new Set(
      requestsByGroup.flatMap((groupRequests) => groupRequests.map((request) => request.id)),
    );
    if (this.previous && sameSet(this.previous.inlineRequestIDs, inlineRequestIDs)) {
      inlineRequestIDs = this.previous.inlineRequestIDs;
    }

    const contextTokens = timeline.contextMessage ? tokenTotal(timeline.contextMessage) : 0;
    const contextModel = timeline.contextMessage?.model ?? null;
    const sameComposer =
      this.composer &&
      sameReferences(this.composer.userMessages, timeline.userMessages) &&
      this.composer.contextTokens === contextTokens &&
      sameModelRef(this.composer.contextModel, contextModel);
    const composerMessages = sameComposer
      ? this.composer!.messages
      : [...timeline.userMessages, ...(timeline.contextMessage ? [timeline.contextMessage] : [])];
    this.composer = {
      userMessages: timeline.userMessages,
      contextTokens,
      contextModel,
      messages: composerMessages,
    };

    const previousBackground = this.previous?.background;
    const subagentTools = reuseArray(
      previousBackground?.subagentTools,
      timeline.background.subagentTools,
      sameBackgroundToolSource,
    );
    const subagentResponses = reuseArray(
      previousBackground?.subagentResponses,
      timeline.background.subagentResponses,
      sameBackgroundResponseSource,
    );
    const shellTools = reuseArray(
      previousBackground?.shellTools,
      timeline.background.shellTools,
      sameBackgroundToolSource,
    );
    const shellMessages = reuseArray(
      previousBackground?.shellMessages,
      timeline.background.shellMessages,
      Object.is,
    );
    const background =
      previousBackground &&
      previousBackground.subagentTools === subagentTools &&
      previousBackground.subagentResponses === subagentResponses &&
      previousBackground.shellTools === shellTools &&
      previousBackground.shellMessages === shellMessages
        ? previousBackground
        : { subagentTools, subagentResponses, shellTools, shellMessages };

    const projection =
      this.previous &&
      this.previous.rows === rows &&
      this.previous.prompts === prompts &&
      this.previous.presentationRows === presentationRows &&
      this.previous.inlineRequestIDs === inlineRequestIDs &&
      this.previous.composerMessages === composerMessages &&
      this.previous.background === background
        ? this.previous
        : { rows, prompts, presentationRows, inlineRequestIDs, composerMessages, background };
    this.previous = projection;
    return projection;
  }
}

export function createSessionTranscriptProjector(): SessionTranscriptProjector {
  return new CachedSessionTranscriptProjector();
}

export function projectTranscriptTurns(
  messages: PalotMessage[],
  execution: SessionExecutionState | null = null,
  requests: PendingRequestView[] = [],
  diffs: FileDiffInfo[] = [],
  runtimeStatus: SessionRuntimeStatus | null = null,
  initialLocation: LocationRef | null = null,
  policy: ResolvedSessionProjectionPolicy = SESSION_PROJECTION_PRESETS.compact,
): TranscriptTurn[] {
  return createSessionTranscriptProjector()
    .project({ messages, execution, requests, diffs, runtimeStatus, initialLocation, policy })
    .rows.map((row) => row.turn);
}

export function sameTurnActivityGroup(left: TurnActivityGroup, right: TurnActivityGroup): boolean {
  if (left === right) return true;
  if (
    left.id !== right.id ||
    left.kind !== right.kind ||
    left.title !== right.title ||
    left.status !== right.status ||
    left.presentation !== right.presentation ||
    left.defaultOpen !== right.defaultOpen ||
    left.forceOpen !== right.forceOpen ||
    left.detailsDefaultOpen !== right.detailsDefaultOpen ||
    left.showReasoningSummaries !== right.showReasoningSummaries ||
    left.currentAction !== right.currentAction ||
    left.pinned !== right.pinned ||
    left.groupSameFileReads !== right.groupSameFileReads ||
    left.categories?.length !== right.categories?.length ||
    left.messages?.length !== right.messages?.length ||
    left.entries.length !== right.entries.length
  ) {
    return false;
  }
  if (left.categories?.some((category, index) => category !== right.categories?.[index])) {
    return false;
  }
  if (left.messages?.some((message, index) => message !== right.messages?.[index])) return false;
  return left.entries.every(
    (entry, index) =>
      entry.message === right.entries[index]?.message &&
      entry.part === right.entries[index]?.part &&
      entry.index === right.entries[index]?.index,
  );
}

export function sameTranscriptTurn(left: TranscriptTurn, right: TranscriptTurn): boolean {
  if (left === right) return true;
  if (
    left.id !== right.id ||
    left.kind !== right.kind ||
    left.user !== right.user ||
    left.users.length !== right.users.length ||
    left.rootBoundary?.id !== right.rootBoundary?.id ||
    left.rootBoundary?.title !== right.rootBoundary?.title ||
    left.rootBoundary?.status !== right.rootBoundary?.status ||
    left.blockingRequests.length !== right.blockingRequests.length ||
    left.final?.message !== right.final?.message ||
    left.final?.part !== right.final?.part ||
    left.postFinal.length !== right.postFinal.length ||
    left.tokensPerSecond !== right.tokensPerSecond ||
    left.status !== right.status ||
    left.startedAt !== right.startedAt ||
    left.finalStartedAt !== right.finalStartedAt ||
    left.workCompletedAt !== right.workCompletedAt ||
    left.completedAt !== right.completedAt ||
    left.canCollapse !== right.canCollapse ||
    left.shouldAutoCollapse !== right.shouldAutoCollapse ||
    left.context?.agent !== right.context?.agent ||
    left.context?.model?.id !== right.context?.model?.id ||
    left.context?.model?.providerID !== right.context?.model?.providerID ||
    left.context?.model?.variant !== right.context?.model?.variant ||
    left.context?.location?.directory !== right.context?.location?.directory ||
    left.context?.location?.workspaceID !== right.context?.location?.workspaceID ||
    left.activity.length !== right.activity.length
  ) {
    return false;
  }
  if (left.users.some((user, index) => user !== right.users[index])) return false;
  if (
    left.rootBoundary?.entries[0]?.message !== right.rootBoundary?.entries[0]?.message ||
    left.rootBoundary?.entries[0]?.part !== right.rootBoundary?.entries[0]?.part
  ) {
    return false;
  }
  if (left.blockingRequests.some((request, index) => request !== right.blockingRequests[index])) {
    return false;
  }
  if (
    left.postFinal.some((item, index) => {
      const other = right.postFinal[index];
      return (
        !other ||
        item.id !== other.id ||
        item.kind !== other.kind ||
        item.name !== other.name ||
        item.mime !== other.mime ||
        item.uri !== other.uri ||
        item.patch !== other.patch ||
        item.additions !== other.additions ||
        item.deletions !== other.deletions
      );
    })
  ) {
    return false;
  }
  return left.activity.every((group, index) => {
    const other = right.activity[index];
    return Boolean(other && sameTurnActivityGroup(group, other));
  });
}
