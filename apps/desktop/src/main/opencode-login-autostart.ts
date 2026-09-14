import { execFile } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse } from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenCodeLoginStatus } from "../shared/opencode-login-contract";

const MARKER = "# Managed by Palot: local OpenCode login service.";
const LABEL = "ai.palot.opencode";
const UNIT = "opencode.service";
const LEGACY = `${MARKER}
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
ExecStart=%h/.bun/bin/opencode2 serve --service
Restart=on-failure
RestartSec=3
TimeoutStopSec=45
KillMode=mixed

[Install]
WantedBy=graphical-session.target
`;
const LEGACY_CANONICAL = LEGACY.replace(
  "ExecStart=%h/.bun/bin/opencode2 ",
  "ExecStart=%h/.bun/bin/opencode ",
);

interface CommandResult {
  code: number;
  stdout: string;
}

export interface OpenCodeLoginDependencies {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  env: NodeJS.ProcessEnv;
  run: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
  ) => Promise<CommandResult>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

type Binary = { path: string; version: string };
type Config = { text: string; binary: string; path: string };

function run(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout,
        killSignal: "SIGKILL",
        maxBuffer: options.maxBuffer,
        encoding: "utf8",
        shell: false,
      },
      (error, stdout) => resolve({ code: error ? 1 : 0, stdout: error ? "" : stdout }),
    );
  });
}

function xml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[char]!;
  });
}

function unxml(value: string): string {
  return value.replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => {
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[name]!;
  });
}

// ExecStart has both systemd specifier expansion and dollar expansion, but no shell.
function unitQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%")
    .replace(/\$/g, () => "$$")}"`;
}

function validText(value: string): boolean {
  return !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

function servicePID(text: string, pattern: RegExp): number | null {
  const value = Number(text.match(pattern)?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** OS login registration only. Never discovers, updates, or starts an OpenCode CLI implicitly. */
export class OpenCodeLoginAutostart {
  private readonly deps: OpenCodeLoginDependencies;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(deps: Partial<OpenCodeLoginDependencies> = {}) {
    this.deps = {
      platform: process.platform,
      home: homedir(),
      uid: process.getuid?.() ?? -1,
      env: process.env,
      run,
      now: Date.now,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      ...deps,
    };
  }

  private get linux() {
    return this.deps.platform === "linux";
  }

  private get domain() {
    return `gui/${this.deps.uid}`;
  }

  private get configPath() {
    const xdg = this.deps.env.XDG_CONFIG_HOME;
    return this.linux
      ? join(xdg && isAbsolute(xdg) ? xdg : join(this.deps.home, ".config"), "systemd/user", UNIT)
      : join(this.deps.home, "Library/LaunchAgents", `${LABEL}.plist`);
  }

  private get command() {
    return this.linux ? "/usr/bin/systemctl" : "/bin/launchctl";
  }

  private async query(args: string[]) {
    try {
      // systemctl restart waits for the unit's graceful 45-second shutdown first.
      const timeout = ["start", "restart", "bootstrap", "kickstart"].includes(args[0] ?? "")
        ? 65_000
        : 15_000;
      // A GUI-domain listing includes other jobs and can exceed 128 KiB on normal desktops.
      const maxBuffer =
        !this.linux && args[0] === "print" && args[1] === this.domain ? 1024 * 1024 : 128 * 1024;
      return await this.deps.run(this.command, this.linux ? ["--user", ...args] : args, {
        timeout,
        maxBuffer,
      });
    } catch {
      return { code: 1, stdout: "" };
    }
  }

  private async change(args: string[]) {
    if ((await this.query(args)).code !== 0) {
      throw new Error(
        `Could not ${args[0]} the OpenCode login service. Check your ${this.linux ? "systemd user manager" : "launchd GUI session"} and retry. No unmanaged service was started.`,
      );
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work, work).catch((error: unknown) => {
      if (typeof (error as NodeJS.ErrnoException)?.code === "string") {
        throw new Error(
          "Cannot safely update the OpenCode login configuration. Check directory ownership, permissions, and available disk space, then retry.",
        );
      }
      throw error;
    });
    this.pending = result.catch(() => {});
    return result;
  }

  private pathEnvironment(): string {
    return (
      (this.deps.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")
        .split(":")
        .filter((entry) => isAbsolute(entry) && validText(entry))
        .join(":") || "/usr/bin:/bin"
    );
  }

  private render(binary: string, path: string): string {
    if (this.linux) {
      return LEGACY.replace(
        "ExecStart=%h/.bun/bin/opencode2 serve --service",
        () =>
          `ExecStart=${unitQuote(binary)} serve --service\nEnvironment=${unitQuote(`PATH=${path}`).replace(/\$\$/g, "$")}`,
      );
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Managed by Palot: local OpenCode login service. -->
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(binary)}</string><string>serve</string><string>--service</string></array>
<key>WorkingDirectory</key><string>${xml(this.deps.home)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>3</integer>
</dict></plist>
`;
  }

  private conflict(): never {
    throw new Error(
      "An unrecognized or unsafe OpenCode login service already exists. Remove or migrate the conflicting user service manually before letting Palot manage login startup.",
    );
  }

  private async checkParents() {
    let directory = dirname(this.configPath);
    while (directory !== parse(directory).root) {
      const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (
        stat &&
        (!stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (stat.uid !== 0 && stat.uid !== this.deps.uid) ||
          ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && stat.mode & 0o1000)))
      )
        this.conflict();
      directory = dirname(directory);
    }
  }

  private async readConfig(): Promise<Config | null> {
    await this.checkParents();
    let handle;
    try {
      handle = await fs.open(
        this.configPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.conflict();
    }
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== this.deps.uid ||
        stat.mode & 0o022 ||
        stat.size > 64 * 1024
      ) {
        this.conflict();
      }
      const text = await handle.readFile("utf8");
      if (this.linux && (text === LEGACY || text === LEGACY_CANONICAL)) {
        return {
          text,
          binary: join(
            this.deps.home,
            text === LEGACY ? ".bun/bin/opencode2" : ".bun/bin/opencode",
          ),
          path: "",
        };
      }
      let binary: string | undefined;
      let path: string | undefined;
      if (this.linux) {
        const decode = (value: string) => value.replace(/\\([\\"])/g, "$1").replace(/%%/g, "%");
        binary = text.match(/^ExecStart="((?:\\.|[^"\\])*)" serve --service$/m)?.[1];
        path = text.match(/^Environment="PATH=((?:\\.|[^"\\])*)"$/m)?.[1];
        if (binary !== undefined) binary = decode(binary).replace(/\$\$/g, "$");
        if (path !== undefined) path = decode(path);
      } else {
        binary = text.match(/<key>ProgramArguments<\/key><array><string>([^<]*)<\/string>/)?.[1];
        path = text.match(/<key>PATH<\/key><string>([^<]*)<\/string>/)?.[1];
        if (binary !== undefined) binary = unxml(binary);
        if (path !== undefined) path = unxml(path);
      }
      if (
        !binary ||
        path === undefined ||
        !isAbsolute(binary) ||
        !validText(binary) ||
        !validText(path) ||
        text !== this.render(binary, path)
      ) {
        this.conflict();
      }
      return { text, binary, path };
    } finally {
      await handle.close();
    }
  }

  private async inspect(): Promise<OpenCodeLoginStatus> {
    const manager = this.linux ? "systemd" : this.deps.platform === "darwin" ? "launchd" : null;
    const result: OpenCodeLoginStatus = {
      manager,
      supported: false,
      enabled: false,
      owned: false,
      running: false,
      pid: null,
      binaryPath: null,
      configPath: manager ? this.configPath : null,
      reason: null,
    };
    if (this.deps.env.PALOT_E2E_USER_DATA || this.deps.env.PALOT_RELEASE_SMOKE_USER_DATA) {
      return {
        ...result,
        manager: null,
        configPath: null,
        reason: "Login startup is unavailable in isolated test and release-smoke instances.",
      };
    }
    if (!manager || this.deps.uid <= 0) {
      result.reason = "Login startup requires a non-root Linux desktop or macOS GUI user session.";
      return result;
    }
    const config = await this.readConfig();
    result.owned = !!config;
    result.binaryPath = config?.binary ?? null;
    if (this.linux) {
      const target = await this.query([
        "show",
        "graphical-session.target",
        "--property=LoadState,ActiveState",
      ]);
      result.supported =
        target.code === 0 &&
        /^LoadState=loaded$/m.test(target.stdout) &&
        /^ActiveState=active$/m.test(target.stdout);
      if (!result.supported)
        result.reason =
          "Login startup requires an active, integrated systemd graphical-session.target. Palot does not enable lingering or modify your desktop session.";
      const unit = await this.query([
        "show",
        UNIT,
        "--property=LoadState,ActiveState,MainPID,FragmentPath,DropInPaths,UnitFileState",
      ]);
      if (unit.code !== 0) {
        result.supported = false;
        result.reason =
          "Cannot inspect the systemd user service. Check your user manager and retry.";
        return result;
      }
      const fragment = unit.stdout.match(/^FragmentPath=(.*)$/m)?.[1];
      const dropins = unit.stdout.match(/^DropInPaths=(.*)$/m)?.[1];
      if (
        (fragment && fragment !== this.configPath) ||
        dropins ||
        (!config && fragment) ||
        /^LoadState=masked$/m.test(unit.stdout)
      )
        this.conflict();
      result.pid = servicePID(unit.stdout, /^MainPID=(\d+)$/m);
      result.running =
        result.pid !== null ||
        /^ActiveState=(active|activating|reloading|deactivating)$/m.test(unit.stdout);
      if (!config && result.running) this.conflict();
      result.enabled = !!config && /^UnitFileState=enabled$/m.test(unit.stdout);
    } else {
      const gui = await this.query(["print", this.domain]);
      result.supported = gui.code === 0;
      if (!result.supported) {
        result.reason =
          "Login startup requires your active macOS GUI launchd domain. Sign in to the desktop and retry.";
        return result;
      }
      const disabled = await this.query(["print-disabled", this.domain]);
      if (disabled.code !== 0)
        throw new Error(
          "Cannot inspect launchd login overrides. Check your GUI session and retry.",
        );
      result.enabled =
        !!config &&
        !new RegExp(`"${LABEL.replace(/\./g, "\\.")}"\\s*=>\\s*(?:disabled|true)\\b`).test(
          disabled.stdout,
        );
      const job = await this.query(["print", `${this.domain}/${LABEL}`]);
      if (job.code === 0) {
        const jobPath = job.stdout.match(/^\s*path = (.+)$/m)?.[1];
        const program = job.stdout.match(/^\s*program = (.+)$/m)?.[1];
        // A matching owned registration remains disable-able if its launcher was removed.
        // Resolve aliases only when launchd reports a different executable spelling.
        if (
          !config ||
          jobPath !== this.configPath ||
          !program ||
          (program !== config.binary &&
            (await this.canonical(program)) !== (await this.canonical(config.binary)))
        )
          this.conflict();
        result.pid = servicePID(job.stdout, /^\s*pid = (\d+)$/m);
        // A loaded, idle launchd job still owns explicit starts, even when disabled.
        result.running =
          result.pid !== null || /^\s*state = (running|waiting|spawn scheduled)$/m.test(job.stdout);
      }
    }
    return result;
  }

  async status(): Promise<OpenCodeLoginStatus> {
    try {
      return await this.inspect();
    } catch (error) {
      return {
        manager: this.linux ? "systemd" : this.deps.platform === "darwin" ? "launchd" : null,
        supported: false,
        enabled: false,
        owned: false,
        running: false,
        pid: null,
        binaryPath: null,
        configPath: this.configPath,
        reason:
          error instanceof Error &&
          /^(An unrecognized|Cannot inspect|The login service executable)/.test(error.message)
            ? error.message
            : "Cannot safely inspect the OpenCode login configuration. Check its ownership and permissions.",
      };
    }
  }

  private async canonical(path: string) {
    try {
      if (!isAbsolute(path) || !validText(path)) throw new Error();
      return await fs.realpath(path);
    } catch {
      throw new Error(
        "The login service executable is unavailable. Select an installed OpenCode CLI and register login startup again.",
      );
    }
  }

  private async writeConfig(binary: string, previous: Config | null) {
    await this.checkParents();
    await fs.mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    const directory = await fs.lstat(dirname(this.configPath));
    if (directory.uid !== this.deps.uid || directory.mode & 0o022) this.conflict();
    const temporary = `${this.configPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, this.render(binary, this.pathEnvironment()), {
        mode: 0o600,
        flag: "wx",
      });
      if ((await this.readConfig())?.text !== previous?.text) this.conflict();
      await fs.rename(temporary, this.configPath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  enable(binary: Binary): Promise<OpenCodeLoginStatus> {
    return this.serial(async () => {
      const state = await this.inspect();
      if (!state.supported) throw new Error(state.reason!);
      const canonical = await this.canonical(binary.path);
      const previous = await this.readConfig();
      // Updating a loaded launchd job requires bootout, which would stop it. Never do that here.
      if (!this.linux && previous && (await this.canonical(previous.binary)) !== canonical) {
        const loaded = await this.query(["print", `${this.domain}/${LABEL}`]);
        if (loaded.code === 0)
          throw new Error(
            "The loaded login agent uses another executable. Sign out before registering a different OpenCode installation.",
          );
      }
      // Retain the approved package-manager launcher rather than its versioned store target.
      await this.writeConfig(binary.path, previous);
      if (this.linux) {
        await this.change(["daemon-reload"]);
        await this.change(["enable", UNIT]);
      } else {
        await this.change(["enable", `${this.domain}/${LABEL}`]);
      }
      return this.status();
    });
  }

  disable(): Promise<OpenCodeLoginStatus> {
    return this.serial(async () => {
      const state = await this.inspect();
      if (!state.owned) return state;
      // Keep the private registration to recognize a still-running disabled service.
      await this.change(this.linux ? ["disable", UNIT] : ["disable", `${this.domain}/${LABEL}`]);
      return this.status();
    });
  }

  private async restartLaunchAgent(pid: number): Promise<void> {
    const target = `${this.domain}/${LABEL}`;
    await this.change(["kill", "SIGTERM", target]);
    const deadline = this.deps.now() + 45_000;
    while (this.deps.now() < deadline) {
      const job = await this.query(["print", target]);
      if (job.code !== 0) {
        throw new Error(
          "The login agent disappeared during restart. Register login startup again and retry; Palot did not start an unmanaged replacement.",
        );
      }
      const currentPID = servicePID(job.stdout, /^\s*pid = (\d+)$/m);
      // KeepAlive may already have replaced the gracefully terminated process.
      if (currentPID !== null && currentPID !== pid) return;
      if (currentPID === null) {
        await this.change(["kickstart", target]);
        return;
      }
      await this.deps.sleep(250);
    }
    throw new Error(
      "OpenCode did not exit within 45 seconds after SIGTERM. Let active work finish or sign out before retrying. Palot did not force-kill the service.",
    );
  }

  control(action: "start" | "restart", binary: Binary, sharedPID: number | null): Promise<boolean> {
    return this.serial(async () => {
      const state = await this.inspect();
      if (!state.owned) {
        if (state.reason?.startsWith("Cannot inspect")) throw new Error(state.reason);
        return false;
      }
      if (!state.enabled && !state.running) return false;
      if (!state.supported) throw new Error(state.reason!);
      if ((await this.canonical(state.binaryPath!)) !== (await this.canonical(binary.path))) {
        throw new Error(
          "The login service uses another OpenCode installation. Select that installation or register login startup with the selected CLI before starting it.",
        );
      }
      if (sharedPID !== null && sharedPID !== state.pid) {
        throw new Error(
          "Another OpenCode process owns the shared service. Stop it explicitly before handing control to the login service; Palot will not take it over automatically.",
        );
      }
      if (this.linux) {
        await this.change([action, UNIT]);
      } else {
        const loaded = await this.query(["print", `${this.domain}/${LABEL}`]);
        if (loaded.code !== 0) {
          // Bootstrap is restricted to an explicit start/restart. RunAtLoad starts the job.
          await this.change(["bootstrap", this.domain, this.configPath]);
        } else if (action === "restart" && state.pid !== null) {
          await this.restartLaunchAgent(state.pid);
        } else {
          await this.change(["kickstart", `${this.domain}/${LABEL}`]);
        }
      }
      return true;
    });
  }
}

let singleton: OpenCodeLoginAutostart | undefined;

export function getOpenCodeLoginAutostart(): OpenCodeLoginAutostart {
  return (singleton ??= new OpenCodeLoginAutostart());
}
