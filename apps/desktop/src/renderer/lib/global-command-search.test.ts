import { describe, expect, it } from "vitest";
import {
  adjacentPaletteTab,
  ALL_TAB_FILE_LIMIT,
  groupGlobalSearchResults,
  paletteEnterLabel,
  paletteFileSearch,
  paletteResultGroups,
  paletteTabStep,
  rankGlobalCommands,
  type PaletteArrowInput,
} from "./global-command-search";
import { defaultGlobalCommands, groupGlobalCommands, type GlobalCommand } from "./global-commands";

function command(
  input: Partial<GlobalCommand> & Pick<GlobalCommand, "id" | "title">,
): GlobalCommand {
  return {
    group: "actions",
    run: () => undefined,
    ...input,
  };
}

function task(id: string, title: string, keywords: string[] = []): GlobalCommand {
  return command({ id, title, group: "tasks", kind: "task", keywords });
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

  it("orders the empty palette as recent tasks, quick actions, then every settings page", () => {
    const tasks = Array.from({ length: 12 }, (_, index) => task(`task-${index}`, `Task ${index}`));
    const commands = [
      command({ id: "general", title: "Settings", group: "settings", kind: "setting" }),
      command({ id: "browser", title: "Browser", group: "settings", kind: "setting" }),
      command({ id: "new", title: "New task", suggested: true }),
      command({ id: "hidden", title: "Copy task ID" }),
      command({ id: "focus", title: "Focus composer", defaultVisible: true }),
      ...tasks,
    ];

    const groups = groupGlobalCommands(defaultGlobalCommands(commands));

    expect(groups.map((group) => group.label)).toEqual([
      "Recent tasks",
      "Quick actions",
      "Settings",
    ]);
    expect(groups[0]?.commands.map((item) => item.id)).toEqual(
      tasks.slice(0, 9).map((item) => item.id),
    );
    expect(groups[1]?.commands.map((item) => item.id)).toEqual(["new", "focus"]);
    expect(groups[2]?.commands.map((item) => item.id)).toEqual(["general", "browser"]);
  });

  it("ranks matching tasks ahead of commands and keeps loose task matches last", () => {
    const commands = [
      command({ id: "restart", title: "Restart Palot" }),
      task("loose", "Unrelated", ["/srv/r/e/s/t/a/r/t"]),
      task("exact", "Restart flaky worker"),
    ];

    const groups = groupGlobalSearchResults(commands, "restart");

    expect(groups.map((group) => [group.label, group.commands.map((item) => item.id)])).toEqual([
      ["Tasks", ["exact"]],
      ["Commands", ["restart"]],
      ["Similar tasks", ["loose"]],
    ]);
  });
});

describe("palette tabs", () => {
  const commands = [
    command({ id: "new", title: "New task", suggested: true }),
    command({ id: "copy", title: "Copy task ID" }),
    command({ id: "project", title: "New task in Palot", group: "projects", kind: "project" }),
    command({ id: "welcome", title: "Open welcome guide", kind: "setting" }),
    command({ id: "general", title: "Settings", group: "settings", kind: "setting" }),
    command({ id: "appearance", title: "Appearance", group: "settings", kind: "setting" }),
    task("task-a", "Fix settings sync"),
    task("task-b", "Ship release"),
  ];
  const ids = (tab: Parameters<typeof paletteResultGroups>[2], query = "") =>
    paletteResultGroups(commands, query, tab).map((group) => [
      group.label,
      group.commands.map((item) => item.id),
    ]);

  it("keeps the suggestion layout on All and lists each tab's own commands", () => {
    expect(ids("all")).toEqual([
      ["Recent tasks", ["task-a", "task-b"]],
      ["Quick actions", ["new"]],
      ["Settings", ["general", "appearance"]],
    ]);
    expect(ids("tasks")).toEqual([["Recent tasks", ["task-a", "task-b"]]]);
    // The Commands tab reveals commands the empty palette hides, but not per-project rows.
    expect(ids("commands")).toEqual([["Quick actions", ["new", "copy", "welcome"]]]);
    expect(ids("settings")).toEqual([["Settings", ["general", "appearance"]]]);
  });

  it("searches only within the selected tab", () => {
    const all = ids("all", "settings");
    expect(all[0]).toEqual(["Tasks", ["task-a"]]);
    expect(all[1]?.[0]).toBe("Commands");
    expect(all[1]?.[1]).toContain("general");
    expect(ids("tasks", "settings")).toEqual([["Tasks", ["task-a"]]]);
    expect(ids("settings", "settings")).toEqual([["Settings", ["general"]]]);
    expect(ids("commands", "new task")).toEqual([["Commands", ["new", "project"]]]);
    expect(ids("settings", "ship")).toEqual([]);
  });

  it("wraps between tabs", () => {
    expect(adjacentPaletteTab("all", -1)).toBe("settings");
    expect(adjacentPaletteTab("settings", 1)).toBe("all");
    expect(adjacentPaletteTab("tasks", 1)).toBe("files");
    expect(adjacentPaletteTab("files", 1)).toBe("commands");
  });

  it("searches files on the Files tab and in a typed All search, only with a task open", () => {
    expect(ids("files")).toEqual([]);
    expect(paletteFileSearch("files", "", true)).toEqual({ query: "", limit: undefined });
    expect(paletteFileSearch("all", " auth ", true)).toEqual({
      query: "auth",
      limit: ALL_TAB_FILE_LIMIT,
    });
    expect(paletteFileSearch("all", "", true)).toBeNull();
    expect(paletteFileSearch("commands", "auth", true)).toBeNull();
    expect(paletteFileSearch("files", "auth", false)).toBeNull();
  });

  it("switches tabs with arrows only when the caret cannot move that way", () => {
    const arrow = (input: Partial<PaletteArrowInput>): 1 | -1 | 0 =>
      paletteTabStep({
        key: "ArrowRight",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        value: "deploy",
        selectionStart: 6,
        selectionEnd: 6,
        ...input,
      });

    expect(arrow({ value: "", selectionStart: 0, selectionEnd: 0 })).toBe(1);
    expect(arrow({ key: "ArrowLeft", value: "", selectionStart: 0, selectionEnd: 0 })).toBe(-1);
    expect(arrow({})).toBe(1);
    expect(arrow({ key: "ArrowLeft" })).toBe(0);
    expect(arrow({ selectionStart: 3, selectionEnd: 3 })).toBe(0);
    expect(arrow({ key: "ArrowLeft", selectionStart: 0, selectionEnd: 0 })).toBe(-1);
    expect(arrow({ key: "ArrowLeft", selectionStart: 0, selectionEnd: 6 })).toBe(0);
    expect(arrow({ shiftKey: true })).toBe(0);
    expect(arrow({ altKey: true })).toBe(0);
    expect(arrow({ key: "ArrowDown" })).toBe(0);
  });

  it("names Enter after what the row does", () => {
    expect(paletteEnterLabel(task("task", "Ship release"))).toBe("Open task");
    expect(
      paletteEnterLabel(
        command({ id: "general", title: "Settings", group: "settings", kind: "setting" }),
      ),
    ).toBe("Open settings");
    expect(paletteEnterLabel(command({ id: "new", title: "New task", kind: "action" }))).toBe(
      "Run command",
    );
  });
});
