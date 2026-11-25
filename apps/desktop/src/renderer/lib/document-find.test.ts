import { afterEach, describe, expect, it, vi } from "vitest";
import {
  documentTextRanges,
  findTableMatches,
  previewTableIn,
  registerPreviewTable,
  tableMatchRanges,
} from "./document-find";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("documentTextRanges", () => {
  it("finds visible text across inline formatting and caps the count", () => {
    const root = mount("<h1>Alpha</h1><p>An <strong>al</strong>pha and alpha</p>");
    const all = documentTextRanges(root, " ALPHA ");
    expect(all.ranges.map((range) => range.toString())).toEqual(["Alpha", "alpha", "alpha"]);
    expect(all.truncated).toBe(false);
    const capped = documentTextRanges(root, "alpha", 2);
    expect(capped.ranges).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it("skips text the preview does not show", () => {
    const root = mount('<p>shown alpha</p><p class="hidden">hidden alpha</p>');
    const hidden = root.querySelector(".hidden")!;
    const checkVisibility = vi
      .spyOn(Element.prototype, "checkVisibility")
      .mockImplementation(function (this: Element) {
        return this !== hidden;
      });
    try {
      expect(documentTextRanges(root, "alpha").ranges.map((range) => range.toString())).toEqual([
        "alpha",
      ]);
      expect(documentTextRanges(root, "alpha").ranges[0]!.startContainer.parentElement).not.toBe(
        hidden,
      );
    } finally {
      checkVisibility.mockRestore();
    }
  });
});

describe("table find", () => {
  const data = [
    ["alpha", "beta alpha"],
    ["gamma", "delta"],
    ["Alpha", ""],
  ];
  const table = { rowCount: data.length, row: (index: number) => data[index]! };

  it("finds matches by row, column and occurrence from the data", () => {
    expect(findTableMatches(table, "ALPHA")).toEqual({
      matches: [
        { row: 0, column: 0, occurrence: 0 },
        { row: 0, column: 1, occurrence: 0 },
        { row: 2, column: 0, occurrence: 0 },
      ],
      truncated: false,
    });
    expect(findTableMatches(table, "alpha", 2).truncated).toBe(true);
    expect(findTableMatches(table, "  ").matches).toEqual([]);
  });

  it("highlights matches in mounted rows only and picks out the active one", () => {
    // Row 0 is scrolled out; aria-rowindex counts the header row.
    const element = mount(
      [2, 3]
        .map(
          (rowIndex) =>
            `<div role="row" aria-rowindex="${rowIndex + 1}">${data[rowIndex - 1]!.map(
              (cell, column) => `<div role="cell" aria-colindex="${column + 1}">${cell}</div>`,
            ).join("")}</div>`,
        )
        .join(""),
    );
    const { matches } = findTableMatches(table, "alpha");
    const ranges = tableMatchRanges(element, "alpha", matches, matches[2]!);
    expect(ranges.hits).toEqual([]);
    expect(ranges.active?.toString()).toBe("Alpha");
    expect(tableMatchRanges(element, "alpha", matches, matches[0]!).active).toBeNull();
  });

  it("finds the registered table inside a preview and forgets it on cleanup", () => {
    const root = mount("<div><div class='scroller'></div></div>");
    const scroller = root.querySelector(".scroller")!;
    const source = { ...table, scrollToRow: vi.fn() };
    const unregister = registerPreviewTable(scroller, source);
    expect(previewTableIn(root)).toEqual({ element: scroller, source });
    unregister();
    expect(previewTableIn(root)).toBeNull();
  });
});
