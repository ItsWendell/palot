import { OpenCode, type UsageLimitsInfo } from "@opencode/client";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { useUsageLimits } from "./use-usage-limits";

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

function setup(response: () => Response | Promise<Response>, version = "2.2.0") {
  const fetch = vi.fn(async (_request: RequestInfo | URL) => response());
  setOpenCodeClientForTest(OpenCode.make({ baseUrl: "https://example.test", fetch }));
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "one",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version,
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const client = createRendererQueryClient();
  const hook = renderHook(() => useUsageLimits("/repo"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    ),
  });
  return { ...hook, fetch, client, store };
}

describe("useUsageLimits", () => {
  it("unwraps signed-out null and sends the location to the official endpoint", async () => {
    const { result, fetch } = setup(() =>
      Response.json({ location: { directory: "/repo" }, data: null }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.unavailable).toBe(false);
    const request = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(request.href).toBe(
      "https://example.test/api/experimental/usage/limits?location%5Bdirectory%5D=%2Frepo",
    );
  });

  it("returns Console limits and retains fresh results across focus changes", async () => {
    const data: UsageLimitsInfo = {
      workspace: { id: "workspace", usageURL: "https://console.example/usage" },
      budgets: [],
    };
    const { result, fetch } = setup(() =>
      Response.json({ location: { directory: "/repo" }, data }),
    );
    await waitFor(() => expect(result.current.data).toEqual(data));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("turns a genuine older-server 404 into unavailable, not an error", async () => {
    const { result } = setup(() => new Response("Not Found", { status: 404 }), "unknown");
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("reports a non-JSON failure from a 2.2.0 server as an error, not an old server", async () => {
    const { result } = setup(
      () =>
        new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.unavailable).toBe(false);
  });

  it("does not show one connection's limits while another connection loads", async () => {
    const data: UsageLimitsInfo = {
      workspace: { id: "old-workspace", usageURL: "https://console.example/usage" },
      budgets: [],
    };
    let resolve!: (value: Response) => void;
    let calls = 0;
    const { result, store } = setup(() =>
      ++calls === 1
        ? Response.json({ location: { directory: "/repo" }, data })
        : new Promise((done) => {
            resolve = done;
          }),
    );
    await waitFor(() => expect(result.current.data).toEqual(data));
    act(() =>
      store.set(runtimeAtom, { ...store.get(runtimeAtom)!, connectionID: "two", profileID: "two" }),
    );
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(resolve).toBeDefined());
    resolve(Response.json({ location: { directory: "/repo" }, data: null }));
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it("skips the request for a known unsupported runtime", () => {
    const { result, fetch } = setup(() => Response.json({}), "2.0.7");
    expect(result.current.unavailable).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps real errors retryable without focus retry storms", async () => {
    const { result, fetch } = setup(() => new Response("Broken", { status: 500 }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.unavailable).toBe(false);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => result.current.refetch());
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
