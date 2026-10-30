import { describe, expect, it } from "vitest";
import { toggleMarkdownTask } from "./markdown-task-edit";

describe("toggleMarkdownTask", () => {
  it("edits only the selected rendered task, skipping code and preserving line endings", () => {
    const source =
      "```md\r\n- [ ] not a task\r\n```\r\n\r\n- [ ] first\r\n  - [X] nested\r\n\r\n> - [ ] quoted\r\n";
    expect(toggleMarkdownTask(source, 1)).toBe(source.replace("[X] nested", "[ ] nested"));
    expect(toggleMarkdownTask(source, 2)).toBe(source.replace("[ ] quoted", "[x] quoted"));
    expect(toggleMarkdownTask(source, 99)).toBe(source);
  });
  it("does not mistake inline literals or repeated task text for another checkbox", () => {
    const source = "`[ ]` literal\n\n- [ ] same\n- [ ] same\n";
    expect(toggleMarkdownTask(source, 1)).toBe("`[ ]` literal\n\n- [ ] same\n- [x] same\n");
  });
});
