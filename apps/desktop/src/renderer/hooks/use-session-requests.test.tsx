import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { setSessionRequestSnapshot } from "../lib/session-request-query";
import { palot } from "../services/palot";
import {
  useSessionRequestMap,
  useSessionRequests,
  useSessionFamilyRequestViews,
} from "./use-session-requests";
import { seedCatalog } from "../test-utils/render-with-router";
import type { PalotSession, SessionRequestSnapshot } from "../../shared";

afterEach(() => vi.restoreAllMocks());

function connectedStore() {
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
  return store;
}

describe("session request queries", () => {
  it("hydrates descendant blockers from cache, follows lineage changes, and isolates connections without fetching children", async () => {
    const loadSessionInbox = vi.spyOn(palot, "loadSessionInbox");
    const loadRequests = vi.spyOn(palot, "loadRequests");
    const queryClient = createRendererQueryClient();
    const base: PalotSession = {
      id: "root",
      title: "Parent",
      parentID: null,
      projectID: "project",
      agent: null,
      model: null,
      location: { directory: "/repo" },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const child = { ...base, id: "child", parentID: "root", title: "Capture" };
    const nested = { ...base, id: "nested", parentID: "child", title: "Check" };
    const pending: SessionRequestSnapshot = {
      permissions: [],
      inbox: [],
      errors: [],
      forms: [
        {
          id: "question",
          sessionID: "nested",
          title: "Ready?",
          metadata: { kind: "question" },
          fields: [{ key: "q0", type: "string", title: "Ready?" }],
        },
      ],
    };
    seedCatalog(queryClient, { sessions: [base] }, "connection-1");
    setSessionRequestSnapshot(queryClient, "connection-1", "nested", pending);
    setSessionRequestSnapshot(queryClient, "other-connection", "root", pending);
    function Probe() {
      const views = useSessionFamilyRequestViews("root");
      return (
        <span>{views.map((view) => `${view.sessionID}:${view.title}`).join(",") || "none"}</span>
      );
    }
    const result = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={connectedStore()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    expect(result.getByText("none")).toBeTruthy();
    act(() => seedCatalog(queryClient, { sessions: [child, nested] }, "connection-1"));
    await waitFor(() => expect(result.getByText("nested:Ready?")).toBeTruthy());
    act(() =>
      setSessionRequestSnapshot(queryClient, "connection-1", "nested", { ...pending, forms: [] }),
    );
    await waitFor(() => expect(result.getByText("none")).toBeTruthy());
    expect(loadSessionInbox).not.toHaveBeenCalled();
    expect(loadRequests).not.toHaveBeenCalled();
  });

  it("lets the selected observer own the request read", async () => {
    const loadSessionInbox = vi.spyOn(palot, "loadSessionInbox").mockResolvedValue([]);
    const loadRequests = vi.spyOn(palot, "loadRequests");

    function Probe() {
      const selected = useSessionRequests("session-1");
      const inventory = useSessionRequestMap(["session-1"]);
      return <span>{selected.isSuccess && inventory.has("session-1") ? "loaded" : "loading"}</span>;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={connectedStore()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(result.getByText("loaded")).toBeTruthy());
    expect(loadSessionInbox).toHaveBeenCalledTimes(1);
    expect(loadSessionInbox).toHaveBeenCalledWith(
      "session-1",
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(loadRequests).not.toHaveBeenCalled();
  });

  it("reads inventory snapshots from cache without querying every session", async () => {
    const loadSessionInbox = vi.spyOn(palot, "loadSessionInbox").mockResolvedValue([]);
    const queryClient = createRendererQueryClient();

    function Probe() {
      const inventory = useSessionRequestMap(["session-1", "session-2", "session-3"]);
      return <span>{inventory.size}</span>;
    }

    const result = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={connectedStore()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    expect(result.getByText("0")).toBeTruthy();
    expect(loadSessionInbox).not.toHaveBeenCalled();

    setSessionRequestSnapshot(queryClient, "connection-1", "session-2", {
      permissions: [],
      forms: [],
      inbox: [],
      errors: [],
    });

    await waitFor(() => expect(result.getByText("1")).toBeTruthy());
    expect(loadSessionInbox).not.toHaveBeenCalled();
  });

  it("cancels the request read when the last observer unmounts", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(palot, "loadSessionInbox").mockImplementation((_sessionID, signal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    function Probe() {
      useSessionRequests("session-1");
      return null;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={connectedStore()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(receivedSignal).toBeDefined());
    result.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
