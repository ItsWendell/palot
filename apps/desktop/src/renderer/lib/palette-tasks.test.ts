import { describe, expect, it } from "vitest";
import type { PalotSession } from "../../shared";
import { adjacentPaletteTask, mergePaletteTasks, type PaletteTask } from "./palette-tasks";

function session(id: string, updatedAt: number, input: Partial<PalotSession> = {}): PalotSession {
  return {
    id,
    parentID: null,
    projectID: "project",
    title: id,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...input,
  };
}

function task(
  profileID: string | null,
  value: PalotSession,
  input: Partial<PaletteTask> = {},
): PaletteTask {
  return {
    session: value,
    profileID,
    connectionID: profileID ? `${profileID}-connection` : null,
    serverName: profileID,
    connected: true,
    ...input,
  };
}

const ids = (tasks: PaletteTask[]) => tasks.map((item) => `${item.profileID}/${item.session.id}`);

describe("mergePaletteTasks", () => {
  it("interleaves servers by recency and keeps equal session IDs on different servers", () => {
    const merged = mergePaletteTasks(
      [task("local", session("shared", 10)), task("local", session("old", 1))],
      [task("remote", session("shared", 20)), task("remote", session("middle", 5))],
    );

    expect(ids(merged)).toEqual(["remote/shared", "local/shared", "remote/middle", "local/old"]);
  });

  it("lets search results refresh a loaded task without losing its status", () => {
    const merged = mergePaletteTasks(
      [task("local", session("a", 1, { title: "Before" }), { status: "attention" })],
      [task("local", session("a", 30, { title: "After" }))],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.session.title).toBe("After");
    expect(merged[0]?.status).toBe("attention");
  });

  it("drops subtask sessions", () => {
    const merged = mergePaletteTasks([
      task(null, session("root", 1)),
      task(null, session("child", 2, { parentID: "root" })),
    ]);

    expect(ids(merged)).toEqual(["null/root"]);
  });
});

describe("adjacentPaletteTask", () => {
  const recent = mergePaletteTasks([
    task("a", session("one", 3)),
    task("b", session("two", 2)),
    task("a", session("three", 1)),
  ]);

  it("moves through recent tasks and wraps at both ends", () => {
    expect(adjacentPaletteTask(recent, { sessionID: "one", profileID: "a" }, 1)?.session.id).toBe(
      "two",
    );
    expect(adjacentPaletteTask(recent, { sessionID: "three", profileID: "a" }, 1)?.session.id).toBe(
      "one",
    );
    expect(adjacentPaletteTask(recent, { sessionID: "one", profileID: "a" }, -1)?.session.id).toBe(
      "three",
    );
  });

  it("matches the current task by owning server", () => {
    // "two" belongs to server b; viewing an unrelated "two" on server a is not in the list.
    expect(adjacentPaletteTask(recent, { sessionID: "two", profileID: "a" }, 1)?.session.id).toBe(
      "one",
    );
  });

  it("starts from the newest task going forward and the oldest going back", () => {
    expect(adjacentPaletteTask(recent, { sessionID: null, profileID: null }, 1)?.session.id).toBe(
      "one",
    );
    expect(adjacentPaletteTask(recent, { sessionID: null, profileID: null }, -1)?.session.id).toBe(
      "three",
    );
  });
});
