import { describe, expect, it } from "vitest";
import type { PalotCommand } from "../../shared";
import { isBuiltinCommand, mergeBuiltinCommands } from "./builtin-commands";

describe("builtin-commands", () => {
  it("includes essential built-in commands like /compact, /new, /model, /undo, /revert", () => {
    expect(isBuiltinCommand("compact")).toBe(true);
    expect(isBuiltinCommand("COMPACT")).toBe(true);
    expect(isBuiltinCommand("new")).toBe(true);
    expect(isBuiltinCommand("clear")).toBe(true);
    expect(isBuiltinCommand("model")).toBe(true);
    expect(isBuiltinCommand("undo")).toBe(true);
    expect(isBuiltinCommand("revert")).toBe(true);
    expect(isBuiltinCommand("init")).toBe(true);
    expect(isBuiltinCommand("unknown-command")).toBe(false);
  });

  it("merges built-in commands with custom commands without duplicate names", () => {
    const custom: PalotCommand[] = [
      {
        name: "test",
        description: "Run test suite",
        agent: null,
        model: null,
        subtask: false,
      },
      {
        name: "compact",
        description: "Custom compact command overriding built-in",
        agent: "custom-agent",
        model: null,
        subtask: true,
      },
    ];

    const merged = mergeBuiltinCommands(custom);
    expect(merged.some((c) => c.name === "test")).toBe(true);
    expect(merged.some((c) => c.name === "new")).toBe(true);

    const compactCommands = merged.filter((c) => c.name.toLowerCase() === "compact");
    expect(compactCommands).toHaveLength(1);
    expect(compactCommands).toHaveProperty(
      "0.description",
      "Custom compact command overriding built-in",
    );
  });
});
