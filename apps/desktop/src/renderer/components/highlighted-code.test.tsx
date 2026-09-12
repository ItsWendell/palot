import { Provider } from "jotai";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighlightedCode } from "./highlighted-code";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HighlightedCode", () => {
  it("renders settled code with TanStack semantic token classes", () => {
    const view = render(
      <Provider>
        <HighlightedCode code="const value = 1" language="ts" />
      </Provider>,
    );

    expect(view.container.querySelector("pre.th-code")?.textContent).toBe("const value = 1");
    expect(view.container.querySelector(".th-keyword")?.textContent).toBe("const");
    expect(view.container.querySelector(".th-number")?.textContent).toBe("1");
    expect(
      view.container
        .querySelector<HTMLElement>(".tanstack-highlight")
        ?.style.getPropertyValue("--th-keyword"),
    ).not.toBe("");
  });

  it("falls back to escaped plaintext for unsupported languages", () => {
    const code = '<script>alert("safe")</script>';
    const view = render(
      <Provider>
        <HighlightedCode code={code} language="not-a-language" />
      </Provider>,
    );

    expect(view.container.querySelector("pre")?.textContent).toBe(code);
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("pre")?.dataset.language).toBe("plaintext");
  });

  it("defers highlighting a large settled block without hiding its code", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const code = "const value = 1;\n".repeat(1_000);
    const view = render(
      <Provider>
        <HighlightedCode code={code} language="ts" />
      </Provider>,
    );

    expect(view.container.querySelector("pre")?.textContent).toBe(code);
    expect(view.container.querySelector(".th-keyword")).toBeNull();

    act(() => vi.advanceTimersByTime(0));
    expect(view.container.querySelector(".th-keyword")?.textContent).toBe("const");
  });

  it("renders streaming syntax tokens with the matching absolute animation range", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <Provider>
        <HighlightedCode
          code="const value"
          language="ts"
          streaming
          animationRanges={[{ start: 0, end: 5, delay: 40, duration: 150, startAt: 40 }]}
        />
      </Provider>,
    );

    act(() => vi.advanceTimersByTime(0));

    const animated = view.container.querySelector<HTMLElement>("[data-markdown-stream-code]");
    expect(animated?.textContent).toBe("const");
    expect(animated?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe("40ms");
    expect(animated?.parentElement?.classList.contains("th-keyword")).toBe(true);
  });

  it("coalesces append-only streaming updates to the latest code", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const renderCode = (code: string) => (
      <Provider>
        <HighlightedCode code={code} language="ts" streaming />
      </Provider>
    );
    const view = render(renderCode("queueStart"));
    act(() => vi.advanceTimersByTime(0));

    now = 10;
    view.rerender(renderCode("queueStart = 0"));
    now = 20;
    view.rerender(renderCode("queueStart = 0 + 1"));
    now = 30;
    view.rerender(renderCode("queueStart = 0 + 1 + 2"));

    expect(view.container.querySelector("pre")?.textContent).toBe("queueStart = 0 + 1 + 2");
    expect(view.container.querySelectorAll(".th-number")).toHaveLength(0);

    act(() => vi.advanceTimersByTime(109));
    expect(view.container.querySelectorAll(".th-number")).toHaveLength(0);

    now = 120;
    act(() => vi.advanceTimersByTime(1));
    expect(
      [...view.container.querySelectorAll(".th-number")].map((element) => element.textContent),
    ).toEqual(["0", "1", "2"]);
  });

  it("refreshes animation timing when streamed code is unchanged", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const renderCode = (startAt: number) => (
      <Provider>
        <HighlightedCode
          code="const"
          language="ts"
          streaming
          animationRanges={[{ start: 0, end: 5, delay: 40, duration: 150, startAt }]}
        />
      </Provider>
    );
    const view = render(renderCode(40));
    act(() => vi.advanceTimersByTime(0));
    expect(
      view.container
        .querySelector<HTMLElement>("[data-markdown-stream-code]")
        ?.style.getPropertyValue("--palot-markdown-stream-delay"),
    ).toBe("40ms");

    now = 10;
    view.rerender(renderCode(80));
    now = 120;
    act(() => vi.advanceTimersByTime(110));

    expect(
      view.container
        .querySelector<HTMLElement>("[data-markdown-stream-code]")
        ?.style.getPropertyValue("--palot-markdown-stream-delay"),
    ).toBe("-40ms");
  });

  it("removes streaming animation wrappers after the block settles", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const range = { start: 0, end: 5, delay: 0, duration: 150, startAt: 0 };
    const view = render(
      <Provider>
        <HighlightedCode code="const" language="ts" streaming animationRanges={[range]} />
      </Provider>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(view.container.querySelector("[data-markdown-stream-code]")).toBeTruthy();

    view.rerender(
      <Provider>
        <HighlightedCode code="const" language="ts" animationRanges={[range]} />
      </Provider>,
    );
    expect(view.container.querySelector("[data-markdown-stream-code]")).toBeTruthy();

    act(() => vi.advanceTimersByTime(0));
    expect(view.container.querySelector("[data-markdown-stream-code]")).toBeNull();
    expect(view.container.querySelector(".th-keyword")?.textContent).toBe("const");
  });
});
