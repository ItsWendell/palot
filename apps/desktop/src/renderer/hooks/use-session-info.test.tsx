import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeKeys } from "../lib/opencode-query";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import {
  sessionIsUnread,
  useAcknowledgeSessionView,
  type OpenedSessionView,
} from "./use-session-info";

function session(): SessionInfo {
  return {
    id: "session-1",
    projectID: "project-1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 3, idle: 3, viewed: 2 },
    location: { directory: "/repo" },
  };
}

afterEach(() => {
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

describe("session viewed state", () => {
  it("compares the server idle and viewed watermarks", () => {
    expect(sessionIsUnread(session())).toBe(true);
    expect(sessionIsUnread({ ...session(), time: { ...session().time, viewed: 3 } })).toBe(false);
    expect(sessionIsUnread({ ...session(), time: { created: 1, updated: 3 } })).toBe(false);
  });

  it("acknowledges the exact idle watermark when the route is focused", async () => {
    const view = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(session());
    setOpenCodeClientForTest({ session: { view, get } } as unknown as OpenCodeClient);
    const { queryClient, renderProbe } = setup();
    queryClient.setQueryData(openCodeKeys.session("connection-1", "session-1"), session());
    renderProbe(() => undefined);

    await waitFor(() =>
      expect(view).toHaveBeenCalledWith(
        { sessionID: "session-1", idle: 3 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection-1", "session-1"))?.time
        .viewed,
    ).toBe(3);
  });

  it("waits for a fresh read before deciding what is unseen or marking it viewed", async () => {
    // The cache predates a view in another window and a newer run the person hasn't seen.
    const stale = { ...session(), time: { created: 1, updated: 3, idle: 3, viewed: 2 } };
    const fresh = { ...session(), time: { created: 1, updated: 10, idle: 10, viewed: 5 } };
    let answer: (value: SessionInfo) => void = () => undefined;
    const get = vi.fn(() => new Promise<SessionInfo>((resolve) => (answer = resolve)));
    const view = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest({ session: { view, get } } as unknown as OpenCodeClient);
    const { queryClient, renderProbe } = setup();
    queryClient.setQueryData(openCodeKeys.session("connection-1", "session-1"), stale);
    const opened: unknown[] = [];
    renderProbe((value) => opened.push(value));

    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    expect(opened.at(-1)).toBeNull();
    expect(view).not.toHaveBeenCalled();

    await act(async () => answer(fresh));
    await waitFor(() =>
      expect(view).toHaveBeenCalledWith({ sessionID: "session-1", idle: 10 }, expect.anything()),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection-1", "session-1"))
          ?.time.viewed,
      ).toBe(10),
    );
    // What was unseen when the task opened, not after opening it marked it viewed.
    expect(opened.at(-1)).toEqual({ idleAt: 10, viewedAt: 5 });
    expect(new Set(opened.filter(Boolean).map((value) => JSON.stringify(value))).size).toBe(1);
    expect(view).toHaveBeenCalledOnce();
  });
});

function setup() {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    contractVersion: "0.0.0-beta-19425",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "0.0.0-beta-19425",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const queryClient = createRendererQueryClient();

  function Probe({ onOpened }: { onOpened(value: OpenedSessionView | null): void }) {
    onOpened(useAcknowledgeSessionView("session-1"));
    return null;
  }

  return {
    queryClient,
    renderProbe: (onOpened: (value: OpenedSessionView | null) => void) =>
      render(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <Probe onOpened={onOpened} />
          </Provider>
        </QueryClientProvider>,
      ),
  };
}
