// @vitest-environment node
import http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentUploadWriter } from "./attachment-upload";

const servers: http.Server[] = [];
async function server(handler: http.RequestListener) {
  const instance = http.createServer(handler);
  servers.push(instance);
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return `http://127.0.0.1:${address.port}/ignored-base`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (instance) =>
        new Promise<void>((resolve) => {
          instance.closeAllConnections();
          instance.close(() => resolve());
        }),
    ),
  );
});

function input(size: number, signal = new AbortController().signal) {
  return {
    path: "/server/tmp/a #?.bin",
    size,
    signal,
    validate: vi.fn(),
    chunks: (async function* () {
      for (let sent = 0; sent < size; sent += 64 * 1024)
        yield new Uint8Array(Math.min(64 * 1024, size - sent));
    })(),
  };
}

describe("main attachment HTTP upload", () => {
  it.each(["success", "mutation", "abort"] as const)(
    "waits for producer validation after an early HTTP success: %s",
    async (outcome) => {
      const validation = Promise.withResolvers<void>();
      const responseRead = Promise.withResolvers<void>();
      let responded = false;
      const url = await server((request, response) => {
        request.resume();
        request.on("end", () => {
          responded = true;
          response.end(JSON.stringify({ data: { path: "/server/tmp/result" } }));
        });
      });
      const controller = new AbortController();
      let settled = false;
      const upload = attachmentUploadWriter({ endpoint: { url }, validate() {} })({
        ...input(1, controller.signal),
        validate() {
          if (responded) responseRead.resolve();
        },
        chunks: (async function* () {
          yield new Uint8Array([1]);
          await validation.promise;
          if (outcome === "mutation") throw new Error("Selected attachment changed.");
        })(),
      });
      // Observe rejection immediately so a regression never creates an unhandled rejection.
      const result = upload.then(
        (path) => {
          settled = true;
          return { path };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );
      try {
        await responseRead.promise;
        expect(settled).toBe(false);
        if (outcome === "abort") {
          controller.abort(new Error("Cancelled during validation"));
          expect(await result).toMatchObject({ error: { message: "Cancelled during validation" } });
        } else {
          validation.resolve();
          expect(await result).toEqual(
            outcome === "success"
              ? { path: "/server/tmp/result" }
              : { error: new Error("Selected attachment changed.") },
          );
        }
      } finally {
        validation.resolve();
        controller.abort();
        await result;
      }
    },
  );

  it("streams more than 20 MiB in bounded chunks with exact auth, query and progress", async () => {
    let received = 0;
    let largest = 0;
    let captured: http.IncomingMessage | undefined;
    const url = await server((request, response) => {
      captured = request;
      request.on("data", (chunk: Buffer) => {
        received += chunk.length;
        largest = Math.max(largest, chunk.length);
      });
      request.on("end", () =>
        response.end(JSON.stringify({ data: { path: "/server/tmp/a #?.bin" } })),
      );
    });
    const progress = vi.fn();
    const size = 21 * 1024 * 1024 + 3;
    const write = attachmentUploadWriter({
      endpoint: { url },
      headers: { authorization: "Basic test-only" },
      validate() {},
    });
    expect(await write({ ...input(size), onProgress: progress })).toBe("/server/tmp/a #?.bin");
    expect(received).toBe(size);
    expect(largest).toBeLessThanOrEqual(64 * 1024);
    expect(captured?.method).toBe("POST");
    expect(captured?.url).toBe("/api/experimental/fs/write?path=%2Fserver%2Ftmp%2Fa+%23%3F.bin");
    expect(captured?.headers.authorization).toBe("Basic test-only");
    expect(captured?.headers["content-length"]).toBe(String(size));
    expect(progress.mock.calls[0]).toEqual([0]);
    expect(progress.mock.calls.at(-1)).toEqual([size]);
  });

  it("aborts streaming without consuming the remaining file", async () => {
    const url = await server((request) => request.resume());
    const controller = new AbortController();
    const write = attachmentUploadWriter({ endpoint: { url }, validate() {} });
    await expect(
      write({
        ...input(30 * 1024 * 1024, controller.signal),
        onProgress: (loaded) => {
          if (loaded) controller.abort();
        },
      }),
    ).rejects.toThrow();
  });

  it.each([302, 401, 500])(
    "rejects HTTP %s without following redirects or exposing response bodies",
    async (status) => {
      let requests = 0;
      const url = await server((request, response) => {
        requests++;
        request.resume();
        response.writeHead(status, { location: "/secret" });
        response.end("secret response");
      });
      const write = attachmentUploadWriter({ endpoint: { url }, validate() {} });
      await expect(write(input(0))).rejects.toThrow(`status ${status}`);
      expect(requests).toBe(1);
    },
  );

  it.each(["not JSON", JSON.stringify({ data: {} }), "x".repeat(70 * 1024)])(
    "rejects invalid or oversized response %#",
    async (body) => {
      const url = await server((request, response) => {
        request.resume();
        request.on("end", () => response.end(body));
      });
      await expect(
        attachmentUploadWriter({ endpoint: { url }, validate() {} })(input(0)),
      ).rejects.toThrow();
    },
  );

  it("validates connection ownership before sending any request", async () => {
    const url = await server(() => {
      throw new Error("Must not send");
    });
    const write = attachmentUploadWriter({
      endpoint: { url },
      validate() {
        throw new Error("stale");
      },
    });
    await expect(write(input(0))).rejects.toThrow("stale");
  });
});
