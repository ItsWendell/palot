/** Runs several E2E scenarios one after another, each in its own runner process. */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type AttemptResult = {
  passed: boolean;
  /** The attempt's run directory while it still exists; successful runs are removed. */
  runRoot: string | null;
  durationMs: number;
  error?: string;
};
export type ScenarioStatus = "passed" | "flaky" | "failed" | "skipped";
export type ScenarioOutcome = {
  name: string;
  status: ScenarioStatus;
  attempts: AttemptResult[];
  /** Why a scenario was skipped without an attempt, such as `needs --profile`. */
  reason?: string;
};

/** Runs each scenario until it passes or has used `retries` extra attempts. */
export async function runScenarios(
  names: readonly string[],
  options: {
    retries: number;
    attempt: (name: string) => Promise<AttemptResult>;
    /** Checked before every attempt; a stopped batch skips the rest. */
    stopped?: () => boolean;
  },
): Promise<ScenarioOutcome[]> {
  const outcomes: ScenarioOutcome[] = [];
  for (const name of names) {
    const attempts: AttemptResult[] = [];
    while (attempts.length <= options.retries && !options.stopped?.()) {
      const result = await options.attempt(name);
      attempts.push(result);
      if (result.passed) break;
    }
    outcomes.push({ name, status: scenarioStatus(attempts), attempts });
  }
  return outcomes;
}

export function scenarioStatus(attempts: readonly AttemptResult[]): ScenarioStatus {
  const last = attempts.at(-1);
  if (!last) return "skipped";
  if (!last.passed) return "failed";
  return attempts.length === 1 ? "passed" : "flaky";
}

export function totals(outcomes: readonly ScenarioOutcome[]): Record<ScenarioStatus, number> {
  const counts = { passed: 0, flaky: 0, failed: 0, skipped: 0 };
  for (const outcome of outcomes) counts[outcome.status] += 1;
  return counts;
}

export function summaryLines(outcomes: readonly ScenarioOutcome[]): string[] {
  const width = Math.max(...outcomes.map((outcome) => outcome.name.length), 0);
  const lines = outcomes.map((outcome) => {
    const retained = outcome.attempts.flatMap((attempt) =>
      !attempt.passed && attempt.runRoot ? [attempt.runRoot] : [],
    );
    const detail = outcome.reason
      ? outcome.reason
      : outcome.status === "failed"
        ? (retained.at(-1) ?? outcome.attempts.at(-1)?.error ?? "no run directory")
        : outcome.status === "flaky"
          ? `failed attempt kept: ${retained.join(", ") || "no run directory"}`
          : "";
    const label = `${outcome.status.padEnd(7)} ${outcome.name}`;
    return detail ? `${label.padEnd(width + 8)}  ${detail}` : label;
  });
  const count = totals(outcomes);
  lines.push(
    `${outcomes.length} scenarios: ${count.passed} passed, ${count.flaky} flaky, ${count.failed} failed` +
      (count.skipped ? `, ${count.skipped} skipped` : ""),
  );
  return lines;
}

type BatchOptions = {
  names: readonly string[];
  tier?: string;
  retries: number;
  /** Arguments every scenario run receives, apart from its name. */
  forwardedArgs: readonly string[];
  entrypoint: string;
  appRoot: string;
  artifactsRoot: string;
  /** Packaged executables are tested as they are, without a development build. */
  build: boolean;
  /** Build-time scenario identity: scenarios with different keys need their own build. */
  buildKey: (name: string) => string;
  /** Why a scenario can't run in this batch, such as a missing opt-in flag. */
  skipReason?: (name: string) => string | undefined;
};

/** Builds once per build key, runs every scenario in order, and returns the exit code. */
export async function runBatch(options: BatchOptions): Promise<number> {
  const startedAt = new Date();
  let interrupted: NodeJS.Signals | null = null;
  let current: ReturnType<typeof spawn> | null = null;
  const onSignal = (signal: NodeJS.Signals) => {
    interrupted ??= signal;
    // The runner owns its resources and cleans them up on the signal; wait for it.
    current?.kill(signal);
    console.error(`Palot E2E batch: ${signal}, stopping after the current scenario cleans up`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const resultDirectory = await mkdtemp(path.join(tmpdir(), "palot-e2e-batch-"));
  const groups = new Map<string, string[]>();
  const outcomes: ScenarioOutcome[] = [];
  for (const name of options.names) {
    const reason = options.skipReason?.(name);
    if (reason) {
      console.log(`Palot E2E batch: skipped ${name}: ${reason}`);
      outcomes.push({ name, status: "skipped", attempts: [], reason });
      continue;
    }
    const key = options.buildKey(name);
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  try {
    for (const [key, names] of groups) {
      if (options.build && !interrupted) {
        console.log(`Palot E2E batch: building${key ? ` for ${key}` : ""}`);
        const build = await runChild(
          "bun",
          ["run", "scripts/build.ts"],
          { ...process.env, PALOT_E2E_SCENARIO: names[0] },
          options.appRoot,
          (child) => (current = child),
        );
        current = null;
        if (build !== 0) {
          for (const name of names) {
            outcomes.push({
              name,
              status: "failed",
              attempts: [{ passed: false, runRoot: null, durationMs: 0, error: "build failed" }],
            });
          }
          continue;
        }
      }
      let attemptNumber = 0;
      outcomes.push(
        ...(await runScenarios(names, {
          retries: options.retries,
          stopped: () => interrupted !== null,
          attempt: async (name) => {
            const resultFile = path.join(resultDirectory, `${attemptNumber++}-${name}.json`);
            const started = Date.now();
            console.log(`Palot E2E batch: ${name}`);
            const code = await runChild(
              process.execPath,
              [...process.execArgv, options.entrypoint, name, ...options.forwardedArgs],
              {
                ...process.env,
                PALOT_E2E_PREBUILT: "1",
                PALOT_E2E_RESULT_FILE: resultFile,
              },
              options.appRoot,
              (child) => (current = child),
            );
            current = null;
            const runRoot = await readRunRoot(resultFile);
            return {
              passed: code === 0,
              runRoot: runRoot && existsSync(runRoot) ? runRoot : null,
              durationMs: Date.now() - started,
              ...(code === 0 ? {} : { error: `runner exited with ${code}` }),
            };
          },
        })),
      );
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await rm(resultDirectory, { recursive: true, force: true });
  }
  outcomes.sort((a, b) => options.names.indexOf(a.name) - options.names.indexOf(b.name));

  console.log("\nPalot E2E summary:");
  for (const line of summaryLines(outcomes)) console.log(`  ${line}`);
  const summaryFile = path.join(options.artifactsRoot, "last-run.json");
  await writeSummary(summaryFile, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ...(options.tier ? { tier: options.tier } : {}),
    retries: options.retries,
    interrupted,
    totals: totals(outcomes),
    scenarios: outcomes,
  });
  console.log(`Palot E2E summary: ${summaryFile}`);
  if (interrupted) return interrupted === "SIGINT" ? 130 : 143;
  return outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0;
}

async function writeSummary(file: string, summary: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function readRunRoot(file: string): Promise<string | null> {
  try {
    const { runRoot } = JSON.parse(await readFile(file, "utf8")) as { runRoot?: unknown };
    return typeof runRoot === "string" && runRoot ? runRoot : null;
  } catch {
    return null;
  }
}

function runChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  started: (child: ReturnType<typeof spawn>) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    started(child);
    child.once("error", (error) => {
      console.error(`Palot E2E batch: could not start ${command}: ${error.message}`);
      resolve(1);
    });
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
