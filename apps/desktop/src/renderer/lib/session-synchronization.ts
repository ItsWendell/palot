import type { PalotEvent, PalotMessage } from "../../shared";
import { compareMessages, reconcileMessage } from "./message-reconcile";
import type { SessionReconcileTargets } from "./opencode-session-reducer";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SessionSnapshotToken {
  sessionID: string;
  targets: SessionReconcileTargets;
  generations: { messages: number; requests: number; diffs: number };
  messageRevision: number;
}

export interface WorkspaceSnapshotToken {
  generation: number;
  requestGeneration: number;
}

interface SessionSynchronizationOptions {
  delay?: number;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

function eventSessionID(event: PalotEvent): string | null {
  const data = event.data as unknown;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const sessionID = value.sessionID;
  if (typeof sessionID === "string") return sessionID;
  const form = value.form;
  if (form === null || typeof form !== "object" || Array.isArray(form)) return null;
  const formSessionID = (form as Record<string, unknown>).sessionID;
  return typeof formSessionID === "string" ? formSessionID : null;
}

function reconcileSnapshot(
  snapshot: PalotMessage[],
  current: PalotMessage[],
  liveEventsArrived: boolean,
): PalotMessage[] {
  const snapshotByID = new Map(snapshot.map((message) => [message.id, message]));
  const currentByID = new Map(current.map((message) => [message.id, message]));
  const ids = new Set([...currentByID.keys(), ...snapshotByID.keys()]);
  return [...ids]
    .map((id) => reconcileMessage(snapshotByID.get(id), currentByID.get(id), liveEventsArrived))
    .filter((message): message is PalotMessage => Boolean(message))
    .toSorted(compareMessages);
}

export class SessionSynchronization {
  readonly #delay: number;
  readonly #schedule: (callback: () => void, delay: number) => TimerHandle;
  readonly #cancel: (handle: TimerHandle) => void;
  readonly #resourceGenerations = new Map<string, number>();
  readonly #messageRevisions = new Map<string, number>();
  #workspaceGeneration = 0;
  #requestGeneration = 0;
  readonly #sessionTimers = new Map<string, TimerHandle>();
  readonly #pendingSessionTargets = new Map<string, SessionReconcileTargets>();
  #workspaceTimer: TimerHandle | null = null;

  constructor(options: SessionSynchronizationOptions = {}) {
    this.#delay = options.delay ?? 120;
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  }

  record(events: PalotEvent[]): void {
    for (const event of events) {
      const sessionID = eventSessionID(event);
      if (!sessionID) continue;
      if (!messageEvent(event.type)) continue;
      this.#messageRevisions.set(sessionID, (this.#messageRevisions.get(sessionID) ?? 0) + 1);
    }
  }

  beginSessionSnapshot(sessionID: string, targets: SessionReconcileTargets): SessionSnapshotToken {
    if (targets.requests) this.#requestGeneration += 1;
    const generations = {
      messages: this.beginResource(sessionID, "messages", targets.messages),
      requests: this.beginResource(sessionID, "requests", targets.requests),
      diffs: this.beginResource(sessionID, "diffs", targets.diffs),
    };
    return {
      sessionID,
      targets,
      generations,
      messageRevision: this.#messageRevisions.get(sessionID) ?? 0,
    };
  }

  isCurrentSessionSnapshot(token: SessionSnapshotToken): boolean {
    return (
      this.isCurrentSessionResource(token, "messages") &&
      this.isCurrentSessionResource(token, "requests") &&
      this.isCurrentSessionResource(token, "diffs")
    );
  }

  isCurrentSessionResource(
    token: SessionSnapshotToken,
    resource: keyof SessionReconcileTargets,
  ): boolean {
    return (
      !token.targets[resource] ||
      this.resourceGeneration(token.sessionID, resource) === token.generations[resource]
    );
  }

  admitSessionMessages(
    token: SessionSnapshotToken,
    snapshot: PalotMessage[],
    current: PalotMessage[],
  ): PalotMessage[] | null {
    if (!this.isCurrentSessionResource(token, "messages")) return null;
    return reconcileSnapshot(
      snapshot,
      current,
      (this.#messageRevisions.get(token.sessionID) ?? 0) !== token.messageRevision,
    );
  }

  beginWorkspaceSnapshot(): WorkspaceSnapshotToken {
    return {
      generation: ++this.#workspaceGeneration,
      requestGeneration: this.#requestGeneration,
    };
  }

  isCurrentWorkspaceSnapshot(token: WorkspaceSnapshotToken): boolean {
    return token.generation === this.#workspaceGeneration;
  }

  isCurrentWorkspaceRequestSnapshot(token: WorkspaceSnapshotToken): boolean {
    return (
      this.isCurrentWorkspaceSnapshot(token) && token.requestGeneration === this.#requestGeneration
    );
  }

  scheduleSessionReconcile(
    sessionID: string,
    targets: SessionReconcileTargets,
    callback: (sessionID: string, targets: SessionReconcileTargets) => void,
  ): void {
    const pending = this.#pendingSessionTargets.get(sessionID);
    this.#pendingSessionTargets.set(sessionID, {
      messages: Boolean(pending?.messages || targets.messages),
      requests: Boolean(pending?.requests || targets.requests),
      diffs: Boolean(pending?.diffs || targets.diffs),
    });
    const timer = this.#sessionTimers.get(sessionID);
    if (timer !== undefined) this.#cancel(timer);
    this.#sessionTimers.set(
      sessionID,
      this.#schedule(() => {
        this.#sessionTimers.delete(sessionID);
        const next = this.#pendingSessionTargets.get(sessionID);
        this.#pendingSessionTargets.delete(sessionID);
        if (next) callback(sessionID, next);
      }, this.#delay),
    );
  }

  scheduleWorkspaceReconcile(callback: () => void): void {
    if (this.#workspaceTimer !== null) this.#cancel(this.#workspaceTimer);
    this.#workspaceTimer = this.#schedule(() => {
      this.#workspaceTimer = null;
      callback();
    }, this.#delay);
  }

  dispose(): void {
    for (const timer of this.#sessionTimers.values()) this.#cancel(timer);
    if (this.#workspaceTimer !== null) this.#cancel(this.#workspaceTimer);
    this.#sessionTimers.clear();
    this.#pendingSessionTargets.clear();
    this.#workspaceTimer = null;
  }

  private beginResource(
    sessionID: string,
    resource: keyof SessionReconcileTargets,
    targeted: boolean,
  ): number {
    const current = this.resourceGeneration(sessionID, resource);
    if (!targeted) return current;
    const next = current + 1;
    this.#resourceGenerations.set(`${sessionID}:${resource}`, next);
    return next;
  }

  private resourceGeneration(sessionID: string, resource: keyof SessionReconcileTargets): number {
    return this.#resourceGenerations.get(`${sessionID}:${resource}`) ?? 0;
  }
}

function messageEvent(type: PalotEvent["type"]): boolean {
  return (
    type.startsWith("session.inbox.") ||
    type.startsWith("session.step.") ||
    type.startsWith("session.text.") ||
    type.startsWith("session.reasoning.") ||
    type.startsWith("session.tool.") ||
    type.startsWith("session.shell.") ||
    type === "session.synthetic" ||
    type === "session.instructions.updated" ||
    type === "session.skill.activated" ||
    type === "session.agent.selected" ||
    type === "session.model.selected" ||
    type === "session.moved" ||
    type === "session.retry.scheduled" ||
    type.startsWith("session.compaction.") ||
    type.startsWith("session.execution.")
  );
}
