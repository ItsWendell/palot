import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { useSessionDiffs } from "./use-session-diffs";

afterEach(() => vi.restoreAllMocks());

describe("session diff queries", () => {
  it("deduplicates working diff reads for the same session", async () => {
    const listDiffs = vi.spyOn(palot, "listDiffs").mockResolvedValue([]);
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
    const session = {
      id: "session-1",
      location: { directory: "/repo", workspaceID: "worktree" },
    } as PalotSession;

    function Probe() {
      const first = useSessionDiffs(session);
      const second = useSessionDiffs(session);
      return <span>{first.isSuccess && second.isSuccess ? "loaded" : "loading"}</span>;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(result.getByText("loaded")).toBeTruthy());
    expect(listDiffs).toHaveBeenCalledTimes(1);
    expect(listDiffs).toHaveBeenCalledWith(
      { directory: "/repo", workspaceID: "worktree", mode: "working", context: 3 },
      expect.any(AbortSignal),
      "connection-1",
    );
  });
});
