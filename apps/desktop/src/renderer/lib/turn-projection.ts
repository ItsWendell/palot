/** Pure chronological projection from OpenCode messages into visible timeline rows. */

import type { FileDiffInfo, LocationRef, ModelRef } from "@opencode/client";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../shared";
import type { RetryError, SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import {
  subagentReportHasBackgroundWork,
  subagentReportWaitsOnlyForSubagents,
} from "../../shared/family-completion";
import { compareMessages } from "./message-reconcile";
import {
  executeFailureShownByCalls,
  executeKeepsOwnRow,
  executeNestedParts,
  projectToolExecution,
  scriptCallOrigin,
  shellStopReason,
  toolStateInterrupted,
  toolStoppedBeforeInput,
} from "./tool-executions";
import { projectArtifactCalls } from "./artifact-calls";
import { providerLimit } from "../../shared/provider-limit";
import {
  limitResetText,
  resettingLimit,
  usageLimitResetAt,
  usageLimitResetsText,
  usageLimitResetText,
  usageLimitRetryLabel,
  usageLimitTitle,
} from "./usage-limit-reset";
import { transcriptPromptLabel, type TranscriptPromptAnchor } from "./transcript-outline";
import { turnChangedFiles } from "./turn-changed-files";
import {
  ACTIVITY_CATEGORIES,
  SESSION_PROJECTION_PRESETS,
  activityCategory,
  type ActivityCategory,
  type ResolvedSessionProjectionPolicy,
} from "./session-projection-policy";
import { isTool, messageText, type PendingRequestView } from "./view-models";
import { describeModelSwitch, TRANSCRIPT_MODEL_SWITCH_WORDING } from "./context-usage";
import { sentenceCase } from "./model-picker";
import { truncateEnd } from "../../shared/text-cut";
import { parseBackgroundResult } from "../../shared/background-result";

export interface TurnPart {
  message: PalotMessage;
  part: PalotMessageContent;
  index: number;
}

export interface TurnActivityGroup {
  id: string;
  kind: "content" | "reasoning" | "tools" | "compaction" | "input" | "boundary" | "subagent-tool";
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "interrupted";
  entries: TurnPart[];
  messages?: PalotMessage[];
  categories?: ActivityCategory[];
  presentation?: "grouped" | "individual";
  /** A grouped group in a settled turn that shows its rows without a header of its own. */
  headerless?: boolean;
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
  /** Files the turn's steps changed, from their snapshot data; set by the projection. */
  changedFiles?: readonly string[];
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
  status?: number;
  retryAfterMs?: number;
  body?: string;
} | null {
  const error = recordValue(messageData(message).error);
  const nested = recordValue(error.data);
  const type = stringValue(error.type) ?? stringValue(error.name);
  const detail = stringValue(error.message) ?? stringValue(nested.message);
  const status = typeof error.status === "number" ? error.status : undefined;
  const retryAfterMs = typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined;
  const body = stringValue(recordValue(error.response).body);
  return type || detail
    ? {
        type,
        message: detail,
        ...(status !== undefined ? { status } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        ...(body ? { body } : {}),
      }
    : null;
}

/** A failure's text, with when a usage, budget or rate limit resets when OpenCode said. */
function failureText(
  message: PalotMessage,
  error: {
    type: string | null;
    message: string | null;
    status?: number;
    retryAfterMs?: number;
    body?: string;
  },
): string | undefined {
  const failedAt = message.completedAt ?? message.createdAt;
  const limit = providerLimit(error, failedAt);
  // An empty balance never resets, whatever wait the provider sent.
  const reset = limit
    ? limit.resets
      ? limitResetText(limit.resetsAt)
      : null
    : usageLimitResetText(failedAt, error.retryAfterMs);
  if (!reset) return error.message ?? undefined;
  return error.message ? `${error.message}\n\n${reset}` : reset;
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
    if (!description || !visibleSystemDescription) return null;
    const notice = noticeOf(message, description, metadata);
    return {
      type: "timeline-boundary",
      id: message.id,
      name: notice?.name ?? description,
      ...(notice?.detail ? { text: notice.detail } : {}),
      data: { kind: message.type, tone: "neutral", ...notice?.data },
    };
  }
  if (message.type === "skill") return null;
  return null;
}

/** Notice kinds with their own row, read from the metadata OpenCode writes on the notice. */
export type TranscriptNoticeKind =
  | "goal"
  | "fork"
  | "restart"
  | "instructions"
  | "shell"
  | "image"
  | "video"
  | "console-watch"
  | "codemode";

const VIDEO_EXTENSION = /\.(?:mp4|m4v|mov|webm|mkv|avi)$/i;

function isVideoNotice(source: string, path: string): boolean {
  return /video/i.test(source) || VIDEO_EXTENSION.test(path);
}

const BACKGROUND_SHELL_STATES = ["completed", "failed", "error", "interrupted", "cancelled"];

/** OpenCode (2.3.0+) names the notice it queues for a new fork after the fork's session ID. */
const FORK_NOTICE_PREFIX = "msg_fork_notice_";

function noticeOf(
  message: PalotMessage,
  description: string,
  metadata: Record<string, JsonValue>,
): {
  name?: string;
  detail?: string;
  data: { notice: TranscriptNoticeKind } & Record<string, JsonValue>;
} | null {
  // OpenCode tells the agent its task is a fork in a long notice meant for the model. The user
  // gets one quiet row; the transcript names the source task from `sessionID`. A notice copied
  // in from an earlier fork has a new ID, so only its text marks it.
  if (
    message.type === "synthetic" &&
    (message.id.startsWith(FORK_NOTICE_PREFIX) ||
      (message.text ?? stringValue(messageData(message).text) ?? "")
        .trimStart()
        .startsWith("<fork-notice>"))
  ) {
    return {
      name: "Forked from another task",
      data: {
        notice: "fork",
        ...(message.id.startsWith(FORK_NOTICE_PREFIX)
          ? { sessionID: message.id.slice(FORK_NOTICE_PREFIX.length) }
          : {}),
      },
    };
  }
  const source = stringValue(metadata.source);
  if (source === "goal") {
    return {
      name: /^goal:/i.test(description) ? description : `Goal: ${description}`,
      data: { notice: "goal" },
    };
  }
  if (metadata.notice === "restart") {
    return { name: "OpenCode restarted", detail: description, data: { notice: "restart" } };
  }
  const sources = Array.isArray(metadata.instructionSources)
    ? metadata.instructionSources.flatMap((value) => stringValue(value) ?? [])
    : [];
  if (metadata.notice === "instructions") {
    return {
      name: "Loaded instructions",
      detail: sources.length
        ? sources.join(", ")
        : description.replace(/^instructions updated:\s*/i, ""),
      data: { notice: "instructions" },
    };
  }
  // Instruction files OpenCode reads on its own say "Loaded AGENTS.md, …" and carry their paths.
  if (message.type === "synthetic" && Array.isArray(recordValue(metadata.instruction).paths)) {
    return {
      name: "Loaded instructions",
      detail: description.replace(/^loaded\s+/i, ""),
      data: { notice: "instructions" },
    };
  }
  const state = stringValue(metadata.state);
  if (source === "shell" && state && BACKGROUND_SHELL_STATES.includes(state)) {
    return {
      data: {
        notice: "shell",
        state,
        ...(typeof metadata.exit === "number" ? { exit: metadata.exit } : {}),
        ...(shellStopReason(metadata) ? { stopped: shellStopReason(metadata)! } : {}),
      },
    };
  }
  if (source === "console.watch") return { data: { notice: "console-watch" } };
  // A background Code Mode script whose card is not in this turn: say how it ended and keep
  // its result as the detail. (In the same turn its card takes the result instead.)
  const script = codemodeReturn(message);
  if (script) {
    const name =
      script.state === "completed"
        ? "Background script finished"
        : script.state === "cancelled" || script.state === "interrupted"
          ? "Background script stopped"
          : "Background script failed";
    return {
      name,
      ...(script.body ? { detail: fencedResult(script.body) } : {}),
      data: { notice: "codemode", state: script.state },
    };
  }
  // OpenCode 2.4.0's `generate_video` notice has the image notice's shape.
  const path = stringValue(metadata.path);
  if (source && stringValue(metadata.jobID) && path && isVideoNotice(source, path)) {
    const failed = state === "error" || state === "failed";
    const stopped = state === "cancelled" || state === "interrupted";
    const detail =
      state === "completed"
        ? `![Generated video](<${path}>)`
        : parseBackgroundResult(message.text ?? "", "video")?.body.trim();
    return {
      name: failed
        ? "Video generation failed"
        : stopped
          ? "Video generation stopped"
          : state === "completed"
            ? "Generated video"
            : description,
      // Expanding a finished notice plays the video when the task's workspace can read it.
      ...(detail ? { detail } : {}),
      data: { notice: "video", ...(state ? { state } : {}), path },
    };
  }
  if (source && stringValue(metadata.jobID) && path) {
    return {
      data: {
        notice: "image",
        ...(state ? { state } : {}),
        path: stringValue(metadata.path)!,
      },
    };
  }
  return null;
}

/**
 * Background work that reported back on its own: a subagent or a shell command. A subagent that
 * reported with work of its own still running (OpenCode 2.3.0 lists it) is `waiting`, not
 * finished; `waitingOnSubagents` when that work is only its own subagents.
 */
export interface BackgroundReport {
  kind: "subagent" | "shell";
  outcome: "finished" | "waiting" | "stopped" | "failed";
  waitingOnSubagents?: boolean;
  description: string;
  childID: string | null;
  agent: string | null;
  exit: number | null;
}

export function backgroundReport(part: PalotMessageContent): BackgroundReport | null {
  const data = recordValue(part.data);
  if (part.type === "subagent-response") {
    return {
      kind: "subagent",
      outcome:
        part.status === "failed"
          ? "failed"
          : part.status === "interrupted"
            ? "stopped"
            : data.backgroundWork === true
              ? "waiting"
              : "finished",
      ...(data.waitingOnSubagents === true ? { waitingOnSubagents: true } : {}),
      description: part.name ?? "Subagent",
      childID: stringValue(data.childID),
      agent: stringValue(data.agent),
      exit: null,
    };
  }
  if (part.type !== "timeline-boundary" || data.notice !== "shell") return null;
  const state = stringValue(data.state);
  const exit = typeof data.exit === "number" ? data.exit : null;
  return {
    kind: "shell",
    outcome:
      state === "interrupted" || state === "cancelled" || stringValue(data.stopped)
        ? "stopped"
        : state === "completed" && (exit === null || exit === 0)
          ? "finished"
          : "failed",
    description: part.name ?? "Shell command",
    childID: null,
    agent: null,
    exit,
  };
}

/**
 * One report per child: a subagent that reported several times (OpenCode after 2.2.7 reports
 * each time it goes idle) is one item, its latest report.
 */
export function distinctBackgroundReports(reports: BackgroundReport[]): BackgroundReport[] {
  const byChild = new Map<string, number>();
  const distinct: BackgroundReport[] = [];
  for (const report of reports) {
    const index = report.childID === null ? undefined : byChild.get(report.childID);
    if (index === undefined) {
      if (report.childID !== null) byChild.set(report.childID, distinct.length);
      distinct.push(report);
    } else {
      distinct[index] = report;
    }
  }
  return distinct;
}

/**
 * "Finished 2 subagents", "Stopped 1 command", "1 command failed", and for subagents that
 * reported while their own work still ran, "1 subagent waiting for its subagent".
 */
export function backgroundReportTitle(reports: BackgroundReport[]): string {
  const first = reports[0];
  if (!first) return "Background work";
  const distinct = distinctBackgroundReports(reports);
  const count = distinct.length;
  if (first.outcome === "waiting") {
    const subject = count === 1 ? "1 subagent" : `${count} subagents`;
    if (!distinct.every((report) => report.waitingOnSubagents)) {
      return `${subject} waiting for background work`;
    }
    return `${subject} waiting for ${count === 1 ? "its subagent" : "their subagents"}`;
  }
  const noun =
    first.kind === "subagent"
      ? count === 1
        ? "subagent"
        : "subagents"
      : count === 1
        ? "command"
        : "commands";
  if (first.outcome === "failed") return `${count} ${noun} failed`;
  return `${first.outcome === "stopped" ? "Stopped" : "Finished"} ${count} ${noun}`;
}

/** The reports a group holds, when every entry is one. */
export function groupBackgroundReports(group: TurnActivityGroup): BackgroundReport[] | null {
  return entryBackgroundReports(group.entries);
}

function entryBackgroundReports(entries: TurnPart[]): BackgroundReport[] | null {
  if (entries.length === 0) return null;
  const reports: BackgroundReport[] = [];
  for (const entry of entries) {
    const report = backgroundReport(entry.part);
    if (!report) return null;
    reports.push(report);
  }
  return reports;
}

function sameReportRun(left: BackgroundReport, right: BackgroundReport): boolean {
  return left.kind === right.kind && left.outcome === right.outcome;
}

/** A notice message that reports finished background work. */
function messageReport(message: PalotMessage): BackgroundReport | null {
  if (message.type !== "synthetic") return null;
  const part = messageProjectionFacts(message).latestParts[0];
  return part ? backgroundReport(part) : null;
}

function switchMessage(message: PalotMessage | undefined): boolean {
  return message?.type === "model-switched" || message?.type === "agent-switched";
}

function jsonModel(model: ModelRef): Record<string, JsonValue> {
  return {
    id: model.id,
    providerID: model.providerID,
    ...(model.variant ? { variant: model.variant } : {}),
  };
}

/**
 * A model switch as a neutral boundary. The name uses model IDs; the transcript swaps in catalog
 * names from `data.model` and `data.previous` when it has them.
 */
function modelSwitchPart(
  message: PalotMessage,
  model: ModelRef,
  previous: ModelRef | null,
): PalotMessageContent {
  return {
    type: "timeline-boundary",
    id: message.id,
    name: describeModelSwitch(model, previous, TRANSCRIPT_MODEL_SWITCH_WORDING),
    data: {
      kind: "model-switch",
      tone: "neutral",
      model: jsonModel(model),
      ...(previous ? { previous: jsonModel(previous) } : {}),
    },
  };
}

function agentSwitchPart(message: PalotMessage, agent: string): PalotMessageContent {
  return {
    type: "timeline-boundary",
    id: message.id,
    name: `Switched to ${sentenceCase(agent)} agent`,
    data: { kind: "agent-switch", tone: "neutral", agent },
  };
}

const switchMarkerCache = new WeakMap<PalotMessage, PalotMessage>();

/** The switch record with its marker as content, kept stable while the marker reads the same. */
function switchMarkerMessage(source: PalotMessage, part: PalotMessageContent): PalotMessage {
  const cached = switchMarkerCache.get(source);
  const prior = cached?.content[0];
  if (
    cached &&
    prior &&
    prior.name === part.name &&
    JSON.stringify(prior.data) === JSON.stringify(part.data)
  ) {
    return cached;
  }
  const marker = { ...source, content: [part] };
  switchMarkerCache.set(source, marker);
  return marker;
}

function subagentResponseBody(value: string): string {
  return (parseBackgroundResult(value, "subagent")?.body ?? value).trim();
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
  const raw = message.text ?? stringValue(data.text) ?? "";
  const response = subagentResponseBody(raw);
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
      // The subagent went idle with work of its own still running: not finished yet.
      ...(state === "completed" && subagentReportHasBackgroundWork(raw)
        ? {
            backgroundWork: true,
            ...(subagentReportWaitsOnlyForSubagents(raw) ? { waitingOnSubagents: true } : {}),
          }
        : {}),
    },
  };
}

function backgroundShellReturn(
  message: PalotMessage,
): { shellID: string; state: string; metadata: Record<string, JsonValue> } | null {
  if (message.type !== "synthetic" || !stringValue(messageData(message).description)) return null;
  const metadata = recordValue(messageData(message).metadata);
  const shellID = stringValue(metadata.shellID);
  const state = stringValue(metadata.state);
  if (metadata.source !== "shell" || !shellID) return null;
  if (!state || !["completed", "failed", "error", "interrupted", "cancelled"].includes(state))
    return null;
  return { shellID, state, metadata };
}

/**
 * A shell call whose command went on in the background, so a later notice carries its result:
 * the model asked for the background, or the call returned with the command still running
 * (`metadata.status: "running"`). OpenCode returns that when the user moves a command to the
 * background, and, after 2.2.7, when a foreground command outlives its timeout (behind
 * `shell_timeout_background` at first, then by default). A background command that outlives an
 * explicit timeout is stopped, and its return says so (`timeout: true`).
 */
function backgroundShellTool(part: PalotMessageContent, shellID: string): boolean {
  if (!isTool(part) || (part.name !== "shell" && part.name !== "local_shell")) return false;
  const state = recordValue(part.state);
  const metadata = recordValue(state.metadata);
  if (stringValue(metadata.shellID) !== shellID) return false;
  return (
    recordValue(state.input).background === true ||
    (state.status === "completed" && metadata.status === "running")
  );
}

function shellToolWithReturn(
  part: PalotMessageContent,
  startedAt: number,
  returned: PalotMessage,
): PalotMessageContent {
  const state = recordValue(part.state);
  const result = backgroundShellReturn(returned)!;
  const { metadata } = result;
  const exit = typeof metadata.exit === "number" ? metadata.exit : null;
  const signal = stringValue(metadata.signal);
  // Stopped by its timeout or a kill: the shared stopped rule (`toolStateInterrupted`) reads it
  // from the metadata below, so it is not a failure whatever its exit code.
  const stopped = shellStopReason(metadata);
  const failed = !stopped && (result.state !== "completed" || (exit !== null && exit !== 0));
  const output = unwrapShellTransport(returned.text ?? "");
  return {
    ...part,
    time: {
      created: part.time?.created ?? startedAt,
      ...part.time,
      completed: returned.createdAt,
    },
    state: {
      ...state,
      status: failed ? "error" : "completed",
      content: [{ type: "text", text: output }],
      metadata: {
        ...recordValue(state.metadata),
        status: result.state,
        ...(exit === null ? {} : { exit }),
        ...(signal ? { signal } : {}),
        ...(typeof metadata.truncated === "boolean" ? { truncated: metadata.truncated } : {}),
        ...(stopped === "timeout" ? { timeout: true } : {}),
        ...(stopped === "killed" ? { killed: true } : {}),
      },
      ...(failed
        ? {
            error: {
              type: "ShellReturnError",
              message:
                exit !== null && exit !== 0
                  ? `Shell command exited with code ${exit}`
                  : `Background command ${result.state}`,
            },
          }
        : {}),
    },
  };
}

const CODEMODE_RETURN_STATES = ["completed", "error", "failed", "cancelled", "interrupted"];

/**
 * The notice OpenCode (with `full_codemode`) posts when a Code Mode script that went on in the
 * background ends: `<codemode id state>` (`<background-result kind="codemode" …>` from 2.4.0)
 * around the script's result or error.
 */
function codemodeReturn(
  message: PalotMessage,
): { jobID: string; state: string; body: string } | null {
  if (message.type !== "synthetic") return null;
  const metadata = recordValue(messageData(message).metadata);
  const jobID = stringValue(metadata.jobID);
  const state = stringValue(metadata.state);
  if (metadata.source !== "codemode" || !jobID || !state) return null;
  if (!CODEMODE_RETURN_STATES.includes(state)) return null;
  return {
    jobID,
    state,
    body: codemodeBody(message.text ?? stringValue(messageData(message).text) ?? ""),
  };
}

/** A script result as a Markdown code block, so the notice detail shows it verbatim. */
function fencedResult(body: string): string {
  let fence = "```";
  while (body.includes(fence)) fence += "`";
  let json = false;
  try {
    JSON.parse(body);
    json = true;
  } catch {
    // Not JSON: a thrown error or plain text.
  }
  return `${fence}${json ? "json" : "text"}\n${body}\n${fence}`;
}

function codemodeBody(text: string): string {
  return (parseBackgroundResult(text, "codemode")?.body ?? text).trim();
}

/** A Code Mode script that went on in the background as the job `jobID`. */
function backgroundExecuteTool(part: PalotMessageContent, index: number, jobID: string): boolean {
  if (!isTool(part)) return false;
  const execution = projectToolExecution(part, index);
  return execution.kind === "execute" && execution.background?.jobID === jobID;
}

/** The script's card with its later result, so the notice needs no row of its own. */
function executeToolWithReturn(
  part: PalotMessageContent,
  startedAt: number,
  returned: PalotMessage,
): PalotMessageContent {
  const state = recordValue(part.state);
  const result = codemodeReturn(returned)!;
  const stopped = result.state === "cancelled" || result.state === "interrupted";
  const failed = !stopped && result.state !== "completed";
  return {
    ...part,
    time: {
      created: part.time?.created ?? startedAt,
      ...part.time,
      completed: returned.createdAt,
    },
    state: {
      ...state,
      status: failed || stopped ? "error" : "completed",
      content: [{ type: "text", text: result.body }],
      metadata: { ...recordValue(state.metadata), backgroundState: result.state },
      ...(failed
        ? { error: { type: "CodeModeJobError", message: result.body || "Script failed" } }
        : {}),
      // The stopped rule (`toolStateInterrupted`) reads an aborted error as a stop, not a failure.
      ...(stopped ? { error: { type: "aborted", message: result.body || "Script stopped" } } : {}),
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
        ...(status === "killed" ? { killed: true } : {}),
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
  const result = parseBackgroundResult(value, "shell");
  const { id, state, command } = result?.attributes ?? {};
  return result && id && state && command !== undefined ? result.body.trim() : value;
}

function assistantBoundaryParts(
  message: PalotMessage,
  latestAssistant: boolean,
): PalotMessageContent[] {
  if (message.type !== "assistant") return [];
  const retry = retryData(message);
  if (retry && latestAssistant) {
    const error = recordValue(retry.error);
    const type = stringValue(error.type);
    return [
      retryBoundary({
        id: `${message.id}:retry`,
        attempt: typeof retry.attempt === "number" ? retry.attempt : null,
        at: typeof retry.at === "number" ? retry.at : null,
        message: stringValue(error.message),
        error: type
          ? {
              type,
              ...(typeof error.status === "number" ? { status: error.status } : {}),
              ...(typeof error.retryAfterMs === "number"
                ? { retryAfterMs: error.retryAfterMs }
                : {}),
            }
          : undefined,
        scheduledAt: typeof retry.scheduledAt === "number" ? retry.scheduledAt : undefined,
      }),
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
      name: interrupted
        ? "Response interrupted"
        : (usageLimitTitle(error.type, error.status, error.body) ?? "Response failed"),
      text: interrupted ? interruptionDetail(error.message) : failureText(message, error),
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
  // OpenCode's switch records carry no content; `switchMarkerMessage` adds the marker when one shows.
  if (switchMessage(message)) {
    return message.content.filter((part) => part.type === "timeline-boundary");
  }
  const subagentResponse = subagentResponsePart(message);
  if (subagentResponse) return [subagentResponse];
  const boundary = boundaryPart(message);
  if (boundary) return [boundary];
  if (message.type !== "assistant" && message.type !== "compaction") return [];
  return [
    ...parts(message).filter((part) =>
      part.type === "text"
        ? Boolean(messageText(message, part).trim())
        : !(isTool(part) && toolStoppedBeforeInput(part.state)),
    ),
    ...assistantBoundaryParts(message, latestAssistant),
  ];
}

interface MessageProjectionFacts {
  latestParts: PalotMessageContent[];
  historicalParts: PalotMessageContent[];
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
  return retryBoundary({
    id: "runtime:retry",
    attempt: status.attempt,
    at: status.next,
    message: status.message,
    error: status.error,
    scheduledAt: status.scheduledAt,
  });
}

/**
 * The row while OpenCode waits to retry. A usage or rate limit says so in the warning tone, with
 * when it resets if the provider said; an empty balance (HTTP 402) is "Out of credits".
 */
function retryBoundary(input: {
  id: string;
  attempt: number | null;
  at: number | null;
  message: string | null;
  error: RetryError | undefined;
  scheduledAt: number | undefined;
}): PalotMessageContent {
  const at: Record<string, JsonValue> = input.at === null ? {} : { at: input.at };
  const limit = usageLimitTitle(input.error?.type, input.error?.status);
  if (!limit) {
    return {
      type: "timeline-boundary",
      id: input.id,
      name:
        input.attempt === null
          ? "Retrying response"
          : `Retrying response, attempt ${input.attempt}`,
      text: input.message ?? undefined,
      status: "running",
      data: { kind: "retry", tone: "progress", ...at },
    };
  }
  const resetsAt =
    input.scheduledAt !== undefined && resettingLimit(input.error?.type, input.error?.status)
      ? usageLimitResetAt(input.scheduledAt, input.error?.retryAfterMs)
      : null;
  const text = [input.message, usageLimitResetsText(resetsAt)].filter(Boolean).join("\n\n");
  return {
    type: "timeline-boundary",
    id: input.id,
    name: usageLimitRetryLabel(limit, input.attempt),
    ...(text ? { text } : {}),
    status: "running",
    data: {
      kind: "retry",
      tone: "warning",
      limit,
      attempt: input.attempt,
      ...at,
      ...(resetsAt === null ? {} : { resetsAt }),
    },
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
      // An idle marker records the error but does not show it; only steps do.
      if (message.type === "idle") return false;
      const error = structuredError(message);
      return error !== null && interruptedError(error) === interrupted;
    })
  ) {
    return null;
  }
  return {
    type: "timeline-boundary",
    id: interrupted ? "execution:interrupted" : "execution:error",
    name: interrupted
      ? "Response interrupted"
      : (usageLimitTitle(execution.error?.type, execution.error?.status, execution.error?.body) ??
        "Response failed"),
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

function toolStatus(part: PalotMessageContent): {
  normalized: "pending" | "running" | "complete" | "error" | "interrupted";
  raw: JsonValue | undefined;
} {
  const raw = recordValue(part.state).status;
  return {
    raw,
    normalized: toolStateInterrupted(part.state)
      ? "interrupted"
      : raw === "completed" || raw === "complete"
        ? "complete"
        : raw === "running" || raw === "error"
          ? raw
          : "pending",
  };
}

const failedScriptParts = new WeakMap<object, PalotMessageContent>();

/**
 * A Code Mode script that threw ends `completed` with `metadata.error`; as a failed call, it
 * fails its row, group and turn like any other failed call, with the thrown error as the reason.
 */
function failedScriptPart(part: PalotMessageContent, index: number): PalotMessageContent {
  if (!isTool(part)) return part;
  const execution = projectToolExecution(part, index);
  if (execution.kind !== "execute" || !execution.runtimeError || execution.status !== "complete")
    return part;
  const cached = failedScriptParts.get(part as object);
  if (cached) return cached;
  const state = recordValue(part.state);
  const failed: PalotMessageContent = {
    ...part,
    state: {
      ...state,
      status: "error",
      error: { type: "CodeModeError", message: execution.output?.trim() || "The script threw" },
    },
  };
  failedScriptParts.set(part as object, failed);
  return failed;
}

/**
 * A Code Mode script as the rows of the calls it made, so they render, group and count like the
 * same calls made directly. The script keeps a row after them only to say it failed, stopped or
 * went to the background (or to hold artifact cards); a script with no recognised calls is one
 * row.
 */
function flattenScriptEntry(entry: TurnPart): TurnPart[] {
  if (!isTool(entry.part)) return [entry];
  const part = failedScriptPart(entry.part, entry.index);
  const script = part === entry.part ? entry : { ...entry, part };
  const nested = executeNestedParts(part, entry.index);
  if (nested.length === 0) return [script];
  return [
    ...nested.map((call) => ({ message: entry.message, part: call, index: entry.index })),
    ...(executeKeepsOwnRow(part, entry.index) ? [script] : []),
  ];
}

const scriptCallDiffTargets = new WeakMap<object, ScriptCallDiffTarget>();

/** Where a script's file change finds its diff: the turn's diff, for the files it names. */
export interface ScriptCallDiffTarget {
  /** The user message that opened the turn; OpenCode resolves it to the turn's diff. */
  userMessageID: string;
  files: string[];
}

/**
 * The turn diff a script's file-change row shows, since the call reports none. Only a file's last
 * such row in the turn gets it, so a file edited twice shows its turn change once.
 */
export function scriptCallDiffTarget(part: PalotMessageContent): ScriptCallDiffTarget | null {
  return scriptCallDiffTargets.get(part as object) ?? null;
}

function assignScriptCallDiffTargets(entries: TurnPart[], userMessageID: string | null): void {
  const claimed = new Set<string>();
  for (const entry of entries.toReversed()) {
    if (!isTool(entry.part) || !scriptCallOrigin(entry.part)) continue;
    const execution = projectToolExecution(entry.part, entry.index);
    if (execution.kind !== "file-change" || execution.files.length > 0 || !userMessageID) {
      scriptCallDiffTargets.delete(entry.part as object);
      continue;
    }
    const files = execution.targetFiles.filter((file) => !claimed.has(file));
    files.forEach((file) => claimed.add(file));
    if (files.length > 0) scriptCallDiffTargets.set(entry.part as object, { userMessageID, files });
    else scriptCallDiffTargets.delete(entry.part as object);
  }
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
  return truncateEnd(fallback, 96);
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
  return `'${truncateEnd(compact, limit)}'`;
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
  if (activity === "orchestrate" && entry.part.name?.toLowerCase() === "execute") {
    // A Code Mode script before its first call, or one whose calls have no rows of their own.
    return "Running a script";
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
  if (kind === "boundary") {
    const reports = entryBackgroundReports(entries);
    return reports ? backgroundReportTitle(reports) : (entries[0]?.part.name ?? "Session update");
  }
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
  if (
    entries.some(
      (entry) =>
        entry.part.status === "interrupted" ||
        (isTool(entry.part) && toolStatus(entry.part).normalized === "interrupted"),
    )
  )
    return "interrupted";
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
  let published = 0;
  let updated = 0;
  let backgroundScripts = 0;
  let scripts = 0;
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
      case "other": {
        const artifacts = projectArtifactCalls(entry.part, entry.index);
        // A script whose other calls have rows of their own is counted through them.
        const flattened = executeNestedParts(entry.part, entry.index).length > 0;
        if (artifacts && (artifacts.only || flattened)) {
          for (const call of artifacts.calls) {
            if (call.operation === "create") published += 1;
            else if (call.operation === "update") updated += 1;
            else other += 1;
          }
          break;
        }
        if (execution.kind === "execute" && execution.name.toLowerCase() === "execute") {
          if (execution.background) backgroundScripts += 1;
          else if (!flattened) scripts += 1;
          break;
        }
        other += 1;
        break;
      }
      case "reasoning":
        break;
    }
  }

  const editCount = changedFiles.size + editsWithoutFiles;
  const readCount = readFiles.size + readsWithoutPaths;
  const changed =
    editsWithoutFiles === 0 && changedFiles.size > 0 && changedFiles.size <= 3
      ? `Changed ${changedFileNames([...changedFiles])}`
      : `Changed ${editCount} ${editCount === 1 ? "file" : "files"}`;
  // What the work changed or set off comes first; looking around comes last.
  const clauses: Array<{ label: string; count: number }> = [
    { label: changed, count: editCount },
    { label: `Ran ${commands} ${commands === 1 ? "command" : "commands"}`, count: commands },
    {
      label: `Delegated ${delegation} ${delegation === 1 ? "task" : "tasks"}`,
      count: delegation,
    },
    {
      label: `Started ${backgroundScripts} background ${backgroundScripts === 1 ? "script" : "scripts"}`,
      count: backgroundScripts,
    },
    { label: `Ran ${scripts} ${scripts === 1 ? "script" : "scripts"}`, count: scripts },
    { label: `Used ${other} other ${other === 1 ? "tool" : "tools"}`, count: other },
    { label: `Read ${readCount} ${readCount === 1 ? "file" : "files"}`, count: readCount },
    {
      label: `Listed ${listedDirectories.size} ${listedDirectories.size === 1 ? "directory" : "directories"}`,
      count: listedDirectories.size,
    },
    { label: `Searched code ${searches} ${searches === 1 ? "time" : "times"}`, count: searches },
    { label: `Researched ${web} ${web === 1 ? "source" : "sources"}`, count: web },
    { label: `Loaded ${skills} ${skills === 1 ? "skill" : "skills"}`, count: skills },
    {
      label: `Published ${published} ${published === 1 ? "artifact" : "artifacts"}`,
      count: published,
    },
    { label: `Updated ${updated} ${updated === 1 ? "artifact" : "artifacts"}`, count: updated },
  ].filter((clause) => clause.count > 0);
  if (clauses.length <= 3) return joinedSummary(clauses.map((clause) => clause.label));
  const folded = clauses.slice(2).reduce((sum, clause) => sum + clause.count, 0);
  return joinedSummary([
    ...clauses.slice(0, 2).map((clause) => clause.label),
    `${folded} other ${folded === 1 ? "action" : "actions"}`,
  ]);
}

/** Base names, with the parent folder for names that would otherwise read the same. */
function changedFileNames(files: string[]): string {
  const names = files.map((file) => {
    const base = fileName(file);
    if (!files.some((other) => other !== file && fileName(other) === base)) return base;
    return file.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");
  });
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Tool calls in a group that failed. A call the user or the runtime stopped is not a failure. */
export function activityFailureCount(group: TurnActivityGroup): number {
  return group.entries.filter(
    (entry) =>
      isTool(entry.part) &&
      toolStatus(entry.part).normalized === "error" &&
      // A failed script's row adds no failure to the failed calls that show where it failed.
      !executeFailureShownByCalls(entry.part, entry.index),
  ).length;
}

function groupActivity(
  items: ActivityItem[],
  policy: ResolvedSessionProjectionPolicy,
  safeguards: {
    interrupted: boolean;
    interruptedEntryID: string | null;
    blockingMessageIDs: Set<string>;
    protectAllForBlocking: boolean;
    /** Subagents the turn launched; their reports become the launch row's result instead. */
    launchedSubagents: Set<string>;
  },
): TurnActivityGroup[] {
  const groups: TurnActivityGroup[] = [];
  let current: TurnActivityGroup | null = null;
  let currentFailed = false;

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
    // A group with failed calls keeps its counted title; the header adds how many failed.
    current.title =
      current.presentation === "grouped" &&
      (current.status === "completed" || current.status === "failed")
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
  };

  // Adjacent reports of the same kind and outcome share one row.
  const appendReport = (entry: TurnPart, report: BackgroundReport) => {
    flush();
    const previous = groups.at(-1);
    const previousReports = previous?.kind === "boundary" ? groupBackgroundReports(previous) : null;
    const pinned = report.kind === "subagent" || report.outcome === "failed";
    if (previous && previousReports?.every((other) => sameReportRun(other, report))) {
      previous.entries.push(entry);
      previous.title = backgroundReportTitle([...previousReports, report]);
      previous.status = activityStatus(previous.entries);
      previous.pinned ||= pinned;
      return;
    }
    current = {
      id: entryID(entry),
      kind: "boundary",
      title: backgroundReportTitle([report]),
      status: activityStatus([entry]),
      entries: [entry],
      pinned,
    };
    flush();
  };

  for (const item of items) {
    if (!("part" in item)) {
      if (current?.kind === "input") {
        current.messages?.push(item.message);
      } else {
        flush();
        // A steer is the user's own words: it stays in view when the turn's work folds.
        current = {
          id: item.message.id,
          kind: "input",
          title: "",
          status: "completed",
          entries: [],
          messages: [item.message],
          pinned: true,
        };
      }
      continue;
    }
    const entry = item;
    if (entry.part.type === "compaction") {
      flush();
      // What the agent remembers changes here, so the row stays in view when the turn's work folds.
      current = {
        id: entryID(entry),
        kind: "compaction",
        title: "Compacting context",
        status: activityStatus([entry]),
        entries: [entry],
        pinned: true,
      };
      flush();
      continue;
    }
    const report = backgroundReport(entry.part);
    if (report && !(report.childID !== null && safeguards.launchedSubagents.has(report.childID))) {
      appendReport(entry, report);
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
    // A report from a subagent this turn launched is that launch row's result, however many the
    // child sends (OpenCode after 2.2.7 reports every time the child goes idle).
    if (entry.part.type === "subagent-response") continue;

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
  return combineIndividualReadGroups(groups);
}

/** Only successful plain file reads can share a compact disclosure. */
export function isPlainReadEntry(entry: TurnPart): boolean {
  if (!isTool(entry.part)) return false;
  const execution = projectToolExecution(entry.part, entry.index);
  const metadata = recordValue(recordValue(entry.part.state).metadata);
  return (
    execution.kind === "read" &&
    execution.status === "complete" &&
    execution.path !== "Unknown path" &&
    execution.images.length === 0 &&
    execution.entries.length === 0 &&
    !execution.error &&
    !(Array.isArray(metadata.loaded) && metadata.loaded.length > 0) &&
    !execution.rawOutput?.includes("<system-reminder>") &&
    !execution.rawOutput?.includes("<system-update>")
  );
}

function combineIndividualReadGroups(groups: TurnActivityGroup[]): TurnActivityGroup[] {
  const combined: TurnActivityGroup[] = [];
  for (const group of groups) {
    const eligible = individualPlainReadGroup(group);
    const previous = combined.at(-1);
    if (
      eligible &&
      previous &&
      individualPlainReadGroup(previous) &&
      previous.detailsDefaultOpen === group.detailsDefaultOpen &&
      previous.pinned === group.pinned
    ) {
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

function individualPlainReadGroup(group: TurnActivityGroup): boolean {
  if (
    group.presentation !== "individual" ||
    group.status !== "completed" ||
    group.forceOpen ||
    group.categories?.length !== 1 ||
    group.categories[0] !== "read"
  ) {
    return false;
  }
  return group.entries.length > 0 && group.entries.every(isPlainReadEntry);
}

export type ActivityDetailRow =
  | { id: string; kind: "reasoning"; entries: TurnPart[] }
  | { id: string; kind: "reads"; entries: TurnPart[] }
  | { id: string; kind: "read"; path: string; entries: TurnPart[] }
  | { id: string; kind: "compaction"; entry: TurnPart }
  | { id: string; kind: "part"; entry: TurnPart };

/** The rows an open activity group shows: adjacent reads and adjacent thoughts merge. */
export function activityDetailRows(
  entries: TurnPart[],
  groupSameFileReads = false,
  showReasoningSummaries = true,
  groupAdjacentReads = true,
): ActivityDetailRow[] {
  const rows: ActivityDetailRow[] = [];
  for (const [entryIndex, entry] of entries.entries()) {
    if (groupAdjacentReads && isPlainReadEntry(entry)) {
      const previous = rows.at(-1);
      if (previous?.kind === "reads" && previous.entries.at(-1) === entries[entryIndex - 1])
        previous.entries.push(entry);
      else rows.push({ id: entryID(entry), kind: "reads", entries: [entry] });
      continue;
    }
    if (entry.part.type === "compaction") {
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:compaction:${entry.index}`,
        kind: "compaction",
        entry,
      });
      continue;
    }
    if (entry.part.type !== "reasoning") {
      const execution =
        groupSameFileReads && isPlainReadEntry(entry)
          ? projectToolExecution(entry.part, entry.index)
          : null;
      if (execution?.kind === "read" && execution.path !== "Unknown path") {
        const previous = rows.at(-1);
        const existing =
          previous?.kind === "read" && previous.path === execution.path ? previous : null;
        if (existing) existing.entries.push(entry);
        else {
          rows.push({
            id: entry.part.id ?? `${entry.message.id}:read:${entry.index}`,
            kind: "read",
            path: execution.path,
            entries: [entry],
          });
        }
        continue;
      }
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:${entry.part.type}:${entry.index}`,
        kind: "part",
        entry,
      });
      continue;
    }
    if (!showReasoningSummaries) continue;
    if (!messageText(entry.message, entry.part).trim()) continue;
    const previous = rows.at(-1);
    if (previous?.kind === "reasoning") {
      previous.entries.push(entry);
    } else {
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:reasoning:${entry.index}`,
        kind: "reasoning",
        entries: [entry],
      });
    }
  }
  return rows;
}

/** Adjacent thoughts fold into one disclosure unless one of them opens or closes a step. */
export function reasoningRowMerges(entries: TurnPart[]): boolean {
  return (
    entries.length > 1 &&
    entries.every(
      (entry) => entry.part.presentation !== "preamble" && entry.part.presentation !== "recap",
    )
  );
}

/**
 * Most rows a group in a settled turn with several groups may show without its own header. A
 * header that folds this few rows costs a click without saving space.
 */
export const HEADERLESS_ACTIVITY_GROUP_MAX_ROWS = 3;

/** Whether the group renders as a collapsible header over its rows. */
function rendersActivityHeader(group: TurnActivityGroup): boolean {
  return (
    (group.kind === "reasoning" || group.kind === "tools") &&
    group.presentation === "grouped" &&
    // Hidden reasoning summaries leave a one-line title with nothing to open.
    !(
      group.showReasoningSummaries === false &&
      group.entries.every((entry) => entry.part.type === "reasoning")
    )
  );
}

function visibleActivityRowCount(group: TurnActivityGroup): number {
  let count = 0;
  for (const row of activityDetailRows(
    group.entries,
    group.groupSameFileReads,
    group.showReasoningSummaries,
  )) {
    count += row.kind === "reasoning" && !reasoningRowMerges(row.entries) ? row.entries.length : 1;
  }
  return count;
}

/**
 * Drops group headers that repeat the turn bar or fold only a few rows once the turn settles.
 * A running turn keeps every header, since the current one carries the live title.
 */
function flattenActivityHeaders(
  activity: TurnActivityGroup[],
  status: TranscriptTurn["status"],
): TurnActivityGroup[] {
  if (status === "working") return activity;
  const headed = activity.filter(rendersActivityHeader).length;
  if (headed === 0) return activity;
  const only = headed === 1;
  return activity.map((group) => {
    if (!rendersActivityHeader(group)) return group;
    const rows = visibleActivityRowCount(group);
    if (rows === 0 || (!only && rows > HEADERLESS_ACTIVITY_GROUP_MAX_ROWS)) return group;
    return { ...group, headerless: true };
  });
}

/**
 * Whether a turn without an idle marker failed. A failed command or subagent the agent answered
 * after is part of the work, not the turn's outcome.
 */
function failed(entries: TurnPart[], assistants: PalotMessage[], answered: boolean): boolean {
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
      (entry.part.type === "timeline-boundary" && entry.part.status === "failed") ||
      (entry.part.type === "compaction" && entry.part.status === "failed") ||
      (!answered &&
        ((isTool(entry.part) && toolStatus(entry.part).normalized === "error") ||
          (entry.part.type === "subagent-response" && entry.part.status === "failed"))),
  );
}

type IdleOutcome = "succeeded" | "failed" | "interrupted";

function idleOutcome(message: PalotMessage | null): IdleOutcome | null {
  if (message?.type !== "idle") return null;
  const outcome = messageData(message).outcome;
  return outcome === "succeeded" || outcome === "failed" || outcome === "interrupted"
    ? outcome
    : null;
}

function textPhase(part: PalotMessageContent): string | null {
  return stringValue(recordValue(part.native).phase);
}

/**
 * The turn's answer: the last assistant text after the turn's last tool call and last steer that
 * the provider did not mark as commentary. Text that a tool call or steer follows is commentary,
 * whatever its phase. A turn that ends on its work has no answer.
 */
function answerEntry(entries: TurnPart[], steerCut: number): TurnPart | null {
  const start = Math.max(steerCut, entries.findLastIndex((entry) => isTool(entry.part)) + 1);
  for (let index = entries.length - 1; index >= start; index -= 1) {
    const entry = entries[index]!;
    if (entry.message.type !== "assistant" || !visibleText(entry)) continue;
    if (textPhase(entry.part) === "commentary") continue;
    return entry;
  }
  return null;
}

/**
 * A step shorter than MIN_RATE_STEP_MS whose tokens over that time exceed MAX_STEP_RATE arrived
 * as a burst (a provider that buffers and sends everything at once) and doesn't count toward
 * tok/s. Short steps at a believable rate, such as a quick one-line answer, still count.
 */
const MIN_RATE_STEP_MS = 250;
const MAX_STEP_RATE = 1_000;

function assistantTokensPerSecond(
  messages: PalotMessage[],
  linkedShellReturnIDs: Set<string>,
): Map<string, number | null> {
  const rates = new Map<string, number | null>();
  let outputTokens = 0;
  let durationMs = 0;
  let allStreamed = true;

  for (const message of messages) {
    if (linkedShellReturnIDs.has(message.id)) continue;
    if (message.type === "user" || message.type === "synthetic") {
      outputTokens = 0;
      durationMs = 0;
      allStreamed = true;
      continue;
    }
    if (message.type !== "assistant") continue;

    // OpenCode's own figure: output and reasoning tokens over the time each step streamed, from
    // its first token (after 2.2.7) or, for steps recorded without one, from the request. A step
    // that streamed in under MIN_RATE_STEP_MS faster than MAX_STEP_RATE arrived as one burst, so
    // its tokens over that time are not a rate; it is left out.
    const stepTokens = (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0);
    if (message.streamedAt === undefined) {
      allStreamed = false;
      outputTokens += stepTokens;
    } else {
      const from = message.firstTokenRecordedAt ?? message.createdAt;
      const stepMs = message.streamedAt - from;
      const burst =
        stepMs < MIN_RATE_STEP_MS && stepTokens * 1_000 > MAX_STEP_RATE * Math.max(stepMs, 1);
      if (stepMs > 0 && !burst) {
        outputTokens += stepTokens;
        durationMs += stepMs;
      }
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
  completed: boolean;
  cancelled: boolean;
  failed: boolean;
  hasActivity: boolean;
  hasBlockingRequest: boolean;
}) {
  // A completed turn folds even when it ended on its work instead of an answer.
  const canCollapse =
    (input.finalStarted || input.completed) &&
    !input.cancelled &&
    !input.failed &&
    input.hasActivity &&
    !input.hasBlockingRequest;
  return { canCollapse, shouldAutoCollapse: canCollapse };
}

function project(
  id: string,
  kind: NonNullable<TranscriptTurn["kind"]>,
  messages: PalotMessage[],
  execution: SessionExecutionState | null,
  hasAuthoritativeStatus: boolean,
  blockingRequests: PendingRequestView[],
  diffs: FileDiffInfo[],
  runtimeStatus: SessionRuntimeStatus | null,
  context: TranscriptTurn["context"],
  policy: ResolvedSessionProjectionPolicy,
  tokensPerSecond: number | null,
  /** Notices from later turns for scripts this turn moved to the background. */
  laterScriptReturns: PalotMessage[] = [],
): TranscriptTurn {
  const users: PalotMessage[] = [];
  const assistants: PalotMessage[] = [];
  let shell: PalotMessage | undefined;
  let latestAssistant: PalotMessage | undefined;
  let idle: PalotMessage | null = null;
  for (const message of messages) {
    if (message.type === "user") users.push(message);
    if (message.type === "shell" && !shell) shell = message;
    if (["assistant", "compaction", "shell"].includes(message.type)) assistants.push(message);
    if (message.type === "assistant") latestAssistant = message;
    if (message.type === "idle") idle = message;
  }
  const firstMessage = messages[0];
  // The prompt that opened the turn. Later user messages are steers inside its work.
  const user = firstMessage?.type === "user" ? firstMessage : null;
  const entries: TurnPart[] = [];
  const entriesByMessage = new Map<PalotMessage, TurnPart[]>();
  const shellReturns = new Map<string, PalotMessage>();
  const codemodeReturns = new Map<string, PalotMessage>();
  for (const message of [...laterScriptReturns, ...messages]) {
    const returned = backgroundShellReturn(message);
    if (returned) shellReturns.set(returned.shellID, message);
    const script = codemodeReturn(message);
    if (script) codemodeReturns.set(script.jobID, message);
  }
  const linkedReturnIDs = new Set<string>();
  // Entries from here on came after the latest steer; earlier text cannot answer it.
  let steerCut = 0;
  for (const message of messages) {
    if (message.type === "user") {
      if (message !== user) steerCut = entries.length;
      continue;
    }
    if (linkedReturnIDs.has(message.id)) continue;
    const messageEntries = projectedParts(
      message,
      message.type !== "assistant" || message === latestAssistant,
    )
      .map((part, index) => {
        const metadata = recordValue(recordValue(part.state).metadata);
        const shellID = stringValue(metadata.shellID);
        const returned =
          shellID && backgroundShellTool(part, shellID) ? shellReturns.get(shellID) : undefined;
        if (returned) linkedReturnIDs.add(returned.id);
        const jobID = stringValue(metadata.jobID);
        const scriptReturn =
          !returned && jobID && backgroundExecuteTool(part, index, jobID)
            ? codemodeReturns.get(jobID)
            : undefined;
        if (scriptReturn) linkedReturnIDs.add(scriptReturn.id);
        return {
          message,
          part: returned
            ? shellToolWithReturn(part, message.createdAt, returned)
            : scriptReturn
              ? executeToolWithReturn(part, message.createdAt, scriptReturn)
              : part,
          index,
        };
      })
      .flatMap(flattenScriptEntry);
    if (messageEntries.length === 0) continue;
    entriesByMessage.set(message, messageEntries);
    entries.push(...messageEntries);
  }
  assignScriptCallDiffTargets(entries, user?.id ?? null);
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
  const outcome = idleOutcome(idle);
  const working =
    execution?.status === "running" ||
    runtimeStatus?.type === "busy" ||
    runtimeStatus?.type === "retry" ||
    (idle === null &&
      !hasAuthoritativeStatus &&
      assistants.some((message) => message.completedAt === null));
  const final = answerEntry(entries, steerCut);
  const hasFailed = failed(entries, assistants, final !== null);
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
    !working && (idle !== null || executionTerminal(execution) || historicalCompletion)
      ? finalArtifacts(final, entries, diffs, false)
      : [];
  const activityItems: ActivityItem[] = [];
  for (const message of messages) {
    if (message.type === "user") {
      if (message !== user) activityItems.push({ message });
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
  const interrupted =
    outcome === "interrupted" ||
    (outcome === null && (executionInterrupted || assistantInterrupted));
  const blockingMessageIDs = new Set(
    blockingRequests.flatMap((request) => (request.ownerMessageID ? [request.ownerMessageID] : [])),
  );
  const interruptedEntry = interrupted
    ? activityItems.findLast(
        (item): item is TurnPart =>
          "part" in item && (item.part.type === "reasoning" || isTool(item.part)),
      )
    : undefined;
  const launchedSubagents = new Set<string>();
  for (const entry of entries) {
    if (!isTool(entry.part)) continue;
    const execution = projectToolExecution(entry.part, entry.index);
    if (execution.kind === "subagent" && execution.sessionID) {
      launchedSubagents.add(execution.sessionID);
    }
  }
  let activity = groupActivity(activityItems, policy, {
    interrupted,
    interruptedEntryID: interruptedEntry ? entryID(interruptedEntry) : null,
    blockingMessageIDs,
    protectAllForBlocking: blockingRequests.length > 0 && blockingMessageIDs.size === 0,
    launchedSubagents,
  });
  const rootBoundary =
    (firstMessage?.type === "synthetic" || switchMessage(firstMessage)) &&
    activity[0]?.kind === "boundary"
      ? activity[0]
      : null;
  if (rootBoundary) activity = activity.slice(1);
  const lastAssistant = assistants.at(-1);
  const startedAt =
    execution?.startedAt ?? firstMessage?.runStartedAt ?? firstMessage?.createdAt ?? 0;
  // The idle marker records when the run ended; live execution state wins while it runs.
  const completedAt = working
    ? null
    : (idle?.createdAt ??
      runCompletedAt ??
      execution?.completedAt ??
      lastAssistant?.completedAt ??
      lastAssistant?.createdAt ??
      null);
  const status = working
    ? "working"
    : outcome === "succeeded"
      ? "completed"
      : outcome === "failed"
        ? "failed"
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
  activity = flattenActivityHeaders(activity, status);
  const finalStartedAt = finalStart(final);
  const workCompletedAt = finalStartedAt;
  const collapse = collapseState({
    finalStarted: hasFinal(final),
    completed: status === "completed",
    cancelled: status === "interrupted",
    failed: status === "failed",
    hasActivity: activity.length > 0,
    hasBlockingRequest: blockingRequests.length > 0,
  });
  collapse.shouldAutoCollapse &&=
    policy.foldCompletedTurns && (status !== "working" || !policy.keepCurrentActivityExpanded);
  return {
    id,
    kind,
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
    changedFiles: turnChangedFiles(messages),
    ...(shellEntry ? { shell: shellEntry } : {}),
    ...(context ? { context } : {}),
  };
}

/** Whether the turn's own activity includes tool calls or subagent launches. */
export function turnHasToolActivity(turn: TranscriptTurn): boolean {
  return turn.activity.some((group) => group.kind === "tools" || group.kind === "subagent-tool");
}

interface TimelineGroup {
  id: string;
  kind: NonNullable<TranscriptTurn["kind"]>;
  messages: PalotMessage[];
  context: NonNullable<TranscriptTurn["context"]>;
}

interface TimelineGrouping {
  groups: TimelineGroup[];
  /** The turn that live execution state, runtime status, requests and diffs belong to. */
  activeIndex: number;
  orderedMessages: PalotMessage[];
  userMessages: PalotMessage[];
  contextMessage: PalotMessage | null;
  background: TranscriptBackgroundFacts;
  linkedShellReturnIDs: Set<string>;
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
  laterScriptReturns: PalotMessage[];
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

/**
 * A prompt OpenCode has not delivered yet. It shows as its own turn after the running one until
 * it starts.
 */
function heldPrompt(message: PalotMessage): boolean {
  return (
    message.type === "user" &&
    message.optimistic === true &&
    message.promotedAt === undefined &&
    message.runStartedAt === undefined
  );
}

const placedMessages = new WeakMap<PalotMessage, PalotMessage>();

/**
 * Where a prompt sits in the run. Live, a sent prompt sorts at the time it was sent, which can be
 * inside a step that ran before OpenCode delivered it; once it started, it sits at its start time,
 * which is where its server copy sorts after a reload.
 */
function placed(message: PalotMessage): PalotMessage {
  if (message.type !== "user") return message;
  const started = message.promotedAt ?? message.runStartedAt;
  const sentAt =
    (message.optimistic === true ? message.timelineAt : undefined) ?? message.createdAt;
  if (started === undefined || started <= sentAt) return message;
  const cached = placedMessages.get(message);
  if (cached?.createdAt === started) return cached;
  const proxy = { ...message, optimistic: undefined, timelineAt: undefined, createdAt: started };
  placedMessages.set(message, proxy);
  return proxy;
}

function comparePlaced(left: PalotMessage, right: PalotMessage): number {
  return compareMessages(placed(left), placed(right));
}

function placedTime(message: PalotMessage): number {
  const proxy = placed(message);
  return (proxy.optimistic === true ? proxy.timelineAt : undefined) ?? proxy.createdAt;
}

/** A turn that holds only notices, switches or compaction, with no prompt or assistant step. */
function workless(group: TimelineGroup): boolean {
  return !group.messages.some((message) => message.type === "user" || message.type === "assistant");
}

/**
 * The agent had finished answering: the turn's latest step completed without asking for tools.
 * OpenCode delivers a queued prompt or a report at that point inside the same run, so a prompt or
 * notice arriving now starts a new turn. A turn with no step yet is still waiting for its answer.
 */
function answered(group: TimelineGroup): boolean {
  const latest = group.messages.findLast((message) => message.type === "assistant");
  return (
    latest !== undefined &&
    latest.completedAt !== null &&
    latest.finish !== null &&
    latest.finish !== "tool-calls"
  );
}

/**
 * Groups messages into turns. A turn runs from a prompt until the agent has answered and something
 * new arrives, or until OpenCode's idle marker. It takes in everything in between: steps, steers,
 * compaction, switches and notices. One idle marker ends a whole busy period, so it belongs to the
 * last turn of the run. Work with no prompt opens a turn at the notice or step that started it.
 * A user shell command is a turn of its own and ends the open one, as in OpenCode's timeline.
 */
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
  const linkedShellReturnIDs = new Set<string>();
  const activeBackgroundShellIDs = new Set<string>();
  const trackBackgroundShells = (facts: MessageProjectionFacts) => {
    for (const { part } of facts.shellTools) {
      const shellID = stringValue(recordValue(recordValue(part.state).metadata).shellID);
      if (shellID && backgroundShellTool(part, shellID)) activeBackgroundShellIDs.add(shellID);
    }
  };
  // Both change inside the helpers below, so they are typed to keep TypeScript from narrowing them.
  let open = null as TimelineGroup | null;
  // The latest turn that ran, which an idle marker after a user shell command still ends.
  let latestConversation = null as TimelineGroup | null;
  // Prompts waiting for delivery; each shows as its own turn until it starts.
  const held = new Set<TimelineGroup>();
  let contextMessage: PalotMessage | null = null;
  let previousMessage: PalotMessage | null = null;
  let activeAgent: string | null = null;
  let activeModel: ModelRef | null = null;
  let activeLocation = initialLocation;
  // Switches since the last visible message, compared with what was in effect before the first.
  // Switches before the first prompt only set up the task, so they never show.
  let seenUser = false;
  let pendingModel: {
    message: PalotMessage;
    model: ModelRef;
    previous: ModelRef | null;
    position: number;
  } | null = null;
  let pendingAgent: {
    message: PalotMessage;
    agent: string;
    previous: string | null;
    position: number;
  } | null = null;
  const currentContext = () => ({
    agent: activeAgent,
    model: activeModel,
    location: activeLocation,
  });
  const close = () => {
    open = null;
    activeBackgroundShellIDs.clear();
  };
  const openGroup = (group: TimelineGroup) => {
    open = group;
    if (group.kind === "conversation") latestConversation = group;
  };
  const startGroup = (message: PalotMessage, kind: TimelineGroup["kind"]) => {
    const group: TimelineGroup = {
      id: message.id,
      kind,
      messages: [message],
      context: currentContext(),
    };
    groups.push(group);
    return group;
  };
  const join = (group: TimelineGroup, message: PalotMessage) => {
    group.messages.push(message);
    group.context = currentContext();
    if (message.type !== "assistant" && message.type !== "user") return;
    group.kind = "conversation";
    if (group === open) latestConversation = group;
  };
  const flushSwitches = (target: TimelineGroup | null) => {
    const markers: Array<{ position: number; message: PalotMessage }> = [];
    if (pendingModel && !sameModelRef(pendingModel.model, pendingModel.previous)) {
      const { message, model, previous, position } = pendingModel;
      markers.push({
        position,
        message: switchMarkerMessage(message, modelSwitchPart(message, model, previous)),
      });
    }
    if (pendingAgent && pendingAgent.agent !== pendingAgent.previous) {
      const { message, agent, position } = pendingAgent;
      markers.push({
        position,
        message: switchMarkerMessage(message, agentSwitchPart(message, agent)),
      });
    }
    pendingModel = null;
    pendingAgent = null;
    if (markers.length === 0) return;
    for (const marker of markers.toSorted((left, right) => left.position - right.position)) {
      if (target) join(target, marker.message);
      else startGroup(marker.message, "boundary");
    }
  };
  // Switches join a turn that is doing work; otherwise they stand above what comes next.
  const switchTarget = () => (open && !workless(open) && !answered(open) ? open : null);

  for (const [position, message] of messages.entries()) {
    if (!assumeOrdered && previousMessage && comparePlaced(previousMessage, message) > 0) {
      return groupTimelineMessages(messages.toSorted(comparePlaced), initialLocation, true);
    }
    previousMessage = message;
    const data = messageData(message);
    if (message.type === "agent-switched") {
      const agent = stringValue(data.agent);
      if (agent && seenUser) {
        pendingAgent = {
          message,
          agent,
          // OpenCode records what the task used before the switch; replies are the fallback.
          previous: pendingAgent
            ? pendingAgent.previous
            : (stringValue(data.previous) ?? activeAgent),
          position,
        };
      }
      activeAgent = agent ?? activeAgent;
    }
    if (message.type === "model-switched") {
      const model = modelRef(data.model);
      if (model && seenUser) {
        pendingModel = {
          message,
          model,
          previous: pendingModel ? pendingModel.previous : (modelRef(data.previous) ?? activeModel),
          position,
        };
      }
      activeModel = model ?? activeModel;
    }
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
    if (message.type === "user") {
      userMessages.push(message);
      seenUser = true;
    }
    if (message.type === "assistant" && tokenTotal(message) > 0) contextMessage = message;
    if (message.type === "shell") shellMessages.push(message);

    const facts = messageProjectionFacts(message);
    subagentTools.push(...facts.subagentTools);
    subagentResponses.push(...facts.subagentResponses);
    shellTools.push(...facts.shellTools);

    if (message.type === "idle") {
      // A prompt sent in the same millisecond the previous run ended sorts ahead of that run's
      // marker; the marker still ends the earlier turn, and the prompt's turn stays open.
      const opener = open?.messages[0];
      if (
        open &&
        opener?.type === "user" &&
        placedTime(opener) === message.createdAt &&
        !open.messages.some((candidate) => candidate.type === "assistant")
      ) {
        const index = groups.indexOf(open);
        const earlier = groups.findLast(
          (group, position) =>
            position < index && group.kind === "conversation" && !held.has(group),
        );
        if (earlier && !earlier.messages.some((candidate) => candidate.type === "idle")) {
          earlier.messages.push(message);
          continue;
        }
      }
      // The marker ends the open turn. After a user shell command it ends the turn the command
      // interrupted, if that one has no marker yet.
      const target =
        open ?? (latestConversation?.messages.at(-1)?.type === "idle" ? null : latestConversation);
      if (target) target.messages.push(message);
      close();
      continue;
    }

    const visible =
      message.type === "user" || message.type === "assistant" || facts.latestParts.length > 0;
    if (!visible) continue;

    const returned = backgroundShellReturn(message);
    if (returned && open && activeBackgroundShellIDs.has(returned.shellID)) {
      open.messages.push(message);
      linkedShellReturnIDs.add(message.id);
      activeBackgroundShellIDs.delete(returned.shellID);
      continue;
    }

    if (message.type === "shell") {
      close();
      flushSwitches(null);
      startGroup(message, "shell");
      continue;
    }

    if (message.type === "user") {
      if (open && (workless(open) || answered(open))) close();
      if (heldPrompt(message) && (open || held.size > 0)) {
        flushSwitches(null);
        held.add(startGroup(message, "conversation"));
        continue;
      }
      flushSwitches(open);
      if (open) {
        join(open, message);
        continue;
      }
      openGroup(startGroup(message, "conversation"));
      continue;
    }

    const notice = message.type !== "assistant" && message.type !== "compaction";
    // Background work that finishes together reads as one row: a report joins a turn that holds
    // only reports of the same kind and outcome.
    const report = notice ? messageReport(message) : null;
    if (
      open &&
      report &&
      !pendingModel &&
      !pendingAgent &&
      open.messages.every((candidate) => {
        const other = messageReport(candidate);
        return other !== null && sameReportRun(other, report);
      })
    ) {
      join(open, message);
      continue;
    }
    // A notice with no work after it stands alone; consecutive notices do not share a turn.
    if (open && notice && (workless(open) || answered(open))) close();
    flushSwitches(switchTarget());
    if (open) {
      join(open, message);
      if (message.type === "assistant") trackBackgroundShells(facts);
      continue;
    }
    openGroup(startGroup(message, timelineKind(message, facts)));
    if (message.type === "assistant") trackBackgroundShells(facts);
  }
  flushSwitches(switchTarget());

  const activeGroup = open ?? latestConversation;
  return {
    groups,
    activeIndex: activeGroup ? groups.indexOf(activeGroup) : -1,
    orderedMessages: messages,
    userMessages,
    contextMessage,
    background: { subagentTools, subagentResponses, shellTools, shellMessages },
    linkedShellReturnIDs,
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
    left.attempt === right.attempt &&
    left.message === right.message &&
    left.next === right.next &&
    left.scheduledAt === right.scheduledAt &&
    left.error?.type === right.error?.type &&
    left.error?.status === right.error?.status &&
    left.error?.retryAfterMs === right.error?.retryAfterMs
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
    cached.tokensPerSecond === input.tokensPerSecond &&
    sameReferences(cached.laterScriptReturns, input.laterScriptReturns)
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
  if (turn.status === "working" && turn.kind !== "shell" && turn.kind !== "compaction") {
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

const NO_MESSAGES: PalotMessage[] = [];

/** The notices outside `messages` for the background scripts its tool parts started. */
function laterScriptReturnsFor(
  messages: PalotMessage[],
  returns: Map<string, PalotMessage>,
): PalotMessage[] {
  const found: PalotMessage[] = [];
  for (const message of messages) {
    for (const part of message.content) {
      if (!isTool(part)) continue;
      const jobID = stringValue(recordValue(recordValue(part.state).metadata).jobID);
      const notice = jobID ? returns.get(jobID) : undefined;
      if (notice && !messages.includes(notice)) found.push(notice);
    }
  }
  return found.length > 0 ? found : NO_MESSAGES;
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
    const tokensPerSecondByMessageID = assistantTokensPerSecond(
      timeline.orderedMessages,
      timeline.linkedShellReturnIDs,
    );
    const activeIndex = timeline.activeIndex;
    const groupIndexByMessageID = new Map<string, number>();
    for (const [index, group] of groups.entries()) {
      for (const message of group.messages) groupIndexByMessageID.set(message.id, index);
    }
    const requestsByGroup = groups.map(() => [] as PendingRequestView[]);
    for (const request of requests) {
      if (request.type === "input") continue;
      const target = request.ownerMessageID
        ? groupIndexByMessageID.get(request.ownerMessageID)
        : activeIndex;
      if (target === undefined || target < 0 || groups[target]?.kind !== "conversation") continue;
      requestsByGroup[target]!.push(request);
    }

    const forkBeforeMessageIDs = Array.from<string | undefined>({ length: groups.length });
    let nextUserMessageID: string | undefined;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      forkBeforeMessageIDs[index] = nextUserMessageID;
      // Fork before the prompt that opened the next turn; its steers belong to that turn.
      const opener = groups[index]?.messages[0];
      if (opener?.type === "user") nextUserMessageID = opener.id;
    }

    const policyKey = projectionPolicyKey(policy);
    const hasAuthoritativeStatus = execution !== null || runtimeStatus !== null;
    // A background script's notice usually opens a turn of its own; its script's turn still
    // learns how the job ended, so the calls it was running settle.
    const scriptReturnsByJob = new Map<string, PalotMessage>();
    for (const message of messages) {
      const script = codemodeReturn(message);
      if (script) scriptReturnsByJob.set(script.jobID, message);
    }
    const nextTurnCache = new Map<string, CachedTurnProjection>();
    const turns = groups.map((group, index) => {
      // A run started by a notice is live before its first step arrives.
      const active = index === activeIndex;
      const firstMessage = group.messages[0]!;
      const groupStartedAt = firstMessage.runStartedAt ?? firstMessage.createdAt;
      const appliesToTurn =
        active &&
        execution !== null &&
        (execution.status === "running" ||
          execution.status === "inactive" ||
          (execution.completedAt !== null && execution.completedAt >= groupStartedAt));
      const groupExecution = appliesToTurn ? execution : null;
      const groupRequests = requestsByGroup[index]!;
      const groupDiffs = active ? diffs : [];
      const groupRuntime = active ? runtimeStatus : null;
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
        laterScriptReturns:
          scriptReturnsByJob.size > 0
            ? laterScriptReturnsFor(group.messages, scriptReturnsByJob)
            : NO_MESSAGES,
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
              group.kind,
              group.messages,
              groupExecution,
              signature.hasAuthoritativeStatus,
              groupRequests,
              groupDiffs,
              groupRuntime,
              group.context,
              policy,
              signature.tokensPerSecond,
              signature.laterScriptReturns,
            );
      nextTurnCache.set(group.id, { ...signature, turn });
      return turn;
    });
    this.turns = nextTurnCache;

    const previousRowsByID = new Map(this.previous?.rows.map((row) => [row.id, row]) ?? []);
    const nextPrompts: TranscriptPromptAnchor[] = [];
    let samePrompts = true;
    let rows = turns.map((turn, index) => {
      // Every delivered prompt, steers included, so the rail matches the older-history index.
      for (const user of turn.kind === "shell" ? [] : turn.users) {
        if (user.optimistic) continue;
        const label = transcriptPromptLabel(user);
        const prior = this.previous?.prompts[nextPrompts.length];
        if (
          prior?.messageID === user.id &&
          prior.turnID === turn.id &&
          prior.rowIndex === index &&
          prior.label === label
        ) {
          nextPrompts.push(prior);
        } else {
          samePrompts = false;
          nextPrompts.push({ messageID: user.id, turnID: turn.id, rowIndex: index, label });
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
    left.headerless !== right.headerless ||
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
