/**
 * Attaches Palot's agent tools to OpenCode servers through client-hosted MCP (OpenCode 2.1.4+).
 *
 * OpenCode scopes an attachment to one location, and only tasks in that directory see its
 * tools. Palot attaches where tasks need them: the directories windows show (reported by the
 * renderer), the directories of new and running tasks, kept for a while after a turn ends
 * so a follow-up turn still has them. Everything else stays detached, so Palot never loads
 * locations on a server just to offer tools.
 */
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import type { ClientMcpConnection, ClientMcpOptions } from "@opencode/client/mcp";
import log from "electron-log/main";
import type { OpenCodeRuntimeStatus, SessionTriageSnapshot } from "../../shared";
import {
  isFullAccessRuleset,
  PALOT_TOOL_APPROVALS,
  PALOT_TOOL_SERVER,
  palotToolName,
  type PalotToolsFocus,
} from "../../shared/palot-tools-contract";
import { supportsClientHostedMcp } from "../opencode-version";
import {
  palotSchedulingState,
  palotTools,
  type PalotSchedulingState,
  type PalotToolContext,
} from "./tools";

const palotToolsLog = log.scope("palot-tools");

/** How long a directory stays attached after its last running task finished. */
const RECENT_MS = 15 * 60_000;
const SWEEP_MS = 60_000;
const MAX_FOCUS_DIRECTORIES = 8;

export interface PalotToolHostRuntime {
  listRuntimes(): OpenCodeRuntimeStatus[];
  onScopedEvent(
    observer: (event: OpenCodeEvent, runtime: OpenCodeRuntimeStatus) => void,
  ): () => void;
  onRuntimeStatus(observer: (runtime: OpenCodeRuntimeStatus) => void): () => void;
  onConnectionDisposed(observer: (connectionID: string) => void): () => void;
  requestConnection(target: { connectionID: string }): Promise<{
    endpoint: { url: string };
    headers: Record<string, string> | undefined;
  }>;
  scopedConnection(connectionID: string): {
    withClient<T>(operation: (client: OpenCodeClient) => Promise<T>): Promise<T>;
    onEvent(observer: (event: OpenCodeEvent) => void): () => void;
  };
}

export interface PalotToolHostOptions {
  runtime: PalotToolHostRuntime;
  connect(options: ClientMcpOptions): ClientMcpConnection;
  automations: PalotToolContext["automations"];
  triage: PalotToolContext["triage"];
  onTriageChanged(snapshot: SessionTriageSnapshot): void;
  /** The user's switch; checked on every change. */
  enabled?: () => boolean;
  /** "Ask before agents schedule tasks"; Full access tasks never ask. Defaults to asking. */
  askBeforeScheduling?: () => boolean;
  now?: () => number;
}

/** One location's attachment. Closing it ends waits its tools started. */
interface Attachment {
  connection: ClientMcpConnection;
  abort: AbortController;
}

interface ConnectionState {
  profileID: string;
  endpoint: string | null;
  attached: Map<string, Attachment>;
  /** Running sessions and their directories. */
  running: Map<string, string>;
  /** Directories whose last running task finished, and when they detach. */
  recent: Map<string, number>;
  context: Omit<PalotToolContext, "signal">;
  seeded: boolean;
}

export class PalotToolHost {
  readonly #options: PalotToolHostOptions;
  readonly #now: () => number;
  readonly #focus = new Map<number, PalotToolsFocus>();
  readonly #connections = new Map<string, ConnectionState>();
  #unsubscribe: Array<() => void> = [];
  #sweep: ReturnType<typeof setInterval> | null = null;
  #queue: Promise<void> = Promise.resolve();
  #scheduled = false;
  #stopped = false;

  constructor(options: PalotToolHostOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    const { runtime } = this.#options;
    this.#unsubscribe = [
      runtime.onScopedEvent((event, status) => this.#handleEvent(event, status)),
      runtime.onRuntimeStatus(() => this.#schedule()),
      runtime.onConnectionDisposed((connectionID) => {
        this.#drop(connectionID);
        this.#schedule();
      }),
    ];
    this.#sweep = setInterval(() => this.#expire(), SWEEP_MS);
    this.#sweep.unref?.();
    this.#schedule();
  }

  /** Re-reads the enabled setting and applies it. */
  refresh(): void {
    this.#schedule();
  }

  /** What one window shows; null when the window closes. */
  setFocus(ownerID: number, focus: PalotToolsFocus | null): void {
    if (focus) {
      this.#focus.set(ownerID, {
        connectionID: focus.connectionID,
        directories: [...new Set(focus.directories)].slice(0, MAX_FOCUS_DIRECTORIES),
      });
    } else this.#focus.delete(ownerID);
    this.#schedule();
  }

  /** Directories attached per connection, for diagnostics and tests. */
  attachments(): Record<string, string[]> {
    return Object.fromEntries(
      [...this.#connections].map(([id, state]) => [id, [...state.attached.keys()].toSorted()]),
    );
  }

  async shutdown(): Promise<void> {
    this.#stopped = true;
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#unsubscribe = [];
    if (this.#sweep) clearInterval(this.#sweep);
    this.#sweep = null;
    await this.#queue;
    await Promise.all([...this.#connections.keys()].map((id) => this.#drop(id)));
  }

  /** Resolves once pending changes are applied. */
  settled(): Promise<void> {
    return this.#queue;
  }

  #handleEvent(event: OpenCodeEvent, status: OpenCodeRuntimeStatus): void {
    const state = this.#connections.get(status.connectionID);
    if (!state) return;
    if (event.type === "permission.asked") {
      this.#autoApprove(status.connectionID, event.data);
      return;
    }
    if (event.type === "session.created") {
      // Attach before the task's first turn starts: a new worktree's first step would otherwise
      // run without the tools. Subagents share their task's attachments.
      if (event.data.parentID) return;
      const directory = event.data.location.directory;
      const known = state.attached.has(directory);
      state.recent.set(
        directory,
        Math.max(state.recent.get(directory) ?? 0, this.#now() + RECENT_MS),
      );
      if (!known) this.#schedule();
      return;
    }
    if (event.type === "session.execution.started") {
      const sessionID = event.data.sessionID;
      const directory = event.location?.directory;
      if (directory) {
        state.running.set(sessionID, directory);
        this.#schedule();
        return;
      }
      void this.#options.runtime
        .scopedConnection(status.connectionID)
        .withClient((client) => client.session.get({ sessionID }))
        .then((session) => {
          if (this.#connections.get(status.connectionID) !== state) return;
          state.running.set(sessionID, session.location.directory);
          this.#schedule();
        })
        .catch(() => undefined);
    } else if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      const directory = state.running.get(event.data.sessionID);
      if (!directory) return;
      state.running.delete(event.data.sessionID);
      state.recent.set(directory, this.#now() + RECENT_MS);
    }
  }

  /**
   * Tasks keep the rules they were created with, so OpenCode can still ask for a scheduling tool
   * the user no longer wants to approve: Full access tasks from before Palot's tools allowed
   * them, or any task once "Ask before agents schedule tasks" is off. Approve those once.
   */
  #autoApprove(connectionID: string, request: { id: string; sessionID: string; action: string }) {
    const tool = palotToolName(request.action);
    if (!tool || PALOT_TOOL_APPROVALS[tool] !== "ask") return;
    const ask = this.#options.askBeforeScheduling?.() ?? true;
    void this.#options.runtime
      .scopedConnection(connectionID)
      .withClient(async (client) => {
        if (ask) {
          const session = await client.session.get({ sessionID: request.sessionID });
          if (!isFullAccessRuleset(session.permissions)) return;
        }
        await client.permission.reply({
          sessionID: request.sessionID,
          requestID: request.id,
          decision: "once",
        });
      })
      .catch((error) => {
        palotToolsLog.warn("could not approve a Palot tool call", { error: String(error) });
      });
  }

  #expire(): void {
    const now = this.#now();
    let changed = false;
    for (const state of this.#connections.values()) {
      for (const [directory, until] of state.recent) {
        if (until > now) continue;
        state.recent.delete(directory);
        changed = true;
      }
    }
    if (changed) this.#schedule();
  }

  #schedule(): void {
    if (this.#stopped || this.#scheduled) return;
    this.#scheduled = true;
    this.#queue = this.#queue
      .then(() => {
        this.#scheduled = false;
        return this.#reconcile();
      })
      .catch((error) => {
        palotToolsLog.warn("could not update Palot tool attachments", { error: String(error) });
      });
  }

  async #reconcile(): Promise<void> {
    if (this.#stopped) return;
    const eligible = new Map(
      this.#options.runtime
        .listRuntimes()
        .filter(
          (status) =>
            (this.#options.enabled?.() ?? true) &&
            status.connected &&
            supportsClientHostedMcp(status.version),
        )
        .map((status) => [status.connectionID, status]),
    );
    for (const connectionID of this.#connections.keys()) {
      if (!eligible.has(connectionID)) await this.#drop(connectionID);
    }
    for (const status of eligible.values()) {
      await this.#reconcileConnection(status).catch((error) => {
        palotToolsLog.warn("could not attach Palot tools", {
          connectionID: status.connectionID,
          error: String(error),
        });
      });
    }
  }

  async #reconcileConnection(status: OpenCodeRuntimeStatus): Promise<void> {
    const { runtime } = this.#options;
    let state = this.#connections.get(status.connectionID);
    if (!state) {
      const scoped = runtime.scopedConnection(status.connectionID);
      const scheduling: PalotSchedulingState = palotSchedulingState();
      state = {
        profileID: status.profileID,
        endpoint: null,
        attached: new Map(),
        running: new Map(),
        recent: new Map(),
        seeded: false,
        context: {
          profileID: status.profileID,
          withClient: (operation) => scoped.withClient(operation),
          onEvent: (observer) => scoped.onEvent(observer),
          automations: this.#options.automations,
          triage: this.#options.triage,
          onTriageChanged: this.#options.onTriageChanged,
          timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: this.#now,
          scheduling,
          askBeforeScheduling: () => this.#options.askBeforeScheduling?.() ?? true,
        },
      };
      this.#connections.set(status.connectionID, state);
    }
    if (!state.seeded) {
      // Tasks already running when Palot connected need the tools too.
      const current = state;
      const running = await runtime
        .scopedConnection(status.connectionID)
        .withClient(async (client) => {
          const active = Object.keys(await client.session.active());
          const sessions = await Promise.all(
            active.map((sessionID) => client.session.get({ sessionID }).catch(() => null)),
          );
          return sessions.flatMap((session) => (session ? [session] : []));
        });
      if (this.#connections.get(status.connectionID) !== current) return;
      for (const session of running) current.running.set(session.id, session.location.directory);
      current.seeded = true;
    }

    const now = this.#now();
    const desired = new Set<string>([
      ...[...this.#focus.values()]
        .filter((focus) => focus.connectionID === status.connectionID)
        .flatMap((focus) => focus.directories),
      ...state.running.values(),
      ...[...state.recent].flatMap(([directory, until]) => (until > now ? [directory] : [])),
    ]);

    const { endpoint, headers } = await runtime.requestConnection({
      connectionID: status.connectionID,
    });
    if (this.#connections.get(status.connectionID) !== state || this.#stopped) return;
    // A restarted service can move to a new port or credentials; reattach everything.
    const key = JSON.stringify([endpoint.url, headers ?? null]);
    if (state.endpoint !== key) {
      await closeAll(state.attached);
      state.endpoint = key;
    }
    for (const [directory, attachment] of state.attached) {
      if (desired.has(directory)) continue;
      state.attached.delete(directory);
      await closeAttachment(attachment);
    }
    for (const directory of desired) {
      if (state.attached.has(directory)) continue;
      const abort = new AbortController();
      const connection = this.#options.connect({
        url: endpoint.url,
        name: PALOT_TOOL_SERVER,
        directory,
        ...(headers ? { headers } : {}),
        tools: palotTools({ ...state.context, signal: abort.signal }),
      });
      state.attached.set(directory, { connection, abort });
    }
  }

  async #drop(connectionID: string): Promise<void> {
    const state = this.#connections.get(connectionID);
    if (!state) return;
    this.#connections.delete(connectionID);
    await closeAll(state.attached);
  }
}

async function closeAll(attached: Map<string, Attachment>): Promise<void> {
  const attachments = [...attached.values()];
  attached.clear();
  await Promise.allSettled(attachments.map(closeAttachment));
}

async function closeAttachment(attachment: Attachment): Promise<void> {
  // The socket closing does not cancel running handlers; end their waits first.
  attachment.abort.abort();
  await attachment.connection.close();
}
