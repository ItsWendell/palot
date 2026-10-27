import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotEventBatch } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import * as clients from "../services/opencode-client";
import { palot } from "../services/palot";
import { useFileWatch } from "./use-file-watch";

const watch = vi.fn();
const unwatch = vi.fn();
const listeners = new Set<(batch: PalotEventBatch) => void>();
const runtime: OpenCodeRuntimeStatus = {
  connectionID: "connection-1",
  profileID: "profile-1",
  connected: true,
  phase: "connected",
  version: "2.2.0",
  contractVersion: "2.2.0",
  binaryPath: null,
  pid: null,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};

function wrapper(value: OpenCodeRuntimeStatus = runtime) {
  const store = createStore();
  store.set(runtimeAtom, value);
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

function reconnect(connectionID = runtime.connectionID) {
  for (const listener of listeners) {
    listener({ connectionID, events: [{ type: "server.connected" }] } as PalotEventBatch);
  }
}

beforeEach(() => {
  watch.mockReset().mockResolvedValue(undefined);
  unwatch.mockReset().mockResolvedValue(undefined);
  vi.spyOn(clients, "openCodeClient").mockReturnValue({ file: { watch, unwatch } } as never);
  vi.spyOn(palot, "subscribe").mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.restoreAllMocks();
  listeners.clear();
});

describe("useFileWatch", () => {
  it("shares a normalized location-relative watch until the last visible tab leaves", async () => {
    const first = renderHook(() => useFileWatch({ directory: "/repo" }, "./src/a.ts"), {
      wrapper: wrapper(),
    });
    const second = renderHook(
      ({ active }) =>
        useFileWatch({ directory: "/repo", workspaceID: "worktree" }, "/repo/src/a.ts", active),
      { wrapper: wrapper(), initialProps: { active: true } },
    );
    await act(async () => {});
    expect(watch).toHaveBeenCalledExactlyOnceWith({
      location: { directory: "/repo" },
      path: "src/a.ts",
    });

    second.rerender({ active: false });
    await act(async () => {});
    expect(listeners.size).toBe(1);
    first.unmount();
    await act(async () => {});
    // Closing never unwatches: another window or app may watch the same file.
    expect(unwatch).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("keeps connections and directories independent", async () => {
    renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), { wrapper: wrapper() });
    renderHook(() => useFileWatch({ directory: "/other" }, "a.ts"), { wrapper: wrapper() });
    renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), {
      wrapper: wrapper({ ...runtime, connectionID: "connection-2" }),
    });
    await act(async () => {});
    expect(watch).toHaveBeenCalledTimes(3);
    expect(clients.openCodeClient).toHaveBeenCalledWith("connection-1");
    expect(clients.openCodeClient).toHaveBeenCalledWith("connection-2");
    await act(async () => reconnect("connection-2"));
    expect(watch).toHaveBeenCalledTimes(4);
  });

  it("re-watches on reconnect and renews before the server TTL, stopping on unmount", async () => {
    vi.useFakeTimers();
    const result = renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), {
      wrapper: wrapper(),
    });
    await act(async () => {});
    await act(async () => reconnect("other-connection"));
    expect(watch).toHaveBeenCalledTimes(1);
    await act(async () => reconnect());
    expect(watch).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(12 * 60 * 60 * 1_000));
    expect(watch).toHaveBeenCalledTimes(3);
    result.unmount();
    await act(async () => vi.advanceTimersByTime(24 * 60 * 60 * 1_000));
    expect(watch).toHaveBeenCalledTimes(3);
    expect(unwatch).not.toHaveBeenCalled();
  });

  it("watches again when a closed file is reopened", async () => {
    const first = renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), {
      wrapper: wrapper(),
    });
    await act(async () => {});
    first.unmount();
    renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), { wrapper: wrapper() });
    await act(async () => {});
    expect(watch).toHaveBeenCalledTimes(2);
    await act(async () => reconnect());
    expect(watch).toHaveBeenCalledTimes(3);
  });

  it.each(["2.0.7", "2.1.4"])("does not call optional routes on OpenCode %s", async (version) => {
    renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), {
      wrapper: wrapper({ ...runtime, version }),
    });
    await act(async () => {});
    expect(watch).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("silently tolerates an unavailable watch route", async () => {
    watch.mockRejectedValue(new Error("404 Not Found"));
    const result = renderHook(() => useFileWatch({ directory: "/repo" }, "a.ts"), {
      wrapper: wrapper({ ...runtime, version: null }),
    });
    await act(async () => {});
    expect(watch).toHaveBeenCalledOnce();
    result.unmount();
    await act(async () => {});
    expect(listeners.size).toBe(0);
  });

  it.each(["../outside.ts", "/outside.ts", "", "/repo"])(
    "does not watch invalid file path %s",
    async (path) => {
      renderHook(() => useFileWatch({ directory: "/repo" }, path), { wrapper: wrapper() });
      await act(async () => {});
      expect(watch).not.toHaveBeenCalled();
    },
  );
});
