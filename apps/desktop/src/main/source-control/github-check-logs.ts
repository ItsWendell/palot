import type {
  PullRequestCheckLog,
  PullRequestCheckLogsInput,
} from "../../shared/source-control-contract";
import type { GitHubGateway } from "./github-client";
import type { NormalizedPullRequestRef } from "./github-review";

/** The last lines of a failing step that go to the agent. */
export const EXCERPT_LINES = 80;
/** Per check; the PR context caps all checks together. */
export const EXCERPT_BYTES = 8 * 1024;
/** Failing checks read per press; the rest say their log is unavailable. */
export const MAX_LOG_CHECKS = 10;
/** Only the end of a job log is kept while it downloads; the failure is near the end. */
const LOG_TAIL_BYTES = 2 * 1024 * 1024;
const CACHE_LIMIT = 100;

interface RawCheckRun {
  id?: number;
  name?: string | null;
  app?: { slug?: string | null } | null;
  output?: { title?: string | null; summary?: string | null; text?: string | null } | null;
}

export interface RawJobStep {
  name?: string | null;
  conclusion?: string | null;
  number?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface RawJob {
  steps?: RawJobStep[] | null;
}

// CSI and OSC sequences; GitHub's own masking (***) already hides secrets, so nothing else goes.
const ANSI =
  // oxlint-disable-next-line no-control-regex -- escape sequences are what this removes
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
const TIMESTAMP = /^\uFEFF?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;

/**
 * Reads the failure behind failing checks: for GitHub Actions the failing step's last log lines,
 * for other apps the check run's own summary. Completed check runs never change, so answers are
 * cached per check run. Failures never throw; that check's excerpt is null instead.
 */
export class GitHubCheckLogs {
  private readonly cache = new Map<string, PullRequestCheckLog>();

  constructor(private readonly github: GitHubGateway) {}

  async read(ref: NormalizedPullRequestRef, input: PullRequestCheckLogsInput) {
    const ids = [...new Set(input.checkRunIDs)];
    return Promise.all(
      ids.map((id, index) =>
        index < MAX_LOG_CHECKS
          ? this.one(ref, id)
          : Promise.resolve({ checkRunID: id, step: null, excerpt: null }),
      ),
    );
  }

  private async one(ref: NormalizedPullRequestRef, id: number): Promise<PullRequestCheckLog> {
    const key = `${ref.host}/${ref.owner}/${ref.name}#${id}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const repo = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
    let result: PullRequestCheckLog;
    try {
      const run = await this.github.rest<RawCheckRun>({
        host: ref.host,
        path: `${repo}/check-runs/${id}`,
        priority: "interactive",
      });
      if (run.data?.app?.slug === "github-actions") {
        // An Actions check run is the job of the same ID.
        const job = await this.github.rest<RawJob>({
          host: ref.host,
          path: `${repo}/actions/jobs/${id}`,
          priority: "interactive",
        });
        const step = failedStep(job.data?.steps ?? []);
        const log = await this.github.download({
          host: ref.host,
          path: `${repo}/actions/jobs/${id}/logs`,
          priority: "interactive",
          tailBytes: LOG_TAIL_BYTES,
        });
        const excerpt = failedStepExcerpt(log, step);
        result = { checkRunID: id, step: step?.name ?? null, excerpt: excerpt || null };
      } else {
        const output = run.data?.output;
        const text = [output?.summary, output?.text].filter(Boolean).join("\n\n");
        result = { checkRunID: id, step: null, excerpt: excerptOf(text.split(/\r?\n/)) || null };
      }
    } catch {
      // Missing permission, an expired log or a rate limit: the chip says the log is unavailable.
      return { checkRunID: id, step: null, excerpt: null };
    }
    if (result.excerpt) {
      this.cache.set(key, result);
      if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }
}

/** The first step that failed; later steps were usually skipped because of it. */
export function failedStep(steps: readonly RawJobStep[]): RawJobStep | null {
  return (
    steps.find((step) => step.conclusion === "failure") ??
    steps.find((step) => step.conclusion === "timed_out" || step.conclusion === "cancelled") ??
    null
  );
}

/**
 * The failing step's tail from a whole job log. Log lines carry timestamps and steps carry
 * whole-second start and end times, so the step is the lines inside its window. Without a usable
 * window the log is cut after its last error annotation, which drops cleanup steps that follow.
 */
export function failedStepExcerpt(log: string, step: RawJobStep | null): string {
  const lines = log.split(/\r?\n/);
  let at = Number.NEGATIVE_INFINITY;
  const stamped = lines.map((line) => {
    const match = TIMESTAMP.exec(line);
    if (match) {
      const parsed = Date.parse(match[1]!);
      if (Number.isFinite(parsed)) at = parsed;
      return { at, text: line.slice(match[0].length) };
    }
    return { at, text: line.replace(/^\uFEFF/, "") };
  });
  const start = step?.started_at ? Date.parse(step.started_at) : Number.NaN;
  const end = step?.completed_at ? Date.parse(step.completed_at) : Number.NaN;
  let chosen: string[] = [];
  if (Number.isFinite(start) && Number.isFinite(end)) {
    chosen = stamped
      .filter((line) => line.at >= start && line.at < end + 1_000)
      .map((line) => line.text);
  }
  if (!chosen.some((line) => line.trim())) {
    const texts = stamped.map((line) => line.text);
    const lastError = texts.findLastIndex((line) => line.includes("##[error]"));
    chosen = lastError >= 0 ? texts.slice(0, lastError + 1) : texts;
  }
  return excerptOf(chosen);
}

/** The last lines without colour codes or log markers, within the line and byte caps. */
export function excerptOf(lines: readonly string[]): string {
  const clean = lines
    .map((line) => line.replace(ANSI, "").replace(/\r$/, ""))
    .filter((line) => !line.startsWith("##[endgroup]"))
    .map((line) => line.replace(/^##\[(group|section)\]/, ""));
  while (clean.length && !clean.at(-1)!.trim()) clean.pop();
  let tail = clean.slice(-EXCERPT_LINES);
  const encoder = new TextEncoder();
  let size = encoder.encode(tail.join("\n")).length;
  while (tail.length > 1 && size > EXCERPT_BYTES) {
    size -= encoder.encode(tail[0]!).length + 1;
    tail = tail.slice(1);
  }
  let text = tail.join("\n");
  const bytes = encoder.encode(text);
  if (bytes.length > EXCERPT_BYTES) {
    // One huge line: keep its end; a character cut in half decodes to U+FFFD and goes.
    text = new TextDecoder()
      .decode(bytes.subarray(bytes.length - EXCERPT_BYTES))
      .replace(/^\uFFFD+/, "");
  }
  return text.replace(/^\n+/, "");
}
