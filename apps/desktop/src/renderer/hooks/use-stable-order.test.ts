import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyStableOrder, usePointerFreeze, useStableOrder } from "./use-stable-order";

interface Row {
  id: string;
  label?: string;
}
const keyOf = (row: Row) => row.id;
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const ids = (items: readonly Row[]) => items.map((row) => row.id);

describe("applyStableOrder", () => {
  it("keeps held rows in place, drops removed rows, and slots new rows by live position", () => {
    expect(
      ids(applyStableOrder(["a", "b", "c", "d"], rows("d", "x", "c", "a", "y"), keyOf)),
    ).toEqual(["a", "x", "c", "d", "y"]);
  });
});

describe("useStableOrder", () => {
  it("holds the order while frozen and applies the live order when released", () => {
    const { result, rerender } = renderHook(
      ({ items, frozen }: { items: Row[]; frozen: boolean }) =>
        useStableOrder(items, keyOf, frozen),
      { initialProps: { items: rows("a", "b", "c"), frozen: false } },
    );
    expect(ids(result.current)).toEqual(["a", "b", "c"]);

    rerender({ items: rows("a", "b", "c"), frozen: true });
    rerender({ items: [{ id: "c", label: "updated" }, { id: "a" }, { id: "b" }], frozen: true });
    expect(ids(result.current)).toEqual(["a", "b", "c"]);
    expect(result.current[2]).toEqual({ id: "c", label: "updated" });

    rerender({ items: rows("b", "c"), frozen: true });
    expect(ids(result.current)).toEqual(["b", "c"]);

    rerender({ items: rows("c", "b"), frozen: false });
    expect(ids(result.current)).toEqual(["c", "b"]);
  });

  it("keeps a row that appeared during the freeze where it first appeared", () => {
    const { result, rerender } = renderHook(
      ({ items, frozen }: { items: Row[]; frozen: boolean }) =>
        useStableOrder(items, keyOf, frozen),
      { initialProps: { items: rows("a", "b"), frozen: true } },
    );
    rerender({ items: rows("a", "new", "b"), frozen: true });
    expect(ids(result.current)).toEqual(["a", "new", "b"]);
    rerender({ items: rows("new", "b", "a"), frozen: true });
    expect(ids(result.current)).toEqual(["a", "new", "b"]);
  });
});

describe("usePointerFreeze", () => {
  it("freezes while the pointer is over the list", () => {
    const { result } = renderHook(() => usePointerFreeze());
    expect(result.current.frozen).toBe(false);
    act(() => result.current.freezeProps.onPointerEnter());
    expect(result.current.frozen).toBe(true);
    act(() => result.current.freezeProps.onPointerLeave());
    expect(result.current.frozen).toBe(false);
  });
});
