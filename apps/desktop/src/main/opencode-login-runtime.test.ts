// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { OpenCodeLoginStatus } from "../shared/opencode-login-contract";
import { controlOpenCodeLoginService } from "./opencode-login-runtime";

const binary = { path: "/usr/bin/opencode", version: "2.0.3" };
const endpoint = { url: "http://127.0.0.1:12345" };

function harness() {
  let time = 0;
  return {
    manager: {
      control: vi.fn().mockResolvedValue(true),
      status: vi.fn().mockResolvedValue({ running: true, pid: 42 } as OpenCodeLoginStatus),
    },
    discover: vi.fn().mockResolvedValue(endpoint),
    health: vi.fn().mockResolvedValue({ pid: 42 }),
    now: () => time,
    wait: vi.fn(async () => {
      time += 30_000;
    }),
  };
}

describe("OS-owned OpenCode startup", () => {
  it("passes current shared ownership to the manager and waits for registered health", async () => {
    const deps = harness();
    deps.discover.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    expect(await controlOpenCodeLoginService("start", binary, deps)).toEqual(endpoint);
    expect(deps.manager.control).toHaveBeenCalledWith("start", binary, null);
    expect(deps.wait).toHaveBeenCalledOnce();
  });

  it("leaves unmanaged startup to the existing SDK without waiting", async () => {
    const deps = harness();
    deps.manager.control.mockResolvedValue(false);
    expect(await controlOpenCodeLoginService("restart", binary, deps)).toBeNull();
    expect(deps.manager.control).toHaveBeenCalledWith("restart", binary, 42);
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.manager.status).not.toHaveBeenCalled();
  });

  it("never claims a competing service as manager-owned", async () => {
    const deps = harness();
    deps.health.mockResolvedValue({ pid: 900 });
    await expect(controlOpenCodeLoginService("restart", binary, deps)).rejects.toThrow(
      "Another OpenCode process",
    );
  });

  it("fails closed on ownership conflicts and bounds readiness waiting", async () => {
    const deps = harness();
    deps.manager.control.mockRejectedValue(new Error("Owned by another process"));
    await expect(controlOpenCodeLoginService("restart", binary, deps)).rejects.toThrow(
      "Owned by another process",
    );
    expect(deps.discover).toHaveBeenCalledOnce();
    deps.manager.control.mockResolvedValue(true);
    deps.discover.mockResolvedValue(undefined);
    await expect(controlOpenCodeLoginService("start", binary, deps)).rejects.toThrow(
      "within 60 seconds",
    );
    expect(deps.wait).toHaveBeenCalledTimes(2);
  });
});
