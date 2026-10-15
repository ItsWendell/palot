import { describe, expect, it } from "vitest";
import type { ModelRef, SessionMessageInfo } from "@opencode/client";
import type { PalotMessage, PalotModel } from "../../shared";
import {
  COMPACT_SUGGESTION_IDLE_MS,
  compactSuggestionTokens,
  compactionHistory,
  contextStatus,
  describeContextEntry,
  describeContextUsage,
  describeInstructionEntry,
  formatTokenCount,
  getContextUsage,
} from "./context-usage";

const model: PalotModel = {
  id: "model-1",
  modelID: "model-1",
  providerID: "provider-1",
  name: "Model One",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 1_000_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
};

function assistant(
  id: string,
  tokens: { input: number; read?: number; write?: number; output?: number; reasoning?: number },
  overrides: Partial<PalotMessage> = {},
): PalotMessage {
  return {
    id,
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: "build",
    model: { id: model.id, providerID: model.providerID },
    tokens: {
      input: tokens.input,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 },
    },
    finish: "stop",
    content: [],
    data: null,
    ...overrides,
  };
}

function user(id: string): PalotMessage {
  return {
    id,
    type: "user",
    createdAt: 1,
    completedAt: 1,
    text: "Hi",
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
}

function compaction(
  id: string,
  status: "running" | "completed" | "failed",
  extra: { cost?: number; error?: string; reason?: "auto" | "manual" } = {},
): PalotMessage {
  return {
    id,
    type: "compaction",
    createdAt: 10,
    completedAt: status === "running" ? null : 10,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: status === "failed" ? "error" : null,
    content: [{ type: "compaction", status, reason: extra.reason ?? "manual", ...extra }],
    data: null,
  };
}

describe("getContextUsage", () => {
  it("measures the window as OpenCode does: the latest step's prompt plus its output", () => {
    // Mostly cache reads: tiny uncached input next to a large window is expected, not a bug.
    const usage = getContextUsage(
      [
        assistant("old", { input: 10_000 }),
        assistant("latest", {
          input: 2,
          read: 620_000,
          write: 5_000,
          output: 2_000,
          reasoning: 507,
        }),
      ],
      [model],
    );
    expect(usage).toMatchObject({
      messageID: "latest",
      total: 627_509,
      limit: 1_000_000,
      percentage: 63,
      breakdown: { cached: 620_000, uncached: 5_002, output: 2_507 },
      compacted: false,
    });
  });

  it("skips failed steps and steps that report no prompt", () => {
    const usage = getContextUsage(
      [
        assistant("measured", { input: 40_000, output: 1_000 }),
        assistant("failed", { input: 90_000 }, { finish: "error" }),
        assistant("output-only", { input: 0, output: 500 }),
      ],
      [model],
    );
    expect(usage?.messageID).toBe("measured");
    expect(usage?.total).toBe(41_000);
  });

  it("flags a window measured before a completed compaction, but not a failed one", () => {
    const steps = [assistant("before", { input: 500_000 })];
    expect(getContextUsage([...steps, compaction("c1", "completed")], [model])?.compacted).toBe(
      true,
    );
    expect(getContextUsage([...steps, compaction("c1", "failed")], [model])?.compacted).toBe(false);
  });

  it("returns null without a measured step and a null percentage without a known model", () => {
    expect(getContextUsage([], [model])).toBeNull();
    expect(getContextUsage([assistant("a", { input: 10 })], [])).toMatchObject({
      limit: null,
      percentage: null,
    });
  });
});

describe("context wording", () => {
  const usage = (percentage: number) =>
    getContextUsage([assistant("a", { input: percentage * 10_000 })], [model])!;

  it("says used and left below 70%, and full at or above it", () => {
    expect(describeContextUsage(usage(45))).toEqual({
      summary: "Context window: 45% used (55% left)",
      detail: "450k / 1M tokens used",
    });
    expect(describeContextUsage(usage(70)).summary).toBe("Context window: 70% full");
  });

  it("maps thresholds to default, warning, and destructive states", () => {
    expect(contextStatus(null)).toBe("unavailable");
    expect(contextStatus(69)).toBe("normal");
    expect(contextStatus(70)).toBe("warning");
    expect(contextStatus(89)).toBe("warning");
    expect(contextStatus(90)).toBe("critical");
  });

  it("formats compact token counts", () => {
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(1_250)).toBe("1.3k");
    expect(formatTokenCount(627_509)).toBe("628k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});

describe("compactSuggestionTokens", () => {
  const large = getContextUsage([assistant("a", { input: 150_000 })], [model]);
  const small = getContextUsage([assistant("a", { input: 99_000 })], [model]);
  const now = 10 * COMPACT_SUGGESTION_IDLE_MS;

  it("suggests compacting a large window once the task has been idle for an hour", () => {
    const idle = now - COMPACT_SUGGESTION_IDLE_MS;
    expect(
      compactSuggestionTokens({ usage: large, lastActivityAt: idle, now, enabled: true }),
    ).toBe(150_000);
    expect(
      compactSuggestionTokens({ usage: large, lastActivityAt: idle + 1, now, enabled: true }),
    ).toBeNull();
  });

  it("does not suggest for small windows, when turned off, or right after a compaction", () => {
    const idle = 0;
    expect(
      compactSuggestionTokens({ usage: small, lastActivityAt: idle, now, enabled: true }),
    ).toBeNull();
    expect(
      compactSuggestionTokens({ usage: large, lastActivityAt: idle, now, enabled: false }),
    ).toBeNull();
    expect(
      compactSuggestionTokens({
        usage: large && { ...large, compacted: true },
        lastActivityAt: idle,
        now,
        enabled: true,
      }),
    ).toBeNull();
  });
});

describe("compactionHistory", () => {
  it("records the window before and after each compaction", () => {
    const history = compactionHistory([
      user("u1"),
      assistant("a1", { input: 600_000 }),
      compaction("c1", "completed", { cost: 0.05, reason: "auto" }),
      user("u2"),
      assistant("a2", { input: 40_000, output: 2_000 }),
      compaction("c2", "failed", { error: "Provider error" }),
    ]);
    expect(history).toEqual([
      expect.objectContaining({
        messageID: "c1",
        reason: "auto",
        status: "completed",
        before: 600_000,
        after: 42_000,
        cost: 0.05,
      }),
      expect.objectContaining({
        messageID: "c2",
        status: "failed",
        before: 42_000,
        after: null,
        error: "Provider error",
      }),
    ]);
  });
});

describe("describeInstructionEntry", () => {
  it("reads Palot automation instructions with their memory path", () => {
    const view = describeInstructionEntry({
      key: "palot.automation",
      value:
        "## Palot automation\n\nAutomation ID: daily\nAutomation memory: /home/me/.palot/memory.md\n\nUse the memory file.",
    });
    expect(view).toMatchObject({
      title: "Automation",
      source: "Palot",
      path: "/home/me/.palot/memory.md",
    });
    expect(view.preview).toMatch(/^Automation ID: daily/);
  });

  it("reads structured API entries without a path", () => {
    expect(
      describeInstructionEntry({ key: "team-rules", value: { rule: "Be brief" } }),
    ).toMatchObject({ title: "Team rules", source: "API", path: null });
  });
});

describe("describeContextEntry", () => {
  it("marks completed compactions as summaries and estimates tokens", () => {
    const entry = describeContextEntry({
      type: "compaction",
      id: "c1",
      time: { created: 1 },
      status: "completed",
      reason: "auto",
      summary: "## Summary\nWe fixed the build.",
      recent: "",
    } as SessionMessageInfo);
    expect(entry).toMatchObject({ role: "Compaction", summary: true, preview: "Summary" });
    expect(entry.tokens).toBeGreaterThan(0);
  });

  it("names the variant and calls out variant-only switches", () => {
    const switched = (id: string, model: ModelRef, previous?: ModelRef) =>
      ({
        type: "model-switched",
        id,
        time: { created: 1 },
        model,
        ...(previous ? { previous } : {}),
      }) as SessionMessageInfo;
    const messages = [
      switched("m1", { id: "gpt", providerID: "openai" }),
      switched("m2", { id: "gpt", providerID: "openai", variant: "high" }),
      switched("m3", { id: "claude", providerID: "anthropic", variant: "max" }),
      switched(
        "m4",
        { id: "claude", providerID: "anthropic" },
        { id: "claude", providerID: "anthropic", variant: "max" },
      ),
    ];
    expect(messages.map(describeContextEntry).map((entry) => entry.preview)).toEqual([
      "Switched to gpt",
      "Switched variant to high",
      "Switched to claude (max)",
      "Switched variant to Auto",
    ]);
  });
});
