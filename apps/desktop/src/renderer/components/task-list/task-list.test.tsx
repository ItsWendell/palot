import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, makeTask, running } from "@/lib/task-list/model/fixtures.test-support";
import type {
  PermissionRequest,
  Project,
  QuestionRequest,
  Server,
  Task,
} from "@/lib/task-list/types";
import { TooltipProvider } from "../ui/tooltip";
import type { RenderRowMenu } from "./context";
import type { Notice } from "./controller";
import { setRowRenderProbe } from "./debug";
import { createFixtureSource, type FixtureSource } from "./fixture-source";
import { DEFAULT_TASK_LIST_PREFERENCES, type TaskListPreferences } from "./preferences";
import { TaskList } from "./task-list";

const PROJECTS: Project[] = [
  { id: "palot", name: "palot", serverID: "local" },
  { id: "web", name: "website", serverID: "local" },
  { id: "infra", name: "infra", serverID: "devbox" },
];

function permission(id: string, arrivedAt = NOW - 60_000, summary = "bun test"): PermissionRequest {
  return {
    id,
    kind: "permission",
    arrivedAt,
    summary,
    detail: `${summary} --run`,
    rule: `${summary} *`,
    from: null,
  };
}

function question(id: string, options = ["main", "release"]): QuestionRequest {
  return {
    id,
    kind: "question",
    arrivedAt: NOW - 60_000,
    question: "Which branch?",
    options,
    from: null,
  };
}

function waiting(...requests: (PermissionRequest | QuestionRequest)[]): Partial<Task> {
  return { ...running(5 * 60_000), requests, attentionAt: NOW - 60_000 };
}

function idle(id: string, minutesAgo: number, extra: Partial<Task> = {}): Task {
  return makeTask({ id, title: `Task ${id}`, activityAt: NOW - minutesAgo * 60_000, ...extra });
}

interface Setup {
  source: FixtureSource;
  notices: Notice[];
  renders: Map<string, number>;
}

function setup(
  tasks: Task[],
  options: {
    preferences?: Partial<TaskListPreferences>;
    servers?: Server[];
    openTaskID?: string | null;
    renderRowMenu?: RenderRowMenu;
    onPreferencesChange?: (preferences: TaskListPreferences) => void;
  } = {},
): Setup {
  const source = createFixtureSource({
    tasks,
    projects: PROJECTS,
    servers: options.servers,
    openTaskID: options.openTaskID ?? null,
  });
  const notices: Notice[] = [];
  const renders = new Map<string, number>();
  setRowRenderProbe((id) => renders.set(id, (renders.get(id) ?? 0) + 1));
  render(
    <TooltipProvider>
      <TaskList
        source={source}
        preferences={{ ...DEFAULT_TASK_LIST_PREFERENCES, ...options.preferences }}
        notify={(notice) => notices.push(notice)}
        renderRowMenu={options.renderRowMenu}
        onPreferencesChange={options.onPreferencesChange}
      />
    </TooltipProvider>,
  );
  return { source, notices, renders };
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-palot-task-row="${id}"]`);
  if (!element) throw new Error(`No row for ${id}`);
  return element;
}

const hasRow = (id: string) => document.querySelector(`[data-palot-task-row="${id}"]`) !== null;

function rowOrder(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-main-list] [data-palot-task-row]")]
    .sort((a, b) => Number.parseFloat(a.style.top) - Number.parseFloat(b.style.top))
    .map((element) => element.dataset.palotTaskRow!);
}

const focused = () => (document.activeElement as HTMLElement | null)?.dataset.focusKey ?? null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function press(element: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(element, { key, ...init });
}

function focusRow(id: string) {
  act(() => {
    fireEvent.keyDown(window, { key: "Tab" });
    row(id).focus();
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(NOW);
  // happy-dom lays nothing out; give the list a viewport so it mounts the rows near the top.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});

afterEach(() => {
  cleanup();
  setRowRenderProbe(null);
  vi.useRealTimers();
});

describe("TaskList", () => {
  it("renders each status rank with its mark and sentence", () => {
    setup([
      makeTask({ id: "approval", ...waiting(permission("r1")) }),
      makeTask({ id: "question", ...waiting(question("r2")) }),
      makeTask({ id: "failed", failure: "rate limit reached" }),
      makeTask({
        id: "unseen",
        unread: true,
        summary: { durationMs: 125_000, filesChanged: 3, commands: 1 },
      }),
      makeTask({ id: "working", ...running(42_000, 1_000, "Running bun test") }),
      makeTask({ id: "stale", ...running(30 * 60_000, 12 * 60_000) }),
      makeTask({ id: "stopped", stopped: true }),
      makeTask({ id: "idle" }),
    ]);
    const expected: [string, string, string | null, string | null][] = [
      ["approval", "approval", "Needs approval", "Waiting for approval"],
      ["question", "question", "Needs an answer", "Waiting for your answer · Which branch?"],
      ["failed", "failed", "Failed", "Failed · rate limit reached"],
      ["unseen", "unseen", "Finished, not seen yet", "Worked for 2m 5s · changed 3 files"],
      ["working", "working", "Working", "Running bun test · 42s"],
      ["stale", "stale", "No recent update", "No update for 12m"],
      ["stopped", "stopped", "Stopped", "Stopped"],
      ["idle", "idle", null, null],
    ];
    for (const [id, kind, mark, sentence] of expected) {
      const element = row(id);
      expect(element.dataset.status).toBe(kind);
      const marks = element.querySelectorAll("[data-slot='status-mark']");
      if (mark) expect(within(element).getByRole("img", { name: mark })).toBeTruthy();
      else expect(marks).toHaveLength(0);
      if (sentence) expect(element.textContent).toContain(sentence);
      else expect(element.dataset.lines).toBe("1");
    }
  });

  it("groups by project with chats first, and by server with offline rows stale", () => {
    const servers: Server[] = [
      { id: "local", name: "This Mac", online: true, lastSeenAt: null },
      { id: "devbox", name: "build-box", online: false, lastSeenAt: NOW - 600_000 },
    ];
    const tasks = [
      idle("chat", 5, { projectID: null }),
      idle("p1", 6),
      idle("w1", 7, { projectID: "web" }),
      makeTask({ id: "remote", projectID: "infra", serverID: "devbox", ...running(60_000) }),
    ];
    setup(tasks, {
      preferences: { view: { ...DEFAULT_TASK_LIST_PREFERENCES.view, grouping: "project" } },
      servers,
    });
    const groups = screen
      .getAllByRole("treeitem")
      .filter((element) => element.hasAttribute("aria-expanded"))
      .map((element) => element.getAttribute("aria-label")!.split(",")[0]);
    expect(groups).toEqual(["Chats", "infra", "palot", "website"]);
    expect(row("chat").textContent).not.toContain("palot");
    expect(row("remote").dataset.status).toBe("stale");
    cleanup();

    setup(tasks, {
      preferences: { view: { ...DEFAULT_TASK_LIST_PREFERENCES.view, grouping: "server" } },
      servers,
    });
    expect(screen.getByRole("treeitem", { name: /^build-box, offline/ })).toBeTruthy();
    expect(
      within(row("remote")).getByRole("button", { name: "Stop", hidden: true }),
    ).toHaveProperty("disabled", true);
  });

  it("places working tasks by the Working knob and widens idle rows by Row detail", () => {
    const tasks = [
      makeTask({ id: "ask", ...waiting(permission("r1")) }),
      makeTask({ id: "run", ...running(60_000) }),
      idle("idle", 3),
    ];
    const view = DEFAULT_TASK_LIST_PREFERENCES.view;
    setup(tasks, { preferences: { view: { ...view, working: "after-inbox" } } });
    expect(rowOrder()).toEqual(["ask", "idle", "run"]);
    expect(row("idle").dataset.lines).toBe("1");
    expect(row("idle").textContent).toContain("palot");
    cleanup();

    setup(tasks, { preferences: { view: { ...view, working: "under-needs-you" } } });
    expect(rowOrder()).toEqual(["ask", "run", "idle"]);
    cleanup();

    setup(tasks, { preferences: { view: { ...view, working: "list", rowDetail: "comfortable" } } });
    expect(row("run").dataset.placement).toBe("inbox");
    expect(document.querySelector("[aria-label^='Working,']")).toBeNull();
    expect(row("idle").dataset.lines).toBe("2");
  });

  it("docks Working under the main list by default, only while something runs", () => {
    const tasks = [
      makeTask({ id: "ask", ...waiting(permission("r1")) }),
      makeTask({ id: "run", ...running(60_000) }),
      makeTask({ id: "run2", ...running(90_000) }),
      idle("idle", 3),
    ];
    const { source } = setup(tasks);
    const dock = () => document.querySelector<HTMLElement>("[data-slot='task-list-dock']");
    expect(rowOrder()).toEqual(["ask", "idle"]);
    expect(dock()?.contains(row("run"))).toBe(true);
    expect(row("run").closest("[data-main-list]")).toBeNull();

    // Arrow keys walk from the main list into the dock and back.
    focusRow("idle");
    press(row("idle"), "ArrowDown");
    expect(focused()).toBe("shelf:working");
    press(document.activeElement as HTMLElement, "ArrowDown");
    expect(focused()).toBe("run");
    press(document.activeElement as HTMLElement, "ArrowLeft");
    expect(focused()).toBe("shelf:working");
    press(document.activeElement as HTMLElement, "ArrowUp");
    expect(focused()).toBe("idle");

    // Collapsed, the dock is its header: label, count and rollup, no rows.
    fireEvent.click(within(dock()!).getByRole("treeitem", { name: "Working, 2" }));
    expect(dock()!.dataset.open).toBeUndefined();
    expect(hasRow("run")).toBe(false);
    expect(dock()!.textContent).toContain("2");

    // With nothing running there is no dock at all.
    act(() => source.set({ tasks: [tasks[0]!, tasks[3]!] }));
    expect(dock()).toBeNull();
  });

  it("shows a chat as Chat, never with a branch or pull request", () => {
    setup([
      makeTask({
        id: "chat",
        projectID: null,
        branch: "main",
        unread: true,
        pr: { number: 7, state: "open", checks: "passing", readiness: null },
      }),
    ]);
    const element = row("chat");
    expect(element.textContent).toContain("Chat");
    expect(element.textContent).not.toContain("main");
    expect(element.querySelector("[data-slot='pull-request-mark']")).toBeNull();
    expect(element.getAttribute("aria-label")).toContain("Chat");
  });

  it("allows by key on the focused row and moves focus to the next request", async () => {
    const { source, notices } = setup([
      makeTask({ id: "a1", ...waiting(permission("r1", NOW - 90_000)) }),
      makeTask({ id: "a2", ...waiting(permission("r2", NOW - 60_000, "rm -rf dist")) }),
      idle("idle", 3),
    ]);
    focusRow("a1");
    press(row("a1"), "a");
    await flush();
    expect(source.calls.filter((call) => call.action === "replyPermission")).toEqual([
      { action: "replyPermission", args: ["a1", "r1", "once"] },
    ]);
    expect(focused()).toBe("a2");
    // The answered row lingers in "Needs you", working, before it moves on.
    expect(row("a1").dataset.placement).toBe("needs-you");
    expect(notices.at(-1)?.title).toBe("Allowed bun test");

    fireEvent.click(within(row("a2")).getByRole("button", { name: "Deny" }));
    await flush();
    expect(source.calls.at(-1)).toEqual({
      action: "replyPermission",
      args: ["a2", "r2", "reject"],
    });
  });

  it("answers a question from its option chips", async () => {
    const { source } = setup([makeTask({ id: "q", ...waiting(question("rq")) })]);
    fireEvent.click(within(row("q")).getByRole("button", { name: "release" }));
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "replyQuestion", args: ["q", "rq", "release"] });
  });

  it("ignores keys and clicks for 1.5 s after a request appears", async () => {
    const { source } = setup([makeTask({ id: "t", ...running(60_000) }), idle("idle", 3)]);
    act(() => source.update([makeTask({ id: "t", ...waiting(permission("late", Date.now())) })]));
    focusRow("t");
    press(row("t"), "a");
    await flush();
    expect(source.calls.some((call) => call.action === "replyPermission")).toBe(false);
    expect(row("t").textContent).toContain("Just arrived");
    // The button keeps its normal look but takes no click until the guard passes.
    const allow = within(row("t")).getByRole("button", { name: "Allow once" });
    expect(allow.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(allow);
    await flush();
    expect(source.calls.some((call) => call.action === "replyPermission")).toBe(false);

    act(() => vi.advanceTimersByTime(1_600));
    press(row("t"), "a");
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "replyPermission", args: ["t", "late", "once"] });
  });

  it("pages through several requests on one task", () => {
    setup([
      makeTask({ id: "multi", ...waiting(permission("r1"), permission("r2"), question("r3")) }),
    ]);
    expect(row("multi").textContent).toContain("1 of 3");
    fireEvent.click(within(row("multi")).getByRole("button", { name: "Next request" }));
    expect(row("multi").textContent).toContain("2 of 3");
    fireEvent.click(within(row("multi")).getByRole("button", { name: "Previous request" }));
    fireEvent.click(within(row("multi")).getByRole("button", { name: "Previous request" }));
    expect(row("multi").textContent).toContain("3 of 3");
    expect(row("multi").dataset.status).toBe("question");
  });

  it("settles by key and by the hover action, with undo", async () => {
    const { source, notices } = setup([idle("one", 2), idle("two", 3), idle("three", 4)]);
    focusRow("one");
    press(row("one"), "e");
    expect(hasRow("one")).toBe(false);
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "settle", args: [["one"]] });
    expect(focused()).toBe("two");
    expect(notices.at(-1)?.title).toBe("Settled “Task one”");

    await act(async () => {
      await notices.at(-1)!.undo!();
    });
    expect(hasRow("one")).toBe(true);

    fireEvent.click(within(row("three")).getByRole("button", { name: "Settle", hidden: true }));
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "settle", args: [["three"]] });
    expect(hasRow("three")).toBe(false);
  });

  it("settles the open task with Mod+Shift+S from anywhere, like E on its row", async () => {
    const { source, notices } = setup([idle("one", 2), idle("two", 3), idle("three", 4)], {
      openTaskID: "two",
    });
    const event = new KeyboardEvent("keydown", {
      key: "S",
      code: "KeyS",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "getModifierState", { value: () => false });
    act(() => void document.body.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(hasRow("two")).toBe(false);
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "settle", args: [["two"]] });
    expect(notices.at(-1)?.title).toBe("Settled “Task two”");
  });

  it("snoozes, pins and marks unread by key", async () => {
    const { source, notices } = setup([idle("one", 2), idle("two", 3)]);
    focusRow("one");
    press(row("one"), "p");
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "setPinned", args: ["one", true] });
    expect(row("one").dataset.placement).toBe("pinned");
    expect(screen.getByText("Pinned")).toBeTruthy();

    focusRow("two");
    press(row("two"), "u");
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "setUnread", args: [["two"], true] });
    expect(row("two").dataset.status).toBe("unseen");
    expect(notices.at(-1)).toMatchObject({ title: "Marked as unread" });

    focusRow("two");
    press(row("two"), "s");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /In 1 hour/ }));
    await flush();
    expect(source.calls.at(-1)?.action).toBe("snooze");
    expect(source.calls.at(-1)?.args[0]).toEqual(["two"]);
    expect(notices.at(-1)).toMatchObject({ title: "Snoozed" });
  });

  it("opens a middle-clicked row in a background window without opening it here", () => {
    const { source } = setup([idle("one", 2), idle("two", 3)]);
    fireEvent(row("two"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(source.calls.at(-1)).toEqual({
      action: "open",
      args: ["two", { newWindow: true, background: true }],
    });
    expect(row("two").hasAttribute("data-open")).toBe(false);
  });

  it("selects several rows and settles them from the bulk bar", async () => {
    const { source } = setup([idle("one", 2), idle("two", 3), idle("three", 4)]);
    fireEvent.click(row("one"), { ctrlKey: true });
    fireEvent.click(row("three"), { ctrlKey: true });
    const bar = screen.getByRole("toolbar", { name: "2 selected" });
    fireEvent.click(within(bar).getByRole("button", { name: "Settle" }));
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "settle", args: [["one", "three"]] });
  });

  it("moves focus across sections and sections' headers, and Left/Right fold groups", () => {
    setup(
      [
        makeTask({ id: "ask", ...waiting(permission("r1")) }),
        idle("p1", 2),
        idle("w1", 3, { projectID: "web" }),
      ],
      { preferences: { view: { ...DEFAULT_TASK_LIST_PREFERENCES.view, grouping: "project" } } },
    );
    focusRow("ask");
    const keys = ["ask"];
    for (let step = 0; step < 4; step++) {
      press(document.activeElement as HTMLElement, "ArrowDown");
      keys.push(focused()!);
    }
    expect(keys).toEqual(["ask", "group:project:palot", "p1", "group:project:web", "w1"]);

    press(document.activeElement as HTMLElement, "ArrowLeft");
    expect(focused()).toBe("group:project:web");
    press(document.activeElement as HTMLElement, "ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("false");
    expect(hasRow("w1")).toBe(false);
    press(document.activeElement as HTMLElement, "ArrowRight");
    expect(hasRow("w1")).toBe(true);
  });

  it("holds the order while the pointer is inside and releases it 3 s later", () => {
    const { source } = setup([idle("one", 2), idle("two", 3)]);
    expect(rowOrder()).toEqual(["one", "two"]);
    const tree = screen.getByRole("tree", { name: "Tasks" });
    fireEvent.pointerEnter(tree);
    act(() => source.update([idle("two", 0)]));
    expect(rowOrder()).toEqual(["one", "two"]);
    fireEvent.pointerLeave(tree);
    expect(rowOrder()).toEqual(["one", "two"]);
    act(() => vi.advanceTimersByTime(3_100));
    expect(rowOrder()).toEqual(["two", "one"]);
  });

  it("renames inline", async () => {
    const { source } = setup([idle("one", 2)]);
    fireEvent.doubleClick(row("one"));
    const input = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.change(input, { target: { value: "Better title" } });
    press(input, "Enter");
    await flush();
    expect(source.calls.at(-1)).toEqual({ action: "rename", args: ["one", "Better title"] });
    expect(row("one").textContent).toContain("Better title");
  });

  it("restores the row and says so when an action fails", async () => {
    const { source, notices } = setup([idle("one", 2), idle("two", 3)]);
    source.failNext("settle", "connection lost");
    focusRow("one");
    press(row("one"), "e");
    expect(hasRow("one")).toBe(false);
    await flush();
    expect(hasRow("one")).toBe(true);
    expect(row("one").dataset.placement).toBe("inbox");
    expect(notices.at(-1)).toMatchObject({
      type: "error",
      title: "Could not settle the task",
      description: "connection lost",
    });
  });

  it("mounts a bounded number of rows for 400 tasks", () => {
    setup(Array.from({ length: 400 }, (_, index) => idle(`t${index}`, index + 1)));
    const mounted = document.querySelectorAll("[data-palot-task-row]").length;
    expect(mounted).toBeGreaterThan(10);
    expect(mounted).toBeLessThan(50);
  });

  it("scrolls to a task the app opens, without taking focus", () => {
    const { source } = setup(
      Array.from({ length: 400 }, (_, index) => idle(`t${index}`, index + 1)),
    );
    const viewport = document.querySelector<HTMLElement>("[data-main-list]")!;
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    expect(viewport.scrollTop).toBe(0);
    act(() => source.set({ openTaskID: "t300" }));
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("does not scroll when the open task came from a click in the list", () => {
    setup([idle("one", 2), idle("two", 3), idle("three", 4)]);
    const viewport = document.querySelector<HTMLElement>("[data-main-list]")!;
    // The first row sits partly above the top edge; a reveal would scroll it back into view.
    const top = Number.parseFloat(row("one").style.top);
    viewport.scrollTop = top + 4;
    fireEvent.click(row("one"));
    expect(viewport.scrollTop).toBe(top + 4);
  });

  it("scrolls to the open task when the list mounts", () => {
    setup(
      Array.from({ length: 400 }, (_, index) => idle(`t${index}`, index + 1)),
      { openTaskID: "t200" },
    );
    expect(document.querySelector<HTMLElement>("[data-main-list]")!.scrollTop).toBeGreaterThan(0);
  });

  it("leaves the window-wide task keys to an open dialog, menu, picker or select", () => {
    const { source } = setup([
      makeTask({ id: "approval", ...waiting(permission("r1")) }),
      idle("one", 2),
      idle("two", 3),
    ]);
    const opens = () => source.calls.filter((call) => call.action === "open").length;
    const keys: KeyboardEventInit[] = [
      { key: "2", code: "Digit2", ctrlKey: true },
      { key: "a", code: "KeyA", ctrlKey: true, altKey: true },
      { key: "ArrowDown", code: "ArrowDown", altKey: true },
    ];
    // happy-dom reports Alt as AltGraph, which the shortcut matcher ignores; a real Alt is not.
    const press = (target: Element, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      Object.defineProperty(event, "getModifierState", { value: () => false });
      act(() => void target.dispatchEvent(event));
    };
    const host = (tag: string, role?: string) => {
      const element = document.createElement(tag);
      if (role) element.setAttribute("role", role);
      return element;
    };
    for (const overlay of [
      host("div", "dialog"),
      host("div", "menu"),
      host("input", "combobox"),
      host("div", "listbox"),
      host("select"),
    ]) {
      const target =
        overlay.tagName === "DIV" ? overlay.appendChild(document.createElement("button")) : overlay;
      document.body.append(overlay);
      for (const init of keys) press(target, init);
      overlay.remove();
    }
    expect(opens()).toBe(0);
    // The same keys work from the page.
    for (const init of keys) press(document.body, init);
    expect(opens()).toBe(keys.length);
  });

  it("re-renders only the changed task's row, and a clock tick only the duration text", () => {
    const tasks = [
      makeTask({ id: "run", ...running(42_000, 1_000, "Running bun test") }),
      ...Array.from({ length: 10 }, (_, index) => idle(`t${index}`, index + 1)),
    ];
    const { source, renders } = setup(tasks);
    expect(row("run").textContent).toContain("42s");
    renders.clear();

    act(() => source.update([{ ...tasks[3]!, title: "Renamed elsewhere" }]));
    expect([...renders.keys()]).toEqual(["t2"]);
    expect(renders.get("t2")).toBe(1);
    renders.clear();

    act(() => vi.advanceTimersByTime(1_000));
    expect(row("run").textContent).toContain("43s");
    expect(renders.size).toBe(0);
  });

  it("marks a task with an unsent draft, except the open task", () => {
    const tasks = [idle("a", 1, { draft: true }), idle("b", 2, { draft: true }), idle("c", 3)];
    const { source, renders } = setup(tasks, { openTaskID: "b" });
    const mark = within(row("a")).getByRole("img", { name: "Unsent draft" });
    expect(mark.getAttribute("title")).toBe("Unsent draft");
    expect(row("a").getAttribute("aria-label")).toContain("Unsent draft");
    // The open task's draft is in its composer; no mark.
    expect(within(row("b")).queryByRole("img", { name: "Unsent draft" })).toBeNull();
    expect(row("b").getAttribute("aria-label")).not.toContain("Unsent draft");
    expect(within(row("c")).queryByRole("img", { name: "Unsent draft" })).toBeNull();
    // The trailing slot still shows the time.
    expect(row("a").querySelector('[data-slot="trailing"] time')).not.toBeNull();
    renders.clear();

    act(() => source.update([{ ...tasks[0]!, draft: false }]));
    expect(within(row("a")).queryByRole("img", { name: "Unsent draft" })).toBeNull();
    expect([...renders.keys()]).toEqual(["a"]);
  });

  it("wraps each row in the app's menu through renderRowMenu", () => {
    const seen: string[] = [];
    setup([idle("one", 2)], {
      renderRowMenu: (task, row, menu) => {
        seen.push(task.id);
        return (
          <div data-testid={`menu-${task.id}`}>
            {row}
            <div hidden>{menu.items ? "items" : null}</div>
          </div>
        );
      },
    });
    expect(seen).toContain("one");
    expect(screen.getByTestId("menu-one").contains(row("one"))).toBe(true);
    expect(row("one").dataset.sidebarFluidRow).toBe("");
  });

  it("reports a changed View knob as preferences", async () => {
    const changes: TaskListPreferences[] = [];
    setup([idle("one", 2)], { onPreferencesChange: (next) => changes.push(next) });
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Comfortable" }));
    expect(changes.at(-1)?.view.rowDetail).toBe("comfortable");
    expect(row("one").dataset.lines).toBe("2");
  });

  it("marks every unread task in the current filter as read, with one undo", async () => {
    const { source, notices } = setup(
      [
        idle("one", 2, { unread: true }),
        idle("two", 3, { unread: true, projectID: "web" }),
        idle("three", 4),
      ],
      { preferences: { filters: { project: "palot", states: [], server: null } } },
    );
    const openView = async () => {
      fireEvent.click(screen.getByRole("button", { name: /^View/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      return screen.getByRole("menuitem", { name: "Mark all as read" });
    };
    fireEvent.click(await openView());
    await flush();
    // Only the filter's unread task; "two" is in another project.
    expect(source.calls.at(-1)).toEqual({ action: "setUnread", args: [["one"], false] });
    expect(row("one").dataset.status).not.toBe("unseen");
    await act(async () => {
      await notices.at(-1)!.undo!();
    });
    expect(source.calls.at(-1)).toEqual({ action: "setUnread", args: [["one"], true] });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await flush();
    source.calls.length = 0;
    await act(async () => {
      await source.actions.setUnread(["one"], false);
    });
    expect((await openView()).getAttribute("aria-disabled")).toBe("true");
  });
});
