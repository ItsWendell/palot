// @vitest-environment node

import { describe, expect, it } from "vitest";
import { runScenarios, summaryLines, type AttemptResult } from "./e2e-batch.ts";

function scripted(results: Record<string, boolean[]>) {
  const calls: string[] = [];
  return {
    calls,
    attempt: async (name: string): Promise<AttemptResult> => {
      const passed = results[name]!.shift()!;
      calls.push(name);
      return { passed, runRoot: passed ? null : `/runs/${name}-${calls.length}`, durationMs: 1 };
    },
  };
}

describe("E2E batch", () => {
  it("reports a pass on retry as flaky and keeps retrying only failed scenarios", async () => {
    const runner = scripted({
      smoke: [true],
      usage: [false, true],
      onboarding: [false, false],
    });
    const outcomes = await runScenarios(["smoke", "usage", "onboarding"], {
      retries: 1,
      attempt: runner.attempt,
    });
    expect(runner.calls).toEqual(["smoke", "usage", "usage", "onboarding", "onboarding"]);
    expect(outcomes.map(({ name, status }) => [name, status])).toEqual([
      ["smoke", "passed"],
      ["usage", "flaky"],
      ["onboarding", "failed"],
    ]);
    expect(summaryLines(outcomes)).toEqual([
      "passed  smoke",
      "flaky   usage       failed attempt kept: /runs/usage-2",
      "failed  onboarding  /runs/onboarding-5",
      "3 scenarios: 1 passed, 1 flaky, 1 failed",
    ]);
  });

  it("fails without retrying when no retries are allowed", async () => {
    const runner = scripted({ smoke: [false, true] });
    const outcomes = await runScenarios(["smoke"], { retries: 0, attempt: runner.attempt });
    expect(runner.calls).toEqual(["smoke"]);
    expect(outcomes[0]?.status).toBe("failed");
  });

  it("skips the remaining scenarios once the batch is stopped", async () => {
    let stopped = false;
    const outcomes = await runScenarios(["smoke", "usage"], {
      retries: 1,
      stopped: () => stopped,
      attempt: async () => {
        stopped = true;
        return { passed: false, runRoot: null, durationMs: 1, error: "interrupted" };
      },
    });
    expect(outcomes.map(({ status }) => status)).toEqual(["failed", "skipped"]);
    expect(summaryLines(outcomes).at(-1)).toBe(
      "2 scenarios: 0 passed, 0 flaky, 1 failed, 1 skipped",
    );
  });
});
