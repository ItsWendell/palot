import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { useComposerCatalog, useWorkspaceFileSearch } from "./use-composer-discovery";

afterEach(() => vi.restoreAllMocks());

function store() {
  const value = createStore();
  value.set(runtimeAtom, {
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
  return value;
}

describe("composer discovery queries", () => {
  it("deduplicates catalog reads for the same location", async () => {
    const load = vi.spyOn(palot, "loadComposerCatalog").mockResolvedValue({
      commands: [],
      skills: [],
      errors: [],
    });

    function Probe() {
      const first = useComposerCatalog({ directory: "/repo" });
      const second = useComposerCatalog({ directory: "/repo" });
      return <span>{first.isSuccess && second.isSuccess ? "loaded" : "loading"}</span>;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(result.getByText("loaded")).toBeTruthy());
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(
      { directory: "/repo" },
      expect.any(AbortSignal),
      "connection-1",
    );
  });

  it("aborts an obsolete workspace file search", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(palot, "findWorkspaceFiles").mockImplementation((_input, signal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    function Probe() {
      useWorkspaceFileSearch({ directory: "/repo" }, "auth");
      return null;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store()}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(receivedSignal).toBeDefined());
    result.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
