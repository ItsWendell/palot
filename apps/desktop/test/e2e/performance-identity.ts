import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const manifestPath = fileURLToPath(new URL("../../package.json", import.meta.url));

/** Only allowlisted, non-secret controls are retained, never the whole environment. */
export const PERFORMANCE_BUILD_FLAGS = [
  "PALOT_REACT_PROFILING",
  "PALOT_REACT_COMPILER",
  "PALOT_REACT_SCAN",
  "PALOT_PERFORMANCE_HARNESS",
  "PALOT_DISABLE_GLASS",
  "PALOT_E2E_TRACE",
  "PALOT_E2E_VIDEO",
  "PALOT_E2E_APP_TRACE",
  "PALOT_E2E_CSS_SELECTOR_STATS",
  "PALOT_E2E_RENDERER_OPAQUE",
  "PALOT_E2E_RENDERER_GLASS",
  "PALOT_E2E_DISABLE_COMPOSER_BACKDROP",
] as const;

export interface PerformanceRunIdentity {
  schemaVersion: 1;
  capturedAt: string;
  scenario: string | null;
  source: { revision: string | null; dirty: boolean | null };
  host: {
    platform: string | null;
    release: string | null;
    architecture: string | null;
    cpuModel: string | null;
    logicalCores: number | null;
    totalMemoryBytes: number | null;
    freeMemoryBytes: number | null;
    /** Instantaneous context, not a controlled-load or power-state measurement. */
    loadAverage: number[] | null;
  };
  runner: { node: string | null; bun: string | null };
  /** Declared manifest versions, not proof of the installed/runtime versions. */
  declaredVersions: Record<
    | "react"
    | "react-dom"
    | "@opencode/client"
    | "@opencode/protocol"
    | "@playwright/test"
    | "electron",
    string | null
  >;
  build: {
    mode: "production";
    flags: Record<(typeof PERFORMANCE_BUILD_FLAGS)[number], string | null>;
  };
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function command(binary: string, args: string[]): string | null {
  return attempt(() =>
    execFileSync(binary, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim(),
  );
}

/** Capture once before any measured interaction; never samples during the action. */
export function capturePerformanceIdentity(): PerformanceRunIdentity {
  const manifest = attempt(
    () =>
      JSON.parse(readFileSync(manifestPath, "utf8")) as {
        devDependencies?: Record<string, string>;
      },
  );
  const processors = attempt(cpus);
  const status = command("git", ["status", "--porcelain", "--untracked-files=normal"]);
  const version = (name: string) => manifest?.devDependencies?.[name] ?? null;
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    scenario: process.env.PALOT_E2E_SCENARIO ?? null,
    source: {
      revision: command("git", ["rev-parse", "HEAD"]),
      dirty: status === null ? null : status.length > 0,
    },
    host: {
      platform: attempt(platform),
      release: attempt(release),
      architecture: attempt(arch),
      cpuModel: processors?.[0]?.model ?? null,
      logicalCores: processors?.length || null,
      totalMemoryBytes: attempt(totalmem),
      freeMemoryBytes: attempt(freemem),
      loadAverage: process.platform === "win32" ? null : attempt(loadavg),
    },
    runner: {
      node: process.versions.node ?? null,
      bun: process.versions.bun ?? command("bun", ["--version"]),
    },
    declaredVersions: {
      react: version("react"),
      "react-dom": version("react-dom"),
      "@opencode/client": version("@opencode/client"),
      "@opencode/protocol": version("@opencode/protocol"),
      "@playwright/test": version("@playwright/test"),
      electron: version("electron"),
    },
    build: {
      mode: "production",
      flags: Object.fromEntries(
        PERFORMANCE_BUILD_FLAGS.map((name) => [
          name,
          process.env[name] ??
            (name === "PALOT_REACT_COMPILER"
              ? "disabled"
              : name === "PALOT_REACT_PROFILING" || name === "PALOT_PERFORMANCE_HARNESS"
                ? "0"
                : null),
        ]),
      ) as PerformanceRunIdentity["build"]["flags"],
    },
  };
}
