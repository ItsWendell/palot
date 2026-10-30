import { timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AutomationRecord } from "../../shared";

export const WEBHOOK_BODY_LIMIT = 32_768;
const WINDOW_MS = 60_000;

/** No CORS, redirects, public bind, or request logging. URL is a bearer capability. */
export class AutomationWebhookServer {
  private server: Server | null = null;
  private window = 0;
  private requests = 0;
  private perAutomation = new Map<string, number>();
  address: string | null = null;

  constructor(
    private readonly options: {
      definitions(): AutomationRecord[];
      accept(
        record: AutomationRecord,
        payload: Record<string, unknown>,
        deliveryID: string | null,
      ): Promise<string>;
      changed(): void;
    },
  ) {}

  async refresh(): Promise<void> {
    const enabled = this.options
      .definitions()
      .some((record) => record.status === "active" && record.trigger.type === "webhook");
    if (!enabled) {
      await this.close();
      return;
    }
    if (this.server) return;
    const server = createServer((request, response) => {
      const reply = (status: number, result: string) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          connection: "close",
        });
        response.end(JSON.stringify({ result }));
      };
      void (async () => {
        if (Date.now() - this.window >= WINDOW_MS) {
          this.window = Date.now();
          this.requests = 0;
          this.perAutomation.clear();
        }
        if (++this.requests > 120) return reply(429, "rate_limited");
        // Refuse browser-origin requests and DNS-rebinding Host values, even with a token.
        if (request.headers.origin || request.headers.host !== new URL(this.address!).host)
          return reply(403, "forbidden");
        if (request.method !== "POST") return reply(405, "post_required");
        const match = request.url?.match(/^\/hooks\/([^/?]+)\/([a-f0-9]{64})$/);
        const record = match
          ? this.options.definitions().find((item) => item.id === match[1])
          : undefined;
        if (
          !record ||
          record.status !== "active" ||
          record.trigger.type !== "webhook" ||
          !match ||
          !timingSafeEqual(Buffer.from(record.trigger.token), Buffer.from(match[2]!))
        )
          return reply(404, "not_found");
        const count = (this.perAutomation.get(record.id) ?? 0) + 1;
        this.perAutomation.set(record.id, count);
        if (count > 10) return reply(429, "rate_limited");
        if (
          request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return reply(415, "json_required");
        const body = await readBody(request);
        if (body === null) return reply(413, "body_too_large");
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return reply(400, "invalid_json");
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          return reply(400, "object_required");
        const key = request.headers["idempotency-key"];
        const deliveryID = typeof key === "string" && key.length <= 200 ? key : null;
        const result = await this.options.accept(
          record,
          payload as Record<string, unknown>,
          deliveryID,
        );
        reply(202, result);
      })()
        .catch(() => reply(503, "unavailable"))
        .finally(() => request.resume());
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxConnections = 16;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Webhook loopback bind failed");
    this.address = `http://127.0.0.1:${address.port}`;
    this.options.changed();
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    this.options.changed();
  }
}

function readBody(request: IncomingMessage): Promise<string | null> {
  if (Number(request.headers["content-length"] ?? 0) > WEBHOOK_BODY_LIMIT)
    return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > WEBHOOK_BODY_LIMIT) {
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () =>
      resolve(length > WEBHOOK_BODY_LIMIT ? null : Buffer.concat(chunks).toString("utf8")),
    );
    request.on("error", reject);
  });
}
