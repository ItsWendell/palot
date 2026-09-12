/** Owns only a disposable service registration; never discovers the user service. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { Service } from "@opencode/client/service";

export function releaseSmokeEnvironment(
  home: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !/^(OPENCODE|PALOT|ELECTRON|XDG)_/.test(entry[0]),
    ),
  );
  return {
    ...environment,
    HOME: home,
    // Do not hydrate the real user's login-shell configuration into an isolated app.
    SHELL: "/bin/sh",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_TEST_HOME: home,
    OPENCODE_CONFIG_CONTENT: "{}",
    OPENCODE_AUTH_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    PALOT_RELEASE_SMOKE: "1",
    PALOT_RELEASE_SMOKE_USER_DATA: home,
    PALOT_LOG_DIR: path.join(home, "logs"),
    PALOT_START_HIDDEN: "1",
    OPENCODE_BIN: "",
  };
}

export async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("Could not allocate a smoke port.");
  return address.port;
}

export async function withReleaseSmokeService(
  input: { binary: string; version: string; evidenceRoot: string },
  inspect: (context: {
    home: string;
    environment: Record<string, string>;
    endpoint: Awaited<ReturnType<typeof Service.ensure>>;
    signal: AbortSignal;
  }) => Promise<void>,
  service: Pick<typeof Service, "ensure" | "stop" | "discover"> = Service,
): Promise<void> {
  await mkdir(input.evidenceRoot, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(path.join(input.evidenceRoot, "smoke-"));
  const environment = releaseSmokeEnvironment(home);
  const file = path.join(environment.XDG_STATE_HOME!, "opencode", "service.json");
  let started = false;
  let failure: unknown;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Release smoke interrupted."));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const port = await availableLoopbackPort();
    // Explicit registration + environment are the official SDK isolation contract.
    const endpoint = await service.ensure({
      file,
      version: input.version,
      command: [input.binary, "serve", "--service", `--port=${port}`],
      env: environment,
    });
    started = true;
    controller.signal.throwIfAborted();
    await inspect({ home, environment, endpoint, signal: controller.signal });
  } catch (error) {
    failure = error;
  } finally {
    try {
      await stopOwnedReleaseService(service, file, started);
    } catch (error) {
      failure = new AggregateError(
        [failure, error].filter(Boolean),
        "Release smoke cleanup failed.",
      );
    }
    if (failure) {
      await writeFile(path.join(home, "failure.txt"), `${String(failure)}\n`, { mode: 0o600 });
      console.error(`Release smoke evidence retained: ${home}`);
    } else {
      await rm(home, { recursive: true, force: true });
    }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  if (failure) throw failure;
}

async function stopOwnedReleaseService(
  service: Pick<typeof Service, "stop" | "discover">,
  file: string,
  started: boolean,
): Promise<void> {
  await service.stop({ file });
  if (await service.discover({ file })) throw new Error("Owned smoke service survived cleanup.");
  // ensure() exposes no AbortSignal or contender handle. Preserve uncertainty
  // rather than claim that stopping a registration proves failed-start cleanup.
  if (!started)
    throw new Error(
      "Service startup failed before returning an endpoint; unregistered contender cleanup cannot be verified through the SDK.",
    );
}
