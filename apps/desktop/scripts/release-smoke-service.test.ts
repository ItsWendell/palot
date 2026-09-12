// @vitest-environment node
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { releaseSmokeEnvironment, withReleaseSmokeService } from "./release-smoke-service";

describe("release smoke service ownership", () => {
  it("replaces inherited service, auth, Electron and Palot overrides with isolated state", () => {
    const environment = releaseSmokeEnvironment("/owned/home", {
      HOME: "/real/home",
      PATH: "/tools",
      SHELL: "/bin/zsh",
      OPENCODE_BIN: "/real/opencode",
      OPENCODE_AUTH_CONTENT: "real-auth",
      OPENCODE_CONFIG_CONTENT: "real-config",
      PALOT_E2E_USER_DATA: "/real/data",
      PALOT_OPENCODE_SERVICE_PORT: "4096",
      ELECTRON_RUN_AS_NODE: "1",
      XDG_STATE_HOME: "/real/state",
    });
    expect(environment.HOME).toBe("/owned/home");
    expect(environment.XDG_STATE_HOME).toBe("/owned/home/.local/state");
    expect(environment.OPENCODE_AUTH_CONTENT).toBe("{}");
    expect(environment.OPENCODE_CONFIG_CONTENT).toBe("{}");
    expect(environment.OPENCODE_BIN).toBe("");
    expect(environment.PATH).toBe("/tools");
    expect(environment.SHELL).toBe("/bin/sh");
    expect(environment).not.toHaveProperty("PALOT_E2E_USER_DATA");
    expect(environment).not.toHaveProperty("PALOT_OPENCODE_SERVICE_PORT");
    expect(environment).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  });

  it.each([false, true])(
    "stops only the explicit registration after inspection (failure=%s)",
    async (fail) => {
      const root = await mkdtemp(path.join(tmpdir(), "palot-smoke-service-"));
      const endpoint = { url: "http://127.0.0.1:12345" };
      const service = {
        ensure: vi.fn().mockResolvedValue(endpoint),
        stop: vi.fn().mockResolvedValue(undefined),
        discover: vi.fn().mockResolvedValue(undefined),
      };
      let home = "";
      try {
        const run = withReleaseSmokeService(
          { binary: "/candidate/opencode2", version: "2.0.2", evidenceRoot: root },
          async (context) => {
            home = context.home;
            expect(context.endpoint).toBe(endpoint);
            if (fail) throw new Error("renderer failed");
          },
          service,
        );
        if (fail) await expect(run).rejects.toThrow("renderer failed");
        else await expect(run).resolves.toBeUndefined();
        const options = service.ensure.mock.calls[0]![0];
        expect(options.file).toBe(path.join(home, ".local/state/opencode/service.json"));
        expect(options.env.HOME).toBe(home);
        expect(options.command.slice(0, 3)).toEqual(["/candidate/opencode2", "serve", "--service"]);
        expect(options.command[3]).toMatch(/^--port=\d+$/);
        expect(service.stop).toHaveBeenCalledExactlyOnceWith({ file: options.file });
        expect(service.discover).toHaveBeenCalledExactlyOnceWith({ file: options.file });
        if (fail) await expect(access(path.join(home, "failure.txt"))).resolves.toBeUndefined();
        else expect(await readdir(root)).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("does not claim successful cleanup after an SDK startup failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "palot-smoke-startup-"));
    const service = {
      ensure: vi.fn().mockRejectedValue(new Error("startup failed")),
      stop: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
    };
    const inspect = vi.fn();
    try {
      await expect(
        withReleaseSmokeService(
          { binary: "/candidate/opencode2", version: "test", evidenceRoot: root },
          inspect,
          service,
        ),
      ).rejects.toThrow("cleanup failed");
      expect(inspect).not.toHaveBeenCalled();
      expect(service.stop).toHaveBeenCalledTimes(1);
      expect(await readdir(root)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
