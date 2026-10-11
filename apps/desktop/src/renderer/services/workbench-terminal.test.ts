import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "./palot";
import { openNewWorkbenchTerminal, recoverWorkbenchTerminal } from "./workbench-terminal";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("openNewWorkbenchTerminal", () => {
  it("removes the PTY when the workbench tab limit rejects it", async () => {
    vi.spyOn(palot, "createPty").mockResolvedValue({
      id: "pty-1",
      title: "Terminal",
      status: "running",
      transport: "persistent",
    });
    const remove = vi.spyOn(palot, "removePty").mockResolvedValue();

    await expect(
      openNewWorkbenchTerminal("session-1", { directory: "/repo" }, () => ({
        ok: false,
        reason: "tab-limit",
      })),
    ).rejects.toThrow("Close a workbench tab");

    expect(remove).toHaveBeenCalledWith({ directory: "/repo" }, "pty-1", "persistent", undefined);
  });

  it("rolls a delayed PTY creation back on its original server after focus changes", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof palot.createPty>>) => void;
    const create = vi.spyOn(palot, "createPty").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const remove = vi.spyOn(palot, "removePty").mockResolvedValue();
    let focused = "owner";
    const openTab = vi.fn(() =>
      focused === "owner" ? undefined : ({ ok: false, reason: "tab-limit" } as const),
    );
    const pending = openNewWorkbenchTerminal(
      "session",
      { directory: "/repo" },
      openTab,
      { pane: "bottom" },
      focused,
    );
    const rejection = expect(pending).rejects.toThrow("Close a workbench tab");
    focused = "other";
    resolve({ id: "same-pty", title: "Terminal", status: "running", transport: "persistent" });
    await rejection;
    expect(create).toHaveBeenCalledWith("session", { directory: "/repo" }, "owner");
    expect(remove).toHaveBeenCalledWith({ directory: "/repo" }, "same-pty", "persistent", "owner");
  });
});

const resource = {
  profileID: "profile",
  location: { directory: "/repo" },
  ptyID: "existing-pty",
  transport: "persistent" as const,
};

function setupRecovery() {
  vi.useFakeTimers();
  const listeners: Array<Parameters<typeof palot.onPtyEvent>[0]> = [];
  let attachment = 0;
  const connect = vi
    .spyOn(palot, "connectPty")
    .mockImplementation(async () => `socket-${++attachment}`);
  const get = vi.spyOn(palot, "getPty").mockResolvedValue({
    id: "existing-pty",
    title: "Terminal",
    status: "running",
    transport: "persistent",
  });
  const detach = vi.spyOn(palot, "disconnectPty").mockResolvedValue();
  const start = vi.spyOn(palot, "startPty").mockResolvedValue();
  const create = vi.spyOn(palot, "createPty");
  const remove = vi.spyOn(palot, "removePty");
  const unsubscribe = vi.fn();
  vi.spyOn(palot, "onPtyEvent").mockImplementation((listener) => {
    listeners.push(listener);
    return unsubscribe;
  });
  const status = vi.fn();
  const data = vi.fn();
  let cursor = 10;
  const recover = () =>
    recoverWorkbenchTerminal(resource, "owner-server", {
      readOnly: true,
      cursor: () => cursor,
      onStatus: status,
      onData: data,
    });
  return {
    connect,
    get,
    start,
    create,
    remove,
    detach,
    listeners,
    unsubscribe,
    status,
    data,
    recover,
    setCursor: (value: number) => {
      cursor = value;
    },
  };
}

describe("terminal recovery", () => {
  it("recovers an error without a close event, preserving cursor, read-only mode and server ownership", async () => {
    const test = setupRecovery();
    const recovery = test.recover();
    await vi.advanceTimersByTimeAsync(0);
    test.listeners[0]!({ connectionID: "socket-1", type: "open" });
    test.listeners[0]!({ connectionID: "socket-1", type: "data", data: "output" });
    test.setCursor(16);
    test.listeners[0]!({ connectionID: "socket-1", type: "error", message: "Tunnel interrupted" });
    // An already queued close/data event from the failed socket must not start a second retry.
    test.listeners[0]!({ connectionID: "socket-1", type: "close", code: 1006 });
    test.listeners[0]!({ connectionID: "socket-1", type: "data", data: "stale" });
    await vi.advanceTimersByTimeAsync(250);
    expect(test.connect).toHaveBeenCalledTimes(2);
    expect(test.connect).toHaveBeenLastCalledWith(
      {
        ptyID: "existing-pty",
        location: { directory: "/repo" },
        transport: "persistent",
        cursor: 16,
        readOnly: true,
      },
      "owner-server",
    );
    expect(test.get).toHaveBeenCalledWith(
      { directory: "/repo" },
      "existing-pty",
      "persistent",
      "owner-server",
    );
    expect(test.data).toHaveBeenCalledExactlyOnceWith("output");
    expect(test.detach).toHaveBeenCalledWith("socket-1");
    test.listeners[1]!({ connectionID: "socket-2", type: "open" });
    expect(test.status).toHaveBeenLastCalledWith("connected");
    recovery.stop();
    expect(test.detach).toHaveBeenCalledWith("socket-2");
    expect(test.create).not.toHaveBeenCalled();
    expect(test.remove).not.toHaveBeenCalled();
  });

  it("bounds failed reattachments and permits a manual retry without creating a PTY", async () => {
    const test = setupRecovery();
    test.connect.mockRejectedValue(new Error("Connection lost"));
    const recovery = test.recover();
    await vi.runAllTimersAsync();
    expect(test.connect).toHaveBeenCalledTimes(6);
    expect(test.status).toHaveBeenLastCalledWith("error", expect.any(Error));
    test.connect.mockResolvedValue("manual-socket");
    recovery.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.start).toHaveBeenCalledWith("manual-socket");
    recovery.stop();
    expect(test.create).not.toHaveBeenCalled();
    expect(test.remove).not.toHaveBeenCalled();
  });

  it("bounds rapidly flapping sockets even when each emits open before failing", async () => {
    const test = setupRecovery();
    const recovery = test.recover();
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 6; index++) {
      test.listeners[index]!({ connectionID: `socket-${index + 1}`, type: "open" });
      test.listeners[index]!({ connectionID: `socket-${index + 1}`, type: "close", code: 1006 });
      await vi.advanceTimersByTimeAsync(Math.min(250 * 2 ** index, 4_000));
    }
    expect(test.connect).toHaveBeenCalledTimes(6);
    expect(test.status).toHaveBeenLastCalledWith("error", expect.any(Error));
    recovery.stop();
  });

  it("retries transient inventory failures but cancels all pending work on stop", async () => {
    const test = setupRecovery();
    test.get.mockRejectedValueOnce(new Error("Server temporarily unavailable"));
    const recovery = test.recover();
    await vi.advanceTimersByTimeAsync(0);
    test.listeners[0]!({ connectionID: "socket-1", type: "close", code: 1006 });
    await vi.advanceTimersByTimeAsync(250);
    expect(test.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(test.connect).toHaveBeenCalledTimes(2);
    test.listeners[1]!({ connectionID: "socket-2", type: "error", message: "Tunnel interrupted" });
    recovery.stop();
    await vi.runAllTimersAsync();
    expect(test.connect).toHaveBeenCalledTimes(2);
    expect(test.remove).not.toHaveBeenCalled();
  });

  it("detaches a late socket after cancellation and never starts it", async () => {
    const test = setupRecovery();
    let resolve!: (id: string) => void;
    test.connect.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const recovery = test.recover();
    recovery.stop();
    resolve("late-socket");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.detach).toHaveBeenCalledExactlyOnceWith("late-socket");
    expect(test.start).not.toHaveBeenCalled();
    expect(test.remove).not.toHaveBeenCalled();
  });

  it.each(["exited", "missing", "removed"])(
    "stops retrying a %s PTY and never recreates it",
    async (condition) => {
      const test = setupRecovery();
      if (condition === "exited")
        test.get.mockResolvedValue({
          id: "existing-pty",
          title: "Terminal",
          status: "exited",
          transport: "persistent",
        });
      if (condition === "missing")
        test.get.mockRejectedValue(new Error("Gone", { cause: { _tag: "PtyNotFoundError" } }));
      const recovery = test.recover();
      await vi.advanceTimersByTimeAsync(0);
      test.listeners[0]!({ connectionID: "socket-1", type: "close", code: 1006 });
      if (condition === "removed") recovery.exit();
      await vi.runAllTimersAsync();
      recovery.reconnect();
      await vi.runAllTimersAsync();
      expect(test.status).toHaveBeenLastCalledWith("exited");
      expect(test.connect).toHaveBeenCalledOnce();
      expect(test.create).not.toHaveBeenCalled();
      expect(test.remove).not.toHaveBeenCalled();
      recovery.stop();
    },
  );
});
