import { afterEach, describe, expect, it } from "vitest";
import { applyDiffHighlights, clearDiffHighlights } from "./diff-find-dom";

const owner = {};
afterEach(() => {
  clearDiffHighlights(owner);
  document.body.replaceChildren();
});

/** Mirrors @pierre/diffs markup: a shadow-hosted `code` column of `[data-line]` rows. */
function renderedItem(id: string, column: string, rows: Array<[number, string, string]>) {
  const host = document.createElement("diffs-container");
  document.body.append(host);
  const code = document.createElement("code");
  code.setAttribute(column, "");
  for (const [line, type, text] of rows) {
    const row = document.createElement("div");
    row.setAttribute("data-line", String(line));
    row.setAttribute("data-line-type", type);
    // Inline word-diff spans split the text across nodes.
    const [head, tail] = [text.slice(0, 3), text.slice(3)];
    row.append(document.createElement("span"), document.createElement("span"));
    row.children[0]!.textContent = head;
    row.children[1]!.textContent = tail;
    code.append(row);
  }
  host.attachShadow({ mode: "open" }).append(code);
  return { id, element: host };
}

describe("applyDiffHighlights", () => {
  it("maps the active match to the rendered line on its side inside the shadow root", () => {
    const unified = renderedItem("app.ts", "data-unified", [
      [4, "change-deletion", "old widget"],
      [4, "change-addition", "new widget widget"],
    ]);
    const result = applyDiffHighlights(owner, [unified], "widget", {
      itemID: "app.ts",
      side: "additions",
      lineNumber: 4,
      occurrence: 1,
    });
    expect(result.activeLine?.textContent).toBe("new widget widget");
    expect(result.active?.toString()).toBe("widget");
    expect(result.active?.startOffset).toBe(8);
  });

  it("uses the split column for the side", () => {
    const deletions = renderedItem("app.ts", "data-deletions", [[7, "context", "a widget"]]);
    const additions = renderedItem("app.ts", "data-additions", [[7, "context", "a widget"]]);
    const result = applyDiffHighlights(owner, [deletions, additions], "widget", {
      itemID: "app.ts",
      side: "deletions",
      lineNumber: 7,
      occurrence: 0,
    });
    expect(result.activeLine?.parentElement?.hasAttribute("data-deletions")).toBe(true);
  });
});
