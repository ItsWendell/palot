// @vitest-environment node

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { OpenCodeRequestProxy } from "./opencode-request-proxy";

const sender = { id: 7 };

function input(path = "/api/health") {
  return {
    id: "request-1",
    rendererStartedAt: Date.now(),
    path,
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: "Bearer renderer-secret",
      cookie: "renderer-cookie",
      origin: "https://evil.example",
    },
    body: null,
  };
}

describe("OpenCodeRequestProxy", () => {
  it("rejects a response when its retained generation was invalidated during fetch", async () => {
    let current = true;
    const proxy = new OpenCodeRequestProxy({
      connection: async () => ({
        endpoint: { url: "https://background.example" },
        headers: undefined,
        validate: () => {
          if (!current) throw new Error("disposed generation");
        },
      }),
      fetch: async () => {
        current = false;
        return new Response("stale result");
      },
    });
    await expect(proxy.request(sender, { ...input(), connectionID: "old" })).rejects.toThrow(
      "disposed generation",
    );
  });
  it("passes the exact profile and generation to resolution and never retries focus on rejection", async () => {
    const connection = vi.fn(async (target: { profileID?: string; connectionID?: string }) => {
      if (target.profileID !== "background" || target.connectionID !== "current")
        throw new Error("stale generation");
      return {
        endpoint: { url: "https://background.example" },
        headers: { authorization: "Bearer main-only" },
      };
    });
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response("ok"));
    const proxy = new OpenCodeRequestProxy({ connection, fetch });
    await proxy.request(sender, { ...input(), profileID: "background", connectionID: "current" });
    expect(fetch.mock.calls[0]![0].origin).toBe("https://background.example");
    expect(new Headers(fetch.mock.calls[0]![1].headers).get("authorization")).toBe(
      "Bearer main-only",
    );
    await expect(
      proxy.request(sender, { ...input(), profileID: "background", connectionID: "old" }),
    ).rejects.toThrow("stale generation");
    expect(connection).toHaveBeenCalledTimes(2);
    expect(connection).toHaveBeenLastCalledWith({ profileID: "background", connectionID: "old" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("allows arbitrary relative OpenCode paths while owning origin and authentication", async () => {
    const fetch = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const proxy = new OpenCodeRequestProxy({
      connection: async () => ({
        endpoint: { url: "http://127.0.0.1:4096" },
        headers: { authorization: "Basic main-secret" },
      }),
      fetch,
    });

    const response = await proxy.request(sender, input("/api/future/resource?value=1"));

    const [url, init] = fetch.mock.calls[0]!;
    expect(url.href).toBe("http://127.0.0.1:4096/api/future/resource?value=1");
    expect(new Headers(init.headers).get("authorization")).toBe("Basic main-secret");
    expect(new Headers(init.headers).get("x-palot-request-id")).toBe("request-1");
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    expect(new Headers(init.headers).has("origin")).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(response.body!))).toEqual({ ok: true });
    expect(response.timings).toEqual(
      expect.objectContaining({
        rendererToMainMs: expect.any(Number),
        connectionMs: expect.any(Number),
        serviceMs: expect.any(Number),
        responseBodyMs: expect.any(Number),
        mainTotalMs: expect.any(Number),
      }),
    );
  });

  it.each(["https://evil.example/api/health", "//evil.example/api/health"])(
    "rejects renderer-selected origins: %s",
    async (path) => {
      const proxy = new OpenCodeRequestProxy({
        connection: async () => ({
          endpoint: { url: "http://127.0.0.1:4096" },
          headers: undefined,
        }),
        fetch: vi.fn(),
      });

      await expect(proxy.request(sender, input(path))).rejects.toThrow(
        "relative to the connected service",
      );
    },
  );

  it("identifies failures while acquiring the OpenCode connection", async () => {
    const proxy = new OpenCodeRequestProxy({
      connection: vi.fn().mockRejectedValue(new Error("service discovery failed")),
      fetch: vi.fn(),
    });

    await expect(proxy.request(sender, input())).rejects.toThrow(
      "OpenCode request failed during connection: service discovery failed",
    );
  });

  it("forwards a decoded gzip body without stale transport headers", async () => {
    const decoded = JSON.stringify({ payload: "x".repeat(1_024) });
    const encoded = gzipSync(decoded);
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": encoded.byteLength,
        "content-type": "application/json",
      });
      response.end(encoded);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    const proxy = new OpenCodeRequestProxy({
      connection: async () => ({
        endpoint: { url: `http://127.0.0.1:${address.port}` },
        headers: undefined,
      }),
      fetch: (url, init) => fetch(url, init),
    });

    try {
      const response = await proxy.request(sender, input());

      expect(JSON.parse(new TextDecoder().decode(response.body!))).toEqual({
        payload: "x".repeat(1_024),
      });
      expect(response.headers).toMatchObject({ "content-type": "application/json" });
      expect(response.headers).not.toHaveProperty("content-encoding");
      expect(response.headers).not.toHaveProperty("content-length");
      expect(response.headers).not.toHaveProperty("transfer-encoding");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("enforces the response limit against the decoded body", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const proxy = new OpenCodeRequestProxy({
      connection: async () => ({
        endpoint: { url: "http://127.0.0.1:4096" },
        headers: undefined,
      }),
      fetch: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                if (sent >= 65) {
                  controller.close();
                  return;
                }
                sent += 1;
                controller.enqueue(chunk);
              },
            }),
            { headers: { "content-encoding": "gzip", "content-length": "52" } },
          ),
      ),
    });

    await expect(proxy.request(sender, input())).rejects.toThrow(
      "OpenCode request failed during response-body: OpenCode response body is too large",
    );
  });

  it("aborts an active request by renderer and request ID", async () => {
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const proxy = new OpenCodeRequestProxy({
      connection: async () => ({ endpoint: { url: "http://127.0.0.1:4096" }, headers: undefined }),
      fetch,
    });

    const pending = proxy.request(sender, input());
    await Promise.resolve();
    proxy.cancel(sender, "request-1");

    await expect(pending).resolves.toMatchObject({
      status: 499,
      statusText: "Client Closed Request",
      body: null,
    });
  });
});
