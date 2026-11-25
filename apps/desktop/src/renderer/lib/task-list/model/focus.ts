/**
 * Roving focus. The whole list (rows, collapsible group headers, shelves and their rows) is
 * one tab stop; arrows move one focusable item at a time across sections and shelves, and
 * Left/Right work like a tree: collapse, expand, or step to the parent header.
 */

import type { Layout } from "./sections";

/** Focusable keys in visual order. Plain headings ("Needs you", "Pinned") are not stops. */
export function focusKeys(layout: Layout): string[] {
  const keys: string[] = [];
  for (const entry of layout.entries) {
    if (entry.type !== "heading" && entry.type !== "spacer" && entry.type !== "empty")
      keys.push(entry.key);
  }
  for (const shelf of layout.shelves) {
    keys.push(shelf.key);
    for (const row of shelf.rows) keys.push(row.key);
  }
  return keys;
}

export type FocusMove = "next" | "previous" | "first" | "last";

export function moveFocus(keys: readonly string[], current: string | null, move: FocusMove) {
  if (keys.length === 0) return null;
  if (move === "first") return keys[0]!;
  if (move === "last") return keys.at(-1)!;
  const index = current === null ? -1 : keys.indexOf(current);
  if (index === -1) return move === "next" ? keys[0]! : keys.at(-1)!;
  const next = index + (move === "next" ? 1 : -1);
  return keys[Math.max(0, Math.min(keys.length - 1, next))]!;
}

/**
 * Where focus goes when rows leave (settled, snoozed, answered): the next remaining key after
 * the current one in the old order, else the previous one.
 */
export function focusAfterRemoval(
  previous: readonly string[],
  current: string,
  remaining: readonly string[],
): string | null {
  const alive = new Set(remaining);
  if (alive.has(current)) return current;
  const index = previous.indexOf(current);
  for (let next = index + 1; next < previous.length; next++)
    if (alive.has(previous[next]!)) return previous[next]!;
  for (let back = index - 1; back >= 0; back--)
    if (alive.has(previous[back]!)) return previous[back]!;
  return remaining[0] ?? null;
}

/** What Left or Right does on the focused key. */
export type TreeStep =
  | { type: "focus"; key: string }
  | { type: "toggle"; key: string; open: boolean }
  | { type: "none" };

interface Collapsible {
  key: string;
  open: boolean;
  parent: string | null;
}

function collapsibles(layout: Layout): Map<string, Collapsible> {
  const result = new Map<string, Collapsible>();
  for (const entry of layout.entries)
    if (entry.type === "group")
      result.set(entry.key, { key: entry.key, open: entry.open, parent: entry.parent });
    else if (entry.type === "shelf")
      result.set(entry.key, { key: entry.key, open: entry.open, parent: null });
  for (const shelf of layout.shelves)
    result.set(shelf.key, { key: shelf.key, open: shelf.open, parent: null });
  return result;
}

function containerOf(layout: Layout, key: string): string | null {
  for (const entry of layout.entries)
    if (entry.type === "row" && entry.key === key) return entry.container;
  for (const shelf of layout.shelves)
    if (shelf.rows.some((row) => row.key === key)) return shelf.key;
  return null;
}

export function treeStep(layout: Layout, key: string, direction: "left" | "right"): TreeStep {
  const headers = collapsibles(layout);
  const header = headers.get(key);
  if (header) {
    if (direction === "left") {
      if (header.open) return { type: "toggle", key, open: false };
      return header.parent ? { type: "focus", key: header.parent } : { type: "none" };
    }
    if (!header.open) return { type: "toggle", key, open: true };
    const keys = focusKeys(layout);
    const next = keys[keys.indexOf(key) + 1];
    return next && !headers.has(next) ? { type: "focus", key: next } : { type: "none" };
  }
  if (direction === "right") return { type: "none" };
  const container = containerOf(layout, key);
  return container && headers.has(container) ? { type: "focus", key: container } : { type: "none" };
}
