import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeKeys } from "../lib/opencode-query";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { sessionIsUnread, useAcknowledgeSessionView } from "./use-session-info";

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
    setOpenCodeClientForTest({ session: { view } } as unknown as OpenCodeClient);
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
    queryClient.setQueryData(openCodeKeys.session("connection-1", "session-1"), session());

    function Probe() {
      useAcknowledgeSessionView("session-1");
      return null;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );

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
});
