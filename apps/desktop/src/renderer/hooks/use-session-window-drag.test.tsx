import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultStore } from "jotai";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { useSessionWindowDrag } from "./use-session-window-drag";

const select = vi.fn();
function Row({
  owner,
  sessionID = "session-drag",
}: {
  owner?: OpenCodeRuntimeStatus | null;
  sessionID?: string;
}) {
  const drag = useSessionWindowDrag(sessionID, owner);
  return (
    <>
      <button {...drag.handleProps} onClick={select}>
        Task
      </button>
      {drag.hint}
    </>
  );
}
const pointer = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  clientX: 60,
  clientY: 100,
};
function runtime(connectionID: string, connected = true): OpenCodeRuntimeStatus {
  return { connectionID, profileID: `profile-${connectionID}`, connected } as OpenCodeRuntimeStatus;
}
beforeEach(() => {
  getDefaultStore().set(runtimeAtom, runtime("drag-owner"));
  select.mockReset();
  vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(runtimeAtom, null);
  vi.restoreAllMocks();
});

describe("session window dragging", () => {
  it("opens duplicate session IDs on their explicit background owner without changing focus", () => {
    const owner = runtime("background");
    render(<Row owner={owner} />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    act(() => getDefaultStore().set(runtimeAtom, runtime("another-focused-server")));
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    expect(palot.openSessionWindow).toHaveBeenCalledExactlyOnceWith("session-drag", "background");
    expect(getDefaultStore().get(runtimeAtom)?.connectionID).toBe("another-focused-server");
  });
  it.each([null, runtime("offline", false)])(
    "does not start a gesture for an unavailable owner %s",
    (owner) => {
      render(<Row owner={owner} />);
      const row = screen.getByRole("button");
      fireEvent.pointerDown(row, pointer);
      fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
      fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
      expect(row.setPointerCapture).not.toHaveBeenCalled();
      expect(palot.openSessionWindow).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
    },
  );
  it.each(["replaced", "offline", "missing", "session", "profile"])(
    "cancels a late release when its owner/session is %s",
    (change) => {
      const owner = runtime("background");
      const view = render(<Row owner={owner} />);
      const row = screen.getByRole("button");
      fireEvent.pointerDown(row, pointer);
      fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
      view.rerender(
        <Row
          owner={
            change === "missing"
              ? null
              : change === "replaced"
                ? runtime("replacement")
                : change === "offline"
                  ? runtime("background", false)
                  : change === "profile"
                    ? { ...owner, profileID: "different-profile" }
                    : owner
          }
          sessionID={change === "session" ? "different-task" : "session-drag"}
        />,
      );
      fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
      expect(palot.openSessionWindow).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
      fireEvent.click(row, { detail: 0 });
      expect(select).toHaveBeenCalledOnce();
    },
  );
  it("cancels an active-owner default drag when focus changes", () => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    act(() => getDefaultStore().set(runtimeAtom, runtime("replacement")));
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    expect(palot.openSessionWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("opens once when a mouse drag is released outside, without selecting the source", () => {
    render(<Row />);
    const row = screen.getByRole("button", { name: "Task" });
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    expect(screen.getByRole("status").textContent).toContain("Release to open");
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    fireEvent.click(row, { detail: 1 });
    expect(palot.openSessionWindow).toHaveBeenCalledExactlyOnceWith("session-drag", "drag-owner");
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not open when a drag comes back inside", () => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    fireEvent.pointerMove(row, { ...pointer, clientX: 80 });
    fireEvent.pointerUp(row, { ...pointer, clientX: 80 });
    fireEvent.click(row, { detail: 1 });
    expect(palot.openSessionWindow).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
  it("ignores cancellation and capture loss for another pointer", () => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    fireEvent.pointerCancel(row, { ...pointer, pointerId: 2 });
    fireEvent.lostPointerCapture(row, { ...pointer, pointerId: 2 });
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    expect(palot.openSessionWindow).toHaveBeenCalledExactlyOnceWith("session-drag", "drag-owner");
  });
  it("ignores bubbled capture loss while the row still owns capture", () => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    vi.mocked(Element.prototype.hasPointerCapture).mockReturnValue(true);
    fireEvent.lostPointerCapture(row, pointer);
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    expect(palot.openSessionWindow).toHaveBeenCalledExactlyOnceWith("session-drag", "drag-owner");
    expect(row.releasePointerCapture).toHaveBeenCalledWith(pointer.pointerId);
  });
  it.each(["escape", "cancel", "capture-loss", "blur"])("cancels on %s", (reason) => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: -20 });
    if (reason === "escape") fireEvent.keyDown(window, { key: "Escape" });
    else if (reason === "blur") fireEvent.blur(window);
    else if (reason === "cancel") fireEvent.pointerCancel(row, pointer);
    else fireEvent.lostPointerCapture(row, pointer);
    fireEvent.pointerUp(row, { ...pointer, clientX: -20 });
    expect(palot.openSessionWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(row, { detail: 0 });
    expect(select).toHaveBeenCalledOnce();
  });
  it("preserves normal clicks and ignores touch/right-button drags", () => {
    render(<Row />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, pointer);
    fireEvent.pointerMove(row, { ...pointer, clientX: 62 });
    fireEvent.pointerUp(row, { ...pointer, clientX: 62 });
    fireEvent.click(row);
    expect(select).toHaveBeenCalledOnce();
    for (const input of [
      { ...pointer, pointerType: "touch" },
      { ...pointer, button: 2 },
    ]) {
      fireEvent.pointerDown(row, input);
      fireEvent.pointerMove(row, { ...input, clientX: -20 });
      fireEvent.pointerUp(row, { ...input, clientX: -20 });
    }
    expect(palot.openSessionWindow).not.toHaveBeenCalled();
  });
});
