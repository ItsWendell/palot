import http from "node:http";
import https from "node:https";

export interface AttachmentUploadInput {
  path: string;
  size: number;
  chunks: AsyncIterable<Uint8Array>;
  signal: AbortSignal;
  validate(): void;
  onProgress?(loaded: number): void;
}

export type AttachmentUploadWriter = (input: AttachmentUploadInput) => Promise<string>;

/** Main-only streaming adapter for the official binary filesystem-write endpoint.
 * The generated Promise client currently only accepts a buffered Uint8Array.
 */
export function attachmentUploadWriter(connection: {
  endpoint: { url: string };
  headers?: Record<string, string>;
  validate(): void;
}): AttachmentUploadWriter {
  return (input) =>
    new Promise((resolve, reject) => {
      const validate = () => {
        input.signal.throwIfAborted();
        connection.validate();
        input.validate();
      };
      validate();
      const url = new URL(connection.endpoint.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Invalid OpenCode upload endpoint.");
      // Match new URL(descriptor.path, baseUrl) in the official generated client.
      url.pathname = "/api/experimental/fs/write";
      url.search = "";
      url.hash = "";
      url.searchParams.set("path", input.path);
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "POST",
        headers: {
          ...connection.headers,
          "content-type": "application/octet-stream",
          "content-length": String(input.size),
        },
        signal: input.signal,
      });
      let settled = false;
      let uploadComplete = false;
      let responsePath: string | undefined;
      const cleanup = () => input.signal.removeEventListener("abort", abort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        request.destroy();
        reject(error);
      };
      const abort = () => fail(input.signal.reason);
      // The HTTP response may finish before the producer's final file validation.
      // Keep cancellation active independently of the request's socket lifetime.
      input.signal.addEventListener("abort", abort, { once: true });
      const finish = () => {
        if (settled || !uploadComplete || responsePath === undefined) return;
        validate();
        settled = true;
        cleanup();
        resolve(responsePath);
      };
      request.on("error", fail);
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          fail(new Error(`OpenCode upload failed with status ${response.statusCode}.`));
          return;
        }
        let size = 0;
        const buffers: Buffer[] = [];
        response.on("error", fail);
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) {
            response.destroy();
            fail(new Error("OpenCode upload response is too large."));
          } else buffers.push(chunk);
        });
        response.on("end", () => {
          try {
            validate();
            const result: unknown = JSON.parse(Buffer.concat(buffers).toString("utf8"));
            if (
              !result ||
              typeof result !== "object" ||
              !("data" in result) ||
              !result.data ||
              typeof result.data !== "object" ||
              !("path" in result.data) ||
              typeof result.data.path !== "string"
            )
              throw new Error("Invalid OpenCode upload response.");
            responsePath = result.data.path;
            finish();
          } catch {
            fail(new Error("Invalid or stale OpenCode upload response."));
          }
        });
      });
      void (async () => {
        let loaded = 0;
        let reportedAt = 0;
        input.onProgress?.(0);
        for await (const chunk of input.chunks) {
          validate();
          if (loaded + chunk.byteLength > input.size)
            throw new Error("Selected attachment changed.");
          await new Promise<void>((done, failed) => {
            request.write(chunk, (error) => (error ? failed(error) : done()));
          });
          loaded += chunk.byteLength;
          const now = Date.now();
          if (now - reportedAt >= 100 || loaded === input.size) {
            input.onProgress?.(loaded);
            reportedAt = now;
          }
        }
        validate();
        if (loaded !== input.size) throw new Error("Selected attachment changed.");
        uploadComplete = true;
        request.end();
        finish();
      })().catch(fail);
    });
}
