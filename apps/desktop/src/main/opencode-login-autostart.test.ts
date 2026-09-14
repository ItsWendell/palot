// @vitest-environment node
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeLoginAutostart } from "./opencode-login-autostart";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function harness(platform: "linux" | "darwin" = "linux", env: NodeJS.ProcessEnv = {}) {
  await fs.mkdir("/tmp/opencode", { recursive: true });
  const home = await fs.mkdtemp(join(await fs.realpath("/tmp/opencode"), "login-service-"));
  roots.push(home);
  const binary = {
    path: join(home, 'bin with spaces/opencode $literal%name"&<>'),
    version: "2.0.2",
  };
  await fs.mkdir(join(home, "bin with spaces"));
  await fs.writeFile(binary.path, "fake executable", { mode: 0o700 });
  const configPath =
    platform === "linux"
      ? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "systemd/user/opencode.service")
      : join(home, "Library/LaunchAgents/ai.palot.opencode.plist");
  const state = {
    enabled: false,
    loaded: false,
    pid: 0,
    fragment: "",
    dropins: "",
    program: binary.path,
    integrated: true,
    available: true,
    failure: "",
    jobPath: configPath,
    ignoreTerm: false,
    autoRestart: false,
    legacyOverrides: false,
  };
  const run = vi.fn(
    async (_file: string, raw: string[], _options: { timeout: number; maxBuffer: number }) => {
      const args = platform === "linux" ? raw.slice(1) : raw;
      const [command, target] = args;
      if (state.failure === command) throw new Error("SECRET_ACCESS_TOKEN=never-display");
      if (command === "show" && target === "graphical-session.target") {
        return {
          code: state.available ? 0 : 1,
          stdout: `LoadState=loaded\nActiveState=${state.integrated ? "active" : "inactive"}\n`,
        };
      }
      if (command === "show") {
        return {
          code: state.available ? 0 : 1,
          stdout: `LoadState=${state.loaded ? "loaded" : "not-found"}\nActiveState=${state.pid ? "active" : "inactive"}\nMainPID=${state.pid}\nFragmentPath=${state.fragment}\nDropInPaths=${state.dropins}\nUnitFileState=${state.enabled ? "enabled" : "disabled"}\n`,
        };
      }
      if (command === "print" && !target?.includes("/ai.palot"))
        return { code: state.available ? 0 : 1, stdout: "gui" };
      if (command === "print-disabled")
        return {
          code: 0,
          stdout: `disabled services = {\n\t"ai.palot.opencode" => ${state.legacyOverrides ? !state.enabled : state.enabled ? "enabled" : "disabled"}\n}`,
        };
      if (command === "print")
        return {
          code: state.loaded ? 0 : 113,
          stdout: `path = ${state.jobPath}\nprogram = ${state.program}\nstate = ${state.pid ? "running" : "not running"}\npid = ${state.pid}\n`,
        };
      if (command === "daemon-reload") {
        state.loaded = true;
        state.fragment = configPath;
      } else if (command === "enable") state.enabled = true;
      else if (command === "disable") state.enabled = false;
      else if (command === "kill") {
        if (!state.ignoreTerm) state.pid = state.autoRestart ? 2345 : 0;
      } else if (["start", "restart", "kickstart", "bootstrap"].includes(command!)) {
        state.pid = 1234;
        state.loaded = true;
      } else throw new Error(`Unexpected manager command: ${args.join(" ")}`);
      return { code: 0, stdout: "" };
    },
  );
  let clock = 0;
  const manager = new OpenCodeLoginAutostart({
    platform,
    home,
    uid: process.getuid!(),
    env: { PATH: '/usr/bin:/some path/$HOME%"&<>:relative::/bin', ...env },
    run,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });
  const mutations = () =>
    run.mock.calls
      .map(([, args]) => (platform === "linux" ? args.slice(1) : args))
      .filter(([command]) => !["show", "print", "print-disabled"].includes(command!));
  return { home, binary, configPath, state, run, manager, mutations };
}

describe("OpenCode login service", () => {
  it("allows a large macOS GUI-domain listing while bounding individual job queries", async () => {
    const h = await harness("darwin");
    expect((await h.manager.status()).supported).toBe(true);
    const domain = `gui/${process.getuid!()}`;
    const gui = h.run.mock.calls.find(([, args]) => args[0] === "print" && args[1] === domain);
    expect(gui?.[2]).toEqual({ timeout: 15_000, maxBuffer: 1024 * 1024 });
    const job = h.run.mock.calls.find(
      ([, args]) => args[0] === "print" && args[1] === `${domain}/ai.palot.opencode`,
    );
    expect(job?.[2]).toEqual({ timeout: 15_000, maxBuffer: 128 * 1024 });
  });

  it.each(["linux", "darwin"] as const)(
    "retains the stable launcher symlink in the %s registration",
    async (platform) => {
      const h = await harness(platform);
      const launcher = join(h.home, "stable-opencode");
      await fs.symlink(h.binary.path, launcher);
      expect(await h.manager.enable({ ...h.binary, path: launcher })).toMatchObject({
        owned: true,
        enabled: true,
        binaryPath: launcher,
      });
      expect(await fs.readFile(h.configPath, "utf8")).toContain(launcher);
      // A package update moves the launcher to a new store target without re-registering login.
      const replacement = join(h.home, "new-store-target");
      await fs.writeFile(replacement, "updated executable");
      await fs.rm(launcher);
      await fs.symlink(replacement, launcher);
      if (platform === "darwin") h.state.program = launcher;
      expect(await h.manager.control("start", { path: replacement, version: "2.0.3" }, null)).toBe(
        true,
      );
      expect((await h.manager.status()).binaryPath).toBe(launcher);
    },
  );

  it("allows systemd's graceful restart to drain while bounding read-only commands separately", async () => {
    const h = await harness();
    await h.manager.enable(h.binary);
    await h.manager.control("start", h.binary, null);
    await h.manager.control("restart", h.binary, 1234);
    const starts = h.run.mock.calls.filter(([, args]) => ["start", "restart"].includes(args[1]!));
    expect(starts).toHaveLength(2);
    for (const [, , options] of starts) expect(options.timeout).toBeGreaterThanOrEqual(65_000);
    const reads = h.run.mock.calls.filter(([, args]) => args[1] === "show");
    expect(reads.length).toBeGreaterThan(0);
    for (const [, , options] of reads) expect(options.timeout).toBe(15_000);
  });

  it.each(["linux", "darwin"] as const)(
    "registers only the next login on %s and keeps status read-only",
    async (platform) => {
      const h = await harness(platform);
      expect(await h.manager.status()).toMatchObject({
        supported: true,
        owned: false,
        running: false,
      });
      expect(h.mutations()).toEqual([]);
      expect(await h.manager.enable(h.binary)).toMatchObject({
        supported: true,
        enabled: true,
        owned: true,
        running: false,
        binaryPath: h.binary.path,
      });
      expect(h.mutations().map(([command]) => command)).toEqual(
        platform === "linux" ? ["daemon-reload", "enable"] : ["enable"],
      );
      expect((await fs.stat(h.configPath)).mode & 0o777).toBe(0o600);
      const text = await fs.readFile(h.configPath, "utf8");
      expect(text).not.toContain("relative:");
      if (platform === "linux") {
        expect(text).toContain('opencode $$literal%%name\\"&<>" serve --service');
        expect(text).toContain('Environment="PATH=/usr/bin:/some path/$HOME%%\\"&<>:/bin"');
      } else {
        expect(text).toContain("opencode $literal%name&quot;&amp;&lt;&gt;</string>");
        expect(text).toContain("<key>RunAtLoad</key><true/>");
      }
      await h.manager.status();
      expect(h.mutations().map(([command]) => command)).toEqual(
        platform === "linux" ? ["daemon-reload", "enable"] : ["enable"],
      );
    },
  );

  it.each(["linux", "darwin"] as const)(
    "starts/restarts through %s and keeps routing after disable",
    async (platform) => {
      const h = await harness(platform);
      await h.manager.enable(h.binary);
      expect(await h.manager.control("start", h.binary, null)).toBe(true);
      expect((await h.manager.status()).pid).toBe(1234);
      expect(await h.manager.disable()).toMatchObject({
        enabled: false,
        owned: true,
        running: true,
        pid: 1234,
      });
      expect(await h.manager.control("restart", h.binary, 1234)).toBe(true);
      expect(h.mutations()).toContainEqual(
        platform === "linux"
          ? ["restart", "opencode.service"]
          : ["kickstart", `gui/${process.getuid!()}/ai.palot.opencode`],
      );
      expect(
        h.mutations().some(([command]) => ["stop", "bootout", "unload"].includes(command!)),
      ).toBe(false);
      h.state.pid = 0;
      expect(await h.manager.control("start", h.binary, null)).toBe(false);
      await h.manager.enable(h.binary);
      expect((await h.manager.status()).enabled).toBe(true);
    },
  );

  it.each(["linux", "darwin"] as const)(
    "rejects takeover and selected binary mismatch on %s",
    async (platform) => {
      const h = await harness(platform);
      await h.manager.enable(h.binary);
      const before = h.mutations().length;
      await expect(h.manager.control("restart", h.binary, 999)).rejects.toThrow(
        "Another OpenCode process owns",
      );
      const other = join(h.home, "another-cli");
      await fs.writeFile(other, "other");
      await expect(h.manager.control("start", { ...h.binary, path: other }, null)).rejects.toThrow(
        "another OpenCode installation",
      );
      expect(h.mutations()).toHaveLength(before);
      const alias = join(h.home, "alias");
      await fs.symlink(h.binary.path, alias);
      expect(await h.manager.control("start", { ...h.binary, path: alias }, null)).toBe(true);
    },
  );

  it.each(["linux", "darwin"] as const)(
    "refuses foreign configurations and symlinks on %s",
    async (platform) => {
      const h = await harness(platform);
      await fs.mkdir(join(h.configPath, ".."), { recursive: true });
      await fs.writeFile(h.configPath, "foreign service");
      expect(await h.manager.status()).toMatchObject({
        supported: false,
        owned: false,
        reason: expect.stringContaining("unrecognized"),
      });
      await expect(h.manager.enable(h.binary)).rejects.toThrow("unrecognized");
      await expect(h.manager.disable()).rejects.toThrow("unrecognized");
      await expect(h.manager.control("restart", h.binary, null)).rejects.toThrow("unrecognized");
      expect(await fs.readFile(h.configPath, "utf8")).toBe("foreign service");
      await fs.rm(h.configPath);
      await fs.symlink(h.binary.path, h.configPath);
      await expect(h.manager.enable(h.binary)).rejects.toThrow("unsafe");
      expect(h.mutations()).toEqual([]);
    },
  );

  it("rejects effective foreign systemd fragments and drop-ins even without a local file", async () => {
    const h = await harness();
    h.state.fragment = "/usr/lib/systemd/user/opencode.service";
    await expect(h.manager.control("restart", h.binary, null)).rejects.toThrow("unrecognized");
    h.state.fragment = "";
    await h.manager.enable(h.binary);
    h.state.dropins = "/some/override.conf";
    await expect(h.manager.disable()).rejects.toThrow("unrecognized");
    expect(h.mutations().map(([command]) => command)).toEqual(["daemon-reload", "enable"]);
  });

  it("does not trust the ownership marker after configuration edits", async () => {
    const h = await harness();
    await h.manager.enable(h.binary);
    await fs.appendFile(h.configPath, "\n[Service]\nExecStartPost=/other/program\n");
    await expect(h.manager.disable()).rejects.toThrow("unrecognized");
    await expect(h.manager.control("restart", h.binary, null)).rejects.toThrow("unrecognized");
    expect(h.mutations().map(([command]) => command)).toEqual(["daemon-reload", "enable"]);
  });

  it("refuses writable registrations and symlinked parent directories", async () => {
    const h = await harness();
    await h.manager.enable(h.binary);
    await fs.chmod(h.configPath, 0o666);
    await expect(h.manager.disable()).rejects.toThrow("unsafe");
    await fs.chmod(h.configPath, 0o600);
    await fs.rename(join(h.home, ".config"), join(h.home, "real-config"));
    await fs.symlink(join(h.home, "real-config"), join(h.home, ".config"));
    await expect(h.manager.enable(h.binary)).rejects.toThrow("unsafe");
  });

  it("does not infer no foreign service when the systemd manager is unavailable", async () => {
    const h = await harness();
    h.state.available = false;
    expect(await h.manager.status()).toMatchObject({
      supported: false,
      reason: expect.stringContaining("Cannot inspect"),
    });
    await expect(h.manager.control("start", h.binary, null)).rejects.toThrow("Cannot inspect");
    expect(h.mutations()).toEqual([]);
  });

  it("reports registration without executing or repairing a missing CLI", async () => {
    const h = await harness();
    await h.manager.enable(h.binary);
    await fs.rm(h.binary.path);
    expect(await h.manager.status()).toMatchObject({ owned: true, enabled: true });
    await expect(h.manager.control("start", h.binary, null)).rejects.toThrow(
      "executable is unavailable",
    );
    expect(h.mutations().map(([command]) => command)).toEqual(["daemon-reload", "enable"]);
  });

  it("rejects a foreign launchd job with the same label", async () => {
    const h = await harness("darwin");
    h.state.loaded = true;
    h.state.jobPath = "/other/job.plist";
    await expect(h.manager.control("start", h.binary, null)).rejects.toThrow("unrecognized");
    expect(h.mutations()).toEqual([]);
  });

  it("does not silently replace a loaded macOS agent's executable", async () => {
    const h = await harness("darwin");
    await h.manager.enable(h.binary);
    await h.manager.control("start", h.binary, null);
    const other = join(h.home, "other");
    await fs.writeFile(other, "binary");
    await expect(h.manager.enable({ path: other, version: "2.0.2" })).rejects.toThrow("Sign out");
    expect((await h.manager.status()).binaryPath).toBe(h.binary.path);
  });

  it("accepts older boolean launchd overrides as well as native enabled/disabled tokens", async () => {
    const h = await harness("darwin");
    h.state.legacyOverrides = true;
    expect((await h.manager.enable(h.binary)).enabled).toBe(true);
    expect((await h.manager.disable()).enabled).toBe(false);
    expect((await h.manager.enable(h.binary)).enabled).toBe(true);
  });

  it("can disable an owned loaded macOS agent after its launcher is deleted", async () => {
    const h = await harness("darwin");
    await h.manager.enable(h.binary);
    await h.manager.control("start", h.binary, null);
    await fs.rm(h.binary.path);
    expect(await h.manager.status()).toMatchObject({
      owned: true,
      enabled: true,
      running: true,
      pid: 1234,
    });
    expect(await h.manager.disable()).toMatchObject({
      owned: true,
      enabled: false,
      running: true,
      pid: 1234,
    });
    expect(h.mutations().slice(-1)).toEqual([
      ["disable", `gui/${process.getuid!()}/ai.palot.opencode`],
    ]);
    await expect(h.manager.control("restart", h.binary, 1234)).rejects.toThrow(
      "executable is unavailable",
    );
  });

  it("lets launchd KeepAlive finish a graceful restart without killing the replacement", async () => {
    const h = await harness("darwin");
    await h.manager.enable(h.binary);
    await h.manager.control("start", h.binary, null);
    h.state.autoRestart = true;
    expect(await h.manager.control("restart", h.binary, 1234)).toBe(true);
    expect((await h.manager.status()).pid).toBe(2345);
    expect(h.mutations().slice(-1)).toEqual([
      ["kill", "SIGTERM", `gui/${process.getuid!()}/ai.palot.opencode`],
    ]);
  });

  it("bounds graceful launchd restart and never escalates to SIGKILL", async () => {
    const h = await harness("darwin");
    await h.manager.enable(h.binary);
    await h.manager.control("start", h.binary, null);
    h.state.ignoreTerm = true;
    await expect(h.manager.control("restart", h.binary, 1234)).rejects.toThrow(
      "did not exit within 45 seconds",
    );
    expect(h.state.pid).toBe(1234);
    expect(h.mutations().slice(-1)).toEqual([
      ["kill", "SIGTERM", `gui/${process.getuid!()}/ai.palot.opencode`],
    ]);
    expect(h.mutations().flat()).not.toContain("-k");
    expect(h.run.mock.calls.length).toBeLessThan(200);
  });

  it.each(["linux", "darwin"] as const)(
    "sanitizes %s command failures and never falls back to unmanaged startup",
    async (platform) => {
      const h = await harness(platform);
      await h.manager.enable(h.binary);
      h.state.failure = platform === "linux" ? "start" : "bootstrap";
      await expect(h.manager.control("start", h.binary, null)).rejects.toThrow("Check your");
      await expect(h.manager.control("start", h.binary, null)).rejects.not.toThrow("SECRET");
      expect(h.state.pid).toBe(0);
    },
  );

  it("requires an integrated graphical target without altering linger", async () => {
    const h = await harness();
    h.state.integrated = false;
    expect(await h.manager.status()).toMatchObject({
      supported: false,
      reason: expect.stringContaining("graphical-session.target"),
    });
    await expect(h.manager.enable(h.binary)).rejects.toThrow("graphical-session.target");
    expect(await h.manager.control("start", h.binary, null)).toBe(false);
    expect(h.mutations()).toEqual([]);
  });

  it.each(["PALOT_E2E_USER_DATA", "PALOT_RELEASE_SMOKE_USER_DATA"])(
    "never accesses OS managers for %s",
    async (key) => {
      const h = await harness("linux", { [key]: "/isolated" });
      expect(await h.manager.status()).toMatchObject({ supported: false, manager: null });
      expect(await h.manager.control("start", h.binary, null)).toBe(false);
      await expect(h.manager.enable(h.binary)).rejects.toThrow("isolated");
      await h.manager.disable();
      expect(h.run).not.toHaveBeenCalled();
    },
  );

  it("uses XDG_CONFIG_HOME for the user unit", async () => {
    const base = await fs.mkdtemp(join(await fs.realpath("/tmp/opencode"), "login-xdg-"));
    roots.push(base);
    const h = await harness("linux", { XDG_CONFIG_HOME: base });
    expect((await h.manager.enable(h.binary)).configPath).toBe(
      join(base, "systemd/user/opencode.service"),
    );
  });

  it.each(["opencode", "opencode2"])(
    "adopts the exact pre-existing Palot %s host unit without replacing it on disable",
    async (name) => {
      const h = await harness();
      // Authoritative deployed unit, not a generated implementation snapshot.
      const unit = `# Managed by Palot: local OpenCode login service.
[Unit]
Description=OpenCode background service
Documentation=https://opencode.ai/v2/docs/troubleshooting
After=graphical-session.target
PartOf=graphical-session.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
WorkingDirectory=%h
ExecStart=%h/.bun/bin/${name} serve --service
Restart=on-failure
RestartSec=3
TimeoutStopSec=45
KillMode=mixed

[Install]
WantedBy=graphical-session.target
`;
      await fs.mkdir(join(h.home, ".bun/bin"), { recursive: true });
      await fs.writeFile(join(h.home, ".bun/bin", name), "fake");
      await fs.mkdir(join(h.configPath, ".."), { recursive: true });
      await fs.writeFile(h.configPath, unit);
      h.state.fragment = h.configPath;
      h.state.pid = 321;
      h.state.enabled = true;
      expect(await h.manager.status()).toMatchObject({
        owned: true,
        enabled: true,
        binaryPath: join(h.home, ".bun/bin", name),
      });
      await h.manager.disable();
      expect(await fs.readFile(h.configPath, "utf8")).toBe(unit);
      expect(
        await h.manager.control(
          "restart",
          { path: join(h.home, ".bun/bin", name), version: "2.0.2" },
          321,
        ),
      ).toBe(true);
    },
  );
});
