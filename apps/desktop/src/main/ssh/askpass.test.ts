import { connect, type Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { createAskpass } from "./askpass";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function bridge(prompt = vi.fn().mockResolvedValue("secret")) {
  const controller = new AbortController();
  const result = await createAskpass({
    binaryPath: "/bundled/opencode2",
    signal: controller.signal,
    prompt,
  });
  cleanups.push(result.close);
  const request = async (token = result.env.OPENCODE_SSH_ASKPASS_TOKEN) => {
    const socket = connect(Number(result.env.OPENCODE_SSH_ASKPASS_PORT), "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const response = collect(socket);
    socket.write(`${JSON.stringify({ token, text: "Password:", confirm: false })}\n`);
    return { socket, response };
  };
  return { ...result, controller, request, prompt };
}

function collect(socket: Socket) {
  return new Promise<string>((resolve) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
    });
    socket.on("error", () => {});
    socket.once("close", () => resolve(buffer));
  });
}

it("requires the per-connection token and uses the bundled helper protocol", async () => {
  const server = await bridge();
  const invalid = await server.request("incorrect");
  expect(await invalid.response).toBe("");
  expect(server.prompt).not.toHaveBeenCalled();
  const valid = await server.request();
  expect(JSON.parse(await valid.response)).toEqual({ value: "secret" });
  expect(server.prompt).toHaveBeenCalledWith({
    kind: "authentication",
    text: "Password:",
    confirm: false,
  });
  expect(server.env.SSH_ASKPASS_REQUIRE).toBe("force");
});

it("serializes prompts and releases ownership when a helper disconnects", async () => {
  const prompt = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue("second");
  const server = await bridge(prompt);
  const first = await server.request();
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  const second = await server.request();
  expect(prompt).toHaveBeenCalledTimes(1);
  first.socket.destroy();
  expect(JSON.parse(await second.response)).toEqual({ value: "second" });
});

it("aborting closes sockets and the listening server without awaiting a UI answer", async () => {
  const server = await bridge(vi.fn(() => new Promise(() => {})));
  const request = await server.request();
  server.controller.abort();
  await server.close();
  expect(await request.response).toBe("");
  await expect(
    createAskpass({ binaryPath: "unused", signal: server.controller.signal, prompt: vi.fn() }),
  ).rejects.toThrow();
});
