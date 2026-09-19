import type { OpenCodeClient, PluginInfo, PluginListOutput } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeInvalidationKeys } from "../lib/opencode-query-events";
import { palot } from "../services/palot";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { checkPlugins, loadSettings } from "../services/opencode-settings";
import { useCheckPlugins, useSettingsSnapshot } from "./use-settings-snapshot";

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

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

describe("OpenCode settings queries", () => {
  it("loads and checks an independent settings owner without changing the selected runtime", async () => {
    const store = connectedStore();
    const selected = store.get(runtimeAtom)!;
    const owner = { ...selected, connectionID: "settings-server", profileID: "settings-profile" };
    const load = vi.spyOn(palot, "loadSettings").mockResolvedValue({
      location: { directory: "/repo" },
      configSources: [],
      catalog: { models: [], defaultModel: null, providers: [], errors: [] },
      agents: [],
      integrations: [],
      mcpServers: [],
      mcpResources: [],
      mcpResourceTemplates: [],
      savedPermissions: [],
      plugins: [],
      skills: [],
      commands: [],
      references: [],
      websearchProviders: [],
      errors: [],
    });
    const check = vi.spyOn(palot, "checkPlugins").mockResolvedValue([]);
    const queryClient = createRendererQueryClient();
    const input = { directory: "/repo", projectID: "project-1" };
    const { result, rerender } = renderHook(
      ({ runtime }) => ({
        settings: useSettingsSnapshot({ ...input, capabilities: ["plugins"] }, true, runtime),
        check: useCheckPlugins(input, runtime),
      }),
      {
        initialProps: { runtime: owner },
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            <Provider store={store}>{children}</Provider>
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.settings.data).toBeDefined());
    expect(load).toHaveBeenCalledWith(
      { ...input, capabilities: ["plugins"], connectionID: owner.connectionID },
      expect.any(AbortSignal),
    );
    await act(() => result.current.check());
    expect(check).toHaveBeenCalledWith({ ...input, connectionID: owner.connectionID });
    expect(store.get(runtimeAtom)).toBe(selected);
    rerender({ runtime: { ...owner, connected: false } });
    await expect(result.current.check()).rejects.toThrow("settings server is disconnected");
    expect(check).toHaveBeenCalledOnce();
  });

  it.each([
    { inventory: "updated", eventRead: "completed" },
    { inventory: "removed", eventRead: "completed" },
    { inventory: "updated", eventRead: "pending" },
    { inventory: "removed", eventRead: "pending" },
  ])(
    "does not overwrite $inventory inventory when a newer event read is $eventRead",
    async ({ inventory, eventRead }) => {
      const location = {
        directory: "/repo",
        project: { id: "project-1", directory: "/repo", canonical: "/repo" },
      };
      const initial: PluginInfo = {
        id: "example",
        source: { type: "package", target: "example@latest", version: "1.0.0" },
        features: {},
        state: { status: "active" },
      };
      const latest: PluginInfo[] =
        inventory === "removed"
          ? []
          : [
              {
                ...initial,
                source: { type: "package", target: "example@latest", version: "2.0.0" },
              },
            ];
      const pendingCheck = Promise.withResolvers<PluginListOutput>();
      const pendingList = Promise.withResolvers<PluginListOutput>();
      let eventSignal: AbortSignal | undefined;
      const list = vi
        .fn<OpenCodeClient["plugin"]["list"]>()
        .mockResolvedValueOnce({ location, data: [initial] })
        .mockImplementation((_input, options) => {
          eventSignal = options?.signal;
          return pendingList.promise;
        });
      const check = vi.fn(() => pendingCheck.promise);
      setOpenCodeClientForTest({ plugin: { list, check } } as unknown as OpenCodeClient);
      vi.spyOn(palot, "loadSettings").mockImplementation(loadSettings);
      vi.spyOn(palot, "checkPlugins").mockImplementation(checkPlugins);
      const store = connectedStore();
      const queryClient = createRendererQueryClient();
      const input = { projectID: "project-1", directory: "/repo" };
      const { result } = renderHook(
        () => ({
          settings: useSettingsSnapshot({ ...input, capabilities: ["plugins"] }),
          check: useCheckPlugins(input),
        }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
          ),
        },
      );
      await waitFor(() =>
        expect(result.current.settings.data?.plugins[0]?.source).toMatchObject({
          version: "1.0.0",
        }),
      );
      let checking: Promise<void> | undefined;
      act(() => {
        checking = result.current.check();
      });
      await waitFor(() => expect(check).toHaveBeenCalledOnce());
      let refreshing: Promise<void>[] = [];
      act(() => {
        const keys = openCodeInvalidationKeys("connection-1", {
          id: "new-plugin-inventory",
          created: 2,
          createdAt: 2,
          receiveSequence: 2,
          type: "plugin.updated",
          location,
          data: {},
        });
        refreshing = keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }));
      });
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      async function completeEventRead() {
        await act(async () => {
          pendingList.resolve({ location, data: latest });
          await Promise.all(refreshing);
        });
        await waitFor(() => expect(result.current.settings.isFetching).toBe(false));
      }
      if (eventRead === "completed") await completeEventRead();
      await act(async () => {
        pendingCheck.resolve({
          location,
          data: [
            {
              ...initial,
              source: {
                type: "package",
                target: "example@latest",
                version: "1.0.0",
                outdated: true,
              },
            },
          ],
        });
        await checking;
      });
      expect(eventSignal?.aborted).toBe(false);
      if (eventRead === "pending") await completeEventRead();
      await waitFor(() =>
        expect(
          result.current.settings.data?.plugins.map((plugin) =>
            plugin.source.type === "package" ? plugin.source.version : undefined,
          ),
        ).toEqual(inventory === "removed" ? [] : ["2.0.0"]),
      );
      expect(
        result.current.settings.data?.plugins.some(
          (plugin) => plugin.source.type === "package" && plugin.source.outdated,
        ),
      ).toBe(false);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "publishes documents and plugin diagnostics before the agent registry can %s",
    async (outcome) => {
      const activation = Promise.withResolvers<void>();
      const location = {
        directory: "/repo",
        project: { id: "project-1", directory: "/repo", canonical: "/repo" },
      };
      const agents = vi.fn(async () => {
        await activation.promise;
        return {
          location,
          data: [{ id: "build", name: "Build", mode: "primary", hidden: false, permissions: [] }],
        };
      });
      setOpenCodeClientForTest({
        config: {
          get: vi
            .fn()
            .mockResolvedValue([{ type: "document", path: "/repo/opencode.json", info: {} }]),
        },
        plugin: {
          list: vi.fn().mockResolvedValue({
            location,
            data: [
              {
                id: "broken",
                source: { type: "local", path: "/repo/broken.ts" },
                features: {},
                state: { status: "failed", error: "setup failed" },
              },
            ],
          }),
        },
        agent: { list: agents },
      } as unknown as OpenCodeClient);
      vi.spyOn(palot, "loadSettings").mockImplementation(loadSettings);
      const store = connectedStore();
      const queryClient = createRendererQueryClient();
      const { result } = renderHook(
        () =>
          useSettingsSnapshot({
            projectID: "project-1",
            directory: "/repo",
            capabilities: ["config", "plugins", "agents"],
          }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
          ),
        },
      );

      await waitFor(() => {
        expect(result.current.data?.configSources[0]?.path).toBe("/repo/opencode.json");
        expect(result.current.data?.plugins[0]?.state).toMatchObject({
          status: "failed",
          error: "setup failed",
        });
      });
      expect(result.current.pendingCapabilities).toEqual(["agents"]);
      expect(result.current.isPending).toBe(false);
      expect(result.current.isFetching).toBe(true);
      expect(agents).toHaveBeenCalledOnce();

      await act(async () => {
        if (outcome === "resolve") activation.resolve();
        else activation.reject(new Error("activation failed"));
      });
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.data?.configSources[0]?.path).toBe("/repo/opencode.json");
      if (outcome === "resolve") expect(result.current.data?.agents[0]?.name).toBe("Build");
      else {
        expect(result.current.data?.errors).toContainEqual(
          expect.objectContaining({ capability: "agents", message: "activation failed" }),
        );
        expect(agents).toHaveBeenCalledOnce();
      }
    },
  );

  it("aborts the aggregate settings read when the observer unmounts", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.spyOn(palot, "loadSettings").mockImplementation((_input, signal) => {
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
      useSettingsSnapshot({ projectID: "project-1", directory: "/repo", capabilities: ["config"] });
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
