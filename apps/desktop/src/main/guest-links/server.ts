import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  GuestLinksState,
  GuestPendingMessage,
  GuestShare,
  GuestTarget,
  GuestTranscript,
} from "../../shared/guest-links-contract";
import html from "./page.html?raw";
import javascript from "./page.js?raw";
import css from "./page.css?raw";

export interface GuestSource {
  snapshot(): Promise<GuestTranscript>;
  subscribe(changed: () => void, revoked: () => void): () => void;
  send(text: string, id: string): Promise<void>;
}
interface ShareState {
  info: GuestShare;
  token: string;
  source: GuestSource;
  snapshot: GuestTranscript;
  streams: Set<ServerResponse>;
  dispose: () => void;
  timer?: ReturnType<typeof setTimeout>;
  refresh?: ReturnType<typeof setTimeout>;
  refreshing: boolean;
  dirty: boolean;
}
interface Submission {
  message: GuestPendingMessage;
  receipt: string;
  status: "pending" | "sent" | "dismissed";
}

/** No OpenCode proxy, renderer bridge, attachments, or filesystem endpoints live here. */
export class GuestLinksServer {
  private server?: Server;
  private starting?: Promise<void>;
  private port = 0;
  private enabled = false;
  private shares = new Map<string, ShareState>();
  private submissions = new Map<string, Submission>();
  private requests = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly changed: () => void = () => {},
    private readonly now = Date.now,
  ) {}

  state(): GuestLinksState {
    return {
      enabled: this.enabled,
      shares: [...this.shares.values()].map((s) => s.info),
      pending: [...this.submissions.values()]
        .filter((s) => s.status === "pending")
        .map((s) => s.message),
    };
  }
  published(id: string, url: string) {
    const share = this.shares.get(id);
    if (!share || this.expired(share)) throw new Error("Guest link ended while publishing");
    share.info.publishedUrl = url;
    this.changed();
  }
  async enable(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) await this.stop();
    this.changed();
  }
  async create(target: GuestTarget, hours: 1 | 24 | 168 | null, source: GuestSource) {
    if (!this.enabled) throw new Error("Enable Guest links (beta) in Settings first");
    if (this.shares.size >= 16)
      throw new Error("Stop another guest link first (16 active links maximum)");
    const snapshot = await source.snapshot();
    if (!this.enabled) throw new Error("Guest links are disabled");
    await this.listen();
    // Recheck after asynchronous startup. No listener should survive a disabled feature.
    if (!this.enabled) {
      await this.closeIfEmpty();
      throw new Error("Guest links are disabled");
    }
    for (const share of this.shares.values()) {
      if (
        share.info.connectionID === target.connectionID &&
        share.info.sessionID === target.sessionID
      )
        return share.info;
    }
    if (this.shares.size >= 16) throw new Error("Stop another guest link first");
    const token = randomBytes(24).toString("base64url");
    const info: GuestShare = {
      connectionID: target.connectionID,
      sessionID: target.sessionID,
      id: randomUUID(),
      localUrl: `http://127.0.0.1:${this.port}/g/${token}/`,
      expiresAt: hours === null ? null : this.now() + hours * 3600000,
    };
    const share: ShareState = {
      info,
      token,
      source,
      snapshot,
      streams: new Set(),
      dispose: () => {},
      refreshing: false,
      dirty: false,
    };
    this.shares.set(info.id, share);
    try {
      share.dispose = source.subscribe(
        () => this.scheduleRefresh(share),
        () => {
          void this.revoke(info.id);
        },
      );
      // Subscribe then refresh to cover events between initial read and subscription.
      this.scheduleRefresh(share);
      if (hours !== null)
        share.timer = setTimeout(() => {
          void this.revoke(info.id);
        }, hours * 3600000);
    } catch (error) {
      await this.revoke(info.id);
      throw error;
    }
    this.changed();
    return info;
  }
  async revoke(id: string) {
    const share = this.shares.get(id);
    if (!share) return;
    this.shares.delete(id);
    clearTimeout(share.timer);
    clearTimeout(share.refresh);
    share.dispose();
    for (const response of share.streams) {
      response.end("event: revoked\ndata: {}\n\n");
    }
    for (const [key, submission] of this.submissions)
      if (submission.message.shareID === id) this.submissions.delete(key);
    this.changed();
    await this.closeIfEmpty();
  }
  async decide(id: string, approve: boolean) {
    const submission = this.submissions.get(id);
    if (!submission || submission.status !== "pending" || submission.message.sending)
      throw new Error("Guest message is no longer pending");
    const share = this.shares.get(submission.message.shareID);
    if (!share || this.expired(share)) throw new Error("Guest link ended");
    if (!approve) {
      submission.status = "dismissed";
      this.changed();
      return;
    }
    submission.message.sending = true;
    this.changed();
    try {
      await share.source.send(
        `Guest message from ${submission.message.name} (unverified):\n\n${submission.message.text}`,
        `msg_guest_${submission.message.id.replaceAll("-", "")}`,
      );
      submission.status = "sent";
    } finally {
      submission.message.sending = false;
      this.changed();
    }
  }
  async stop() {
    await Promise.all([...this.shares.keys()].map((id) => this.revoke(id)));
    await this.starting;
    await this.closeIfEmpty();
  }
  private expired(share: ShareState) {
    return share.info.expiresAt !== null && this.now() >= share.info.expiresAt;
  }
  private async listen() {
    if (this.starting) return this.starting;
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      });
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxConnections = 128;
    this.server = server;
    this.starting = new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Guest listener unavailable"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
    try {
      await this.starting;
    } catch (error) {
      this.server = undefined;
      server.close();
      throw error;
    } finally {
      this.starting = undefined;
    }
  }
  private async closeIfEmpty() {
    if (this.shares.size || !this.server || this.starting) return;
    const server = this.server;
    this.server = undefined;
    this.requests.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  private scheduleRefresh(share: ShareState) {
    share.dirty = true;
    if (share.refresh || share.refreshing || !this.shares.has(share.info.id)) return;
    share.refresh = setTimeout(() => {
      share.refresh = undefined;
      void this.refresh(share);
    }, 150);
  }
  private async refresh(share: ShareState) {
    share.refreshing = true;
    share.dirty = false;
    try {
      share.snapshot = await share.source.snapshot();
    } catch {
      share.snapshot = { ...share.snapshot, status: "offline" };
    }
    share.refreshing = false;
    if (!this.shares.has(share.info.id)) return;
    for (const response of share.streams) this.writeSnapshot(share, response);
    if (share.dirty) this.scheduleRefresh(share);
  }
  private writeSnapshot(share: ShareState, response: ServerResponse) {
    // A slow reader must not accumulate unbounded main-process buffers.
    if (response.writableLength > 1024 * 1024) {
      response.destroy();
      return;
    }
    response.write(`event: snapshot\ndata: ${JSON.stringify(share.snapshot)}\n\n`);
  }
  private admit(key: string, limit: number) {
    const now = this.now();
    const current = this.requests.get(key);
    if (!current || now - current.start >= 60000) {
      // Bound cardinality even with attacker-controlled paths/headers.
      if (this.requests.size >= 1024)
        for (const [id, entry] of this.requests)
          if (now - entry.start >= 60000) this.requests.delete(id);
      if (this.requests.size >= 1024) return false;
      this.requests.set(key, { start: now, count: 1 });
      return true;
    }
    return ++current.count <= limit;
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const end = (code: number, text = "Guest link unavailable") => {
      res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(text);
    };
    if (!this.admit("all", 1800)) return end(429, "Too many requests");
    if ((req.url?.length ?? 0) > 512) return end(414);
    const match =
      /^\/g\/([A-Za-z0-9_-]{32})\/(|page\.js|page\.css|events|messages(?:\/[A-Za-z0-9_-]{32})?)$/.exec(
        req.url ?? "",
      );
    const share = match && [...this.shares.values()].find((s) => s.token === match[1]);
    if (!share || !this.enabled) return end(404);
    if (this.expired(share)) {
      await this.revoke(share.info.id);
      if (!res.destroyed) end(404);
      return;
    }
    if (!this.admit(share.info.id, 300)) return end(429, "Too many requests");
    const endpoint = match![2]!;
    // No CORS, no cookies, and mutations require a non-simple JSON request. Do not trust
    // forwarded headers or loopback peers: public relays connect from loopback too.
    if (
      req.method !== "POST" &&
      (req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) > 0)
    )
      return end(413);
    if (req.method === "GET" && ["", "page.js", "page.css"].includes(endpoint)) {
      const asset =
        endpoint === ""
          ? ["text/html", html]
          : endpoint === "page.js"
            ? ["text/javascript", javascript]
            : ["text/css", css];
      res.writeHead(200, { "Content-Type": `${asset[0]}; charset=utf-8` });
      res.end(asset[1]);
      return;
    }
    if (req.method === "GET" && endpoint === "events") {
      if (share.streams.size >= 8) return end(429, "Too many viewers");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      share.streams.add(res);
      this.writeSnapshot(share, res);
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        share.streams.delete(res);
      });
      return;
    }
    if (req.method === "POST" && endpoint === "messages") {
      if (req.headers["content-type"] !== "application/json") return end(415);
      if (!this.admit(`post:${share.info.id}`, 10)) return end(429, "Too many messages");
      if (
        [...this.submissions.values()].filter((s) => s.message.shareID === share.info.id).length >=
          200 ||
        this.state().pending.length >= 100
      )
        return end(429, "Owner inbox is full");
      let bytes = 0;
      const chunks: Buffer[] = [];
      if (Number(req.headers["content-length"] ?? 0) > 18000) return end(413);
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 18000) {
          end(413);
          return;
        }
        chunks.push(chunk);
      }
      if (!this.shares.has(share.info.id) || this.expired(share)) return end(404);
      if (this.state().pending.length >= 100) return end(429, "Owner inbox is full");
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return end(400);
      }
      if (!input || typeof input !== "object") return end(400);
      const { name, text } = input as Record<string, unknown>;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 80 ||
        [...name].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 4000
      )
        return end(400);
      const message: GuestPendingMessage = {
        ...share.info,
        id: randomUUID(),
        shareID: share.info.id,
        name: name.trim(),
        text: text.trim(),
        sending: false,
      };
      // Receipt is a separate capability. Other viewers cannot enumerate submissions.
      const receipt = randomBytes(24).toString("base64url");
      this.submissions.set(message.id, { message, receipt, status: "pending" });
      this.changed();
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ receipt }));
      return;
    }
    if (req.method === "GET" && endpoint.startsWith("messages/")) {
      const submission = [...this.submissions.values()].find(
        (s) => s.message.shareID === share.info.id && s.receipt === endpoint.slice(9),
      );
      if (!submission) return end(404);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: submission.status }));
      return;
    }
    end(405);
  }
}
