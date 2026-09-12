import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { SshPrompt } from "../../shared/ssh-contract";

/** A private, one-request-per-socket bridge to the bundled CLI askpass helper. */
export async function createAskpass(input: {
  binaryPath: string;
  signal: AbortSignal;
  prompt(request: SshPrompt): Promise<string | null>;
  onPromptDisconnected?(): void;
}) {
  input.signal.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  const sockets = new Set<Socket>();
  let queue = Promise.resolve();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(300_000, () => socket.destroy());
    let buffer = "";
    let received = false;
    socket.on("data", (chunk: Buffer) => {
      if (received) return socket.destroy();
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 16_384) return socket.destroy();
      if (!buffer.includes("\n")) return;
      received = true;
      let request: { token: string; text: string; confirm: boolean };
      try {
        request = JSON.parse(buffer.trim());
        if (
          typeof request.token !== "string" ||
          typeof request.text !== "string" ||
          typeof request.confirm !== "boolean" ||
          Buffer.byteLength(request.token) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(request.token), Buffer.from(token))
        )
          return socket.destroy();
      } catch {
        return socket.destroy();
      }
      queue = queue.then(async () => {
        if (socket.destroyed || input.signal.aborted) return;
        // Disconnection must release the queue even if the UI answer never arrives.
        let disconnected: (() => void) | undefined;
        try {
          const value = await Promise.race([
            input.prompt({ kind: "authentication", text: request.text, confirm: request.confirm }),
            new Promise<null>((resolve) => {
              disconnected = () => {
                input.onPromptDisconnected?.();
                resolve(null);
              };
              socket.once("close", disconnected);
            }),
          ]);
          if (!socket.destroyed) socket.end(`${JSON.stringify({ value })}\n`);
        } catch {
          socket.destroy();
        } finally {
          if (disconnected) socket.removeListener("close", disconnected);
        }
      });
    });
  });
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot open SSH authentication bridge");
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve) => {
      input.signal.removeEventListener("abort", abort);
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
    return closing;
  };
  const abort = () => {
    void close();
  };
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) {
    await close();
    input.signal.throwIfAborted();
  }
  return {
    env: {
      SSH_ASKPASS: input.binaryPath,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: process.env.DISPLAY || "opencode",
      OPENCODE_SSH_ASKPASS_PORT: String(address.port),
      OPENCODE_SSH_ASKPASS_TOKEN: token,
    },
    close,
  };
}
