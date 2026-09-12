import { describe, expect, it } from "vitest";
import { rankGlobalCommands } from "./global-command-search";
import {
  defaultGlobalCommands,
  formatCommandShortcut,
  type GlobalCommand,
} from "./global-commands";

function command(
  input: Partial<GlobalCommand> & Pick<GlobalCommand, "id" | "title">,
): GlobalCommand {
  return {
    group: "navigation",
    run: () => undefined,
    ...input,
  };
}

describe("global command search", () => {
  it("ranks exact title matches ahead of aliases", () => {
    const commands = [
      command({ id: "settings", title: "Settings", keywords: ["preferences"] }),
      command({ id: "appearance", title: "Appearance", keywords: ["settings theme"] }),
      command({ id: "task", title: "Set up integration testing" }),
    ];

    expect(rankGlobalCommands(commands, "settings").map((item) => item.id)).toEqual([
      "settings",
      "appearance",
    ]);
  });

  it("keeps suggested commands unique and limits the default recent task list", () => {
    const suggested = command({
      id: "new",
      title: "New task",
      group: "suggested",
      suggested: true,
      defaultVisible: true,
    });
    const tasks = Array.from({ length: 10 }, (_, index) =>
      command({ id: `task-${index}`, title: `Task ${index}`, group: "tasks", kind: "task" }),
    );

    const visible = defaultGlobalCommands([suggested, ...tasks]);

    expect(visible.filter((item) => item.id === suggested.id)).toHaveLength(1);
    expect(visible.filter((item) => item.kind === "task")).toHaveLength(7);
  });

  it("formats shortcut labels for macOS and other platforms", () => {
    expect(formatCommandShortcut(["Meta", "Shift", "I"], "MacIntel")).toBe("⌘⇧I");
    expect(formatCommandShortcut(["Meta", "Shift", "I"], "Win32")).toBe("Ctrl+Shift+I");
  });
});
