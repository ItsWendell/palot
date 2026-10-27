import { describe, expect, it } from "vitest";
import type { PalotProject, PalotSession } from "../../shared";
import { taskMentions, serializeTaskMention, taskMentionSuggestions } from "./task-mentions";

const id = "ses_0123456789abcdefghijklmnop";

describe("OpenCode task mentions", () => {
  it("offers recent and matching root tasks with their project, excluding self, children, archives and invalid IDs", () => {
    const project: PalotProject = {
      id: "project",
      name: "Palot",
      canonical: "/repo",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    };
    const task = (
      letter: string,
      updatedAt: number,
      extra: Partial<PalotSession> = {},
    ): PalotSession => ({
      id: `ses_${letter.repeat(26)}`,
      parentID: null,
      projectID: "project",
      title: `Task ${letter}`,
      agent: null,
      model: null,
      location: { directory: "/repo" },
      createdAt: 1,
      updatedAt,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      ...extra,
    });
    const tasks = [
      task("a", 2),
      task("b", 3),
      task("c", 4, { parentID: "parent" }),
      task("d", 5, { archivedAt: 1 }),
      task("e", 10),
      task("f", 6, { id: "invalid" }),
    ];
    expect(
      taskMentionSuggestions(tasks, [project], tasks[4]!.id, "").map(({ title, project }) => [
        title,
        project,
      ]),
    ).toEqual([
      ["Task b", "Palot"],
      ["Task a", "Palot"],
    ]);
    expect(
      taskMentionSuggestions(tasks, [project], tasks[4]!.id, "task A").map(({ id }) => id),
    ).toEqual([tasks[0]!.id]);
    expect(taskMentionSuggestions(tasks, [project], tasks[4]!.id, "PALOT")).toHaveLength(2);
    expect(taskMentionSuggestions(tasks, [project], tasks[4]!.id, "missing")).toEqual([]);
  });

  it("round-trips the upstream @session format with the task ID and exact source offsets", () => {
    const serialized = serializeTaskMention(id);
    expect(serialized).toBe(`@session:${id}`);
    expect(taskMentions(`Read ${serialized}, then ${id}.`)).toEqual([
      { id, text: serialized, start: 5, end: 5 + serialized.length },
      { id, text: id, start: 12 + serialized.length, end: 12 + serialized.length + id.length },
    ]);
  });

  it("does not interpret partial, overlong, path, URL, or email tokens as mentions", () => {
    expect(
      taskMentions(
        `ses_123 @session:ses_123 ${id}extra dir/${id} https://host/${id} me@${id} @other:${id}`,
      ),
    ).toEqual([]);
  });
});
