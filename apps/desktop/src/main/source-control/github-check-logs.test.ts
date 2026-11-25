// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { GitHubCheckLogs, excerptOf, failedStepExcerpt } from "./github-check-logs";
import { GitHubApiError, type GitHubGateway } from "./github-client";
import { normalizePullRequestRef } from "./github-review";

const ref = normalizePullRequestRef({ host: "github.com", repository: "Acme/Web", number: 8 })!;
const input = { host: "github.com", repository: "acme/web", number: 8 };

const JOB_LOG = [
  "2026-11-10T10:00:00.1000000Z ##[group]Run actions/checkout@v4",
  "2026-11-10T10:00:01.2000000Z checked out",
  "2026-11-10T10:00:02.0000000Z ##[endgroup]",
  "2026-11-10T10:00:03.1000000Z ##[group]Run bun test",
  "2026-11-10T10:00:04.0000000Z \u001b[31mFAIL\u001b[0m src/a.test.ts > adds",
  "2026-11-10T10:00:04.5000000Z expected 3, received *** (masked)",
  "2026-11-10T10:00:05.0000000Z ##[error]Process completed with exit code 1.",
  "2026-11-10T10:00:06.0000000Z Post job cleanup.",
].join("\n");

const STEPS = [
  {
    name: "Checkout",
    conclusion: "success",
    started_at: "2026-11-10T10:00:00Z",
    completed_at: "2026-11-10T10:00:02Z",
  },
  {
    name: "Test",
    conclusion: "failure",
    started_at: "2026-11-10T10:00:03Z",
    completed_at: "2026-11-10T10:00:05Z",
  },
  { name: "Post", conclusion: "success", started_at: "2026-11-10T10:00:06Z" },
];

function gateway(overrides: Partial<Record<string, unknown>> = {}) {
  const answers: Record<string, unknown> = {
    "repos/acme/web/check-runs/11": { id: 11, app: { slug: "github-actions" } },
    "repos/acme/web/actions/jobs/11": { steps: STEPS },
    "repos/acme/web/check-runs/12": {
      id: 12,
      app: { slug: "circleci" },
      output: { summary: "Lint failed", text: "src/a.ts:1 no-unused-vars" },
    },
    ...overrides,
  };
  const rest = vi.fn(async ({ path }: { path: string }) => {
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new GitHubApiError("not-found", "missing");
    return { status: 200, data: answer, notModified: false };
  });
  const download = vi.fn(async ({ path }: { path: string }) => {
    const answer = answers[path] ?? JOB_LOG;
    if (answer instanceof Error) throw answer;
    return answer as string;
  });
  const github = {
    rest,
    download,
    graphql: vi.fn(),
    graphqlPartial: vi.fn(),
    credential: vi.fn(),
    pausedUntil: () => null,
  } as unknown as GitHubGateway;
  return { github, rest, download };
}

describe("check log excerpts", () => {
  it("reads an Actions job's failing step, without colour codes, timestamps or later steps", async () => {
    const { github } = gateway();
    const [log] = await new GitHubCheckLogs(github).read(ref, { ...input, checkRunIDs: [11] });
    expect(log).toEqual({
      checkRunID: 11,
      step: "Test",
      excerpt: [
        "Run bun test",
        "FAIL src/a.test.ts > adds",
        "expected 3, received *** (masked)",
        "##[error]Process completed with exit code 1.",
      ].join("\n"),
    });
  });

  it("uses another app's summary and text, and says unavailable when GitHub refuses", async () => {
    const { github } = gateway({
      "repos/acme/web/check-runs/13": { id: 13, app: { slug: "github-actions" } },
      "repos/acme/web/actions/jobs/13": { steps: STEPS },
      "repos/acme/web/actions/jobs/13/logs": new GitHubApiError("not-found", "expired"),
      "repos/acme/web/check-runs/14": new GitHubApiError("rate-limited", "wait"),
    });
    const logs = await new GitHubCheckLogs(github).read(ref, {
      ...input,
      checkRunIDs: [12, 13, 14],
    });
    expect(logs).toEqual([
      { checkRunID: 12, step: null, excerpt: "Lint failed\n\nsrc/a.ts:1 no-unused-vars" },
      { checkRunID: 13, step: null, excerpt: null },
      { checkRunID: 14, step: null, excerpt: null },
    ]);
  });

  it("caches a read check run and retries one that failed", async () => {
    const { github, rest, download } = gateway({
      "repos/acme/web/check-runs/14": new GitHubApiError("rate-limited", "wait"),
    });
    const reader = new GitHubCheckLogs(github);
    await reader.read(ref, { ...input, checkRunIDs: [11, 14] });
    const calls = rest.mock.calls.length;
    await reader.read(ref, { ...input, checkRunIDs: [11, 14] });
    // Only the rate-limited one is asked again.
    expect(rest.mock.calls.slice(calls).map(([request]) => request.path)).toEqual([
      "repos/acme/web/check-runs/14",
    ]);
    expect(download).toHaveBeenCalledOnce();
  });

  it("cuts after the last error when the step has no usable times", () => {
    expect(failedStepExcerpt(JOB_LOG, null).split("\n").at(-1)).toBe(
      "##[error]Process completed with exit code 1.",
    );
  });

  it("keeps the last 80 lines within 8 KB, whole characters only", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    expect(excerptOf(lines).split("\n")).toEqual(lines.slice(-80));
    const wide = Array.from({ length: 80 }, () => "é".repeat(100));
    const excerpt = excerptOf(wide);
    expect(new TextEncoder().encode(excerpt).length).toBeLessThanOrEqual(8 * 1024);
    expect(excerpt.split("\n").every((line) => line === "é".repeat(100))).toBe(true);
    const huge = excerptOf(["€".repeat(5_000)]);
    expect(new TextEncoder().encode(huge).length).toBeLessThanOrEqual(8 * 1024);
    expect(huge).toMatch(/^€+$/);
  });
});
