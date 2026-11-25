import type {
  SessionInfo,
  SessionStatsInfo,
  SessionStatsModelUsage,
  SessionStatsToolUsage,
  TokenUsageInfo,
} from "@opencode/client";

/**
 * Derived figures for the Usage page. Everything here works on data Palot already has: the
 * server-side `session.stats` aggregate and session records (`cost`/`tokens` per session, kept
 * current by `session.usage.updated`). Nothing reads messages.
 */

/** The tool name of a Code Mode script (OpenCode's `full_codemode`). */
export const CODE_MODE_TOOL = "execute";

/**
 * Share of prompt tokens served from the provider's cache: cache reads over everything the
 * model read (fresh input, cache reads, cache writes). Matches the context meter's
 * cached/uncached split (`lib/context-usage.ts`). Null when nothing was read.
 */
export function cacheHitRate(tokens: TokenUsageInfo): number | null {
  const read = tokens.input + tokens.cache.read + tokens.cache.write;
  return read > 0 ? tokens.cache.read / read : null;
}

/** Every token billed in some form: input, output, reasoning, cache reads and cache writes. */
export function processedTokens(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/** Input, output and reasoning: the page's "model tokens", without cache traffic. */
export function modelTokens(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning;
}

/** Reported cost per million processed tokens. Null without tokens or without a reported cost. */
export function costPerMillion(cost: number, tokens: TokenUsageInfo): number | null {
  const total = processedTokens(tokens);
  return total > 0 && cost > 0 ? (cost / total) * 1_000_000 : null;
}

export interface ToolFailure {
  name: string;
  calls: number;
  failed: number;
  failureRate: number;
}

export interface ToolMix {
  calls: number;
  codeModeCalls: number;
  directCalls: number;
  /** Null when there were no calls. */
  codeModeShare: number | null;
  codeModeFailureRate: number | null;
  directFailureRate: number | null;
  /** Tools that failed at least once, worst failure rate first. */
  failures: ToolFailure[];
}

/**
 * Code Mode against direct tool calls, and the tools that fail most. Calls a Code Mode script
 * makes run inside `execute`; OpenCode stores no tool part for them, so stats count the script
 * once. Tools with fewer than `minCalls` calls are left out of the ranking so one stray failure
 * doesn't top it.
 */
export function toolMix(
  usage: readonly SessionStatsToolUsage[],
  { minCalls = 3, limit = 5 }: { minCalls?: number; limit?: number } = {},
): ToolMix {
  let calls = 0;
  let codeModeCalls = 0;
  let codeModeFailed = 0;
  let directFailed = 0;
  for (const tool of usage) {
    calls += tool.calls;
    if (tool.name === CODE_MODE_TOOL) {
      codeModeCalls += tool.calls;
      codeModeFailed += tool.failed;
    } else directFailed += tool.failed;
  }
  const directCalls = calls - codeModeCalls;
  const failures = usage
    .filter((tool) => tool.failed > 0 && tool.calls >= minCalls)
    .map((tool) => ({
      name: tool.name,
      calls: tool.calls,
      failed: tool.failed,
      failureRate: tool.failed / tool.calls,
    }))
    .toSorted(
      (left, right) =>
        right.failureRate - left.failureRate ||
        right.failed - left.failed ||
        left.name.localeCompare(right.name),
    )
    .slice(0, limit);
  return {
    calls,
    codeModeCalls,
    directCalls,
    codeModeShare: calls > 0 ? codeModeCalls / calls : null,
    codeModeFailureRate: codeModeCalls > 0 ? codeModeFailed / codeModeCalls : null,
    directFailureRate: directCalls > 0 ? directFailed / directCalls : null,
    failures,
  };
}

/** The parts of a session record the Usage page keeps. */
export interface UsageSession {
  id: string;
  parentID: string | null;
  projectID: string;
  title: string | null;
  cost: number;
  tokens: TokenUsageInfo;
  created: number;
  updated: number;
  /** Set when the session's own metadata names an automation. */
  automation: boolean;
}

export function usageSession(session: SessionInfo): UsageSession {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    projectID: session.projectID,
    title: session.title ?? null,
    cost: session.cost,
    tokens: session.tokens,
    created: session.time.created,
    updated: session.time.updated,
    automation: metadataNamesAutomation(session.metadata),
  };
}

function metadataNamesAutomation(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return record.automation !== undefined || record["palot.automation"] !== undefined;
}

/**
 * OpenCode starts a child session `ses_<automation ID>_<run>` for each run of a subagent
 * automation (`Automation.isRunSession` in `@opencode/schema`). Prompt automations send into an
 * existing session instead and leave no session-level mark.
 */
export function isOpenCodeAutomationSession(sessionID: string): boolean {
  return sessionID.startsWith("ses_aut_");
}

export interface UsageTask {
  /** The root task; subagents roll up into it. */
  id: string;
  title: string | null;
  projectID: string | null;
  /** The root's own record was not loaded (it was last active before the range). */
  rootMissing: boolean;
  cost: number;
  tokens: TokenUsageInfo;
  ownCost: number;
  subagents: number;
  subagentCost: number;
  updated: number;
}

function emptyTokens(): TokenUsageInfo {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

function addTokens(target: TokenUsageInfo, source: TokenUsageInfo): void {
  target.input += source.input;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.cache.read += source.cache.read;
  target.cache.write += source.cache.write;
}

/** Follows parent links inside the loaded set. Returns the top-most loaded ancestor's parent when the chain leaves the set. */
function rootOf(
  session: UsageSession,
  byID: ReadonlyMap<string, UsageSession>,
  memo: Map<string, string>,
): string {
  const known = memo.get(session.id);
  if (known) return known;
  const path: string[] = [];
  const seen = new Set<string>();
  let current: UsageSession | undefined = session;
  let root = session.id;
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    path.push(current.id);
    const cached = memo.get(current.id);
    if (cached) {
      root = cached;
      break;
    }
    root = current.id;
    if (!current.parentID) break;
    root = current.parentID;
    current = byID.get(current.parentID);
  }
  for (const id of path) memo.set(id, root);
  return root;
}

/**
 * Groups sessions into tasks, adding each subagent's cost to its root task. Costs are lifetime
 * totals of each session (OpenCode keeps no per-range session cost).
 */
export function rollUpTasks(sessions: readonly UsageSession[]): UsageTask[] {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  const memo = new Map<string, string>();
  const tasks = new Map<string, UsageTask>();
  for (const session of sessions) {
    const rootID = rootOf(session, byID, memo);
    let task = tasks.get(rootID);
    if (!task) {
      const root = byID.get(rootID);
      task = {
        id: rootID,
        title: root?.title ?? null,
        projectID: root?.projectID ?? session.projectID,
        rootMissing: !root,
        cost: 0,
        tokens: emptyTokens(),
        ownCost: 0,
        subagents: 0,
        subagentCost: 0,
        updated: 0,
      };
      tasks.set(rootID, task);
    }
    task.cost += session.cost;
    addTokens(task.tokens, session.tokens);
    task.updated = Math.max(task.updated, session.updated);
    if (session.id === rootID) task.ownCost += session.cost;
    else {
      task.subagents += 1;
      task.subagentCost += session.cost;
    }
  }
  return [...tasks.values()];
}

export function mostExpensiveTasks(tasks: readonly UsageTask[], limit = 10): UsageTask[] {
  return (
    tasks
      // Subscription and free models report no cost; their tasks still rank by tokens.
      .filter((task) => task.cost > 0 || processedTokens(task.tokens) > 0)
      .toSorted(
        (left, right) =>
          right.cost - left.cost ||
          processedTokens(right.tokens) - processedTokens(left.tokens) ||
          right.updated - left.updated ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
  );
}

export interface AutomationShare {
  totalCost: number;
  automationCost: number;
  /** Null without any cost. */
  share: number | null;
  palotCost: number;
  openCodeCost: number;
  palotSessions: number;
  openCodeSessions: number;
}

/**
 * Spend in sessions an automation started: Palot's standalone scheduled runs (their root
 * sessions, from Palot's run registry), OpenCode's subagent automation runs (`ses_aut_…`), and
 * sessions whose metadata names an automation. Their subagents count with them. Prompts an
 * automation sends into an existing task are not separable here: that needs per-message cost.
 */
export function automationShare(
  sessions: readonly UsageSession[],
  palotRunSessionIDs: ReadonlySet<string>,
): AutomationShare {
  const byID = new Map(sessions.map((session) => [session.id, session]));
  const origin = new Map<string, "palot" | "opencode" | null>();
  const originOf = (session: UsageSession): "palot" | "opencode" | null => {
    const path: string[] = [];
    const seen = new Set<string>();
    let id: string | null = session.id;
    let found: "palot" | "opencode" | null = null;
    while (id && !seen.has(id)) {
      seen.add(id);
      const cached = origin.get(id);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      path.push(id);
      const current = byID.get(id);
      if (palotRunSessionIDs.has(id)) {
        found = "palot";
        break;
      }
      if (isOpenCodeAutomationSession(id) || current?.automation) {
        found = "opencode";
        break;
      }
      id = current?.parentID ?? null;
    }
    for (const visited of path) origin.set(visited, found);
    return found;
  };
  let totalCost = 0;
  let palotCost = 0;
  let openCodeCost = 0;
  let palotSessions = 0;
  let openCodeSessions = 0;
  for (const session of sessions) {
    totalCost += session.cost;
    const source = originOf(session);
    if (source === "palot") {
      palotCost += session.cost;
      palotSessions += 1;
    } else if (source === "opencode") {
      openCodeCost += session.cost;
      openCodeSessions += 1;
    }
  }
  const automationCost = palotCost + openCodeCost;
  return {
    totalCost,
    automationCost,
    share: totalCost > 0 ? automationCost / totalCost : null,
    palotCost,
    openCodeCost,
    palotSessions,
    openCodeSessions,
  };
}

export interface UsageExportInput {
  exportedAt: number;
  range: { from: number; to: number; timezone: string };
  projectID: string | null;
  stats: SessionStatsInfo;
  /** Present when tool details were loaded. */
  tools: readonly SessionStatsToolUsage[] | null;
  /** Present when the task list was loaded. */
  tasks: readonly UsageTask[] | null;
  /** Projects whose stats were loaded, by name. */
  projects: readonly { id: string; name: string; stats: SessionStatsInfo }[];
  modelName?(usage: SessionStatsModelUsage): string;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ratio(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function tokenFields(tokens: TokenUsageInfo) {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  };
}

export function usageExportJson(input: UsageExportInput): string {
  const { stats } = input;
  const value = {
    exportedAt: new Date(input.exportedAt).toISOString(),
    range: {
      from: new Date(input.range.from).toISOString(),
      to: new Date(input.range.to).toISOString(),
      timezone: input.range.timezone,
    },
    projectID: input.projectID,
    note: "Costs are as reported by OpenCode. Totals include context compaction; model rows do not. Task titles and one-off generations are not included in the totals. Task costs are lifetime totals of tasks active in the range.",
    totals: {
      cost: roundCost(stats.cost),
      tokens: tokenFields(stats.tokens),
      cacheHitRate: ratio(cacheHitRate(stats.tokens)),
      costPerMillionTokens: ratio(costPerMillion(stats.cost, stats.tokens)),
      sessions: stats.sessions,
      subagents: stats.subagents,
      prompts: stats.prompts,
      steps: stats.steps,
      activeDays: stats.activeDays,
    },
    activity: stats.activity,
    models: stats.models.map((usage) => ({
      providerID: usage.model.providerID,
      modelID: usage.model.id,
      variant: usage.model.variant ?? null,
      name: input.modelName?.(usage) ?? usage.model.id,
      cost: roundCost(usage.cost),
      steps: usage.steps,
      tokens: tokenFields(usage.tokens),
      cacheHitRate: ratio(cacheHitRate(usage.tokens)),
      costPerMillionTokens: ratio(costPerMillion(usage.cost, usage.tokens)),
    })),
    toolTotals: stats.tools.mode === "none" ? null : stats.tools.totals,
    tools: input.tools,
    projects: input.projects.map((project) => ({
      id: project.id,
      name: project.name,
      cost: roundCost(project.stats.cost),
      tokens: tokenFields(project.stats.tokens),
      sessions: project.stats.sessions,
      prompts: project.stats.prompts,
      steps: project.stats.steps,
    })),
    tasks:
      input.tasks?.map((task) => ({
        id: task.id,
        title: task.title,
        projectID: task.projectID,
        cost: roundCost(task.cost),
        ownCost: roundCost(task.ownCost),
        subagentCost: roundCost(task.subagentCost),
        subagents: task.subagents,
        tokens: tokenFields(task.tokens),
        lastActive: new Date(task.updated).toISOString(),
      })) ?? null,
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

const CSV_COLUMNS = [
  "kind",
  "id",
  "name",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cache_hit_rate",
  "usd_per_million_tokens",
  "steps",
  "calls",
  "succeeded",
  "failed",
  "unfinished",
  "duration_p50_ms",
] as const;

type CsvRow = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | null>>;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Leading formula characters are quoted with an apostrophe so spreadsheets keep them as text.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === "string" ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function tokenRow(cost: number, tokens: TokenUsageInfo): CsvRow {
  return {
    cost_usd: roundCost(cost),
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    reasoning_tokens: tokens.reasoning,
    cache_read_tokens: tokens.cache.read,
    cache_write_tokens: tokens.cache.write,
    cache_hit_rate: ratio(cacheHitRate(tokens)),
    usd_per_million_tokens: ratio(costPerMillion(cost, tokens)),
  };
}

/** One long-format table: a `kind` column separates totals, models, tools, projects and tasks. */
export function usageExportCsv(input: UsageExportInput): string {
  const { stats } = input;
  const rows: CsvRow[] = [
    {
      kind: "total",
      id: input.projectID ?? "all",
      name: `${new Date(input.range.from).toISOString()} to ${new Date(input.range.to).toISOString()}`,
      ...tokenRow(stats.cost, stats.tokens),
      steps: stats.steps,
      ...(stats.tools.mode === "none"
        ? {}
        : {
            calls: stats.tools.totals.calls,
            succeeded: stats.tools.totals.succeeded,
            failed: stats.tools.totals.failed,
            unfinished: stats.tools.totals.unfinished,
          }),
    },
    ...stats.models.map((usage) => ({
      kind: "model",
      id: `${usage.model.providerID}/${usage.model.id}${usage.model.variant ? `#${usage.model.variant}` : ""}`,
      name: input.modelName?.(usage) ?? usage.model.id,
      ...tokenRow(usage.cost, usage.tokens),
      steps: usage.steps,
    })),
    ...(input.tools ?? []).map((tool) => ({
      kind: "tool",
      id: tool.name,
      name: tool.name,
      calls: tool.calls,
      succeeded: tool.succeeded,
      failed: tool.failed,
      unfinished: tool.unfinished,
      duration_p50_ms: tool.durationP50 === undefined ? null : Math.round(tool.durationP50),
    })),
    ...input.projects.map((project) => ({
      kind: "project",
      id: project.id,
      name: project.name,
      ...tokenRow(project.stats.cost, project.stats.tokens),
      steps: project.stats.steps,
    })),
    ...(input.tasks ?? []).map((task) => ({
      kind: "task",
      id: task.id,
      name: task.title,
      ...tokenRow(task.cost, task.tokens),
    })),
  ];
  return `${[CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
}

export function usageExportName(
  range: { from: number; to: number },
  extension: "csv" | "json",
): string {
  const day = (time: number) => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  return `palot-usage-${day(range.from)}-to-${day(range.to - 1)}.${extension}`;
}
