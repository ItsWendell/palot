import { describe, expect, it } from "vitest";
import { focusAfterRemoval, focusKeys, moveFocus, treeStep } from "./focus";
import type { GroupEntry, Layout, RowEntry, ShelfLayout } from "./sections";

const row = (key: string, container: string): RowEntry => ({
  type: "row",
  key,
  container,
  placement: "inbox",
  lines: 1,
  size: 34,
  depth: 0,
});

const group = (key: string, open: boolean, parent: string | null = null): GroupEntry => ({
  type: "group",
  key,
  kind: parent ? "project" : "server",
  label: key,
  open,
  count: 1,
  rollup: null,
  projectID: null,
  serverID: "local",
  online: true,
  parent,
  depth: parent ? 1 : 0,
  size: 28,
});

const shelf = (id: ShelfLayout["id"], open: boolean, rows: string[]): ShelfLayout => ({
  id,
  key: `shelf:${id}`,
  label: id,
  open,
  count: rows.length,
  rollup: null,
  rows: open ? rows.map((key) => row(key, `shelf:${id}`)) : [],
});

const layout: Layout = {
  entries: [
    { type: "heading", key: "heading:needs-you", label: "Needs you", size: 28 },
    row("n1", "needs-you"),
    group("server", true),
    group("project", true, "server"),
    row("p1", "project"),
    row("p2", "project"),
    group("closed", false, "server"),
  ],
  shelves: [shelf("working", true, ["w1"]), shelf("snoozed", false, ["z1"])],
  attention: 1,
};

describe("roving focus", () => {
  it("is one sequence across sections, group headers and shelves, without plain headings", () => {
    expect(focusKeys(layout)).toEqual([
      "n1",
      "server",
      "project",
      "p1",
      "p2",
      "closed",
      "shelf:working",
      "w1",
      "shelf:snoozed",
    ]);
  });

  it("moves one stop at a time and stops at the ends", () => {
    const keys = focusKeys(layout);
    expect(moveFocus(keys, "p2", "next")).toBe("closed");
    expect(moveFocus(keys, "n1", "previous")).toBe("n1");
    expect(moveFocus(keys, "shelf:snoozed", "next")).toBe("shelf:snoozed");
    expect(moveFocus(keys, null, "next")).toBe("n1");
    expect(moveFocus(keys, "p1", "last")).toBe("shelf:snoozed");
  });

  it("lands on the next remaining row after rows leave, else the previous one", () => {
    const before = ["a", "b", "c", "d"];
    expect(focusAfterRemoval(before, "b", ["a", "d"])).toBe("d");
    expect(focusAfterRemoval(before, "d", ["a", "b"])).toBe("b");
    expect(focusAfterRemoval(before, "c", ["a", "b", "c"])).toBe("c");
  });
});

describe("in-flow sections", () => {
  const flow: Layout = {
    entries: [
      row("i1", "inbox"),
      {
        type: "shelf",
        key: "shelf:working",
        id: "working",
        label: "Working",
        open: true,
        count: 1,
        rollup: null,
        size: 28,
      },
      row("w1", "shelf:working"),
      {
        type: "shelf",
        key: "shelf:settled",
        id: "settled",
        label: "Settled",
        open: true,
        count: 3,
        rollup: null,
        size: 28,
      },
      row("s1", "shelf:settled"),
      { type: "more", key: "more:settled", shelf: "settled", count: 2, size: 30 },
    ],
    shelves: [],
    attention: 0,
  };
  it("are stops like any header, with their rows and Load older in between", () => {
    expect(focusKeys(flow)).toEqual([
      "i1",
      "shelf:working",
      "w1",
      "shelf:settled",
      "s1",
      "more:settled",
    ]);
  });
  it("collapse with Left and step from a row to their header", () => {
    expect(treeStep(flow, "shelf:working", "left")).toEqual({
      type: "toggle",
      key: "shelf:working",
      open: false,
    });
    expect(treeStep(flow, "w1", "left")).toEqual({ type: "focus", key: "shelf:working" });
  });
});

describe("treeStep", () => {
  it("collapses an open header, then steps to its parent", () => {
    expect(treeStep(layout, "project", "left")).toEqual({
      type: "toggle",
      key: "project",
      open: false,
    });
    expect(treeStep(layout, "closed", "left")).toEqual({ type: "focus", key: "server" });
    expect(treeStep(layout, "server", "left")).toEqual({
      type: "toggle",
      key: "server",
      open: false,
    });
  });

  it("expands a closed header, then enters it", () => {
    expect(treeStep(layout, "closed", "right")).toEqual({
      type: "toggle",
      key: "closed",
      open: true,
    });
    expect(treeStep(layout, "project", "right")).toEqual({ type: "focus", key: "p1" });
    expect(treeStep(layout, "shelf:snoozed", "right")).toEqual({
      type: "toggle",
      key: "shelf:snoozed",
      open: true,
    });
  });

  it("steps from a row to its group or shelf header", () => {
    expect(treeStep(layout, "p2", "left")).toEqual({ type: "focus", key: "project" });
    expect(treeStep(layout, "w1", "left")).toEqual({ type: "focus", key: "shelf:working" });
    expect(treeStep(layout, "n1", "left")).toEqual({ type: "none" });
    expect(treeStep(layout, "p1", "right")).toEqual({ type: "none" });
  });
});
