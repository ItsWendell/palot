import type { SessionStatsInfo, TokenUsageInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import {
  automationShare,
  cacheHitRate,
  costPerMillion,
  mostExpensiveTasks,
  rollUpTasks,
  toolMix,
  usageExportCsv,
  usageExportJson,
  type UsageSession,
} from "./usage-analytics";

function tokens(input: number, output = 0, read = 0, write = 0): TokenUsageInfo {
  return { input, output, reasoning: 0, cache: { read, write } };
}

function session(id: string, cost: number, parentID: string | null = null): UsageSession {
  return {
    id,
    parentID,
    projectID: "project",
    title: id.toUpperCase(),
    cost,
    tokens: tokens(100, 10),
    created: 1,
    updated: 10,
    automation: false,
  };
}

describe("cache and price", () => {
  it("divides cache reads by every prompt token, including cache writes", () => {
    expect(cacheHitRate(tokens(100, 50, 700, 200))).toBe(0.7);
    expect(cacheHitRate(tokens(0, 50))).toBeNull();
  });

  it("prices every processed token, cache traffic included", () => {
    expect(costPerMillion(2, tokens(500_000, 100_000, 300_000, 100_000))).toBe(2);
    expect(costPerMillion(0, tokens(10))).toBeNull();
    expect(costPerMillion(1, tokens(0))).toBeNull();
  });
});

describe("toolMix", () => {
  it("splits Code Mode from direct calls and ranks failures by rate", () => {
    const mix = toolMix([
      { name: "execute", calls: 10, succeeded: 8, failed: 2, unfinished: 0 },
      { name: "read", calls: 30, succeeded: 29, failed: 1, unfinished: 0 },
      { name: "bash", calls: 10, succeeded: 5, failed: 5, unfinished: 0 },
      { name: "rare", calls: 2, succeeded: 0, failed: 2, unfinished: 0 },
    ]);
    expect(mix.calls).toBe(52);
    expect(mix.codeModeCalls).toBe(10);
    expect(mix.directCalls).toBe(42);
    expect(mix.codeModeShare).toBeCloseTo(10 / 52);
    expect(mix.codeModeFailureRate).toBe(0.2);
    expect(mix.directFailureRate).toBeCloseTo(8 / 42);
    expect(mix.failures.map((tool) => tool.name)).toEqual(["bash", "execute", "read"]);
  });
});

describe("rollUpTasks", () => {
  it("adds nested subagents to their root task and keeps an unloaded root's ID", () => {
    const tasks = rollUpTasks([
      session("root", 1),
      session("child", 2, "root"),
      session("grandchild", 3, "child"),
      session("orphan", 4, "missing-root"),
      { ...session("idle", 0), tokens: tokens(0) },
      { ...session("free", 0), tokens: tokens(5) },
    ]);
    const top = mostExpensiveTasks(tasks);
    expect(top.map((task) => [task.id, task.cost, task.subagents])).toEqual([
      ["root", 6, 2],
      ["missing-root", 4, 1],
      ["free", 0, 0],
    ]);
    expect(top[0]).toMatchObject({ title: "ROOT", ownCost: 1, subagentCost: 5 });
    expect(top[1]).toMatchObject({ title: null, rootMissing: true, ownCost: 0 });
  });
});

describe("automationShare", () => {
  it("counts Palot runs, OpenCode run sessions and their subagents", () => {
    const share = automationShare(
      [
        session("manual", 6),
        session("ses_palot_run", 2),
        session("palot_child", 1, "ses_palot_run"),
        session("ses_aut_01_3", 1, "manual"),
        { ...session("tagged", 0.5), automation: true },
        session("unloaded_child", 0.5, "ses_palot_other"),
      ],
      new Set(["ses_palot_run", "ses_palot_other"]),
    );
    expect(share).toMatchObject({
      totalCost: 11,
      palotCost: 3.5,
      palotSessions: 3,
      openCodeCost: 1.5,
      openCodeSessions: 2,
      automationCost: 5,
    });
    expect(share.share).toBeCloseTo(5 / 11);
  });
});

describe("export", () => {
  const stats: SessionStatsInfo = {
    range: { from: 0, to: 1 },
    sessions: 1,
    subagents: 0,
    prompts: 1,
    steps: 2,
    tokens: tokens(100, 50, 300, 100),
    cost: 1.5,
    tools: { mode: "summary", totals: { calls: 3, succeeded: 2, failed: 1, unfinished: 0 } },
    activeDays: 1,
    streak: 1,
    activity: [],
    models: [
      { model: { providerID: "openai", id: "gpt-5" }, steps: 2, tokens: tokens(100), cost: 1 },
    ],
  };
  const input = {
    exportedAt: Date.UTC(2026, 10, 24),
    range: { from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 10, 24), timezone: "UTC" },
    projectID: null,
    stats,
    tools: [{ name: "bash", calls: 3, succeeded: 2, failed: 1, unfinished: 0, durationP50: 12.4 }],
    tasks: rollUpTasks([{ ...session("ses_1", 2), title: '=SUM(A1), "quoted"' }]),
    projects: [],
  };

  it("writes one long-format CSV with spreadsheet-safe text", () => {
    const lines = usageExportCsv(input).trimEnd().split("\n");
    expect(lines[0]).toBe(
      "kind,id,name,cost_usd,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens,cache_hit_rate,usd_per_million_tokens,steps,calls,succeeded,failed,unfinished,duration_p50_ms",
    );
    expect(lines[1]).toMatch(
      /^total,all,2026-11-01T00:00:00.000Z to .*,1.5,100,50,0,300,100,0.6,2727.2727,2,3,2,1,0,$/,
    );
    expect(lines[2]).toBe("model,openai/gpt-5,gpt-5,1,100,0,0,0,0,0,10000,2,,,,,");
    expect(lines[3]).toBe("tool,bash,bash,,,,,,,,,,3,2,1,0,12");
    expect(lines[4]).toBe('task,ses_1,"\'=SUM(A1), ""quoted""",2,100,10,0,0,0,0,18181.8182,,,,,,');
  });

  it("writes JSON with derived rates", () => {
    const value = JSON.parse(usageExportJson(input));
    expect(value.totals).toMatchObject({ cost: 1.5, cacheHitRate: 0.6 });
    expect(value.models[0]).toMatchObject({ modelID: "gpt-5", variant: null, cacheHitRate: 0 });
    expect(value.tasks[0]).toMatchObject({ id: "ses_1", cost: 2, subagents: 0 });
  });
});
