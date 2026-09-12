import type { Project, SessionInfo, SessionLogOutput } from "@opencode/client";
import type { QueryClient } from "@tanstack/react-query";
import type {
  PalotEvent,
  PalotEventBatch,
  PalotMessage,
  PalotMessageContent,
  PalotProject,
  PalotSession,
  SessionRequestSnapshot,
} from "../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";
import {
  OpenCodeDataGraph,
  openCodeDataGraphKeys,
  openCodeDataGraphRecordKey,
  type OpenCodeDataGraphKey,
  type OpenCodeDataGraphRecord,
  type OpenCodeDataGraphWriter,
  type OpenCodeProjectRecord,
  type OpenCodeSessionRecord,
  type OpenCodeSessionMessageRecord,
  type OpenCodeSessionRequestRecord,
  type OpenCodeSessionRuntime,
  type OpenCodeSessionRuntimeRecord,
} from "./open-code-data-graph";
import {
  applyOpenCodeEvents,
  applyExecutionEvents,
  applySessionStatusEvents,
  needsMissingMessageRecovery,
  sameSessionExecutionState,
  sameSessionRuntimeStatus,
} from "./opencode-session-reducer";
import { compareMessages } from "./message-reconcile";
import {
  EMPTY_SESSION_REQUEST_SNAPSHOT,
  mergeSessionRequestSnapshot,
  sessionRequestEventSessionID,
  updateSessionRequests,
} from "./session-request-reducer";
import { streamingPatchInputFromJson } from "./streaming-patch-input";

export interface SessionActivityData {
  activeIDs: Set<string>;
  execution: Map<string, SessionExecutionState>;
  statuses: Map<string, SessionRuntimeStatus>;
}

export interface OpenCodeSnapshotToken {
  connectionID: string;
  revision: number;
}

export interface OpenCodeBatchResult {
  events: PalotEvent[];
  gap: boolean;
  streamChanged: boolean;
  changedSessionIDs: string[];
  /** Sessions whose committed message records actually changed, excluding metadata/no-ops. */
  changedTranscriptSessionIDs: string[];
  gapSessionIDs: string[];
  missingMessageSessionIDs: string[];
}

export interface OpenCodeAppliedBatch {
  batch: PalotEventBatch;
  result: OpenCodeBatchResult;
}

export interface OpenCodeReplayResult {
  events: PalotEvent[];
  changedSessionIDs: string[];
  cursor: number | undefined;
  synced: boolean;
  regression: boolean;
}

export type OpenCodeTranscriptSnapshotMode = "rooted" | "recent" | "older";

interface ConnectionOrderingState {
  epoch: number;
  batchSequence: number;
  receiveSequence: number;
  durableSequences: Map<string, number>;
  verifiedSequences: Map<string, number>;
}

const reconcilers = new WeakMap<QueryClient, OpenCodeReconciler>();

function emptyActivity(): SessionActivityData {
  return { activeIDs: new Set(), execution: new Map(), statuses: new Map() };
}

function recordSessionID(event: PalotEvent): string | null {
  const data: unknown = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if ("sessionID" in data && typeof data.sessionID === "string") return data.sessionID;
  if (!("form" in data) || !data.form || typeof data.form !== "object") return null;
  return "sessionID" in data.form && typeof data.form.sessionID === "string"
    ? data.form.sessionID
    : null;
}

function normalizeActivityEvents(events: readonly PalotEvent[]): PalotEvent[] {
  return events.flatMap((event) => {
    if (event.type === "session.idle") {
      return [
        {
          ...event,
          type: "session.status",
          data: { ...event.data, status: { type: "idle" } },
        } as PalotEvent,
      ];
    }
    if (
      event.type === "session.created" ||
      event.type === "session.deleted" ||
      event.type === "session.status" ||
      event.type === "session.retry.scheduled" ||
      event.type === "session.execution.started" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted" ||
      event.type === "session.step.started" ||
      event.type === "session.step.ended"
    ) {
      return [event];
    }
    return [];
  });
}

function mergeSessionInfo(current: SessionInfo | undefined, incoming: SessionInfo): SessionInfo {
  if (!current) return incoming;
  const newer = current.time.updated >= incoming.time.updated ? current : incoming;
  return {
    ...newer,
    time: {
      ...newer.time,
      ...(current.time.idle === undefined && incoming.time.idle === undefined
        ? {}
        : { idle: Math.max(current.time.idle ?? 0, incoming.time.idle ?? 0) }),
      ...(current.time.viewed === undefined && incoming.time.viewed === undefined
        ? {}
        : { viewed: Math.max(current.time.viewed ?? 0, incoming.time.viewed ?? 0) }),
    },
  };
}

export function sessionInfoFromPalot(
  session: PalotSession,
  previous?: SessionInfo | null,
): SessionInfo {
  return {
    ...previous,
    id: session.id,
    ...(session.parentID ? { parentID: session.parentID } : { parentID: undefined }),
    projectID: session.projectID,
    ...(session.agent ? { agent: session.agent } : { agent: undefined }),
    ...(session.model ? { model: { ...session.model } } : { model: undefined }),
    ...(session.permissions === undefined
      ? {}
      : { permissions: session.permissions.map((rule) => ({ ...rule })) }),
    cost: session.cost ?? previous?.cost ?? 0,
    tokens: { ...session.tokens, cache: { ...session.tokens.cache } },
    time: {
      ...previous?.time,
      created: session.createdAt,
      updated: session.updatedAt,
      ...(session.idleAt === undefined ? {} : { idle: session.idleAt }),
      ...(session.viewedAt === undefined ? {} : { viewed: session.viewedAt }),
      ...(session.archivedAt === null ? { archived: undefined } : { archived: session.archivedAt }),
    },
    ...(session.outcome ? { outcome: session.outcome } : {}),
    ...(session.title ? { title: session.title } : { title: undefined }),
    location: { ...session.location },
    ...(session.revert
      ? {
          revert: {
            ...session.revert,
            ...(session.revert.files
              ? { files: session.revert.files.map((file) => ({ ...file })) }
              : {}),
          },
        }
      : { revert: undefined }),
  };
}

export function projectInfoFromPalot(project: PalotProject, previous?: Project): Project {
  const updated = project.updatedAt ?? 0;
  return {
    ...previous,
    id: project.id,
    canonical: project.canonical,
    ...(project.name ? { name: project.name } : { name: undefined }),
    time: { ...previous?.time, created: previous?.time.created ?? updated, updated },
    sandboxes: [...project.sandboxes],
  };
}

function sessionRecord(connectionID: string, value: SessionInfo): OpenCodeSessionRecord {
  return {
    connectionID,
    kind: "session",
    entityID: value.id,
    sessionID: value.id,
    value,
  };
}

function projectRecord(connectionID: string, value: Project): OpenCodeProjectRecord {
  return {
    connectionID,
    kind: "project",
    entityID: value.id,
    sessionID: null,
    value,
  };
}

function runtimeRecord(
  connectionID: string,
  sessionID: string,
  value: OpenCodeSessionRuntime,
): OpenCodeSessionRuntimeRecord {
  return { connectionID, kind: "session-runtime", entityID: sessionID, sessionID, value };
}

function requestRecord(
  connectionID: string,
  sessionID: string,
  value: SessionRequestSnapshot,
): OpenCodeSessionRequestRecord {
  return { connectionID, kind: "session-request", entityID: sessionID, sessionID, value };
}

function messageRecord(
  connectionID: string,
  sessionID: string,
  value: PalotMessage,
): OpenCodeSessionMessageRecord {
  return { connectionID, kind: "session-message", entityID: value.id, sessionID, value };
}

function preserveStreamingPatchInputs(
  incoming: PalotMessage,
  current: PalotMessage | undefined,
): PalotMessage {
  if (!current) return incoming;
  const currentTools = new Map(
    current.content
      .filter((part) => part.type === "tool" && part.id)
      .map((part) => [part.id, part]),
  );
  let changed = false;
  const content = incoming.content.map((part) => {
    if (part.type !== "tool" || (part.name !== "patch" && part.name !== "apply_patch")) return part;
    const state = part.state;
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      state.status !== "streaming"
    ) {
      return part;
    }
    const previous = currentTools.get(part.id);
    const previousState = previous?.state;
    if (
      previous?.name !== part.name ||
      !previousState ||
      typeof previousState !== "object" ||
      Array.isArray(previousState) ||
      previousState.status !== "streaming"
    ) {
      return part;
    }
    const stream = streamingPatchInputFromJson(previousState.inputStream);
    if (!stream) return part;
    // Input deltas are ephemeral: even a snapshot begun after the last delta
    // contains empty input until input.ended. Keep its decoder, not the old part.
    changed = true;
    return {
      ...part,
      state: {
        ...state,
        input: previousState.input ?? { patchText: stream.document.text },
        inputStream: stream,
      },
    };
  });
  return changed ? { ...incoming, content } : incoming;
}

function preserveStreamingText(
  incoming: PalotMessage,
  current: PalotMessage | undefined,
): PalotMessage {
  if (
    !current ||
    current.type !== "assistant" ||
    incoming.type !== "assistant" ||
    current.completedAt !== null ||
    incoming.completedAt !== null ||
    !current.content.some((part) => part.streaming)
  )
    return incoming;

  // The public stream addresses text and reasoning by independent typed ordinals.
  // Snapshots have no part IDs; keep an explicit identity when one is available.
  const parts: Record<"text" | "reasoning", PalotMessageContent[]> = { text: [], reasoning: [] };
  for (const part of current.content) {
    if (part.type === "text" || part.type === "reasoning") parts[part.type].push(part);
  }
  const ordinals = { text: 0, reasoning: 0 };
  let changed = false;
  let textChanged = false;
  const content = incoming.content.map((part) => {
    if (part.type !== "text" && part.type !== "reasoning") return part;
    const ordinal = ordinals[part.type]++;
    const previous = part.id
      ? parts[part.type].find((candidate) => candidate.id === part.id)
      : parts[part.type][ordinal];
    if (
      !previous?.streaming ||
      !previous.text ||
      part.text !== "" ||
      part.time?.completed !== undefined ||
      (part.time && previous.time && part.time.created !== previous.time.created)
    )
      return part;
    // Deltas are ephemeral even for a fetch begun AFTER the last delta. Only an
    // empty, unfinished persisted part may borrow that live value; nonempty
    // snapshots and ended events remain authoritative, regardless of length.
    changed = true;
    if (part.type === "text") textChanged = true;
    return { ...part, id: previous.id, text: previous.text, streaming: true };
  });
  return changed
    ? {
        ...incoming,
        content,
        ...(textChanged
          ? {
              text: content
                .filter((part) => part.type === "text")
                .map((part) => part.text ?? "")
                .join(""),
            }
          : {}),
        ...(current.firstTokenAt !== undefined
          ? { firstTokenAt: incoming.firstTokenAt ?? current.firstTokenAt }
          : {}),
      }
    : incoming;
}

function transcriptRunningSince(messages: readonly PalotMessage[]): number | null {
  const activeUser = messages.findLast(
    (message) =>
      message.type === "user" &&
      message.runCompletedAt === undefined &&
      (message.runStartedAt !== undefined || message.delivery !== "queue"),
  );
  if (activeUser) return activeUser.runStartedAt ?? activeUser.createdAt;
  const pending = messages.findLast(
    (message) =>
      (message.type === "assistant" || message.type === "shell" || message.type === "compaction") &&
      message.completedAt === null,
  );
  return pending?.createdAt ?? null;
}

export class OpenCodeReconciler {
  readonly graph: OpenCodeDataGraph;
  readonly #ordering = new Map<string, ConnectionOrderingState>();
  readonly #touchedAt = new Map<OpenCodeDataGraphKey, number>();
  readonly #listeners = new Set<(applied: OpenCodeAppliedBatch) => void>();
  readonly #staleTranscripts = new Map<string, Set<string>>();
  #revision = 0;
  #focusedConnectionID: string | null | undefined;

  constructor(id?: string) {
    this.graph = new OpenCodeDataGraph(id);
  }

  /** Undefined until configured preserves full reconciliation for standalone consumers. */
  setFocusedConnection(connectionID: string | null): void {
    this.#focusedConnectionID = connectionID;
  }

  #hasTranscriptInterest(connectionID: string): boolean {
    return this.#focusedConnectionID === undefined || this.#focusedConnectionID === connectionID;
  }

  beginSnapshot(connectionID: string): OpenCodeSnapshotToken {
    return { connectionID, revision: this.#revision };
  }

  projects(connectionID: string): Project[] {
    return this.graph
      .selectConnectionRecords(connectionID, "project")
      .flatMap((item) => (item.kind === "project" ? [item.value] : []))
      .toSorted((left, right) => left.canonical.localeCompare(right.canonical));
  }

  sessions(connectionID: string): SessionInfo[] {
    return this.graph
      .selectConnectionRecords(connectionID, "session")
      .flatMap((item) => (item.kind === "session" ? [item.value] : []))
      .toSorted(
        (left, right) => right.time.updated - left.time.updated || left.id.localeCompare(right.id),
      );
  }

  session(connectionID: string, sessionID: string): SessionInfo | null {
    const record = this.graph.collection.get(
      openCodeDataGraphKeys.session(connectionID, sessionID),
    );
    return record?.kind === "session" ? record.value : null;
  }

  activity(connectionID: string): SessionActivityData {
    const activity = emptyActivity();
    for (const record of this.graph.selectConnectionRecords(connectionID, "session-runtime")) {
      if (record.kind !== "session-runtime") continue;
      if (record.value.active) activity.activeIDs.add(record.sessionID);
      if (record.value.execution) activity.execution.set(record.sessionID, record.value.execution);
      if (record.value.status) activity.statuses.set(record.sessionID, record.value.status);
    }
    return activity;
  }

  requests(connectionID: string, sessionID: string): SessionRequestSnapshot | undefined {
    const record = this.graph.collection.get(
      openCodeDataGraphKeys.sessionRequest(connectionID, sessionID),
    );
    return record?.kind === "session-request" ? record.value : undefined;
  }

  messages(connectionID: string, sessionID: string): PalotMessage[] {
    return this.graph
      .selectSessionRecords(connectionID, sessionID, "session-message")
      .flatMap((item) => (item.kind === "session-message" ? [item.value] : []))
      .toSorted(compareMessages);
  }

  replayCursor(connectionID: string, aggregateID: string): number | undefined {
    return this.#ordering.get(connectionID)?.verifiedSequences.get(aggregateID);
  }

  subscribe(listener: (applied: OpenCodeAppliedBatch) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  requestMap(connectionID: string, sessionIDs?: ReadonlySet<string>) {
    const result = new Map<string, SessionRequestSnapshot>();
    for (const record of this.graph.selectConnectionRecords(connectionID, "session-request")) {
      if (record.kind !== "session-request") continue;
      if (sessionIDs && !sessionIDs.has(record.sessionID)) continue;
      result.set(record.sessionID, record.value);
    }
    return result;
  }

  replaceProjects(
    connectionID: string,
    projects: readonly Project[],
    token?: OpenCodeSnapshotToken,
  ): void {
    const incoming = new Set(projects.map((project) => project.id));
    this.#commit((writer, touched) => {
      for (const record of this.graph.selectConnectionRecords(connectionID, "project")) {
        if (record.kind !== "project" || incoming.has(record.entityID)) continue;
        const key = openCodeDataGraphRecordKey(record);
        if (this.#changedAfter(key, token)) continue;
        writer.delete(key);
        touched.add(key);
      }
      for (const project of projects) {
        const record = projectRecord(connectionID, project);
        const key = openCodeDataGraphRecordKey(record);
        if (this.#changedAfter(key, token)) continue;
        writer.upsert(record);
        touched.add(key);
      }
    });
  }

  upsertSessionInfos(
    connectionID: string,
    sessions: readonly SessionInfo[],
    token?: OpenCodeSnapshotToken,
  ): void {
    this.#commit((writer, touched) => {
      for (const incoming of sessions) {
        const key = openCodeDataGraphKeys.session(connectionID, incoming.id);
        if (this.#changedAfter(key, token)) continue;
        const current = this.session(connectionID, incoming.id) ?? undefined;
        writer.upsert(sessionRecord(connectionID, mergeSessionInfo(current, incoming)));
        touched.add(key);
      }
    });
  }

  upsertPalotSessions(connectionID: string, sessions: readonly PalotSession[]): void {
    this.#commit((writer, touched) => {
      for (const session of sessions) {
        const current = this.session(connectionID, session.id);
        const record = sessionRecord(connectionID, sessionInfoFromPalot(session, current));
        writer.upsert(record);
        touched.add(openCodeDataGraphRecordKey(record));
      }
    });
  }

  upsertPalotProjects(connectionID: string, projects: readonly PalotProject[]): void {
    this.replaceProjects(
      connectionID,
      projects.map((project) =>
        projectInfoFromPalot(
          project,
          this.projects(connectionID).find((item) => item.id === project.id),
        ),
      ),
    );
  }

  patchSession(
    connectionID: string,
    sessionID: string,
    update: (session: SessionInfo) => SessionInfo,
  ): void {
    const current = this.session(connectionID, sessionID);
    if (!current) return;
    this.#upsert(sessionRecord(connectionID, update(current)));
  }

  removeSession(connectionID: string, sessionID: string): void {
    const deleted = this.#sessionFamily(connectionID, sessionID);
    this.#commit((writer, touched) => {
      writer.deleteWhere((record) => {
        const remove = record.connectionID === connectionID && deleted.has(record.sessionID ?? "");
        if (remove) touched.add(openCodeDataGraphRecordKey(record));
        return remove;
      });
    });
  }

  replaceActivity(
    connectionID: string,
    value: SessionActivityData,
    token?: OpenCodeSnapshotToken,
  ): void {
    const sessionIDs = new Set([
      ...value.activeIDs,
      ...value.execution.keys(),
      ...value.statuses.keys(),
      ...this.activity(connectionID).execution.keys(),
      ...this.activity(connectionID).statuses.keys(),
    ]);
    this.#commit((writer, touched) => {
      for (const sessionID of sessionIDs) {
        const key = openCodeDataGraphKeys.sessionRuntime(connectionID, sessionID);
        if (this.#changedAfter(key, token)) continue;
        const runtime: OpenCodeSessionRuntime = {
          active: value.activeIDs.has(sessionID),
          execution: value.execution.get(sessionID) ?? null,
          status: value.statuses.get(sessionID) ?? null,
        };
        if (!runtime.active && !runtime.execution && !runtime.status) writer.delete(key);
        else writer.upsert(runtimeRecord(connectionID, sessionID, runtime));
        touched.add(key);
      }
    });
  }

  updateActivity(
    connectionID: string,
    update: (current: SessionActivityData) => SessionActivityData,
  ): SessionActivityData {
    const next = update(this.activity(connectionID));
    this.replaceActivity(connectionID, next);
    return next;
  }

  setRequests(
    connectionID: string,
    sessionID: string,
    value: SessionRequestSnapshot,
    token?: OpenCodeSnapshotToken,
  ): void {
    const key = openCodeDataGraphKeys.sessionRequest(connectionID, sessionID);
    if (this.#changedAfter(key, token)) return;
    this.#upsert(
      requestRecord(
        connectionID,
        sessionID,
        mergeSessionRequestSnapshot(this.requests(connectionID, sessionID), value),
      ),
    );
  }

  removeRequests(connectionID: string, sessionID: string): void {
    this.#delete(openCodeDataGraphKeys.sessionRequest(connectionID, sessionID));
  }

  setTranscriptSnapshot(
    connectionID: string,
    sessionID: string,
    messages: readonly PalotMessage[],
    mode: OpenCodeTranscriptSnapshotMode,
    token?: OpenCodeSnapshotToken,
  ): void {
    const incoming = new Map(messages.map((message) => [message.id, message]));
    const stale = this.#staleTranscripts.get(connectionID)?.has(sessionID);
    this.#commit((writer, touched) => {
      if (mode === "rooted") {
        for (const record of this.graph.selectSessionRecords(
          connectionID,
          sessionID,
          "session-message",
        )) {
          if (record.kind !== "session-message" || incoming.has(record.entityID)) continue;
          const key = openCodeDataGraphRecordKey(record);
          if (this.#changedAfter(key, token)) continue;
          writer.delete(key);
          touched.add(key);
        }
      }
      for (const message of messages) {
        const key = openCodeDataGraphKeys.sessionMessage(connectionID, sessionID, message.id);
        if (this.#changedAfter(key, token)) continue;
        if (mode === "older" && this.graph.collection.has(key)) continue;
        const current = this.graph.collection.get(key);
        writer.upsert(
          messageRecord(
            connectionID,
            sessionID,
            preserveStreamingPatchInputs(
              preserveStreamingText(
                message,
                !stale && current?.kind === "session-message" ? current.value : undefined,
              ),
              !stale && current?.kind === "session-message" ? current.value : undefined,
            ),
          ),
        );
        touched.add(key);
      }
      const runtimeKey = openCodeDataGraphKeys.sessionRuntime(connectionID, sessionID);
      const runtime = this.graph.collection.get(runtimeKey);
      const execution = runtime?.kind === "session-runtime" ? runtime.value.execution : null;
      if (runtime?.kind === "session-runtime" && execution?.status === "running") {
        const startedAt = execution.startedAt ?? transcriptRunningSince(messages);
        if (startedAt !== null && startedAt !== execution.startedAt) {
          writer.upsert(
            runtimeRecord(connectionID, sessionID, {
              ...runtime.value,
              execution: { ...execution, startedAt },
            }),
          );
          touched.add(runtimeKey);
        }
      }
    });
    this.#staleTranscripts.get(connectionID)?.delete(sessionID);
  }

  removeMessage(connectionID: string, sessionID: string, messageID: string): void {
    this.#delete(openCodeDataGraphKeys.sessionMessage(connectionID, sessionID, messageID));
  }

  applyBatch(batch: PalotEventBatch): OpenCodeBatchResult {
    const accepted = this.#admitBatch(batch);
    const eventSessionIDs = new Set(
      accepted.events.map(recordSessionID).filter((id): id is string => Boolean(id)),
    );
    const missingMessageSessionIDs = this.#hasTranscriptInterest(batch.connectionID)
      ? [...eventSessionIDs].filter((sessionID) =>
          needsMissingMessageRecovery(
            this.messages(batch.connectionID, sessionID),
            sessionID,
            accepted.events,
          ),
        )
      : [];
    const changes =
      accepted.events.length > 0
        ? this.#applyEvents(batch.connectionID, accepted.events)
        : { changedSessionIDs: [], changedTranscriptSessionIDs: [] };
    const gapSessionIDs = accepted.gap
      ? [...new Set(accepted.events.map(recordSessionID).filter((id): id is string => Boolean(id)))]
      : [];
    const result = {
      ...accepted,
      ...changes,
      gapSessionIDs,
      missingMessageSessionIDs,
    };
    if (accepted.events.length > 0 || accepted.gap || accepted.streamChanged) {
      const admittedBatch = { ...batch, events: accepted.events };
      for (const listener of this.#listeners) listener({ batch: admittedBatch, result });
    }
    return result;
  }

  applyReplay(
    connectionID: string,
    aggregateID: string,
    items: readonly SessionLogOutput[],
    requestedAfter?: number,
  ): OpenCodeReplayResult {
    const marker = items.findLast((item) => item.type === "log.synced");
    if (!marker || marker.aggregateID !== aggregateID) {
      return {
        events: [],
        changedSessionIDs: [],
        cursor: requestedAfter,
        synced: false,
        regression: false,
      };
    }
    if (marker.seq !== undefined && requestedAfter !== undefined && marker.seq < requestedAfter) {
      return {
        events: [],
        changedSessionIDs: [],
        cursor: requestedAfter,
        synced: false,
        regression: true,
      };
    }
    const ordering = this.#ordering.get(connectionID) ?? {
      epoch: 0,
      batchSequence: 0,
      receiveSequence: 0,
      durableSequences: new Map<string, number>(),
      verifiedSequences: new Map<string, number>(),
    };
    const events: PalotEvent[] = [];
    for (const item of items) {
      if (item.type === "log.synced" || !("durable" in item)) continue;
      if (item.durable.aggregateID !== aggregateID) continue;
      const current = ordering.durableSequences.get(aggregateID) ?? -1;
      if (item.durable.seq <= current) continue;
      ordering.durableSequences.set(aggregateID, item.durable.seq);
      events.push({ ...item, createdAt: item.created, receiveSequence: 0 } as PalotEvent);
    }
    if (marker.seq === undefined) ordering.verifiedSequences.delete(aggregateID);
    else ordering.verifiedSequences.set(aggregateID, marker.seq);
    this.#ordering.set(connectionID, ordering);
    const changedSessionIDs =
      events.length > 0 ? this.#applyEvents(connectionID, events).changedSessionIDs : [];
    return {
      events,
      changedSessionIDs,
      cursor: marker.seq,
      synced: true,
      regression: false,
    };
  }

  resetConnection(connectionID: string): void {
    this.#commit((writer, touched) => {
      writer.deleteWhere((record) => {
        if (record.connectionID !== connectionID) return false;
        touched.add(openCodeDataGraphRecordKey(record));
        return true;
      });
    });
    this.#ordering.delete(connectionID);
    this.#staleTranscripts.delete(connectionID);
  }

  #applyEvents(
    connectionID: string,
    events: PalotEvent[],
  ): Pick<OpenCodeBatchResult, "changedSessionIDs" | "changedTranscriptSessionIDs"> {
    const transcriptInterest = this.#hasTranscriptInterest(connectionID);
    const beforeActivity = this.activity(connectionID);
    const activityEvents = normalizeActivityEvents(events);
    let execution = applyExecutionEvents(beforeActivity.execution, activityEvents);
    const statuses = applySessionStatusEvents(beforeActivity.statuses, activityEvents);
    const activeIDs = new Set(beforeActivity.activeIDs);
    const sessions = new Map(this.sessions(connectionID).map((session) => [session.id, session]));
    const requests = this.requestMap(connectionID);
    const deletedSessionIDs = new Set<string>();
    const touchedSessionIDs = new Set<string>();
    const touchedRequestIDs = new Set<string>();
    const messageEvents = new Map<string, PalotEvent[]>();

    for (const event of events) {
      const sessionID = recordSessionID(event);
      if (event.type === "session.created") {
        sessions.set(event.data.sessionID, {
          id: event.data.sessionID,
          ...(event.data.parentID ? { parentID: event.data.parentID } : {}),
          projectID: event.data.projectID,
          ...(event.data.agent ? { agent: event.data.agent } : {}),
          ...(event.data.model ? { model: event.data.model } : {}),
          ...(event.data.permissions === undefined ? {} : { permissions: event.data.permissions }),
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: event.createdAt, updated: event.createdAt },
          ...(event.data.title ? { title: event.data.title } : {}),
          location: event.data.location,
          ...(event.data.subpath ? { subpath: event.data.subpath } : {}),
        });
        touchedSessionIDs.add(event.data.sessionID);
      } else if (event.type === "session.deleted") {
        for (const id of this.#sessionFamilyFromMap(sessions, event.data.sessionID)) {
          sessions.delete(id);
          requests.delete(id);
          deletedSessionIDs.add(id);
          touchedSessionIDs.add(id);
          touchedRequestIDs.add(id);
          activeIDs.delete(id);
        }
      } else if (sessionID) {
        const current = sessions.get(sessionID);
        const updated = current ? this.#applySessionEvent(current, event) : current;
        if (updated && updated !== current) {
          sessions.set(sessionID, updated);
          touchedSessionIDs.add(sessionID);
        }
      }

      const requestSessionID = sessionRequestEventSessionID(event);
      if (requestSessionID) {
        const current = requests.get(requestSessionID) ?? EMPTY_SESSION_REQUEST_SNAPSHOT;
        const updated = updateSessionRequests(current, event);
        if (updated !== current) {
          requests.set(requestSessionID, updated);
          touchedRequestIDs.add(requestSessionID);
        }
      }

      // Keep retained background snapshots intact until an authoritative focus fetch.
      // Admission and summary reducers still see every event, including token streams.
      if (sessionID && transcriptInterest) {
        const current = messageEvents.get(sessionID) ?? [];
        current.push(event);
        messageEvents.set(sessionID, current);
      } else if (sessionID) {
        // Retained live content has missed ephemeral deltas; it must not
        // override the next authoritative snapshot's text or tool input.
        let stale = this.#staleTranscripts.get(connectionID);
        if (!stale) this.#staleTranscripts.set(connectionID, (stale = new Set()));
        stale.add(sessionID);
      }

      if (!sessionID) continue;
      if (
        event.type === "session.execution.started" ||
        event.type === "session.step.started" ||
        event.type === "session.retry.scheduled" ||
        (event.type === "session.status" && event.data.status.type !== "idle")
      ) {
        activeIDs.add(sessionID);
      }
      if (
        event.type === "session.deleted" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted" ||
        event.type === "session.idle" ||
        (event.type === "session.status" && event.data.status.type === "idle")
      ) {
        activeIDs.delete(sessionID);
      }
    }

    const runtimeSessionIDs = new Set([
      ...beforeActivity.activeIDs,
      ...activeIDs,
      ...beforeActivity.execution.keys(),
      ...execution.keys(),
      ...beforeActivity.statuses.keys(),
      ...statuses.keys(),
    ]);
    const changedMessages = new Map<string, PalotMessage[]>();
    for (const [sessionID, sessionEvents] of messageEvents) {
      if (deletedSessionIDs.has(sessionID)) continue;
      const current = this.messages(connectionID, sessionID);
      const next = applyOpenCodeEvents(current, sessionID, sessionEvents);
      if (next !== current) changedMessages.set(sessionID, next);
    }
    for (const [sessionID, messages] of changedMessages) {
      const current = execution.get(sessionID);
      if (current?.status !== "running" || current.startedAt !== null) continue;
      const startedAt = transcriptRunningSince(messages);
      if (startedAt === null) continue;
      if (execution === beforeActivity.execution) execution = new Map(execution);
      execution.set(sessionID, { ...current, startedAt });
    }

    // Track candidate message writes in the existing staging loops. Comparing the
    // committed values afterwards respects the graph's deep-equal no-op suppression
    // without another transcript scan or another deep comparison of message history.
    const transcriptCandidates = new Map<
      OpenCodeDataGraphKey,
      { sessionID: string; before: PalotMessage | undefined }
    >();
    this.#commit((writer, touched) => {
      for (const sessionID of deletedSessionIDs) {
        writer.deleteWhere((record) => {
          const remove = record.connectionID === connectionID && record.sessionID === sessionID;
          if (remove) {
            const key = openCodeDataGraphRecordKey(record);
            touched.add(key);
            if (record.kind === "session-message") {
              transcriptCandidates.set(key, { sessionID, before: record.value });
            }
          }
          return remove;
        });
      }
      for (const sessionID of touchedSessionIDs) {
        const session = sessions.get(sessionID);
        const key = openCodeDataGraphKeys.session(connectionID, sessionID);
        if (session) writer.upsert(sessionRecord(connectionID, session));
        else writer.delete(key);
        touched.add(key);
      }
      for (const sessionID of runtimeSessionIDs) {
        const current = beforeActivity.execution.get(sessionID);
        const nextExecution = execution.get(sessionID);
        const currentStatus = beforeActivity.statuses.get(sessionID);
        const nextStatus = statuses.get(sessionID);
        if (
          beforeActivity.activeIDs.has(sessionID) === activeIDs.has(sessionID) &&
          sameSessionExecutionState(current, nextExecution) &&
          sameSessionRuntimeStatus(currentStatus, nextStatus)
        ) {
          continue;
        }
        const key = openCodeDataGraphKeys.sessionRuntime(connectionID, sessionID);
        if (deletedSessionIDs.has(sessionID)) writer.delete(key);
        else {
          writer.upsert(
            runtimeRecord(connectionID, sessionID, {
              active: activeIDs.has(sessionID),
              execution: nextExecution ?? null,
              status: nextStatus ?? null,
            }),
          );
        }
        touched.add(key);
      }
      for (const sessionID of touchedRequestIDs) {
        const key = openCodeDataGraphKeys.sessionRequest(connectionID, sessionID);
        const value = requests.get(sessionID);
        if (value) writer.upsert(requestRecord(connectionID, sessionID, value));
        else writer.delete(key);
        touched.add(key);
      }
      for (const [sessionID, messages] of changedMessages) {
        const incoming = new Map(messages.map((message) => [message.id, message]));
        for (const record of this.graph.selectSessionRecords(
          connectionID,
          sessionID,
          "session-message",
        )) {
          if (record.kind !== "session-message" || incoming.has(record.entityID)) continue;
          const key = openCodeDataGraphRecordKey(record);
          writer.delete(key);
          touched.add(key);
          transcriptCandidates.set(key, { sessionID, before: record.value });
        }
        for (const message of messages) {
          const record = messageRecord(connectionID, sessionID, message);
          const key = openCodeDataGraphRecordKey(record);
          const current = this.graph.collection.get(key);
          const before = current?.kind === "session-message" ? current.value : undefined;
          if (before !== message) transcriptCandidates.set(key, { sessionID, before });
          writer.upsert(record);
          touched.add(key);
        }
      }
    });
    const changedTranscriptSessionIDs = new Set<string>();
    for (const [key, { sessionID, before }] of transcriptCandidates) {
      if (changedTranscriptSessionIDs.has(sessionID)) continue;
      const current = this.graph.collection.get(key);
      const after = current?.kind === "session-message" ? current.value : undefined;
      if (after !== before) changedTranscriptSessionIDs.add(sessionID);
    }
    return {
      changedSessionIDs: [
        ...new Set(events.map(recordSessionID).filter((id): id is string => Boolean(id))),
      ],
      changedTranscriptSessionIDs: [...changedTranscriptSessionIDs],
    };
  }

  #applySessionEvent(session: SessionInfo, event: PalotEvent): SessionInfo {
    if (event.type === "session.permissions.updated") {
      return {
        ...session,
        permissions: event.data.permissions,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.execution.started") {
      const { outcome: _outcome, ...current } = session;
      return {
        ...current,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.renamed") {
      return {
        ...session,
        title: event.data.title,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.moved") {
      return {
        ...session,
        projectID: event.data.projectID,
        location: event.data.location,
        ...(event.data.subpath ? { subpath: event.data.subpath } : {}),
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.model.selected") {
      return {
        ...session,
        model: event.data.model,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.agent.selected") {
      return {
        ...session,
        agent: event.data.agent,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.usage.updated") {
      return {
        ...session,
        cost: event.data.cost,
        tokens: event.data.tokens,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.inbox.delivered") {
      return { ...session, time: { ...session.time, updated: event.createdAt } };
    }
    if (event.type === "session.revert.staged") {
      return {
        ...session,
        revert: event.data.revert,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (event.type === "session.revert.cleared" || event.type === "session.revert.committed") {
      return {
        ...session,
        revert: undefined,
        time: { ...session.time, updated: Math.max(session.time.updated, event.createdAt) },
      };
    }
    if (
      event.type === "session.idle" ||
      (event.type === "session.status" && event.data.status.type === "idle")
    ) {
      return {
        ...session,
        time: {
          ...session.time,
          updated: Math.max(session.time.updated, event.createdAt),
          idle: Math.max(session.time.idle ?? 0, event.createdAt),
        },
      };
    }
    if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      const outcome =
        event.type === "session.execution.succeeded"
          ? "succeeded"
          : event.type === "session.execution.failed"
            ? event.data.error.type === "MessageAbortedError"
              ? "interrupted"
              : "failed"
            : "interrupted";
      return {
        ...session,
        outcome,
        time: {
          ...session.time,
          updated: Math.max(session.time.updated, event.createdAt),
          idle: Math.max(session.time.idle ?? 0, event.createdAt),
        },
      };
    }
    if (event.type === "session.viewed") {
      return { ...session, time: { ...session.time, viewed: event.data.idle } };
    }
    return session;
  }

  #admitBatch(batch: PalotEventBatch): OpenCodeBatchResult {
    const previous = this.#ordering.get(batch.connectionID);
    if (previous && batch.streamEpoch < previous.epoch) {
      return {
        events: [],
        gap: false,
        streamChanged: false,
        changedSessionIDs: [],
        changedTranscriptSessionIDs: [],
        gapSessionIDs: [],
        missingMessageSessionIDs: [],
      };
    }
    const streamChanged = Boolean(previous && previous.epoch !== batch.streamEpoch);
    if (previous && !streamChanged && batch.batchSequence <= previous.batchSequence) {
      return {
        events: [],
        gap: false,
        streamChanged: false,
        changedSessionIDs: [],
        changedTranscriptSessionIDs: [],
        gapSessionIDs: [],
        missingMessageSessionIDs: [],
      };
    }
    const ordering: ConnectionOrderingState =
      streamChanged || !previous
        ? {
            epoch: batch.streamEpoch,
            batchSequence: batch.batchSequence,
            receiveSequence: 0,
            durableSequences: previous?.durableSequences ?? new Map(),
            verifiedSequences: previous?.verifiedSequences ?? new Map(),
          }
        : previous;
    let gap = Boolean(
      previous && !streamChanged && batch.batchSequence !== previous.batchSequence + 1,
    );
    const events: PalotEvent[] = [];
    for (const event of batch.events) {
      if (ordering.receiveSequence > 0) {
        if (event.receiveSequence <= ordering.receiveSequence) continue;
        if (event.receiveSequence !== ordering.receiveSequence + 1) gap = true;
      }
      ordering.receiveSequence = event.receiveSequence;
      if (event.durable) {
        const current = ordering.durableSequences.get(event.durable.aggregateID) ?? -1;
        if (event.durable.seq <= current) continue;
        ordering.durableSequences.set(event.durable.aggregateID, event.durable.seq);
      }
      events.push(event);
    }
    ordering.epoch = batch.streamEpoch;
    ordering.batchSequence = batch.batchSequence;
    this.#ordering.set(batch.connectionID, ordering);
    return {
      events,
      gap,
      streamChanged,
      changedSessionIDs: [],
      changedTranscriptSessionIDs: [],
      gapSessionIDs: [],
      missingMessageSessionIDs: [],
    };
  }

  #sessionFamily(connectionID: string, sessionID: string): Set<string> {
    return this.#sessionFamilyFromMap(
      new Map(this.sessions(connectionID).map((session) => [session.id, session])),
      sessionID,
    );
  }

  #sessionFamilyFromMap(sessions: Map<string, SessionInfo>, sessionID: string): Set<string> {
    const deleted = new Set([sessionID]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of sessions.values()) {
        if (!session.parentID || !deleted.has(session.parentID) || deleted.has(session.id))
          continue;
        deleted.add(session.id);
        changed = true;
      }
    }
    return deleted;
  }

  #changedAfter(key: OpenCodeDataGraphKey, token?: OpenCodeSnapshotToken): boolean {
    return Boolean(token && (this.#touchedAt.get(key) ?? 0) > token.revision);
  }

  #upsert(record: OpenCodeDataGraphRecord): void {
    const key = openCodeDataGraphRecordKey(record);
    this.#commit((writer, touched) => {
      writer.upsert(record);
      touched.add(key);
    });
  }

  #delete(key: OpenCodeDataGraphKey): void {
    this.#commit((writer, touched) => {
      writer.delete(key);
      touched.add(key);
    });
  }

  #commit(
    apply: (writer: OpenCodeDataGraphWriter, touched: Set<OpenCodeDataGraphKey>) => void,
  ): void {
    const touched = new Set<OpenCodeDataGraphKey>();
    const changed = this.graph.commit((writer) => apply(writer, touched));
    if (!changed || touched.size === 0) return;
    this.#revision += 1;
    for (const key of touched) this.#touchedAt.set(key, this.#revision);
  }
}

export function openCodeReconciler(queryClient: QueryClient): OpenCodeReconciler {
  let reconciler = reconcilers.get(queryClient);
  if (!reconciler) {
    reconciler = new OpenCodeReconciler();
    reconcilers.set(queryClient, reconciler);
  }
  return reconciler;
}
