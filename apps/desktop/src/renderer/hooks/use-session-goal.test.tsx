import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotEventBatch } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import * as clients from "../services/opencode-client";
import { palot } from "../services/palot";
import { useSessionGoal } from "./use-session-goal";

const call = vi.fn();
const listeners = new Set<(batch: PalotEventBatch) => void>();
const runtime = {
  connectionID: "connection-1",
  profileID: "profile-1",
  connected: true,
  phase: "connected",
  version: "2.2.1",
  contractVersion: "2.2.1",
  binaryPath: null,
  pid: null,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
} as OpenCodeRuntimeStatus;
const goal = {
  id: "goal-1",
  objective: "Make the tests pass",
  status: "active",
  rounds: 1,
  maxRounds: 50,
  boot: "b",
  updatedAt: 1,
};

function wrapper(value: OpenCodeRuntimeStatus = runtime) {
  const store = createStore();
  store.set(runtimeAtom, value);
  const queries = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
}

function emit(events: Array<{ type: string; data?: unknown }>) {
  for (const listener of listeners)
    listener({ connectionID: runtime.connectionID, events } as unknown as PalotEventBatch);
}

beforeEach(() => {
  call.mockReset().mockResolvedValue({ output: goal });
  vi.spyOn(clients, "openCodeClient").mockReturnValue({ rpc: { call } } as never);
  vi.spyOn(palot, "subscribe").mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  listeners.clear();
});

describe("useSessionGoal", () => {
  it("reads the goal through the plugin RPC in the task's location and follows changes", async () => {
    const { result } = renderHook(() => useSessionGoal("s1", { directory: "/repo" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current?.status).toBe("active"));
    expect(call).toHaveBeenCalledWith(
      {
        rpcID: "opencode.goal",
        method: "get",
        location: { directory: "/repo" },
        input: { sessionID: "s1" },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() =>
      emit([
        { type: "rpc.opencode.goal.changed", data: { sessionID: "other", goal: null } },
        {
          type: "rpc.opencode.goal.changed",
          data: {
            sessionID: "s1",
            goal: { ...goal, status: "paused", reason: "Stopped by the user" },
          },
        },
      ]),
    );
    await waitFor(() => expect(result.current?.status).toBe("paused"));
    expect(result.current?.reason).toBe("Stopped by the user");

    act(() => emit([{ type: "rpc.opencode.goal.changed", data: { sessionID: "s1", goal: null } }]));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("asks nothing of servers older than 2.2.1 and shows no goal when the read fails", async () => {
    const old = renderHook(() => useSessionGoal("s1", { directory: "/repo" }), {
      wrapper: wrapper({ ...runtime, version: "2.2.0" }),
    });
    expect(old.result.current).toBeNull();
    expect(call).not.toHaveBeenCalled();

    call.mockRejectedValue(new Error("rpc.unavailable"));
    const failing = renderHook(() => useSessionGoal("s2", { directory: "/repo" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(failing.result.current).toBeNull();
  });
});
