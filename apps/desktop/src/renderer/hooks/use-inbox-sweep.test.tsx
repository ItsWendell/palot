import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useInboxSweep } from "./use-inbox-sweep";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const settle = vi.fn();
  const ordinaryClick = vi.fn();
  const items = ["one", "two", "busy"];
  function List() {
    const sweep = useInboxSweep({
      items,
      keyOf: (item) => item,
      canSettle: (item) => item !== "busy",
      settle,
    });
    return (
      <div {...sweep}>
        {items.map((item) => (
          <div key={item} data-testid={item} data-inbox-sweep-key={item}>
            <button data-inbox-settle disabled={item === "busy"} onClick={ordinaryClick}>
              {item}
            </button>
          </div>
        ))}
      </div>
    );
  }
  render(<List />);
  let hit: Element = screen.getByTestId("one");
  vi.spyOn(document, "elementFromPoint").mockImplementation(() => hit);
  return {
    settle,
    ordinaryClick,
    moveTo: (item: string) => {
      hit = screen.getByTestId(item);
      fireEvent.pointerMove(window, { pointerId: 1 });
    },
  };
}
it("highlights and deduplicates eligible rows, then applies one batch on release", () => {
  const { settle, ordinaryClick, moveTo } = mount();
  fireEvent.pointerDown(screen.getByRole("button", { name: "one" }), { pointerId: 1, button: 0 });
  expect(settle).not.toHaveBeenCalled();
  moveTo("two");
  moveTo("one");
  moveTo("busy");
  expect(screen.getByTestId("one").dataset.inboxSweep).toBe("true");
  expect(screen.getByTestId("two").dataset.inboxSweep).toBe("true");
  expect(screen.getByTestId("busy").dataset.inboxSweep).toBeUndefined();
  fireEvent.pointerUp(window, { pointerId: 1 });
  fireEvent.click(screen.getByRole("button", { name: "one" }), { detail: 1 });
  expect(settle).toHaveBeenCalledExactlyOnceWith(["one", "two"]);
  expect(ordinaryClick).not.toHaveBeenCalled();
  expect(screen.getByTestId("one").dataset.inboxSweep).toBeUndefined();
});
it.each(["escape", "cancel", "blur"])("cancels without changing any tasks on %s", (method) => {
  const { settle, moveTo } = mount();
  fireEvent.pointerDown(screen.getByRole("button", { name: "one" }), { pointerId: 1, button: 0 });
  moveTo("two");
  if (method === "escape") fireEvent.keyDown(window, { key: "Escape" });
  else if (method === "cancel") fireEvent.pointerCancel(window, { pointerId: 1 });
  else fireEvent.blur(window);
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(settle).not.toHaveBeenCalled();
  expect(screen.getByTestId("two").dataset.inboxSweep).toBeUndefined();
});
