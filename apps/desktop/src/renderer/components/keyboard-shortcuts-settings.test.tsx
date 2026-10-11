import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatShortcut,
  matchesShortcut,
  resetShortcutBindings,
  setShortcutBinding,
  shortcutKeys,
  useShortcutKeys,
} from "../lib/keyboard-shortcuts";
import { KeyboardShortcutsSettings } from "./keyboard-shortcuts-settings";

/** Stands in for any shortcut label elsewhere in the app, such as a tooltip or menu hint. */
function NewTaskHint() {
  const keys = useShortcutKeys("task.new");
  return <span data-testid="new-task-hint">{keys.length ? formatShortcut(keys) : "none"}</span>;
}

function renderSettings() {
  render(
    <>
      <KeyboardShortcutsSettings />
      <NewTaskHint />
    </>,
  );
  return userEvent.setup();
}

function ctrl(key: string) {
  return new KeyboardEvent("keydown", { key: key.toLowerCase(), ctrlKey: true });
}

function row(id: string) {
  return document.querySelector<HTMLElement>(`[data-shortcut-id="${id}"]`)!;
}

describe("KeyboardShortcutsSettings", () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = "linux";
  });
  afterEach(() => {
    cleanup();
    resetShortcutBindings();
    delete document.documentElement.dataset.platform;
  });

  it("filters the reference by label and keeps matches under their group", async () => {
    const user = renderSettings();
    expect(screen.getByRole("heading", { name: "Task view" })).toBeTruthy();

    await user.type(
      screen.getByRole("searchbox", { name: "Filter keyboard shortcuts" }),
      "cycle agent",
    );

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Composer",
    ]);
    expect(screen.getByText("Cycle agent")).toBeTruthy();
    expect(screen.getByText("Cycle agent backwards")).toBeTruthy();
    expect(screen.queryByText("Find in task")).toBeNull();

    await user.clear(screen.getByRole("searchbox", { name: "Filter keyboard shortcuts" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Filter keyboard shortcuts" }),
      "no such shortcut",
    );
    expect(screen.getByText(/No shortcuts match/)).toBeTruthy();
  });

  it("lists Find in changes as an editable shortcut", () => {
    renderSettings();
    expect(within(row("changes.find")).getByText("Find in changes")).toBeTruthy();
    expect(
      within(row("changes.find")).getByRole("button", {
        name: /Change shortcut for Find in changes/,
      }),
    ).toBeTruthy();
  });

  it("records a new binding that the matcher and other labels follow", async () => {
    const user = renderSettings();
    await user.click(screen.getByRole("button", { name: /Change shortcut for New task/ }));
    expect(within(row("task.new")).getByText("Press keys…")).toBeTruthy();

    await user.keyboard("{Control>}j{/Control}");

    expect(matchesShortcut(ctrl("j"), shortcutKeys("task.new"))).toBe(true);
    expect(matchesShortcut(ctrl("n"), shortcutKeys("task.new"))).toBe(false);
    expect(screen.getByTestId("new-task-hint").textContent).toBe("Ctrl+J");
    expect(
      screen.getByRole("button", { name: "Change shortcut for New task, currently Ctrl+J" }),
    ).toBeTruthy();
  });

  it("cancels with Escape, clears with Backspace, and rejects bare keys", async () => {
    const user = renderSettings();
    const change = () => screen.getByRole("button", { name: /Change shortcut for New task/ });

    await user.click(change());
    await user.keyboard("j");
    expect(within(row("task.new")).getByRole("alert").textContent).toMatch(/Ctrl/);
    await user.keyboard("{Escape}");
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(within(row("task.new")).queryByText("Press keys…")).toBeNull();

    await user.click(change());
    await user.keyboard("{Backspace}");
    expect(shortcutKeys("task.new")).toEqual([]);
    expect(screen.getByTestId("new-task-hint").textContent).toBe("none");
    expect(change().getAttribute("aria-label")).toBe(
      "Change shortcut for New task, currently Not set",
    );

    // The palette is the way into every command, so it cannot be cleared.
    await user.click(screen.getByRole("button", { name: /Change shortcut for Search tasks/ }));
    await user.keyboard("{Backspace}");
    expect(within(row("palette.open")).getByRole("alert").textContent).toMatch(/needs a shortcut/);
    expect(shortcutKeys("palette.open")).toEqual(["Mod", "K"]);
  });

  it("offers to replace or cancel a conflicting binding", async () => {
    const user = renderSettings();
    const recordNewTask = async () => {
      await user.click(screen.getByRole("button", { name: /Change shortcut for New task/ }));
      await user.keyboard("{Control>}b{/Control}");
    };

    await recordNewTask();
    const alert = within(row("task.new")).getByRole("alert");
    expect(alert.textContent).toContain("Ctrl+B is already used by Show or hide navigation");
    await user.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(shortcutKeys("navigation.toggle")).toEqual(["Mod", "B"]);

    await recordNewTask();
    await user.click(
      within(within(row("task.new")).getByRole("alert")).getByRole("button", { name: "Replace" }),
    );
    expect(shortcutKeys("task.new")).toEqual(["Mod", "B"]);
    expect(shortcutKeys("navigation.toggle")).toEqual([]);
  });

  it("resets one row or restores every default", async () => {
    setShortcutBinding("task.new", ["Mod", "J"]);
    setShortcutBinding("settings.open", ["Mod", "Shift", "P"]);
    const user = renderSettings();

    await user.click(screen.getByRole("button", { name: "Reset New task to Ctrl+N" }));
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(screen.queryByRole("button", { name: "Reset New task to Ctrl+N" })).toBeNull();
    expect(shortcutKeys("settings.open")).toEqual(["Mod", "Shift", "P"]);

    await user.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(shortcutKeys("settings.open")).toEqual(["Mod", ","]);
    expect(
      (screen.getByRole("button", { name: "Restore defaults" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps built-in composer keys locked", () => {
    renderSettings();
    expect(within(row("composer.send")).queryByRole("button")).toBeNull();
    expect(within(row("composer.send")).getByText("Part of typing in the composer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Change shortcut for Send message/ })).toBeNull();
  });
});
