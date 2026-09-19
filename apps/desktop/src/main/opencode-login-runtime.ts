import { OpenCode } from "@opencode/client";
import { Service, type Endpoint } from "@opencode/client/service";
import { getOpenCodeLoginAutostart } from "./opencode-login-autostart";
import type { OpenCodeLoginStatus } from "../shared/opencode-login-contract";

interface Dependencies {
  manager: {
    status(): Promise<OpenCodeLoginStatus>;
    control(
      action: "start" | "restart",
      binary: { path: string; version: string },
      sharedPID: number | null,
    ): Promise<boolean>;
  };
  discover(): Promise<Endpoint | undefined>;
  health(endpoint: Endpoint): Promise<{ pid: number }>;
  now(): number;
  wait(): Promise<void>;
}

/** OS ownership is separate from the SDK's shared-service registration and health. */
export async function controlOpenCodeLoginService(
  action: "start" | "restart",
  binary: { path: string; version: string },
  dependencies?: Dependencies,
): Promise<Endpoint | null> {
  const deps: Dependencies = dependencies ?? {
    manager: getOpenCodeLoginAutostart(),
    discover: () => Service.discover(),
    health: (endpoint) =>
      OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).server.info({
        signal: AbortSignal.timeout(5_000),
      }),
    now: Date.now,
    wait: () => new Promise((resolve) => setTimeout(resolve, 300)),
  };
  const existing = await deps.discover();
  const pid = existing ? (await deps.health(existing)).pid : null;
  if (!(await deps.manager.control(action, binary, pid))) return null;

  const deadline = deps.now() + 60_000;
  while (deps.now() < deadline) {
    const endpoint = await deps.discover();
    if (endpoint) {
      const health = await deps.health(endpoint);
      const owner = await deps.manager.status();
      if (owner.pid === health.pid && owner.running) return endpoint;
      throw new Error(
        "Another OpenCode process registered during startup. Palot did not replace it. Check the local service before trying again.",
      );
    }
    await deps.wait();
  }
  throw new Error(
    "The login service did not become ready within 60 seconds. Check its status in connection settings and the OpenCode service log.",
  );
}
