import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileAtScrollTop,
  fileNavigationStep,
  useChangedFileNavigation,
} from "./changed-file-navigation";

const ids = ["a.ts", "b.ts", "c.ts", "d.ts"];
const tops: Record<string, number> = { "a.ts": 0, "b.ts": 300, "c.ts": 600, "d.ts": 900 };
const viewer = (scrollHeight = 2_000) => ({
  getTopForItem: (id: string) => tops[id],
  getHeight: () => 400,
  getScrollHeight: () => scrollHeight,
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

describe("fileAtScrollTop", () => {
  it("reports the file whose header has reached the top, and the last file at the end", () => {
    expect(fileAtScrollTop(ids, viewer(), 0, 0)).toBe("a.ts");
    expect(fileAtScrollTop(ids, viewer(), 299, 0)).toBe("b.ts");
    expect(fileAtScrollTop(ids, viewer(), 650, 0)).toBe("c.ts");
    // A jump lands `offset` above the item; it still counts as that item.
    expect(fileAtScrollTop(ids, viewer(), 600 - 34, 34)).toBe("c.ts");
    // Short trailing files can't reach the top, so the end of the scroller is the last file.
    expect(fileAtScrollTop(ids, viewer(1_000), 600, 0)).toBe("d.ts");
    expect(fileAtScrollTop([], viewer(), 0, 0)).toBeNull();
  });
});

describe("fileNavigationStep", () => {
  function press(target: Element, init: KeyboardEventInit) {
    let step = 0;
    target.addEventListener("keydown", (event) => {
      step = fileNavigationStep(event as KeyboardEvent);
    });
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    return step;
  }

  it("leaves keys to editors, popups, trees and live text selections", () => {
    const pane = document.createElement("div");
    pane.innerHTML = `<p>Some diff text</p><textarea></textarea><div role="tree"><span></span></div><div contenteditable="true"><b></b></div>`;
    document.body.append(pane);
    expect(press(pane, { key: "j" })).toBe(1);
    expect(press(pane, { key: "K", shiftKey: true })).toBe(0);
    expect(press(pane, { key: "k" })).toBe(-1);
    expect(press(pane, { key: "j", ctrlKey: true })).toBe(0);
    expect(press(pane.querySelector("textarea")!, { key: "j" })).toBe(0);
    expect(press(pane.querySelector("[role=tree] span")!, { key: "j" })).toBe(0);
    expect(press(pane.querySelector("[contenteditable] b")!, { key: "j" })).toBe(0);

    const range = document.createRange();
    range.selectNodeContents(pane.querySelector("p")!);
    window.getSelection()!.addRange(range);
    expect(press(pane, { key: "j" })).toBe(0);
  });
});

describe("useChangedFileNavigation", () => {
  it("follows manual scrolling but holds a jump's target until the scroller arrives", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const scrollTo = vi.fn();
    const { result } = renderHook(() =>
      useChangedFileNavigation({ ids, codeView: { current: { scrollTo } } }),
    );
    act(() => result.current.onScroll(650, viewer()));
    expect(result.current.index).toBe(2);

    act(() => result.current.goTo("a.ts"));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ id: "a.ts" }));
    // Smooth scrolling passes b.ts on the way; the counter stays on the target.
    act(() => result.current.onScroll(320, viewer()));
    expect(result.current.index).toBe(0);
    act(() => result.current.onScroll(0, viewer()));
    expect(result.current.index).toBe(0);
    // Once arrived, manual scrolling takes over again.
    act(() => result.current.onScroll(320, viewer()));
    expect(result.current.index).toBe(1);
  });
});
