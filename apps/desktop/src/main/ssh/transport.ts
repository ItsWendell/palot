import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode } from "@opencode/client";
import { Service, type Endpoint } from "@opencode/client/service";
import type { SshConfig, SshPrompt } from "../../shared/ssh-contract";
import { createAskpass } from "./askpass";
import { bootstrap, quote, requireVersion } from "./bootstrap";
import { normalizeSshConfig } from "./config";

export interface SshConnection {
  endpoint: Endpoint;
  close(): Promise<void>;
}

export function sshArgs(config: SshConfig, control: string) {
  return [
    "-T",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "RemoteCommand=none",
    "-o",
    "RequestTTY=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "StrictHostKeyChecking=ask",
    "-o",
    "ControlPersist=no",
    "-o",
    "ForkAfterAuthentication=no",
    "-o",
    `ControlPath=${control}`,
    ...(config.port ? ["-p", String(config.port)] : []),
    ...(config.identityFile ? ["-i", config.identityFile] : []),
  ];
}

/** Each local process has an awaited close path, including cancellation and spawn failure. */
export function startSsh(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn("ssh", args, {
    env: { ...process.env, ...env },
    stdio: "pipe",
    windowsHide: true,
  });
  let stdout = "";
  let failed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-1_048_576);
  });
  // Neither stdout registration credentials nor authentication diagnostics escape this module.
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("error", () => {
    failed = true;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      timer.unref();
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    })();
    return stopping;
  };
  return { child, exited, stop, output: () => stdout, failed: () => failed };
}

export async function runSsh(input: {
  args: string[];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stdin?: string | Uint8Array;
  timeout?: number;
}) {
  input.signal.throwIfAborted();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeout ?? 300_000)]);
  const process = startSsh(input.args, input.env);
  const abort = () => {
    void process.stop();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    process.child.stdin.end(input.stdin);
    const code = await process.exited;
    signal.throwIfAborted();
    if (code !== 0 || process.failed())
      throw new Error(
        "SSH command failed. Check the host, credentials, and known_hosts configuration.",
      );
    return process.output();
  } finally {
    signal.removeEventListener("abort", abort);
    await process.stop();
  }
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("Cannot reserve SSH tunnel port");
  return address.port;
}

async function abortablePrompt(
  prompt: (request: SshPrompt) => Promise<string | null>,
  request: SshPrompt,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      prompt(request),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export async function connectSsh(input: {
  config: SshConfig;
  binaryPath: string;
  version: string;
  signal: AbortSignal;
  onStage(stage: string): void;
  prompt(request: SshPrompt): Promise<string | null>;
}): Promise<SshConnection> {
  const config = normalizeSshConfig(input.config);
  requireVersion(input.version);
  input.signal.throwIfAborted();
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const directory = await mkdtemp(join(tmpdir(), "palot-ssh-"));
  const control = join(directory, "s");
  const args = sshArgs(config, control);
  let askpass: Awaited<ReturnType<typeof createAskpass>> | undefined;
  let master: ReturnType<typeof startSsh> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      input.signal.removeEventListener("abort", abort);
      lifetime.abort(new Error("SSH connection closed"));
      const failures: unknown[] = [];
      for (const cleanup of [
        () => master?.stop(),
        () => askpass?.close(),
        () => rm(directory, { recursive: true, force: true }),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "SSH connection cleanup failed");
    })();
    return closing;
  };
  const abort = () => {
    void close().catch(() => {});
  };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    input.signal.throwIfAborted();
    signal.throwIfAborted();
    askpass = await createAskpass({
      binaryPath: input.binaryPath,
      signal,
      prompt: (request) => abortablePrompt(input.prompt, request, signal),
      // The broker cannot retract an individual prompt through this contract.
      // End this attempt rather than overlap a stale UI question with a new helper.
      onPromptDisconnected: abort,
    });
    signal.throwIfAborted();
    input.onStage("connecting");
    master = startSsh(
      [
        ...args,
        "-M",
        "-N",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        config.target,
      ],
      askpass.env,
    );
    master.child.stdin.end();
    // This master never backgrounds itself; it is the sole owner of all forwarding.
    void master.exited.then(() => close()).catch(() => {});
    const deadline = Date.now() + 300_000;
    for (;;) {
      signal.throwIfAborted();
      try {
        await runSsh({
          args: [...args, "-O", "check", config.target],
          env: askpass.env,
          signal,
          timeout: 2_000,
        });
        break;
      } catch {
        signal.throwIfAborted();
        if (Date.now() >= deadline) throw new Error("SSH authentication timed out");
        await delay(100, undefined, { signal });
      }
    }
    const remote = await bootstrap({
      version: input.version,
      signal,
      onStage: input.onStage,
      prompt: (request) =>
        abortablePrompt(
          input.prompt,
          request,
          AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
        ),
      run: (script, archive) =>
        runSsh({
          args: [
            ...args,
            "-o",
            "ControlMaster=no",
            config.target,
            archive ? `sh -c ${quote(script)}` : "sh -l -s",
          ],
          env: askpass!.env,
          signal,
          stdin: archive ?? script,
        }),
    });
    input.onStage("forwarding");
    const port = await freePort();
    await runSsh({
      args: [
        ...args,
        "-o",
        "ExitOnForwardFailure=yes",
        "-O",
        "forward",
        "-L",
        `127.0.0.1:${port}:${remote.host}:${remote.port}`,
        config.target,
      ],
      env: askpass.env,
      signal,
      timeout: 10_000,
    });
    signal.throwIfAborted();
    const endpoint: Endpoint = {
      url: `http://127.0.0.1:${port}`,
      auth: { type: "basic", username: "opencode", password: remote.password },
    };
    input.onStage("checking-health");
    const client = OpenCode.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
      fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
    });
    const healthSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    for (;;) {
      healthSignal.throwIfAborted();
      const health = await client.health
        .get({
          signal: AbortSignal.any([healthSignal, AbortSignal.timeout(2_000)]),
        })
        .catch(() => undefined);
      if (health) {
        if (health.version !== input.version)
          throw new Error("SSH service version changed during connection");
        break;
      }
      healthSignal.throwIfAborted();
      await delay(100, undefined, { signal: healthSignal });
    }
    signal.throwIfAborted();
    input.signal.removeEventListener("abort", abort);
    return { endpoint, close };
  } catch (error) {
    await close();
    throw error;
  }
}
