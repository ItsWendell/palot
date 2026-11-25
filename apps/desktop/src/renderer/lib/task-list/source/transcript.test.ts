import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue, PalotMessage, PalotMessageContent } from "../../../../shared";
import { taskID } from "./ids";
import { TaskListProjector } from "./project";
import { NOW, serverData, session } from "./fixtures.test-support";
import { finishedTurnInsight, LruCache, runningTurnDetail, turnInsightCache } from "./transcript";

function message(overrides: Partial<PalotMessage> & Pick<PalotMessage, "id">): PalotMessage {
  return {
    type: "assistant",
    createdAt: NOW - 60_000,
    completedAt: null,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...overrides,
  };
}

const shell = (command: string, status: string): PalotMessageContent => ({
  type: "tool",
  id: `shell-${command}`,
  name: "shell",
  state: { status, input: { command } as Record<string, JsonValue>, metadata: {} },
});

const prompt = message({
  id: "user-1",
  type: "user",
  createdAt: NOW - 60_000,
  completedAt: NOW - 60_000,
  text: "Run the tests",
});

const finished: PalotMessage[] = [
  prompt,
  message({
    id: "assistant-1",
    createdAt: NOW - 59_000,
    completedAt: NOW - 30_000,
    finish: "stop",
    content: [shell("bun test", "completed"), { type: "text", id: "text-1", text: "All green." }],
  }),
];

afterEach(() => turnInsightCache.clear());

describe("loaded transcripts", () => {
  it("names what a running task does", () => {
    const running = [
      prompt,
      message({ id: "assistant-1", content: [shell("bun test", "running")] }),
    ];
    expect(
      runningTurnDetail(
        "task",
        running,
        { status: "running", startedAt: NOW - 60_000, completedAt: null },
        { type: "busy" },
      ),
    ).toBe("Running 'bun test'");
    expect(runningTurnDetail("other", [], null, { type: "busy" })).toBeNull();
  });

  it("summarises the last finished turn and its answer", () => {
    const insight = finishedTurnInsight(
      finished,
      { status: "succeeded", startedAt: NOW - 60_000, completedAt: NOW - 30_000 },
      NOW - 30_000,
    );
    expect(insight).toMatchObject({
      idleAt: NOW - 30_000,
      summary: { filesChanged: 0, commands: 1 },
      lastAnswer: "All green.",
    });
    expect(insight!.summary.durationMs).toBeGreaterThanOrEqual(1_000);
  });

  it("remembers a summary seen this session, and the answer only while it is loaded", () => {
    const projector = new TaskListProjector();
    let messages = finished;
    const transcripts = { messages: () => messages };
    const done = (idleAt: number) =>
      serverData({ sessions: [session({ id: "a", idleAt, viewedAt: idleAt - 1 })] });
    const loaded = projector.project({
      servers: [done(NOW - 30_000)],
      openTask: null,
      now: NOW,
      transcripts,
    }).tasks[0]!;
    expect(loaded.summary?.commands).toBe(1);
    expect(loaded.lastAnswer).toBe("All green.");

    messages = [];
    const evicted = projector.project({
      servers: [done(NOW - 30_000)],
      openTask: null,
      now: NOW,
      transcripts,
    }).tasks[0]!;
    expect(evicted.summary).toEqual(loaded.summary);
    expect(evicted.lastAnswer).toBe("");

    // A newer turn the list has not seen makes the remembered summary stale.
    const newer = projector.project({
      servers: [done(NOW - 1_000)],
      openTask: null,
      now: NOW,
      transcripts,
    }).tasks[0]!;
    expect(newer.id).toBe(taskID("local", "a"));
    expect(newer.summary).toBeNull();
  });

  it("bounds the summary cache", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([1, undefined, 3]);
    expect(cache.size).toBe(2);
  });
});
