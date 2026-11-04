/**
 * Hostile Markdown/HTML inputs: prototype-named lookups, deep nesting, unclosed constructs and
 * pathological attribute values must render (or keep rendering) without throwing and in linear
 * time. Time bounds are generous for a loaded CI machine; healthy runs are far below them.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlTokenCacheStats, MAX_HTML_DEPTH, tokenizeHtml } from "../lib/markdown-html-tree";
import { MarkdownContent } from "./markdown-content";

afterEach(cleanup);

const TIME_LIMIT_MS = 1000;

function renderTimed(value: string, props: { passiveMedia?: boolean } = {}) {
  const started = performance.now();
  const view = render(<MarkdownContent value={value} {...props} />);
  return { view, elapsed: performance.now() - started };
}

function maxElementDepth(root: Element): number {
  let deepest = 0;
  const stack: Array<[Element, number]> = [[root, 0]];
  while (stack.length) {
    const [element, depth] = stack.pop()!;
    deepest = Math.max(deepest, depth);
    for (const child of element.children) stack.push([child, depth + 1]);
  }
  return deepest;
}

function count(text: string | null, needle: string): number {
  return (text ?? "").split(needle).length - 1;
}

describe("prototype-named lookups", () => {
  it.each([
    "&constructor;",
    "&toString; &valueOf; &hasOwnProperty; &isPrototypeOf;",
    "**&valueOf;** and _&constructor;_",
    "$x$ next to &constructor; and $y$",
    "| &toString; |\n| --- |\n| &valueOf; |",
    "<p>&constructor; in an HTML block</p>",
  ])("renders %j with the reference as literal text", (value) => {
    const { view } = renderTimed(value);
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"])
      if (value.includes(`&${name};`)) expect(view.container.textContent).toContain(`&${name};`);
    expect(view.container.textContent).not.toMatch(/function|native code/);
  });

  it("ignores attributes and tags named like Object.prototype members", () => {
    const { view } = renderTimed(
      '<p constructor="x" hasOwnProperty="y" __proto__="z" title="kept">para</p>\n\n<details constructor toString open><summary>s</summary>d</details>\n\n<constructor>literal</constructor> <toString/>',
    );
    const paragraph = view.container.querySelector(".markdown > p")!;
    expect(paragraph.getAttributeNames()).toEqual(["title"]);
    expect(view.container.querySelector("details")?.open).toBe(true);
    expect(view.container.textContent).toContain("<constructor>literal</constructor> <toString/>");
  });
});

describe("nesting depth", () => {
  it("caps open elements in one paragraph and keeps the rest literal, pairs included", () => {
    const { view, elapsed } = renderTimed(`${"<b>".repeat(10_000)}deep${"</b>".repeat(10_000)}`);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
    const text = view.container.textContent;
    expect(text).toContain("deep");
    expect(count(text, "<b>")).toBe(count(text, "</b>"));
    expect(count(text, "<b>")).toBeGreaterThan(9_000);
    expect(maxElementDepth(view.container)).toBeLessThanOrEqual(MAX_HTML_DEPTH + 8);
  });

  it("caps nested HTML blocks", () => {
    const { view, elapsed } = renderTimed(`${"<div>".repeat(10_000)}\n\ninside`);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
    expect(view.container.textContent).toContain("inside");
    expect(maxElementDepth(view.container)).toBeLessThanOrEqual(MAX_HTML_DEPTH + 8);
  });

  it("counts elements opened around nested Markdown containers", () => {
    // 60 divs, then a list item whose paragraph opens 200 more inline elements.
    const value = `${"<div>".repeat(60)}\n\n- ${"<b>".repeat(200)}x\n\n${"> <i>".repeat(30)}y`;
    const { view, elapsed } = renderTimed(value);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
    expect(view.container.textContent).toContain("x");
    expect(maxElementDepth(view.container)).toBeLessThanOrEqual(MAX_HTML_DEPTH + 40);
  });
});

describe("unclosed and pathological constructs", () => {
  it.each([
    ["an unfinished attribute list", `<div><a ${"<a ".repeat(20_000)}`],
    ["unclosed quotes", `<div>\n${'<a x=" '.repeat(8_000)}`],
    ["processing instructions", `x ${"<?".repeat(30_000)}`],
    ["comments", `x ${"<!--".repeat(15_000)}`],
    ["declarations", `x ${"<!A".repeat(15_000)}`],
    ["CDATA", `x ${"<![CDATA[".repeat(5_000)}`],
    ["quoted inline attributes", `x ${'<a href="'.repeat(6_000)}`],
    ["block processing instructions", "<?".repeat(30_000)],
    ["block comments", "<!--".repeat(15_000)],
    ["end tags", `<div>${"</a".repeat(20_000)}`],
  ])("renders %s in linear time", (_, value) => {
    const { view, elapsed } = renderTimed(value);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
    expect(view.container.querySelector(".markdown")).not.toBeNull();
  });

  it("keeps re-tokenizing a growing block linear per delta", () => {
    const block = `<div><a ${"<a ".repeat(10_000)}`;
    const started = performance.now();
    for (let end = 100; end <= block.length; end += 100) tokenizeHtml(block.slice(0, end), false);
    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it("reads srcset candidates without backtracking and drops oversized values", () => {
    const source = (srcset: string) =>
      `<picture>\n<source media="(prefers-color-scheme: light)" srcset="${srcset}">\n<img alt="Logo" src="https://example.com/fallback.png">\n</picture>`;
    // A whitespace run between URL and descriptor made `/\s*,\s*/` quadratic.
    const { view, elapsed } = renderTimed(
      source(`https://example.com/light.png${" \t".repeat(4_000)}1x, x.png 2x`),
      { passiveMedia: true },
    );
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/light.png",
    );
    cleanup();
    const oversized = renderTimed(source(`https://example.com/light.png${" ".repeat(50_000)}1x`), {
      passiveMedia: true,
    });
    expect(oversized.elapsed).toBeLessThan(TIME_LIMIT_MS);
    expect(oversized.view.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/fallback.png",
    );
  });
});

describe("task checkbox order around HTML", () => {
  it("does not hoist a summary with tasks above earlier nested Markdown", () => {
    const edit = vi.fn();
    const value =
      "<details>\n<div>\n\n- [ ] a\n\n</div>\n<summary>\n\n- [ ] b\n\n</summary>\n</details>\n\n- [ ] c";
    const view = render(<MarkdownContent value={value} onTaskEdit={edit} />);
    const boxes = view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(Array.from(boxes, (box) => box.closest("li")?.textContent?.trim())).toEqual([
      "a",
      "b",
      "c",
    ]);
    fireEvent.click(boxes[1]!);
    expect(edit).toHaveBeenCalledWith(value.replace("- [ ] b", "- [x] b"));
  });

  it("keeps Markdown nested anywhere inside a picture", () => {
    const edit = vi.fn();
    const value =
      '<picture>\n<source srcset="dark.png" media="(prefers-color-scheme: dark)">\n<div>\n\n- [ ] a\n\n</div>\n<img src="x.png" alt="Logo">\n</picture>\n\n- [ ] b';
    const view = render(<MarkdownContent value={value} onTaskEdit={edit} />);
    const boxes = view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]!);
    expect(edit).toHaveBeenCalledWith(value.replace("- [ ] b", "- [x] b"));
    expect(view.container.textContent).toContain("[Image: Logo]");
  });
});

describe("token cache", () => {
  it("does not cache every version of a streaming HTML block", () => {
    const before = htmlTokenCacheStats();
    const block = `<div>\n${"<span>streamed text</span>\n".repeat(400)}`;
    const view = render(<MarkdownContent value="" streaming />);
    for (let end = 50; end <= block.length; end += 50)
      view.rerender(<MarkdownContent value={block.slice(0, end)} streaming />);
    const after = htmlTokenCacheStats();
    expect(after.entries - before.entries).toBeLessThan(20);
  });

  it("stays within its byte budget", () => {
    for (let index = 0; index < 40; index += 1)
      tokenizeHtml(`<div data-i="${index}">${"x".repeat(100_000)}</div>`);
    expect(htmlTokenCacheStats().size).toBeLessThanOrEqual(1024 * 1024);
  });
});
