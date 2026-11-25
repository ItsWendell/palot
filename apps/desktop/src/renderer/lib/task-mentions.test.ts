import { describe, expect, it } from "vitest";
import { taskMentions, serializeTaskMention } from "./task-mentions";

const id = "ses_0123456789abcdefghijklmnop";

describe("OpenCode task mentions", () => {
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
