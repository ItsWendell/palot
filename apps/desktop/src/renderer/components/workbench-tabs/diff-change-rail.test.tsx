import { parsePatchFiles } from "@pierre/diffs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiffChangeRail, type DiffRailSource } from "./diff-change-rail";

afterEach(cleanup);

const PATCH = `--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 one
+added
 two
`;

function source(scrollHeight: number, viewportHeight: number): DiffRailSource {
  const fileDiff = parsePatchFiles(PATCH)[0]!.files[0]!;
  return {
    scrollTop: () => 0,
    scrollHeight: () => scrollHeight,
    viewportHeight: () => viewportHeight,
    scrollTo: vi.fn(),
    items: () => [
      { id: "a.ts", top: 0, height: scrollHeight, headerHeight: 0, fileDiff, collapsed: false },
    ],
  };
}

function renderRail(rail: DiffRailSource) {
  const container = document.createElement("div");
  return render(
    <DiffChangeRail
      container={container}
      source={rail}
      layout="unified"
      expandUnchanged={false}
      layoutKey={rail}
    />,
  );
}

it("stays hidden while the content fits without scrolling", () => {
  const { container } = renderRail(source(300, 400));
  expect(container.querySelector("[data-slot=diff-change-rail]")).toBeNull();
});

it("marks changes and scrolls to the pressed point, centring the viewport", () => {
  const rail = source(3000, 300);
  const { container } = renderRail(rail);
  const element = container.querySelector<HTMLElement>("[data-slot=diff-change-rail]")!;
  expect(element.querySelector("[data-kind=added]")).not.toBeNull();
  element.getBoundingClientRect = () => ({ top: 0, height: 300 }) as DOMRect;
  element.setPointerCapture = vi.fn();
  fireEvent.pointerDown(element, { button: 0, clientY: 150, pointerId: 1 });
  // The middle of the rail is 1500px into the content; centring puts 1350px at the top.
  expect(rail.scrollTo).toHaveBeenCalledWith(1350);
});
