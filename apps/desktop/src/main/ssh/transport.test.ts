import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  health: vi.fn(),
  askpassClose: vi.fn(),
  bootstrap: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }));
vi.mock("@opencode/client", () => ({
  OpenCode: { make: () => ({ server: { info: mocks.health } }) },
}));
vi.mock("./askpass", () => ({
  createAskpass: async () => ({ env: {}, close: mocks.askpassClose }),
}));
vi.mock("./bootstrap", async (original) => ({
  ...(await original<typeof import("./bootstrap")>()),
  bootstrap: mocks.bootstrap,
}));

import { connectSsh, runSsh, sshArgs } from "./transport";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((signal: string) => {
    this.signalCode = signal;
    queueMicrotask(() => this.emit("close", null));
    return true;
  });
  finish(code = 0) {
    this.exitCode = code;
    this.emit("close", code);
  }
}

const children: FakeChild[] = [];
const connections: { close(): Promise<void> }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  children.length = 0;
  mocks.spawn.mockImplementation((_binary: string, args: string[]) => {
    const child = new FakeChild();
    children.push(child);
    if (!args.includes("-M")) queueMicrotask(() => child.finish());
    return child;
  });
  mocks.health.mockResolvedValue({ version: "0.0.0-beta-19507" });
  mocks.bootstrap.mockResolvedValue({ host: "127.0.0.1", port: 4321, password: "private" });
});
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

const input = (signal = new AbortController().signal) => ({
  config: { target: "user@example" },
  binaryPath: "/bundled/opencode2",
  version: "0.0.0-beta-19507",
  signal,
  prompt: vi.fn().mockResolvedValue("yes"),
  onStage: vi.fn(),
});

it("keeps identity paths as one argv value without interpreting shell syntax", () => {
  expect(
    sshArgs({ target: "host", identityFile: "/keys/a b'$(touch x)", port: 2222 }, "/owned/s"),
  ).toEqual(
    expect.arrayContaining([
      "-i",
      "/keys/a b'$(touch x)",
      "-p",
      "2222",
      "PermitLocalCommand=no",
      "RequestTTY=no",
    ]),
  );
});

it("rejects malicious targets and cancelled attempts without spawning", async () => {
  await expect(
    connectSsh({ ...input(), config: { target: "-oProxyCommand=touch /x" } }),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(connectSsh(input(controller.signal))).rejects.toThrow();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("waits for health, detaches setup cancellation, and closes only its owned master", async () => {
  const controller = new AbortController();
  const connection = await connectSsh(input(controller.signal));
  connections.push(connection);
  expect(mocks.health).toHaveBeenCalledOnce();
  expect(connection.endpoint.auth?.password).toBe("private");
  const master = children[0]!;
  const masterArgs = mocks.spawn.mock.calls[0]![1] as string[];
  const control = masterArgs.find((arg) => arg.startsWith("ControlPath="))!.slice(12);
  controller.abort();
  expect(master.kill).not.toHaveBeenCalled();
  await connection.close();
  expect(master.kill).toHaveBeenCalledWith("SIGTERM");
  expect(mocks.askpassClose).toHaveBeenCalledOnce();
  await expect(access(dirname(control))).rejects.toThrow();
  expect(
    mocks.spawn.mock.calls.some((call) =>
      (call[1] as string[]).some((arg) => arg.includes("service stop")),
    ),
  ).toBe(false);
});

it("awaits owned-process cleanup on bootstrap failure", async () => {
  mocks.bootstrap.mockRejectedValueOnce(new Error("setup declined"));
  await expect(connectSsh(input())).rejects.toThrow("setup declined");
  expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  expect(mocks.askpassClose).toHaveBeenCalledOnce();
  const args = mocks.spawn.mock.calls[0]![1] as string[];
  await expect(
    access(dirname(args.find((arg) => arg.startsWith("ControlPath="))!.slice(12))),
  ).rejects.toThrow();
});

it("attempts bridge and directory cleanup even when process cleanup fails", async () => {
  const connection = await connectSsh(input());
  const master = children[0]!;
  const args = mocks.spawn.mock.calls[0]![1] as string[];
  const directory = dirname(args.find((arg) => arg.startsWith("ControlPath="))!.slice(12));
  master.kill.mockImplementationOnce(() => {
    throw new Error("process cleanup failed");
  });
  mocks.askpassClose.mockRejectedValueOnce(new Error("bridge cleanup failed"));
  try {
    await expect(connection.close()).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(mocks.askpassClose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  } finally {
    master.finish();
  }
});

it("rejects a service version change and cleans up before returning", async () => {
  mocks.health.mockResolvedValueOnce({ version: "0.0.0-beta-19000" });
  await expect(connectSsh(input())).rejects.toThrow("version changed");
  expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  expect(mocks.askpassClose).toHaveBeenCalledOnce();
});

it("keeps setup cancellation active while waiting for authenticated health", async () => {
  mocks.health.mockImplementationOnce(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const controller = new AbortController();
  const connecting = connectSsh(input(controller.signal));
  const rejected = expect(connecting).rejects.toThrow("SSH connection closed");
  await vi.waitFor(() => expect(mocks.health).toHaveBeenCalled());
  controller.abort();
  await rejected;
  expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
});

it("cancellation kills and awaits a running command without exposing output", async () => {
  const child = new FakeChild();
  mocks.spawn.mockReturnValueOnce(child);
  const controller = new AbortController();
  const running = runSsh({ args: ["host"], env: {}, signal: controller.signal });
  child.stdout.write("OPENCODE_SSH_REGISTRATION_BEGIN\nprivate password\n");
  controller.abort(new Error("cancelled"));
  await expect(running).rejects.toThrow("cancelled");
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
});

it("does not expose private remote registration in command failures", async () => {
  const child = new FakeChild();
  mocks.spawn.mockReturnValueOnce(child);
  const running = runSsh({ args: ["host"], env: {}, signal: new AbortController().signal });
  child.stdout.write("OPENCODE_SSH_REGISTRATION_BEGIN\nprivate password\n");
  child.stderr.write("private password");
  child.finish(1);
  await expect(running).rejects.toThrow("SSH command failed");
});
