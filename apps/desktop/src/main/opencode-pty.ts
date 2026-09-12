import type { OpenCodeClient } from "@opencode/client";
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type {
  CreateSessionPtyInput,
  PalotPty,
  PreparePtyConnectionInput,
  PtyTransportEvent,
} from "../shared";
import { IPC_CHANNELS } from "../shared";

interface PtyRuntime {
  withClient<T>(operation: (client: OpenCodeClient, remote: boolean) => Promise<T>): Promise<T>;
  requestConnection(): Promise<{ endpoint: { url: string } }>;
}

const defaultRuntime: PtyRuntime = {
  withClient: async (operation) =>
    (await import("./opencode-runtime")).openCodeRuntime.withClient((client, status) =>
      operation(client, status.topology === "remote-machine"),
    ),
  requestConnection: async () =>
    (await import("./opencode-runtime")).openCodeRuntime.requestConnection(),
};

const location = (input: PreparePtyConnectionInput["location"]) => ({
  directory: input.directory,
  ...(input.workspaceID ? { workspace: input.workspaceID } : {}),
});

export async function createSessionPty(
  input: CreateSessionPtyInput,
  runtime: PtyRuntime = defaultRuntime,
): Promise<PalotPty> {
  return runtime.withClient(async (client, remote) => {
    const createServerTerminal = async (): Promise<PalotPty> => {
      const response = await client.pty.create({
        location: location(input.location),
        cwd: input.location.directory,
        title: "Terminal",
      });
      return {
        id: response.data.id,
        title: response.data.title,
        status: response.data.status,
        transport: "legacy",
      };
    };
    // Remote hosts choose their own shell and environment, never this Mac's defaults.
    if (remote) return createServerTerminal();
    try {
      const shell =
        process.platform === "win32"
          ? process.env.COMSPEC || "cmd.exe"
          : process.env.SHELL || "/bin/sh";
      const pty = await client.experimental.persistentPty.create({
        sessionID: input.sessionID,
        command: shell,
        args: process.platform === "win32" ? [] : ["-l"],
        cwd: input.location.directory,
        title: "Terminal",
        env: {
          TERM: process.env.TERM || "xterm-256color",
          COLORTERM: process.env.COLORTERM || "truecolor",
        },
      });
      return { id: pty.id, title: pty.title, status: pty.status, transport: "persistent" };
    } catch (error) {
      if (!persistentPtyUnavailable(error)) throw error;
      return createServerTerminal();
    }
  });
}

export async function preparePtyConnection(
  input: PreparePtyConnectionInput,
  runtime: PtyRuntime = defaultRuntime,
): Promise<{ url: string; expiresAt: number }> {
  const [ticket, connection] = await Promise.all([
    runtime.withClient(async (client) => {
      if (input.transport === "persistent") {
        return client.experimental.persistentPty.connectToken({
          ptyID: input.ptyID,
          "x-opencode-ticket": "1",
        });
      }
      const response = await client.pty.connect.token({
        ptyID: input.ptyID,
        location: location(input.location),
        "x-opencode-ticket": "1",
      });
      return response.data;
    }),
    runtime.requestConnection(),
  ]);
  const url = new URL(
    input.transport === "persistent"
      ? `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect`
      : `/api/pty/${encodeURIComponent(input.ptyID)}/connect`,
    connection.endpoint.url,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (input.transport === "legacy") {
    url.searchParams.set("location[directory]", input.location.directory);
    if (input.location.workspaceID) {
      url.searchParams.set("location[workspace]", input.location.workspaceID);
    }
  } else {
    url.searchParams.set("role", input.readOnly ? "observer" : "controller");
    url.searchParams.set("takeover", input.readOnly ? "false" : "true");
    url.searchParams.set("input_protocol", "1");
  }
  url.searchParams.set("cursor", String(input.cursor));
  url.searchParams.set("ticket", ticket.ticket);
  return {
    url: url.href,
    expiresAt: Date.now() + ticket.expires_in * 1_000,
  };
}

function persistentPtyUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: { status?: unknown; code?: unknown; message?: unknown };
  };
  const status = value.status ?? value.code ?? value.cause?.status ?? value.cause?.code;
  if (status === 404 || status === 503 || status === "404" || status === "503") return true;
  const message = [value.message, value.cause?.message]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return /(?:persistent\s+pty|daemon).*(?:unavailable|unsupported|not found)|daemon unavailable/i.test(
    message,
  );
}

interface PtyConnection {
  readOnly: boolean;
  ownerID: number;
  url: string;
  expiresAt: number;
  socket: WebSocket | null;
  startTimer: ReturnType<typeof setTimeout>;
  transport: PreparePtyConnectionInput["transport"];
  cursor: number;
  decoder: TextDecoder;
}

const MAX_CONNECTIONS_PER_RENDERER = 8;
const START_TIMEOUT_MS = 10_000;

export class PtyTransport {
  private generation = 0;
  private readonly connections = new Map<string, PtyConnection>();
  private readonly observedSenders = new WeakSet<WebContents>();

  constructor(
    private readonly prepare: typeof preparePtyConnection = preparePtyConnection,
    private readonly createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly startTimeoutMs = START_TIMEOUT_MS,
  ) {}

  async connect(
    sender: WebContents,
    input: PreparePtyConnectionInput,
    runtime?: PtyRuntime,
  ): Promise<string> {
    const generation = this.generation;
    this.observe(sender);
    const active = [...this.connections.values()].filter(
      (connection) => connection.ownerID === sender.id,
    ).length;
    if (active >= MAX_CONNECTIONS_PER_RENDERER) {
      throw new Error("Too many terminal connections are open");
    }
    const target = await this.prepare(input, runtime);
    if (generation !== this.generation)
      throw new Error("OpenCode profile changed while connecting terminal");
    if (sender.isDestroyed()) throw new Error("Terminal renderer is unavailable");
    const connectionID = randomUUID();
    const connection: PtyConnection = {
      readOnly: input.readOnly === true,
      ownerID: sender.id,
      url: target.url,
      expiresAt: target.expiresAt,
      socket: null,
      startTimer: setTimeout(() => this.expire(connectionID), this.startTimeoutMs),
      transport: input.transport,
      cursor: Math.max(0, input.cursor),
      decoder: new TextDecoder(),
    };
    this.connections.set(connectionID, connection);
    return connectionID;
  }

  start(sender: WebContents, connectionID: string): void {
    const connection = this.owned(sender, connectionID);
    if (connection.socket) return;
    if (connection.expiresAt <= Date.now()) {
      this.connections.delete(connectionID);
      clearTimeout(connection.startTimer);
      throw new Error("Terminal connection token expired");
    }
    clearTimeout(connection.startTimer);
    const socket = this.createSocket(connection.url);
    connection.socket = socket;
    socket.binaryType = "arraybuffer";
    const active = () => this.connections.get(connectionID) === connection;
    socket.addEventListener("open", () => {
      if (active()) this.send(sender, { connectionID, type: "open" });
    });
    socket.addEventListener("message", (event) => {
      if (!active()) return;
      if (connection.transport === "persistent") {
        this.forwardPersistentMessage(sender, connectionID, connection, event.data);
        return;
      }
      const data = normalizeSocketData(event.data);
      if (data !== null) this.send(sender, { connectionID, type: "data", data });
    });
    socket.addEventListener("error", () => {
      if (!active()) return;
      this.send(sender, {
        connectionID,
        type: "error",
        message: "Terminal connection failed",
      });
    });
    socket.addEventListener("close", (event) => {
      if (!active()) return;
      this.connections.delete(connectionID);
      this.send(sender, { connectionID, type: "close", code: event.code });
    });
  }

  write(
    sender: WebContents,
    connectionID: string,
    data: string,
    size: { cols: number; rows: number },
    control = false,
  ): void {
    const connection = this.owned(sender, connectionID);
    if (
      connection.readOnly ||
      !connection.socket ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      return;
    if (control && connection.transport === "legacy") return;
    connection.socket.send(
      connection.transport === "persistent" ? persistentInputFrame(data, size, control) : data,
    );
  }

  disconnect(sender: WebContents, connectionID: string): void {
    const connection = this.connections.get(connectionID);
    if (!connection || connection.ownerID !== sender.id) return;
    this.connections.delete(connectionID);
    clearTimeout(connection.startTimer);
    connection.socket?.close(1000);
  }

  closeAll(): void {
    this.generation += 1;
    for (const connection of this.connections.values()) {
      clearTimeout(connection.startTimer);
      connection.socket?.close(1001, "OpenCode profile changed");
    }
    this.connections.clear();
  }

  private owned(sender: WebContents, connectionID: string): PtyConnection {
    const connection = this.connections.get(connectionID);
    if (!connection || connection.ownerID !== sender.id) {
      throw new Error("Terminal connection is unavailable");
    }
    return connection;
  }

  private observe(sender: WebContents): void {
    if (this.observedSenders.has(sender)) return;
    this.observedSenders.add(sender);
    sender.once("destroyed", () => {
      for (const [connectionID, connection] of this.connections) {
        if (connection.ownerID !== sender.id) continue;
        this.connections.delete(connectionID);
        clearTimeout(connection.startTimer);
        connection.socket?.close(1000);
      }
    });
  }

  private expire(connectionID: string): void {
    const connection = this.connections.get(connectionID);
    if (!connection || connection.socket) return;
    this.connections.delete(connectionID);
  }

  private send(sender: WebContents, event: PtyTransportEvent): void {
    if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.ptyEvents, event);
  }

  private forwardPersistentMessage(
    sender: WebContents,
    connectionID: string,
    connection: PtyConnection,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      try {
        const event = JSON.parse(value) as {
          type?: string;
          replay?: { availableOffset?: number };
          endOffset?: number;
          finalOffset?: number;
          message?: string;
        };
        if (event.type === "attached" && Number.isSafeInteger(event.replay?.availableOffset)) {
          connection.cursor = event.replay!.availableOffset!;
        }
        if (event.type === "replay_complete" && Number.isSafeInteger(event.endOffset)) {
          connection.cursor = event.endOffset!;
          this.send(sender, { connectionID, type: "data", data: cursorFrame(connection.cursor) });
        }
        if (event.type === "exited" && Number.isSafeInteger(event.finalOffset)) {
          connection.cursor = event.finalOffset!;
          this.send(sender, { connectionID, type: "data", data: cursorFrame(connection.cursor) });
        }
        if (event.type === "error") {
          this.send(sender, {
            connectionID,
            type: "error",
            message: event.message || "Terminal connection failed",
          });
        }
        return;
      } catch {
        this.send(sender, { connectionID, type: "data", data: value });
        return;
      }
    }
    const data = normalizeSocketData(value);
    if (!(data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(data);
    connection.cursor += bytes.byteLength;
    const text = connection.decoder.decode(bytes, { stream: true });
    if (text) this.send(sender, { connectionID, type: "data", data: text });
    this.send(sender, { connectionID, type: "data", data: cursorFrame(connection.cursor) });
  }
}

function normalizeSocketData(value: unknown): string | ArrayBuffer | null {
  if (typeof value === "string" || value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return null;
}

function cursorFrame(cursor: number): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify({ cursor }));
  const frame = new Uint8Array(payload.byteLength + 1);
  frame[0] = 0;
  frame.set(payload, 1);
  return frame.buffer;
}

function persistentInputFrame(
  data: string,
  size: { cols: number; rows: number },
  control: boolean,
): Uint8Array {
  const payload = new TextEncoder().encode(data);
  const frame = new Uint8Array(payload.byteLength + 5);
  const view = new DataView(frame.buffer);
  frame[0] = control ? 0 : 1;
  view.setUint16(1, size.cols);
  view.setUint16(3, size.rows);
  frame.set(payload, 5);
  return frame;
}

export const ptyTransport = new PtyTransport();
