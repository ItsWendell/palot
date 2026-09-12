import { createStore, Provider } from "jotai";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { runtimeAtom } from "../../atoms/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotEventBatch } from "../../../shared";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { TerminalTab } from "./terminal-tab";

const ghostty = vi.hoisted(() => ({
  data: null as ((data: string) => void) | null,
  resize: null as ((size: { cols: number; rows: number }) => void) | null,
  writes: [] as string[],
  disposed: 0,
}));

vi.mock("../../lib/font-loading", () => ({
  prepareCodeFont: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("ghostty-web", () => ({
  Ghostty: { load: vi.fn().mockResolvedValue({}) },
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    setOption() {}
    write(data: string) {
      ghostty.writes.push(data);
    }
    onData(callback: (data: string) => void) {
      ghostty.data = callback;
      return { dispose() {} };
    }
    onResize(callback: (size: { cols: number; rows: number }) => void) {
      ghostty.resize = callback;
      return { dispose() {} };
    }
    dispose() {
      ghostty.disposed += 1;
    }
  },
  FitAddon: class {
    fit() {}
    observeResize() {}
    dispose() {}
  },
}));

const tab: Extract<WorkbenchTab, { kind: "terminal" }> = {
  id: "terminal-tab",
  kind: "terminal",
  pinned: false,
  resource: {
    profileID: "profile-1",
    location: { directory: "/repo" },
    ptyID: "pty-1",
    sessionID: "session-1",
    transport: "persistent",
  },
};

afterEach(() => {
  cleanup();
  ghostty.data = null;
  ghostty.resize = null;
  ghostty.writes.length = 0;
  ghostty.disposed = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TerminalTab", () => {
  it("retries a failed remote attachment without creating or ending its terminal", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      topology: "remote-machine",
      connectionID: "test",
    } as never);
    vi.spyOn(palot, "connectPty")
      .mockRejectedValueOnce(new Error("Tunnel interrupted"))
      .mockResolvedValueOnce("retry-connection");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    vi.spyOn(palot, "onPtyEvent").mockReturnValue(() => undefined);
    vi.spyOn(palot, "createPty");
    vi.spyOn(palot, "removePty");
    const view = render(
      <Provider store={store}>
        <TerminalTab
          tab={{
            ...tab,
            resource: { ...tab.resource, transport: "legacy", ptyID: "remote-retry" },
          }}
        />
      </Provider>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Reconnect terminal" }));
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("retry-connection"));
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.objectContaining({ ptyID: "remote-retry", transport: "legacy" }),
      "test",
    );
    expect(palot.createPty).not.toHaveBeenCalled();
    expect(palot.removePty).not.toHaveBeenCalled();
    view.unmount();
    expect(palot.disconnectPty).toHaveBeenCalledWith("retry-connection");
  });
  it("observes without writes or resizing until Take control, and only detaches on unmount", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "test",
    } as never);
    const ptyEvents: Array<Parameters<typeof palot.onPtyEvent>[0]> = [];
    vi.spyOn(palot, "snapshotPty").mockResolvedValue({
      buffer: "output",
      cursor: 6,
      cols: 80,
      rows: 24,
    });
    vi.spyOn(palot, "connectPty")
      .mockResolvedValueOnce("observer")
      .mockResolvedValueOnce("controller")
      .mockResolvedValueOnce("reconnected-observer");
    vi.spyOn(palot, "startPty").mockResolvedValue();
    vi.spyOn(palot, "writePty").mockResolvedValue();
    vi.spyOn(palot, "resizePty").mockResolvedValue();
    vi.spyOn(palot, "removePty").mockResolvedValue();
    vi.spyOn(palot, "disconnectPty").mockResolvedValue();
    vi.spyOn(palot, "subscribe").mockReturnValue(() => undefined);
    vi.spyOn(palot, "onPtyEvent").mockImplementation((cb) => {
      ptyEvents.push(cb);
      return () => undefined;
    });
    const view = render(
      <Provider store={store}>
        <TerminalTab
          tab={{ ...tab, resource: { ...tab.resource, ptyID: "read-only-pty", readOnly: true } }}
        />
      </Provider>,
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("observer"));
    expect(palot.connectPty).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true }),
      "test",
    );
    act(() => {
      ghostty.data?.("bad\n");
      ghostty.resize?.({ cols: 100, rows: 30 });
    });
    expect(palot.writePty).not.toHaveBeenCalled();
    expect(palot.resizePty).not.toHaveBeenCalled();
    act(() => ptyEvents[0]?.({ connectionID: "observer", type: "open" }));
    fireEvent.click(view.getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("controller"));
    expect(palot.disconnectPty).toHaveBeenCalledWith("observer");
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ readOnly: true }),
      "test",
    );
    act(() => ghostty.data?.("pwd\n"));
    expect(palot.writePty).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "controller", data: "pwd\n" }),
    );
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    fireEvent.click(view.getByRole("button", { name: "End terminal" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(palot.removePty).not.toHaveBeenCalled();
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "profile-1",
        connectionID: "replacement",
      } as never),
    );
    await waitFor(() => expect(palot.startPty).toHaveBeenCalledWith("reconnected-observer"));
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      expect.objectContaining({ readOnly: true }),
      "replacement",
    );
    act(() => store.set(runtimeAtom, { connected: false, profileID: "profile-1" } as never));
    expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(true);
    expect(palot.disconnectPty).toHaveBeenCalledWith("controller");
    act(() => store.set(runtimeAtom, { connected: true, profileID: "other-profile" } as never));
    expect(view.getByRole("button", { name: "End terminal" }).hasAttribute("disabled")).toBe(true);
    expect(palot.connectPty).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(palot.removePty).not.toHaveBeenCalled();
    expect(palot.disconnectPty).toHaveBeenCalledWith("controller");
  });
  it("restores output, writes and resizes, reconnects from the latest cursor, and cleans up", async () => {
    const ptyEvents: Array<(event: Parameters<Parameters<typeof palot.onPtyEvent>[0]>[0]) => void> =
      [];
    const openCodeEvents: Array<(batch: PalotEventBatch) => void> = [];
    vi.spyOn(palot, "snapshotPty").mockResolvedValue({
      buffer: "restored\n",
      cursor: 9,
      cols: 80,
      rows: 24,
    });
    vi.spyOn(palot, "connectPty")
      .mockResolvedValueOnce("connection-1")
      .mockResolvedValueOnce("connection-2");
    vi.spyOn(palot, "startPty").mockResolvedValue(undefined);
    vi.spyOn(palot, "writePty").mockResolvedValue(undefined);
    vi.spyOn(palot, "resizePty").mockResolvedValue(undefined);
    vi.spyOn(palot, "disconnectPty").mockResolvedValue(undefined);
    vi.spyOn(palot, "getPty").mockResolvedValue({
      id: "pty-1",
      title: "Terminal",
      status: "running",
      transport: "persistent",
    });
    vi.spyOn(palot, "onPtyEvent").mockImplementation((callback) => {
      ptyEvents.push(callback);
      return () => undefined;
    });
    vi.spyOn(palot, "subscribe").mockImplementation((callback) => {
      openCodeEvents.push(callback);
      return () => undefined;
    });

    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "profile-1",
      connectionID: "test",
    } as never);
    const view = render(
      <Provider store={store}>
        <TerminalTab tab={tab} />
      </Provider>,
    );

    await waitFor(() => expect(palot.connectPty).toHaveBeenCalledOnce());
    expect(palot.connectPty).toHaveBeenCalledWith(
      {
        ptyID: "pty-1",
        location: { directory: "/repo" },
        cursor: 9,
        transport: "persistent",
      },
      "test",
    );
    expect(ghostty.writes).toEqual(["restored\n"]);

    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "open" }));
    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "data", data: "new" }));
    act(() => ghostty.data?.("pwd\n"));
    expect(palot.writePty).toHaveBeenCalledWith({
      connectionID: "connection-1",
      data: "pwd\n",
      cols: 80,
      rows: 24,
    });

    act(() => ghostty.resize?.({ cols: 100, rows: 30 }));
    await waitFor(() =>
      expect(palot.writePty).toHaveBeenCalledWith({
        connectionID: "connection-1",
        data: "",
        cols: 100,
        rows: 30,
        control: true,
      }),
    );

    act(() => ptyEvents[0]?.({ connectionID: "connection-1", type: "close", code: 1006 }));
    await waitFor(() => expect(palot.connectPty).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    expect(palot.connectPty).toHaveBeenLastCalledWith(
      {
        ptyID: "pty-1",
        location: { directory: "/repo" },
        cursor: 12,
        transport: "persistent",
      },
      "test",
    );
    expect(palot.startPty).toHaveBeenLastCalledWith("connection-2");

    const removedBatch = {
      connectionID: "test",
      contractVersion: "test",
      streamEpoch: 1,
      batchSequence: 1,
      receivedAt: 1,
      sentAt: 1,
      events: [
        {
          id: "event-1",
          created: 1,
          createdAt: 1,
          receiveSequence: 1,
          type: "persistent-pty.removed" as const,
          data: { sessionID: "session-1", ptyID: "pty-1" },
        },
      ],
    };
    act(() => openCodeEvents[0]?.({ ...removedBatch, connectionID: "other-server" }));
    expect(palot.disconnectPty).not.toHaveBeenCalledWith("connection-2");
    act(() => openCodeEvents[0]?.(removedBatch));
    await waitFor(() => expect(palot.disconnectPty).toHaveBeenCalledWith("connection-2"));

    view.unmount();
    expect(ghostty.disposed).toBe(1);
  });
});
