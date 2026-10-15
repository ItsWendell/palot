import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

afterEach(cleanup);

describe("ResizablePanelGroup", () => {
  it("keeps presses in a separator's hit area away from an adjacent scrollbar", () => {
    const scrollbarPress = vi.fn();
    render(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="left">
          <div data-testid="scrollbar" onPointerDown={scrollbarPress} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="right" />
      </ResizablePanelGroup>,
    );
    const separator = document.querySelector<HTMLElement>('[data-slot="resizable-handle"]')!;
    separator.getBoundingClientRect = () => new DOMRect(300, 0, 1, 500);
    const scrollbar = screen.getByTestId("scrollbar");

    // 4px left of the line is inside the separator's 10px hit area: it resizes, not scrolls.
    fireEvent.pointerDown(scrollbar, {
      clientX: 296,
      clientY: 200,
      button: 0,
      pointerType: "mouse",
    });
    expect(scrollbarPress).not.toHaveBeenCalled();

    // Outside the hit area, or with a secondary button, the scrollbar keeps the press.
    fireEvent.pointerDown(scrollbar, {
      clientX: 290,
      clientY: 200,
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.pointerDown(scrollbar, {
      clientX: 296,
      clientY: 200,
      button: 2,
      pointerType: "mouse",
    });
    expect(scrollbarPress).toHaveBeenCalledTimes(2);
  });
});
