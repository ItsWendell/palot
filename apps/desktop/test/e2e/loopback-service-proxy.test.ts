// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createServer, request, type RequestListener } from "node:http";
import { startLoopbackServiceProxy } from "./loopback-service-proxy";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const proxy = await startLoopbackServiceProxy({
    url: `http://127.0.0.1:${address.port}`,
    auth: { type: "basic", username: "fixture", password: "fixture-only-password" },
  });
  cleanup.push(proxy.close);
  return proxy;
}

describe("loopback service proxy", () => {
  it("forwards method, path, body, status and service auth without exposing credentials", async () => {
    const proxy = await fixture(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      expect(req.headers.authorization).toBe(
        `Basic ${Buffer.from("fixture:fixture-only-password").toString("base64")}`,
      );
      expect(req.headers["proxy-authorization"]).toBeUndefined();
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    const response = await fetch(`${proxy.url}/api/session?limit=2`, {
      method: "POST",
      headers: { authorization: "ignored", "proxy-authorization": "ignored" },
      body: "fixture body",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      method: "POST",
      path: "/api/session?limit=2",
      body: "fixture body",
    });
    expect(response.headers.get("authorization")).toBeNull();
  });

  it("streams SSE before completion and closes active streams during cleanup", async () => {
    let disconnected!: () => void;
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const proxy = await fixture((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"server.connected"}\n\n');
      res.on("close", disconnected);
    });
    const response = await fetch(`${proxy.url}/api/event`);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("server.connected");
    cleanup.pop();
    await proxy.close();
    await closed;
    await expect(reader.read()).rejects.toThrow();
  });

  it("rejects arbitrary forwarding and non-loopback upstreams", async () => {
    let calls = 0;
    const proxy = await fixture((_req, res) => {
      calls++;
      res.end();
    });
    for (const path of ["http://example.invalid/api/health", "//example.invalid/api/health"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(proxy.url, { path }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(400);
    }
    expect(calls).toBe(0);
    await expect(startLoopbackServiceProxy({ url: "http://example.invalid" })).rejects.toThrow(
      "loopback",
    );
  });
});
