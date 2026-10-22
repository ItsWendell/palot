import { describe, expect, it } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import {
  collectRecentProjectOutputs,
  pathInsideDirectory,
  resolveTaskPath,
  type LoadedTask,
} from "./recent-project-outputs";

function message(input: Partial<PalotMessage> & Pick<PalotMessage, "id" | "type">): PalotMessage {
  return {
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: input.type === "assistant" ? "build" : null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...input,
  };
}

function session(id: string, directory: string, projectID = "project-1"): PalotSession {
  return {
    id,
    parentID: null,
    projectID,
    title: `Task ${id}`,
    agent: null,
    model: null,
    location: { directory },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function completedTurn(id: string, at: number, tools: PalotMessage["content"]): PalotMessage[] {
  return [
    message({ id: `${id}-user`, type: "user", text: "Do it", createdAt: at }),
    message({
      id: `${id}-assistant`,
      type: "assistant",
      createdAt: at + 1,
      completedAt: at + 2,
      finish: "stop",
      content: [...tools, { type: "text", id: `${id}-final`, text: "Done" }],
    }),
  ];
}

const edit = (id: string, filePath: string) => ({
  type: "tool",
  id,
  name: "edit",
  state: { status: "completed", input: { filePath }, metadata: {} },
});

function task(connectionID: string, value: PalotSession, messages: PalotMessage[]): LoadedTask {
  return { connectionID, session: value, messages };
}

const target = { directory: "/repo" };
const projectOf = (value: PalotSession) => value.projectID;

describe("collectRecentProjectOutputs", () => {
  it("lists changed and produced files of loaded tasks in this project, newest task first", () => {
    const older = session("older", "/repo");
    const newer = session("newer", "/repo");
    const result = collectRecentProjectOutputs({
      connectionID: "c1",
      projectID: "project-1",
      location: target,
      projectOf,
      tasks: [
        task("c1", older, completedTurn("o", 10, [edit("e1", "src/old.ts")])),
        task(
          "c1",
          newer,
          completedTurn("n", 20, [
            edit("e2", "/repo/src/new.ts"),
            {
              type: "tool",
              id: "gen",
              name: "generate",
              state: {
                status: "completed",
                input: {},
                content: [
                  { type: "file", uri: "file:///repo/out/report.md", mime: "text/markdown" },
                ],
              },
            },
          ]),
        ),
      ],
    });
    expect(result.map((group) => group.sessionID)).toEqual(["newer", "older"]);
    expect(result[0]?.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "changed", path: "src/new.ts" }),
        expect.objectContaining({ kind: "produced", path: "out/report.md" }),
      ]),
    );
    expect(result[0]?.outputs.every((output) => output.userMessageID === "n-user")).toBe(true);
    expect(result[1]?.outputs).toEqual([
      expect.objectContaining({
        kind: "changed",
        path: "src/old.ts",
        absolutePath: "/repo/src/old.ts",
      }),
    ]);
  });

  it("never reads tasks from another connection or project", () => {
    const result = collectRecentProjectOutputs({
      connectionID: "c1",
      projectID: "project-1",
      location: target,
      projectOf,
      tasks: [
        task("c2", session("remote", "/repo"), completedTurn("r", 1, [edit("e", "a.ts")])),
        task(
          "c1",
          session("other", "/repo", "project-2"),
          completedTurn("p", 1, [edit("e", "b.ts")]),
        ),
        task("c1", session("unloaded", "/repo"), []),
      ],
    });
    expect(result).toEqual([]);
  });

  it("marks outputs outside the composer's location as unavailable", () => {
    const [group] = collectRecentProjectOutputs({
      connectionID: "c1",
      projectID: "project-1",
      location: target,
      projectOf,
      tasks: [
        task(
          "c1",
          session("worktree", "/worktrees/feature"),
          completedTurn("w", 1, [edit("e", "src/x.ts")]),
        ),
      ],
    });
    expect(group?.outputs).toEqual([
      expect.objectContaining({ path: null, absolutePath: "/worktrees/feature/src/x.ts" }),
    ]);
  });

  it("skips turns that are still running", () => {
    const running = [
      message({ id: "u", type: "user", text: "Go", createdAt: 1 }),
      message({
        id: "a",
        type: "assistant",
        createdAt: 2,
        completedAt: null,
        content: [edit("e", "src/live.ts")],
      }),
    ];
    expect(
      collectRecentProjectOutputs({
        connectionID: "c1",
        projectID: "project-1",
        location: target,
        projectOf,
        tasks: [task("c1", session("live", "/repo"), running)],
      }),
    ).toEqual([]);
  });
});

describe("output paths", () => {
  it("resolves task paths without escaping their directory", () => {
    expect(resolveTaskPath("/repo/", "src/a.ts")).toBe("/repo/src/a.ts");
    expect(resolveTaskPath("/repo", "../etc/passwd")).toBeNull();
    expect(resolveTaskPath("/repo", "/repo/./src/../b.ts")).toBe("/repo/b.ts");
  });

  it("only relativizes paths strictly inside the directory", () => {
    expect(pathInsideDirectory("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(pathInsideDirectory("/repo", "/repository/a.ts")).toBeNull();
    expect(pathInsideDirectory("/repo", "/repo")).toBeNull();
  });
});
