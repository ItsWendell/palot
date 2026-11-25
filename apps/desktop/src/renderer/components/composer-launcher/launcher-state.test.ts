import { describe, expect, it } from "vitest";
import type { LauncherItem } from "./launcher-items";
import {
  CLOSED_LAUNCHER,
  highlightedItem,
  transition,
  type LauncherEvent,
  type LauncherState,
} from "./launcher-state";

function item(id: string, patch: Partial<LauncherItem> = {}): LauncherItem {
  return {
    id,
    kind: "command",
    title: id,
    icon: "command",
    category: "commands",
    action: { type: "command", name: id },
    ...patch,
  };
}

const category = (id: "outputs" | "stash" | "commands" | "skills" | "mention") =>
  item(`category:${id}`, {
    kind: "category",
    category: null,
    action: { type: "drill", category: id },
  });

const ROOT = [
  item("attach", { kind: "attach", action: { type: "attach-files" } }),
  category("stash"),
  category("commands"),
];

function run(state: LauncherState, ...events: LauncherEvent[]) {
  let current = state;
  let last = transition(current, events[0]!);
  current = last.state;
  for (const event of events.slice(1)) {
    last = transition(current, event);
    current = last.state;
  }
  return last;
}

const key = (
  keyName: string,
  items: readonly LauncherItem[],
  patch: Partial<Extract<LauncherEvent, { type: "key" }>["event"]> = {},
  caret = { atStart: true, atEnd: true },
): LauncherEvent => ({ type: "key", event: { key: keyName, ...patch }, caret, items });

const openPlus = (draftPreview: string | null = "fix the bug") =>
  transition(CLOSED_LAUNCHER, { type: "open", via: "button", draftPreview }).state;

const typed = (char: "/" | "@" | "$", from: number, query: string): LauncherEvent => ({
  type: "trigger",
  trigger: { char, from, to: from + 1 + query.length, query },
});

describe("opening and closing", () => {
  it("opens `+` at the root and sets a non-empty draft aside", () => {
    const step = transition(CLOSED_LAUNCHER, {
      type: "open",
      via: "shortcut",
      draftPreview: "fix the bug",
    });
    expect(step.outcome).toEqual({ type: "set-draft-aside" });
    expect(step.state).toMatchObject({
      status: "open",
      source: { type: "plus", via: "shortcut" },
      category: null,
      query: "",
      keptDraft: "fix the bug",
    });
    expect(openPlus("   ")).toMatchObject({ keptDraft: null });
  });

  it("toggles closed and asks for the draft back", () => {
    const step = transition(openPlus(), { type: "toggle", via: "button", draftPreview: null });
    expect(step.state.status).toBe("closed");
    expect(step.outcome).toEqual({ type: "restore-draft" });
  });

  it("opens a typed trigger in its category without setting the draft aside", () => {
    const step = transition(CLOSED_LAUNCHER, typed("@", 4, "comp"));
    expect(step.outcome).toBeNull();
    expect(step.state).toMatchObject({
      status: "open",
      source: { type: "trigger", trigger: { char: "@", from: 4, to: 9 } },
      category: "mention",
      query: "comp",
      keptDraft: null,
    });
    expect(transition(CLOSED_LAUNCHER, typed("/", 0, "")).state).toMatchObject({
      category: "commands",
    });
    expect(transition(CLOSED_LAUNCHER, typed("$", 0, "")).state).toMatchObject({
      category: "skills",
    });
  });

  it("closes a typed trigger when it goes away, and ignores triggers while `+` is open", () => {
    const opened = transition(CLOSED_LAUNCHER, typed("@", 0, "a")).state;
    expect(transition(opened, { type: "trigger", trigger: null }).state).toEqual(CLOSED_LAUNCHER);
    const plus = openPlus();
    const step = transition(plus, typed("@", 0, "a"));
    expect(step.state).toBe(plus);
  });

  it("Escape closes a typed trigger, which stays closed until its start moves or it goes", () => {
    const opened = transition(CLOSED_LAUNCHER, typed("@", 4, "co")).state;
    const escaped = transition(opened, key("Escape", []));
    expect(escaped.handled).toBe(true);
    expect(escaped.state).toEqual({ status: "closed", dismissedTrigger: 4 });
    expect(transition(escaped.state, typed("@", 4, "com")).state.status).toBe("closed");
    expect(transition(escaped.state, typed("@", 9, "")).state.status).toBe("open");
    const cleared = transition(escaped.state, { type: "trigger", trigger: null }).state;
    expect(transition(cleared, typed("@", 4, "com")).state.status).toBe("open");
  });

  it("keeps a trigger in the set-aside draft closed when `+` returns it", () => {
    const opened = transition(CLOSED_LAUNCHER, typed("@", 4, "co")).state;
    const plus = transition(opened, { type: "open", via: "shortcut", draftPreview: "see @co" });
    expect(plus.state).toMatchObject({ source: { type: "plus" }, keptDraft: "see @co" });
    const closed = transition(plus.state, { type: "escape" });
    expect(closed.outcome).toEqual({ type: "restore-draft" });
    expect(transition(closed.state, typed("@", 4, "co")).state.status).toBe("closed");
  });

  it("Backspace on an empty root query closes `+`; on a typed trigger it edits the draft", () => {
    const step = transition(openPlus(), key("Backspace", ROOT));
    expect(step.handled).toBe(true);
    expect(step.state.status).toBe("closed");
    expect(step.outcome).toEqual({ type: "restore-draft" });
    const trigger = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    expect(transition(trigger, key("Backspace", [])).handled).toBe(false);
  });
});

describe("levels", () => {
  it("Right drills in only with the caret at the end of the query", () => {
    const state = run(openPlus(), { type: "highlight", id: "category:commands" }).state;
    const midQuery = transition(
      state,
      key("ArrowRight", ROOT, {}, { atStart: false, atEnd: false }),
    );
    expect(midQuery.handled).toBe(false);
    const step = transition(state, key("ArrowRight", ROOT));
    expect(step.handled).toBe(true);
    expect(step.state).toMatchObject({ category: "commands", query: "", highlight: null });
    // On a row that does not drill, Right moves the caret as usual.
    expect(transition(openPlus(), key("ArrowRight", ROOT)).handled).toBe(false);
  });

  it("clears the field when a level change discards a query", () => {
    const state = run(openPlus(), { type: "query", query: "com" }).state;
    expect(transition(state, { type: "drill", category: "commands" }).outcome).toEqual({
      type: "clear-query",
    });
    expect(transition(openPlus(), { type: "drill", category: "commands" }).outcome).toBeNull();
  });

  it("Left or Backspace on an empty query goes back and lands on the category", () => {
    const inside = transition(openPlus(), { type: "drill", category: "stash" }).state;
    for (const name of ["ArrowLeft", "Backspace"]) {
      const step = transition(inside, key(name, []));
      expect(step.handled).toBe(true);
      expect(step.state).toMatchObject({ category: null, highlight: "category:stash" });
      expect(highlightedItem(step.state, ROOT)?.id).toBe("category:stash");
    }
    const typedQuery = transition(inside, { type: "query", query: "x" }).state;
    expect(transition(typedQuery, key("ArrowLeft", [])).handled).toBe(false);
    expect(transition(typedQuery, key("Backspace", [])).handled).toBe(false);
  });

  it("Escape goes back one level, then closes", () => {
    const inside = transition(openPlus(), { type: "drill", category: "commands" }).state;
    const back = transition(inside, key("Escape", []));
    expect(back.state).toMatchObject({ status: "open", category: null });
    const closed = transition(back.state, key("Escape", ROOT));
    expect(closed.state.status).toBe("closed");
    expect(closed.outcome).toEqual({ type: "restore-draft" });
  });

  it("a typed trigger's category has no back level", () => {
    const opened = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    expect(transition(opened, { type: "back" }).handled).toBe(false);
    expect(transition(opened, key("ArrowLeft", [])).handled).toBe(false);
  });
});

describe("highlight", () => {
  const rows = [item("a"), item("b", { disabled: true }), item("c"), item("d")];

  it("moves with wrapping and skips rows that cannot be picked", () => {
    let state = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    expect(highlightedItem(state, rows)?.id).toBe("a");
    state = transition(state, key("ArrowDown", rows)).state;
    expect(highlightedItem(state, rows)?.id).toBe("c");
    state = transition(state, key("ArrowUp", rows)).state;
    state = transition(state, key("ArrowUp", rows)).state;
    expect(highlightedItem(state, rows)?.id).toBe("d");
    state = transition(state, key("ArrowDown", rows)).state;
    expect(highlightedItem(state, rows)?.id).toBe("a");
  });

  it("Ctrl+N and Ctrl+P move like the arrows; other modifiers do not", () => {
    const state = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    const down = transition(state, key("n", rows, { ctrlKey: true }));
    expect(highlightedItem(down.state, rows)?.id).toBe("c");
    const up = transition(state, key("p", rows, { ctrlKey: true }));
    expect(highlightedItem(up.state, rows)?.id).toBe("d");
    expect(transition(state, key("ArrowDown", rows, { metaKey: true })).handled).toBe(false);
    expect(transition(state, key("n", rows, { ctrlKey: true, metaKey: true })).handled).toBe(false);
  });

  it("follows the item's identity while rows change, and resets when the query changes", () => {
    let state = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    state = transition(state, { type: "highlight", id: "c" }).state;
    // A result arrives above the highlighted row: it stays on the same item.
    const grown = [item("new"), ...rows];
    expect(highlightedItem(state, grown)?.id).toBe("c");
    // Its row leaves: the first pickable row takes over.
    expect(highlightedItem(state, [item("x"), item("a")])?.id).toBe("x");
    // Same trigger, same query (a caret move): the highlight is kept.
    expect(transition(state, typed("/", 0, "")).state).toMatchObject({ highlight: "c" });
    // A new query is a new result set.
    expect(transition(state, typed("/", 0, "c")).state).toMatchObject({ highlight: null });
    const plus = run(
      openPlus(),
      { type: "highlight", id: "category:commands" },
      { type: "query", query: "s" },
    );
    expect(plus.state).toMatchObject({ highlight: null });
  });

  it("ignores keys while an IME composes", () => {
    const state = transition(CLOSED_LAUNCHER, typed("/", 0, "")).state;
    expect(transition(state, key("Enter", rows, { isComposing: true })).handled).toBe(false);
    expect(transition(state, key("ArrowDown", rows, { isComposing: true })).handled).toBe(false);
  });
});

describe("picking", () => {
  it("reports a typed trigger's pick with the range to replace", () => {
    const state = transition(CLOSED_LAUNCHER, typed("@", 4, "co")).state;
    const file = item("file:src/app.ts", {
      kind: "file",
      action: { type: "mention", mention: { kind: "file", path: "src/app.ts" } },
    });
    const step = transition(state, key("Tab", [file]));
    expect(step.handled).toBe(true);
    expect(step.state).toEqual(CLOSED_LAUNCHER);
    expect(step.outcome).toEqual({
      type: "pick",
      item: file,
      action: { type: "mention", mention: { kind: "file", path: "src/app.ts" } },
      target: { type: "trigger", trigger: { char: "@", from: 4, to: 7 } },
    });
  });

  it("reports a `+` pick against the set-aside draft, for every kind of action", () => {
    const actions: LauncherItem["action"][] = [
      { type: "attach-files" },
      { type: "shell" },
      { type: "send-to-models" },
      { type: "command", name: "compact" },
      { type: "restore-stash", id: "stash-1" },
      { type: "review-changes" },
      { type: "mention", mention: { kind: "skill", id: "palot-design" } },
    ];
    for (const action of actions) {
      const row = item(`row:${action.type}`, { action });
      const step = transition(openPlus(), { type: "pick", item: row });
      expect(step.state.status).toBe("closed");
      expect(step.outcome).toEqual({
        type: "pick",
        item: row,
        action,
        target: { type: "draft", draftSetAside: true },
      });
    }
    const empty = transition(openPlus(null), { type: "pick", item: item("x") });
    expect(empty.outcome).toMatchObject({ target: { type: "draft", draftSetAside: false } });
  });

  it("drills in when a category is picked and ignores disabled rows", () => {
    const drilled = transition(openPlus(), { type: "pick", item: category("skills") });
    expect(drilled.outcome).toBeNull();
    expect(drilled.state).toMatchObject({ status: "open", category: "skills" });
    const state = openPlus();
    const disabled = transition(state, { type: "pick", item: item("x", { disabled: true }) });
    expect(disabled.state).toBe(state);
    expect(disabled.outcome).toBeNull();
  });

  it("Enter with nothing to pick is the field's on a typed trigger and swallowed under `+`", () => {
    const trigger = transition(CLOSED_LAUNCHER, typed("/", 0, "zz")).state;
    expect(transition(trigger, key("Enter", [])).handled).toBe(false);
    const plus = run(openPlus(), { type: "query", query: "zz" }).state;
    const step = transition(plus, key("Enter", []));
    expect(step.handled).toBe(true);
    expect(step.state).toBe(plus);
    expect(transition(plus, key("Enter", [], { shiftKey: true })).handled).toBe(false);
  });
});

describe("deleting stashed prompts", () => {
  const stashed = (id: string) =>
    item(`stash:${id}`, {
      kind: "stash",
      category: "stash",
      icon: "stash",
      action: { type: "restore-stash", id },
    });
  const STASH = [stashed("a"), stashed("b"), stashed("c")];
  const inStash = (highlight: string | null = null) =>
    ({ ...openPlus(), category: "stash", highlight }) as LauncherState;
  const modBackspace = (items: readonly LauncherItem[]) =>
    key("Backspace", items, { ctrlKey: true });

  it("deletes the highlighted row with Mod+Backspace and highlights the next one", () => {
    const step = transition(inStash("stash:b"), modBackspace(STASH));
    expect(step).toMatchObject({
      handled: true,
      outcome: { type: "delete-stash", id: "b", clearQuery: false },
      state: { status: "open", category: "stash", highlight: "stash:c" },
    });
    // At the end of the list the highlight moves up instead.
    expect(transition(inStash("stash:c"), modBackspace(STASH)).state).toMatchObject({
      highlight: "stash:b",
    });
    // Meta works where Mod is Command.
    expect(transition(inStash(), key("Backspace", STASH, { metaKey: true })).outcome).toMatchObject(
      { type: "delete-stash", id: "a" },
    );
  });

  it("goes back a level, onto the category, when the last row goes", () => {
    const step = transition(
      { ...inStash(), query: "only" } as LauncherState,
      modBackspace([stashed("a")]),
    );
    expect(step).toMatchObject({
      outcome: { type: "delete-stash", id: "a", clearQuery: true },
      state: { status: "open", category: null, query: "", highlight: "category:stash" },
    });
  });

  it("deletes a row from its own action without moving to it first", () => {
    const step = transition(inStash("stash:a"), {
      type: "delete",
      item: STASH[2]!,
      items: STASH,
    });
    expect(step.outcome).toMatchObject({ type: "delete-stash", id: "c" });
    expect(step.state).toMatchObject({ highlight: "stash:b" });
  });

  it("leaves Backspace to the query, and Mod+Backspace on other rows to the field", () => {
    const query = { ...inStash(), query: "ab" } as LauncherState;
    expect(transition(query, key("Backspace", STASH)).handled).toBe(false);
    const commands = { ...openPlus(), category: "commands" } as LauncherState;
    expect(transition(commands, modBackspace([item("review")])).handled).toBe(false);
  });
});

describe("Opening on a category", () => {
  it("sets the draft aside and lands in the category, with Back to the root", () => {
    const opened = transition(CLOSED_LAUNCHER, {
      type: "open",
      via: "button",
      draftPreview: "keep me",
      category: "approvals",
    });
    expect(opened.outcome).toEqual({ type: "set-draft-aside" });
    expect(opened.state).toMatchObject({
      status: "open",
      category: "approvals",
      keptDraft: "keep me",
    });
    expect(transition(opened.state, { type: "escape" }).state).toMatchObject({
      status: "open",
      category: null,
      highlight: "category:approvals",
    });
  });

  it("only changes the level when + already holds the field", () => {
    const state = run(openPlus(), { type: "query", query: "rev" }).state;
    const step = transition(state, {
      type: "open",
      via: "button",
      draftPreview: "rev",
      category: "approvals",
    });
    expect(step.outcome).toEqual({ type: "clear-query" });
    expect(step.state).toMatchObject({ category: "approvals", keptDraft: "fix the bug" });
  });
});
