/**
 * The launcher's keyboard and navigation model: one pure reducer behind `+`, Mod+/ and the
 * typed `/`, `@` and `$` triggers. It never touches the editor or runs anything; a step
 * reports what the composer should do (clear the field, restore the set-aside draft, act on
 * a picked item) and whether a key was consumed.
 */

import type { LauncherAction, LauncherCategory, LauncherItem } from "./launcher-items";

export type LauncherTriggerChar = "/" | "@" | "$";

const TRIGGER_CATEGORY: Record<LauncherTriggerChar, LauncherCategory> = {
  "/": "commands",
  "@": "mention",
  $: "skills",
};

/** A typed trigger's range in the draft: `from` is the trigger character, `to` the caret. */
export interface LauncherTrigger {
  char: LauncherTriggerChar;
  from: number;
  to: number;
}

type LauncherSource =
  | { type: "plus"; via: "button" | "shortcut" }
  | { type: "trigger"; trigger: LauncherTrigger };

export type LauncherState =
  | {
      status: "closed";
      /** A typed trigger the person dismissed stays closed until its start moves or it goes. */
      dismissedTrigger: number | null;
    }
  | {
      status: "open";
      /** Kept while `+` is open, so a trigger in the set-aside draft stays closed on return. */
      dismissedTrigger: number | null;
      source: LauncherSource;
      /** Null at the root; typed triggers always open in their category. */
      category: LauncherCategory | null;
      query: string;
      /** The highlighted item's id; null means the first pickable row. */
      highlight: string | null;
      /** Preview of the draft set aside when `+` opened over one; null when there was none. */
      keptDraft: string | null;
    };

export const CLOSED_LAUNCHER: LauncherState = { status: "closed", dismissedTrigger: null };

interface LauncherKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export type LauncherEvent =
  /**
   * `+` or Mod+/; `draftPreview` is null when the field is empty. `category` opens drilled into
   * it (the approvals chip opens Approvals), with Back to the root.
   */
  | {
      type: "open";
      via: "button" | "shortcut";
      draftPreview: string | null;
      category?: LauncherCategory;
    }
  /** Opens like `open`, or closes when `+` already has it open. */
  | { type: "toggle"; via: "button" | "shortcut"; draftPreview: string | null }
  /** The trigger before the caret after an edit or caret move, or null when there is none. */
  | { type: "trigger"; trigger: (LauncherTrigger & { query: string }) | null }
  /** The field's text while `+` has the launcher open: it is the query. */
  | { type: "query"; query: string }
  /** The pointer moved over a row. */
  | { type: "highlight"; id: string }
  | { type: "move"; direction: "up" | "down"; items: readonly LauncherItem[] }
  | { type: "drill"; category: LauncherCategory }
  | { type: "back" }
  | { type: "pick"; item: LauncherItem }
  /** Removes a deletable row (a stashed prompt); `items` is the list it was in. */
  | { type: "delete"; item: LauncherItem; items: readonly LauncherItem[] }
  | { type: "escape" }
  | { type: "close" }
  /** A key pressed in the text field; `caret` tells whether it sits at the field's edges. */
  | {
      type: "key";
      event: LauncherKey;
      caret: { atStart: boolean; atEnd: boolean };
      items: readonly LauncherItem[];
    };

export type LauncherOutcome =
  /** `+` opened: move the draft aside (it returns on close) and empty the field. */
  | { type: "set-draft-aside" }
  /** A level changed under `+`: empty the field, which holds the query. */
  | { type: "clear-query" }
  /** `+` closed without a pick: put the set-aside draft back (an empty one clears the query). */
  | { type: "restore-draft" }
  /** An item was picked and the launcher closed; `target` says where its result goes. */
  | {
      type: "pick";
      action: Exclude<LauncherAction, { type: "drill" }>;
      item: LauncherItem;
      target: LauncherPickTarget;
    }
  /**
   * A stashed prompt was deleted; the launcher stays open. `clearQuery` when its list emptied
   * and the launcher went back a level, whose query starts empty.
   */
  | { type: "delete-stash"; id: string; clearQuery: boolean };

/**
 * `trigger`: replace the typed trigger's range in the draft with the result. `draft`: the
 * field held the query, so put the set-aside draft back first (empty when there was none),
 * then apply the action to it.
 */
type LauncherPickTarget =
  | { type: "trigger"; trigger: LauncherTrigger }
  | { type: "draft"; draftSetAside: boolean };

export interface LauncherStep {
  state: LauncherState;
  outcome: LauncherOutcome | null;
  /** For key events: the launcher consumed the key, so the field must not act on it. */
  handled: boolean;
}

function step(state: LauncherState, outcome: LauncherOutcome | null = null, handled = true) {
  return { state, outcome, handled } satisfies LauncherStep;
}

const ignored = (state: LauncherState): LauncherStep => step(state, null, false);

/** Rows the keyboard can land on and Enter can pick. */
function pickableItems(items: readonly LauncherItem[]): LauncherItem[] {
  return items.filter((item) => !item.disabled);
}

/**
 * The highlighted row: the remembered id while it is still listed and pickable, otherwise
 * the first pickable row. So the highlight follows identity as rows arrive or reorder, and
 * falls back to the top when its row leaves.
 */
export function highlightedItem(
  state: LauncherState,
  items: readonly LauncherItem[],
): LauncherItem | null {
  if (state.status !== "open") return null;
  const pickable = pickableItems(items);
  return (
    (state.highlight !== null ? pickable.find((item) => item.id === state.highlight) : null) ??
    pickable[0] ??
    null
  );
}

/** Rows that Mod+Backspace or their Delete action remove: stashed prompts. */
export function canDelete(item: LauncherItem): boolean {
  return item.kind === "stash" && item.action.type === "restore-stash" && !item.disabled;
}

export function canGoBack(state: LauncherState): boolean {
  return state.status === "open" && state.source.type === "plus" && state.category !== null;
}

function close(state: LauncherState & { status: "open" }): LauncherStep {
  if (state.source.type === "trigger") {
    return step({ status: "closed", dismissedTrigger: state.source.trigger.from });
  }
  return step(
    { status: "closed", dismissedTrigger: state.dismissedTrigger },
    { type: "restore-draft" },
  );
}

function openAtRoot(
  state: LauncherState,
  via: "button" | "shortcut",
  draftPreview: string | null,
  category: LauncherCategory | null = null,
): LauncherStep {
  // Already open under `+`: the draft is aside, so only the level changes.
  if (state.status === "open" && state.source.type === "plus") {
    return category ? drill(state, category) : step(state);
  }
  // An open typed trigger is part of the draft that goes aside; it must not reopen on return.
  const dismissedTrigger =
    state.status === "open" && state.source.type === "trigger"
      ? state.source.trigger.from
      : state.dismissedTrigger;
  return step(
    {
      status: "open",
      dismissedTrigger,
      source: { type: "plus", via },
      category,
      query: "",
      highlight: null,
      keptDraft: draftPreview?.trim() ? draftPreview : null,
    },
    { type: "set-draft-aside" },
  );
}

function move(
  state: LauncherState & { status: "open" },
  direction: "up" | "down",
  items: readonly LauncherItem[],
): LauncherStep {
  const pickable = pickableItems(items);
  if (!pickable.length) return step(state);
  const current = highlightedItem(state, items);
  const index = current ? pickable.indexOf(current) : -1;
  const delta = direction === "down" ? 1 : -1;
  const next = pickable[(((index + delta) % pickable.length) + pickable.length) % pickable.length];
  return step({ ...state, highlight: next?.id ?? null });
}

function drill(state: LauncherState & { status: "open" }, category: LauncherCategory) {
  if (state.source.type !== "plus") return ignored(state);
  return step(
    { ...state, category, query: "", highlight: null },
    state.query ? { type: "clear-query" } : null,
  );
}

function back(state: LauncherState & { status: "open" }): LauncherStep {
  if (!canGoBack(state)) return ignored(state);
  // Land on the category row the person came from.
  return step(
    { ...state, category: null, query: "", highlight: `category:${state.category}` },
    state.query ? { type: "clear-query" } : null,
  );
}

function pick(state: LauncherState & { status: "open" }, item: LauncherItem): LauncherStep {
  if (item.disabled) return step(state);
  const action = item.action;
  if (action.type === "drill") return drill(state, action.category);
  const trigger = state.source.type === "trigger" ? state.source.trigger : null;
  // The picked result replaces a typed trigger; a set-aside draft keeps its dismissal.
  return step(
    { status: "closed", dismissedTrigger: trigger ? null : state.dismissedTrigger },
    {
      type: "pick",
      action,
      item,
      target: trigger
        ? { type: "trigger", trigger }
        : { type: "draft", draftSetAside: state.keptDraft !== null },
    },
  );
}

/**
 * Deletes a row and keeps the place: the highlight moves to the next row (the previous one at
 * the end); a category left empty goes back to the level above.
 */
function remove(
  state: LauncherState & { status: "open" },
  item: LauncherItem,
  items: readonly LauncherItem[],
): LauncherStep {
  if (!canDelete(item) || item.action.type !== "restore-stash") return ignored(state);
  const id = item.action.id;
  const pickable = pickableItems(items);
  const index = pickable.findIndex((candidate) => candidate.id === item.id);
  const rest = pickable.filter((candidate) => candidate.id !== item.id);
  if (!rest.length && canGoBack(state)) {
    const back = { ...state, category: null, query: "", highlight: `category:${state.category}` };
    return step(back, { type: "delete-stash", id, clearQuery: state.query !== "" });
  }
  const next = rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? null;
  return step(
    { ...state, highlight: next?.id ?? null },
    { type: "delete-stash", id, clearQuery: false },
  );
}

function key(
  state: LauncherState & { status: "open" },
  event: Extract<LauncherEvent, { type: "key" }>,
): LauncherStep {
  const { key, ctrlKey = false, metaKey = false, altKey = false, shiftKey = false } = event.event;
  if (event.event.isComposing) return ignored(state);
  const plain = !ctrlKey && !metaKey && !altKey && !shiftKey;
  const ctrlOnly = ctrlKey && !metaKey && !altKey && !shiftKey;
  const lower = key.toLowerCase();
  if ((key === "ArrowDown" && plain) || (ctrlOnly && lower === "n")) {
    return move(state, "down", event.items);
  }
  if ((key === "ArrowUp" && plain) || (ctrlOnly && lower === "p")) {
    return move(state, "up", event.items);
  }
  if ((key === "Enter" || key === "Tab") && plain) {
    const item = highlightedItem(state, event.items);
    if (item) return pick(state, item);
    // A typed trigger with nothing to pick gives Enter and Tab back to the field.
    return state.source.type === "trigger" ? ignored(state) : step(state);
  }
  if (key === "ArrowRight" && plain) {
    const item = highlightedItem(state, event.items);
    if (item?.action.type === "drill" && event.caret.atEnd)
      return drill(state, item.action.category);
    return ignored(state);
  }
  // Mod+Backspace deletes the highlighted stashed prompt; elsewhere it stays the field's.
  if (key === "Backspace" && ctrlKey !== metaKey && !altKey && !shiftKey) {
    const item = highlightedItem(state, event.items);
    return item && canDelete(item) ? remove(state, item, event.items) : ignored(state);
  }
  if ((key === "ArrowLeft" || key === "Backspace") && plain && !state.query && canGoBack(state)) {
    return back(state);
  }
  if (key === "Backspace" && plain && !state.query && state.source.type === "plus") {
    return close(state);
  }
  if (key === "Escape" && plain) return transition(state, { type: "escape" });
  return ignored(state);
}

export function transition(state: LauncherState, event: LauncherEvent): LauncherStep {
  switch (event.type) {
    case "open":
      return openAtRoot(state, event.via, event.draftPreview, event.category ?? null);
    case "toggle":
      if (state.status === "open" && state.source.type === "plus") return close(state);
      return openAtRoot(state, event.via, event.draftPreview);
    case "trigger": {
      if (state.status === "open" && state.source.type === "plus") return ignored(state);
      const trigger = event.trigger;
      if (!trigger) {
        if (state.status === "open") return step(CLOSED_LAUNCHER);
        return step(state.dismissedTrigger === null ? state : CLOSED_LAUNCHER);
      }
      if (state.status === "closed" && state.dismissedTrigger === trigger.from) return step(state);
      const category = TRIGGER_CATEGORY[trigger.char];
      const previous = state.status === "open" ? state : null;
      const sameList =
        previous !== null &&
        previous.category === category &&
        previous.query === trigger.query &&
        previous.source.type === "trigger" &&
        previous.source.trigger.from === trigger.from;
      return step({
        status: "open",
        dismissedTrigger: null,
        source: {
          type: "trigger",
          trigger: { char: trigger.char, from: trigger.from, to: trigger.to },
        },
        category,
        query: trigger.query,
        highlight: sameList ? previous.highlight : null,
        keptDraft: null,
      });
    }
    case "query":
      if (state.status !== "open" || state.source.type !== "plus") return ignored(state);
      if (state.query === event.query) return step(state);
      return step({ ...state, query: event.query, highlight: null });
    case "highlight":
      if (state.status !== "open" || state.highlight === event.id) return step(state);
      return step({ ...state, highlight: event.id });
    case "move":
      return state.status === "open" ? move(state, event.direction, event.items) : ignored(state);
    case "drill":
      return state.status === "open" ? drill(state, event.category) : ignored(state);
    case "back":
      return state.status === "open" ? back(state) : ignored(state);
    case "pick":
      return state.status === "open" ? pick(state, event.item) : ignored(state);
    case "delete":
      return state.status === "open" ? remove(state, event.item, event.items) : ignored(state);
    case "escape":
      if (state.status !== "open") return ignored(state);
      return canGoBack(state) ? back(state) : close(state);
    case "close":
      return state.status === "open" ? close(state) : step(state);
    case "key":
      return state.status === "open" ? key(state, event) : ignored(state);
  }
}
