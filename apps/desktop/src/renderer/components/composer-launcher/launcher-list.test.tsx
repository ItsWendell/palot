import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_LAUNCHER_SOURCES, type LauncherSources } from "./launcher-items";
import { buildLauncherView } from "./launcher-view";
import { LauncherList, launcherOptionId } from "./launcher-list";
import {
  CLOSED_LAUNCHER,
  highlightedItem,
  transition,
  type LauncherEvent,
  type LauncherOutcome,
  type LauncherState,
} from "./launcher-state";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 11, 12);
const LIST = "launcher";

const SOURCES: LauncherSources = {
  ...EMPTY_LAUNCHER_SOURCES,
  commands: [
    { name: "compact", description: "Free context", agent: null, model: null, subtask: false },
    { name: "model", description: "Switch model", agent: null, model: null, subtask: false },
    { name: "undo", description: "Revert the last step", agent: null, model: null, subtask: false },
  ],
  stash: [
    {
      id: "stash-1",
      createdAt: NOW - 60_000,
      draft: { text: "Saved idea", mentions: [], command: null },
      files: [],
    },
  ],
};

/** The composer's side of the contract: a field that owns focus and feeds the reducer. */
function Harness({
  initial,
  sources = SOURCES,
  onOutcome = () => {},
}: {
  initial: LauncherState;
  sources?: LauncherSources;
  onOutcome?(outcome: LauncherOutcome): void;
}) {
  const [state, setState] = useState(initial);
  const view = buildLauncherView(state, sources, { now: NOW });
  const dispatch = (event: LauncherEvent) => {
    const step = transition(state, event);
    setState(step.state);
    if (step.outcome) onOutcome(step.outcome);
    return step;
  };
  const highlighted = highlightedItem(state, view.items);
  return (
    <>
      <input
        aria-label="Message"
        role="combobox"
        aria-expanded={state.status === "open"}
        aria-controls={LIST}
        aria-activedescendant={highlighted ? launcherOptionId(LIST, highlighted.id) : undefined}
        value={state.status === "open" ? state.query : ""}
        onChange={(event) => dispatch({ type: "query", query: event.target.value })}
        onKeyDown={(event) => {
          const field = event.currentTarget;
          const step = dispatch({
            type: "key",
            event: {
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
            },
            caret: {
              atStart: field.selectionStart === 0 && field.selectionEnd === 0,
              atEnd: field.selectionStart === field.value.length,
            },
            items: view.items,
          });
          if (step.handled) event.preventDefault();
        }}
      />
      {state.status === "open" ? (
        <LauncherList listId={LIST} state={state} view={view} onEvent={dispatch} />
      ) : null}
    </>
  );
}

const plus = (draftPreview: string | null = null) =>
  transition(CLOSED_LAUNCHER, { type: "open", via: "button", draftPreview }).state;

function activeOption() {
  const id = screen
    .getByRole("combobox", { name: "Message" })
    .getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

describe("LauncherList", () => {
  it("renders the root on its first frame, with categories, suggestions and the kept draft", () => {
    render(<Harness initial={plus("fix the flaky test")} />);
    const list = screen.getByRole("listbox", { name: "Add to message" });
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Attach files"),
      "Recent outputs",
      "Stashed prompts",
      "Commands/",
      "Skills$",
      "Mention a file, task or agent@",
      "Run a shell command!",
      "Saved idea Stashed 1m ago · restore it",
    ]);
    expect(within(list).getByRole("group", { name: "Suggested" })).toBeTruthy();
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(activeOption()).toBe(options[0]);
    expect(screen.getByText("fix the flaky test")).toBeTruthy();
    expect(screen.getByText("· back when you close")).toBeTruthy();
  });

  it("drills into a category with the keyboard and comes back to it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={plus()} />);
    const field = screen.getByRole("combobox", { name: "Message" });
    field.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption()?.textContent).toBe("Commands/");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Commands", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Esc to go back")).toBeTruthy();
    expect(
      within(screen.getByRole("listbox", { name: "Commands" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["/compact Free context", "/model Switch model", "/undo Revert the last step"]);
    await user.keyboard("{Escape}");
    expect(activeOption()?.textContent).toBe("Commands/");
    expect(document.activeElement).toBe(field);
  });

  it("filters with the query, wraps with the arrows and reports the pick", async () => {
    const user = userEvent.setup();
    const onOutcome = vi.fn();
    render(<Harness initial={plus("draft")} onOutcome={onOutcome} />);
    const field = screen.getByRole("combobox", { name: "Message" });
    field.focus();
    onOutcome.mockClear();
    await user.type(field, "co");
    const list = screen.getByRole("listbox", { name: "Add to message" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Commands/", "/compact Free context", "Run a shell command!"]);
    expect(within(list).getByRole("group", { name: "Commands" })).toBeTruthy();
    expect(activeOption()?.textContent).toBe("Commands/");
    await user.keyboard("{ArrowUp}");
    expect(activeOption()?.textContent).toBe("Run a shell command!");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onOutcome).toHaveBeenCalledWith({
      type: "pick",
      action: { type: "command", name: "compact" },
      item: expect.objectContaining({ id: "command:compact" }),
      target: { type: "draft", draftSetAside: true },
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves the highlight only when the pointer moves, and picks on click without taking focus", async () => {
    const onOutcome = vi.fn();
    render(
      <Harness
        initial={transition(plus(), { type: "drill", category: "commands" }).state}
        onOutcome={onOutcome}
      />,
    );
    const field = screen.getByRole("combobox", { name: "Message" });
    field.focus();
    const undo = screen.getByRole("option", { name: /\/undo/ });
    fireEvent.pointerMove(undo, { movementX: 0, movementY: 0 });
    expect(undo.getAttribute("aria-selected")).toBe("false");
    fireEvent.pointerMove(undo, { movementX: 0, movementY: 3 });
    expect(undo.getAttribute("aria-selected")).toBe("true");
    expect(activeOption()).toBe(undo);
    const mouseDown = fireEvent.mouseDown(undo);
    expect(mouseDown).toBe(false);
    fireEvent.click(undo);
    expect(onOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: { type: "command", name: "undo" } }),
    );
  });

  it("goes back from the header's Back button", () => {
    render(<Harness initial={transition(plus(), { type: "drill", category: "stash" }).state} />);
    act(() => screen.getByRole("button", { name: "Back" }).click());
    expect(screen.getByRole("listbox", { name: "Add to message" })).toBeTruthy();
    expect(activeOption()?.textContent).toBe("Stashed prompts");
  });

  it("shows a pending file search: older rows stay but cannot be picked", () => {
    const state = transition(CLOSED_LAUNCHER, {
      type: "trigger",
      trigger: { char: "@", from: 0, to: 3, query: "ma" },
    }).state;
    render(
      <Harness
        initial={state}
        sources={{
          ...SOURCES,
          agents: [
            {
              id: "maintainer",
              name: "Maintainer",
              description: null,
              mode: "subagent",
              hidden: false,
              color: null,
              steps: null,
              model: null,
              permissions: [],
            },
          ],
          files: { paths: ["src/main.ts"], pending: true },
        }}
      />,
    );
    const file = screen.getByRole("option", { name: /main\.ts/ });
    expect(file.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Searching…");
    expect(screen.getByText("Esc to close")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(activeOption()?.textContent).toContain("@maintainer");
  });

  it("tells files with the same name apart by their folder, with the full path as title", () => {
    const state = transition(CLOSED_LAUNCHER, {
      type: "trigger",
      trigger: { char: "@", from: 0, to: 5, query: "auth" },
    }).state;
    render(
      <Harness
        initial={state}
        sources={{
          ...SOURCES,
          files: {
            paths: ["src/server/routes/auth.ts", "src/client/auth.ts", "auth.ts"],
            pending: false,
          },
        }}
      />,
    );
    const rows = screen.getAllByRole("option", { name: /auth\.ts/ });
    expect(rows.map((row) => row.getAttribute("title"))).toEqual([
      "src/server/routes/auth.ts",
      "src/client/auth.ts",
      "auth.ts",
    ]);
    expect(rows.map((row) => row.textContent)).toEqual([
      "auth.ts src/server/routes",
      "auth.ts src/client",
      "auth.ts",
    ]);
    // The folder gives way from its start, so the end nearest the file stays in view.
    const folder = rows[0]!.querySelector('[data-slot="launcher-item-description"]');
    expect(folder?.getAttribute("data-overflow")).toBe("start");
    expect(folder?.getAttribute("dir")).toBe("rtl");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness initial={plus()} />);
    await user.type(screen.getByRole("combobox", { name: "Message" }), "zzzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Nothing matches “zzzz”");
    expect(
      screen.getByRole("combobox", { name: "Message" }).getAttribute("aria-activedescendant"),
    ).toBeNull();
  });
});
