import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { useModelCatalog } from "./use-model-catalog";

const location = { directory: "/repo", workspaceID: "workspace-1" };

afterEach(() => vi.restoreAllMocks());

describe("OpenCode model catalog queries", () => {
  it("deduplicates model catalog reads for the same location", async () => {
    const listModels = vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [],
      defaultModel: null,
      providers: [],
      errors: [],
    });
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

    function Probe() {
      const first = useModelCatalog(location);
      const second = useModelCatalog(location);
      return <span>{first.isSuccess && second.isSuccess ? "loaded" : "loading"}</span>;
    }

    const result = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(result.getByText("loaded")).toBeTruthy());
    expect(listModels).toHaveBeenCalledOnce();
    expect(listModels).toHaveBeenCalledWith(location, expect.any(AbortSignal), "connection-1");
  });

  it("aborts the service read when the last observer unmounts", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(palot, "listModels").mockImplementation((_location, signal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
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

    function Probe() {
      useModelCatalog(location);
      return null;
    }

    const result = render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(receivedSignal).toBeDefined());
    result.unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
