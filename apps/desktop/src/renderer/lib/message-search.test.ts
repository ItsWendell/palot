import { describe, expect, it } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import {
  MESSAGE_SEARCH_TASK_LIMIT,
  messageExcerpt,
  messageSearchCandidates,
  messageSearchCoverageLabel,
  runBounded,
  searchMessages,
} from "./message-search";
import type { PaletteTask } from "./palette-tasks";

function message(id: string, type: string, text: string, createdAt = 1): PalotMessage {
  return {
    id,
    type,
    createdAt,
    completedAt: createdAt,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [{ id: `${id}-part`, type: "text", text }],
    data: null,
  };
}

function task(
  id: string,
  updatedAt: number,
  connectionID = "local",
  connected = true,
): PaletteTask {
  return {
    session: { id, title: id, updatedAt, parentID: null } as PalotSession,
    profileID: connectionID === "local" ? null : connectionID,
    connectionID,
    serverName: connectionID,
    connected,
  };
}

describe("searchMessages", () => {
  it("finds user and assistant text, newest task first, and anchors assistant hits to their prompt", () => {
    const older = task("older", 1);
    const newer = task("newer", 5);
    const hits = searchMessages(
      [
        { task: older, messages: [message("o1", "user", "Rotate the signing KEY")] },
        {
          task: newer,
          messages: [
            message("n1", "user", "Where is the config?"),
            message("n2", "assistant", "The signing key lives in vault."),
            { ...message("n3", "assistant", ""), content: [{ type: "tool", text: "signing key" }] },
          ],
        },
      ],
      "  Signing Key ",
    );

    expect(hits.map((hit) => [hit.task.session.id, hit.messageID, hit.anchorMessageID])).toEqual([
      ["newer", "n2", "n1"],
      ["older", "o1", "o1"],
    ]);
    expect(hits[0]).toMatchObject({
      author: "assistant",
      excerpt: { before: "The ", match: "signing key", after: " lives in vault." },
    });
    expect(hits[1]?.excerpt.match).toBe("signing KEY");
  });

  it("caps matches per task and overall, and ignores one-character queries", () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      message(`m${index}`, "user", `deploy ${index}`),
    );
    const sources = ["a", "b", "c"].map((id, index) => ({ task: task(id, index), messages }));

    expect(searchMessages(sources, "deploy", { perTask: 2, limit: 5 })).toHaveLength(5);
    expect(
      searchMessages(sources, "deploy", { perTask: 2 }).filter(
        (hit) => hit.task.session.id === "a",
      ),
    ).toHaveLength(2);
    expect(searchMessages(sources, "d")).toEqual([]);
  });

  it("cuts long excerpts at word edges and flattens whitespace", () => {
    const text = `${"lorem ".repeat(20)}needle\n\nafter ${"ipsum ".repeat(40)}`;
    const excerpt = messageExcerpt(text, text.indexOf("needle"), "needle".length);
    expect(excerpt.before.startsWith("…")).toBe(true);
    expect(excerpt.match).toBe("needle");
    expect(excerpt.after.startsWith(" after ipsum")).toBe(true);
    expect(excerpt.after.endsWith("…")).toBe(true);
  });
});

describe("messageSearchCandidates", () => {
  it("bounds recent tasks per connection and skips offline ones", () => {
    const tasks = [
      ...Array.from({ length: 40 }, (_, index) => task(`work-${index}`, 100 - index, "work")),
      ...Array.from({ length: 5 }, (_, index) => task(`home-${index}`, 50 - index, "home")),
      task("offline", 200, "offline", false),
    ];
    const candidates = messageSearchCandidates(tasks);
    expect(candidates.filter((item) => item.connectionID === "work")).toHaveLength(
      MESSAGE_SEARCH_TASK_LIMIT,
    );
    expect(candidates.filter((item) => item.connectionID === "home")).toHaveLength(5);
    expect(candidates.some((item) => item.connectionID === "offline")).toBe(false);
    expect(candidates[0]?.session.id).toBe("work-0");
  });
});

describe("runBounded", () => {
  it("keeps at most the given number in flight and stops starting work after abort", async () => {
    const controller = new AbortController();
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await runBounded(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      controller.signal,
      async (item) => {
        started.push(item);
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        if (item === 4) controller.abort();
        if (item === 1) throw new Error("one failure");
      },
    );
    expect(peak).toBe(3);
    expect(started.length).toBeLessThan(10);
    expect(started).toContain(4);
  });
});

describe("messageSearchCoverageLabel", () => {
  it("states exactly what was searched", () => {
    expect(messageSearchCoverageLabel({ searched: 0, recent: null })).toBe("");
    expect(messageSearchCoverageLabel({ searched: 2, recent: null })).toBe(
      "Searched 2 tasks loaded in Palot",
    );
    expect(
      messageSearchCoverageLabel({ searched: 3, recent: null, pending: { done: 1, total: 30 } }),
    ).toBe("Searching 1 of 30 tasks…");
    expect(messageSearchCoverageLabel({ searched: 32, recent: 30 })).toBe(
      "Searched 30 recent tasks + 2 loaded · latest messages only",
    );
  });
});
