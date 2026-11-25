import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergePath,
  parseShellEnvironment,
  parseShellProbeOutput,
  probeShellEnvironment,
  shellProbeCommand,
  type SpawnShell,
} from "./shell-environment";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn(() => true);

  exit(output: string, status = 0): void {
    this.stdout.emit("data", Buffer.from(output));
    this.exitCode = status;
    this.emit("close", status);
  }
}

/** Each call hands out the next scripted child; the script decides how it behaves. */
function fakeSpawn(...scripts: Array<(child: FakeChild) => void>) {
  const children: FakeChild[] = [];
  const spawn = vi.fn((_shell: string, _args: readonly string[]) => {
    const child = new FakeChild();
    children.push(child);
    const script = scripts[children.length - 1];
    queueMicrotask(() => script?.(child));
    return child;
  });
  return { spawn, children, asSpawn: spawn as unknown as SpawnShell };
}

describe("shell environment", () => {
  it("parses null-delimited values without splitting embedded equals signs", () => {
    expect(parseShellEnvironment(Buffer.from("PATH=/opt/homebrew/bin\0TOKEN=a=b\0\0"))).toEqual({
      PATH: "/opt/homebrew/bin",
      TOKEN: "a=b",
    });
  });

  it("prefers shell paths while preserving unique app paths", () => {
    expect(
      mergePath(
        ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
        ["/usr/bin", "/bin"].join(path.delimiter),
      ),
    ).toBe(["/opt/homebrew/bin", "/usr/bin", "/bin"].join(path.delimiter));
  });

  it("clears DEBUG traps only in shells that support them", () => {
    for (const shell of ["/bin/bash", "/usr/bin/zsh", "/bin/sh", "/bin/ksh", "/bin/ksh93"]) {
      expect(shellProbeCommand(shell)).toMatch(/^\(trap - DEBUG\) 2>\/dev\/null && trap - DEBUG; /);
    }
    expect(shellProbeCommand("/usr/bin/fish")).not.toContain("trap");
  });

  it.runIf(existsSync("/bin/bash"))(
    "ignores what a DEBUG trap and rc files print before the environment",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "palot-shell-env-"));
      try {
        const bashEnv = path.join(directory, "env.bash");
        await writeFile(bashEnv, `echo rc-noise\ntrap 'echo -n "trap:$BASH_COMMAND"' DEBUG\n`);
        const output = execFileSync("/bin/bash", ["-c", shellProbeCommand("/bin/bash")], {
          env: { PATH: "/usr/bin:/bin", BASH_ENV: bashEnv, PALOT_SHELL_TEST: "1" },
        });
        const environment = parseShellProbeOutput(output);
        expect(environment.PALOT_SHELL_TEST).toBe("1");
        expect(Object.keys(environment).every((name) => /^\w+$/.test(name))).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("resolves with the variables the shell printed", async () => {
    const { spawn, asSpawn } = fakeSpawn((child) => {
      child.stdout.emit("data", Buffer.from("PATH=/opt/bin\0TO"));
      child.exit("KEN=a=b\0");
    });

    await expect(probeShellEnvironment("/bin/zsh", "-il", asSpawn)).resolves.toEqual({
      type: "loaded",
      environment: { PATH: "/opt/bin", TOKEN: "a=b" },
    });
    expect(spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-il", "-c", shellProbeCommand("/bin/zsh")],
      expect.objectContaining({ stdio: ["ignore", "pipe", "ignore"] }),
    );
  });

  it("kills a shell that never exits and reports a timeout", async () => {
    const { children, asSpawn } = fakeSpawn(() => undefined);

    await expect(probeShellEnvironment("/bin/zsh", "-il", asSpawn, 10)).resolves.toEqual({
      type: "timeout",
    });
    expect(children[0]?.kill).toHaveBeenCalledOnce();
  });

  it("reports a non-zero exit as failed", async () => {
    const { asSpawn } = fakeSpawn((child) => child.exit("PATH=/opt/bin\0", 1));

    await expect(probeShellEnvironment("/bin/zsh", "-l", asSpawn)).resolves.toEqual({
      type: "failed",
    });
  });
});

describe("hydrating the login shell environment", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.SHELL = "/bin/bash";
    process.env.PATH = "/usr/bin";
    delete process.env.PALOT_SHELL_TEST;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it("falls back to a login shell when the interactive probe errors", async () => {
    const { hydrateShellEnvironment } = await import("./shell-environment");
    const { spawn, asSpawn } = fakeSpawn(
      (child) => child.emit("error", new Error("spawn EACCES")),
      (child) => child.exit("PALOT_SHELL_TEST=1\0PATH=/opt/bin:/usr/bin\0"),
    );

    await hydrateShellEnvironment(asSpawn);

    expect(spawn.mock.calls.map(([, args]) => args[0])).toEqual(["-il", "-l"]);
    expect(process.env.PALOT_SHELL_TEST).toBe("1");
    expect(process.env.PATH).toBe(["/opt/bin", "/usr/bin"].join(path.delimiter));
  });

  it("keeps variables the app already has", async () => {
    process.env.PALOT_SHELL_TEST = "app";
    const { hydrateShellEnvironment } = await import("./shell-environment");
    const { asSpawn } = fakeSpawn((child) => child.exit("PALOT_SHELL_TEST=shell\0"));

    await hydrateShellEnvironment(asSpawn);

    expect(process.env.PALOT_SHELL_TEST).toBe("app");
  });

  it("shares one probe between concurrent callers", async () => {
    const { hydrateShellEnvironment } = await import("./shell-environment");
    const { spawn, asSpawn } = fakeSpawn((child) => child.exit("PALOT_SHELL_TEST=1\0"));

    const first = hydrateShellEnvironment(asSpawn);
    const second = hydrateShellEnvironment(asSpawn);
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(spawn).toHaveBeenCalledOnce();
  });
});
