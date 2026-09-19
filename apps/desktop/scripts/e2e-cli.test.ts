// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import packageJson from "../package.json";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const entrypoint = fileURLToPath(new URL("./e2e.ts", import.meta.url));
const version = packageJson.devDependencies["@opencode/client"];
let directory: string;
let preload: string;
let invocation = 0;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "palot-e2e-cli-"));
  preload = path.join(directory, "guard.cjs");
  // Run the real CLI, but make accidental builds, services, or Electron access fail safely.
  await writeFile(
    preload,
    `const childProcess = require("node:child_process");
const Module = require("node:module");
const { promisify } = require("node:util");
const forbidden = (operation) => {
  console.error("FORBIDDEN: " + operation);
  throw new Error("FORBIDDEN: " + operation);
};
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (process.env.TEST_BUILD_FAILURE && command === "bun") {
    return spawn(process.execPath, ["-e", "console.log('fixture build stdout'); console.error('fixture build stderr'); process.exit(17)"], options);
  }
  if (process.env.TEST_SERVICE_FAILURE && (command === "bun" || command === "git")) {
    return spawn(process.execPath, ["-e", "console.log('fixture prerequisite completed')"], options);
  }
  return forbidden("spawn");
};
childProcess.execFile = () => forbidden("execFile");
if (process.env.TEST_OPENCODE_VERSION) {
  require("node:fs/promises").access = async () => {};
  childProcess.execFile[promisify.custom] = async (command, args) => ({
    stdout: command === "git" && args[0] === "rev-parse"
      ? process.env.TEST_ARTIFACT_CHECKOUT + "/.git\\n"
      : process.env.TEST_OPENCODE_VERSION + "\\n",
    stderr: "",
  });
}
const load = Module._load;
Module._load = function(id, ...args) {
  if (id === "electron") return process.env.TEST_BUILD_FAILURE || process.env.TEST_SERVICE_FAILURE ? process.execPath : forbidden("electron");
  return load.call(this, id, ...args);
};
Module.syncBuiltinESMExports();
if (process.env.TEST_SERVICE_FAILURE) {
  const service = "export const Service = { ensure: async () => { throw new Error('fixture service startup timeout', { cause: new Error('fixture stderr detail') }); }, stop: async ({file}) => console.log('FIXTURE_SERVICE_STOP:' + file) };";
  Module.registerHooks({ resolve(id, context, next) {
    if (id === '@opencode/client/service') return { url: 'data:text/javascript,' + encodeURIComponent(service), shortCircuit: true };
    return next(id, context);
  }});
}
if (process.env.TEST_VIDEO_MISSING) {
  const video = "export const assertVideoPrerequisites = async () => { throw new Error('ffmpeg is required for --video'); }; export const startVideoCapture = () => { throw new Error('capture must not start'); };";
  Module.registerHooks({ resolve(id, context, next) {
    if (id.endsWith('/test/e2e/video.ts')) return { url: 'data:text/javascript,' + encodeURIComponent(video), shortCircuit: true };
    return next(id, context);
  }});
}
`,
  );
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function runCli(
  args: string[],
  options: {
    rootScript?: boolean;
    version?: string;
    buildFailure?: boolean;
    serviceFailure?: boolean;
    videoMissing?: boolean;
  } = {},
) {
  const checkout = path.join(directory, `run-${invocation++}`);
  const result = spawnSync(
    options.rootScript ? "bun" : "node",
    options.rootScript
      ? ["run", "test:e2e", "--", ...args]
      : ["--experimental-strip-types", entrypoint, ...args],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload)}`,
        OPENCODE_BIN: path.join(directory, "opencode2"),
        TEST_OPENCODE_VERSION: options.version ?? "",
        TEST_ARTIFACT_CHECKOUT: checkout,
        TEST_BUILD_FAILURE: options.buildFailure ? "1" : "",
        TEST_SERVICE_FAILURE: options.serviceFailure ? "1" : "",
        TEST_VIDEO_MISSING: options.videoMissing ? "1" : "",
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, checkout };
}

describe("E2E CLI", () => {
  it("allows explicit supported runtime qualification without changing the client pin", () => {
    const result = runCli(["--opencode-version", version, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Requires OpenCode ${version}`);
    expect(result.stderr).not.toContain("FORBIDDEN");
  });

  it.each(["1.11.0", "2.0.3", "3.0.0", "0.0.0-beta-19507", "0.0.0-beta-19599", "latest"])(
    "rejects unqualified runtime override %s before starting processes",
    (runtime) => {
      const result = runCli(["--opencode-version", runtime, "--help"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("supported stable 2.x or reviewed beta");
      expect(result.stderr).not.toContain("FORBIDDEN");
    },
  );
  it.each([["--help"], ["--list"], ["--video", "--help"]])(
    "handles discovery without binaries or child processes: %j",
    async (...args) => {
      const result = runCli(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(args.includes("--help") ? "Examples:" : "smoke:");
      expect(result.stderr).not.toContain("FORBIDDEN:");
      await expect(stat(result.checkout)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("accepts the root Bun script's separator", () => {
    const result = runCli(["--help"], { rootScript: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Examples:");
    expect(result.stderr).not.toContain("FORBIDDEN:");
  });

  it("checks video prerequisites before build and records visible capture intent", async () => {
    const result = runCli(["smoke", "--video"], {
      version: `opencode2 v${version}`,
      videoMissing: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ffmpeg is required for --video");
    expect(result.stderr).not.toContain("FORBIDDEN:");
    const artifacts = path.join(result.checkout, ".local/desktop-e2e");
    const [run] = await readdir(artifacts);
    const manifest = JSON.parse(
      await readFile(path.join(artifacts, run!, "instance.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      video: true,
      hidden: false,
      inactive: true,
      failure: { phase: "prerequisites" },
    });
  });

  it.each([
    { args: ["--typo"], error: "Unknown option" },
    { args: ["smoke", "diagnostics"], error: "only one E2E scenario" },
    { args: ["toString"], error: "Unknown E2E scenario" },
    { args: ["--trace", "--app-trace"], error: "cannot run together" },
  ])("rejects $args before accessing binaries or building", ({ args, error }) => {
    const result = runCli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(error);
    expect(result.stderr).toContain("Use --help");
    expect(result.stderr).not.toContain("FORBIDDEN:");
    expect(result.stdout).toBe("");
  });

  it("rejects a version prefix match before Electron or build", () => {
    const result = runCli(["smoke"], { version: `opencode2 v${version}0` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`OpenCode ${version} is required`);
    expect(result.stderr).toContain("OPENCODE_BIN");
    expect(result.stderr).not.toContain("FORBIDDEN:");
  });

  it("accepts the real CLI's version output before resolving Electron", () => {
    const result = runCli([], { version: `opencode2 v${version}` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FORBIDDEN: electron");
    expect(result.stderr).not.toContain("FORBIDDEN: spawn");
    expect(result.stderr).not.toContain(`OpenCode ${version} is required`);
  });

  it.each([
    { args: [], hidden: true, inactive: false },
    { args: ["--visible"], hidden: false, inactive: true },
    { args: ["--focus"], hidden: false, inactive: false },
    { args: ["--profile"], hidden: false, inactive: true },
    { args: ["--showcase"], hidden: false, inactive: false },
  ])(
    "records host-window visibility for $args without a display subprocess",
    async ({ args, hidden, inactive }) => {
      const result = runCli(["smoke", ...args], { version: `opencode2 v${version}` });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FORBIDDEN: electron");
      expect(result.stderr).not.toContain("FORBIDDEN: spawn");
      const artifacts = path.join(result.checkout, ".local/desktop-e2e");
      const [run] = await readdir(artifacts);
      if (!run) throw new Error("Expected prerequisite failure artifacts");
      const manifest = JSON.parse(
        await readFile(path.join(artifacts, run, "instance.json"), "utf8"),
      );
      expect(manifest).toMatchObject({ hidden, inactive });
    },
  );

  it("retains early build failure metadata and both console streams without launching a service", async () => {
    const result = runCli(["smoke", "--inspect-on-failure"], {
      version: `opencode2 v${version}`,
      buildFailure: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("FORBIDDEN:");
    const artifacts = path.join(result.checkout, ".local/desktop-e2e");
    const [run] = await readdir(artifacts);
    if (!run) throw new Error("Expected early failure artifacts");
    const root = path.join(artifacts, run);
    const manifest = JSON.parse(await readFile(path.join(root, "instance.json"), "utf8"));
    expect(manifest).toMatchObject({
      runnerPID: expect.any(Number),
      status: "failed",
      phase: "finished",
      failure: { phase: "build", status: "failed", error: "build exited with 17" },
      // The lifecycle preserves nonzero child exits during release as well as
      // the primary build failure; successful process termination is not a
      // successful build. Keep both pieces of failure evidence in the manifest.
      cleanup: {
        status: "failed",
        errors: [
          {
            resource: expect.stringMatching(/^build process group \(leader PID \d+\)$/),
            error: "build exited with 17 during cleanup",
          },
        ],
      },
      processes: [{ name: "build", pid: expect.any(Number), closed: true, code: 17 }],
    });
    const log = await readFile(path.join(root, "build.log"), "utf8");
    expect(log).toContain("fixture build stdout");
    expect(log).toContain("fixture build stderr");
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, "instance.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(root, "build.log"))).mode & 0o777).toBe(0o600);
  });

  it("reports uncertain cleanup after ensure rejects even when registered-service stop succeeds", async () => {
    const result = runCli(["smoke", "--inspect-on-failure"], {
      version: `opencode2 v${version}`,
      serviceFailure: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("FORBIDDEN:");
    const artifacts = path.join(result.checkout, ".local/desktop-e2e");
    const [run] = await readdir(artifacts);
    if (!run) throw new Error("Expected service startup failure artifacts");
    const root = path.join(artifacts, run);
    expect(result.stdout).toContain(
      `FIXTURE_SERVICE_STOP:${root}/home/.local/state/opencode/service.json`,
    );
    expect(result.stdout).not.toContain("cleanup complete");
    expect(result.stdout).not.toContain("agent-browser connect");
    expect(result.stderr).toContain("cleanup remains uncertain");
    const manifest = JSON.parse(await readFile(path.join(root, "instance.json"), "utf8"));
    expect(manifest).toMatchObject({
      status: "failed",
      failure: { phase: "service", error: "fixture service startup timeout" },
      cleanup: {
        status: "uncertain",
        errors: [],
        uncertainties: [expect.stringContaining("An unregistered process may survive")],
      },
    });
    const errorLog = path.join(root, "service-startup-error.log");
    expect(await readFile(errorLog, "utf8")).toContain("fixture stderr detail");
    expect((await stat(errorLog)).mode & 0o777).toBe(0o600);
  });
});
