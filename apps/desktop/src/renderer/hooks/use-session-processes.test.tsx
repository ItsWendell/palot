import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { openCodeInvalidationKeys } from "../lib/opencode-query-events";
import {
  reconcileProcesses,
  SHELL_POLL_MS,
  TERMINAL_POLL_MS,
  useSessionProcesses,
  type SessionCommand,
  type SessionProcess,
  type SessionTerminal,
} from "./use-session-processes";

const mocks = vi.hoisted(() => ({
  shells: vi.fn(),
  terminals: vi.fn(),
  get: vi.fn(),
  catalog: vi.fn(),
  client: vi.fn(),
  locations: vi.fn(async (): Promise<{ directory: string }[]> => []),
  // Servers before 2.2.6 have no job list.
  jobs: vi.fn(async (): Promise<{ sessionID: string }[]> => {
    throw new Error("Not Found");
  }),
}));
vi.mock("../services/palot", () => ({
  palot: { listRunningShells: mocks.shells, subscribe: () => () => undefined },
}));
vi.mock("../services/opencode-client", () => ({
  openCodeClient: (connectionID: string) => {
    mocks.client(connectionID);
    return {
      shell: { get: mocks.get },
      experimental: { persistentPty: { list: mocks.terminals }, job: { list: mocks.jobs } },
      debug: { location: { list: mocks.locations } },
    };
  },
}));
vi.mock("./use-session-catalog", () => ({ useSessionCatalog: () => mocks.catalog() }));

function command(id: string): SessionCommand {
  return {
    kind: "command",
    id,
    sessionID: "root",
    command: "sleep 30",
    cwd: "/repo",
    startedAt: 1,
    status: "running",
    location: { directory: "/repo" },
    active: true,
  };
}

function terminal(id: string, active = true): SessionTerminal {
  return {
    kind: "terminal",
    id,
    active,
    status: active ? "running" : "exited",
    sessionID: "root",
    location: { directory: "/repo" },
    cwd: "/repo",
    title: "Terminal",
    userTitle: null,
    command: "zsh",
    args: [],
    pid: 1,
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  };
}

function history(rows: SessionProcess[]) {
  return { rows, inactiveSince: new Map<string, number>() };
}

describe("process retention", () => {
  it("keeps row order and retains disappeared commands briefly without counting them active", () => {
    const previous = history([command("a"), command("b")]);
    const rows = reconcileProcesses(previous, [command("b"), command("c")], 100, false);
    expect(rows.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.rows[0]).toMatchObject({ active: false, missingSince: 100 });
    expect(
      reconcileProcesses(rows, [command("b"), command("c")], 30_101, false).rows.map(
        (row) => row.id,
      ),
    ).toEqual(["b", "c"]);
  });

  it("pins vanished rows while the picker is open, then expires them on close", () => {
    const rows = reconcileProcesses(history([command("a")]), [], 100, true);
    expect(reconcileProcesses(rows, [], 90_000, true).rows).toHaveLength(1);
    expect(reconcileProcesses(rows, [], 90_000, false).rows).toEqual([]);
  });

  it("bounds recent command history", () => {
    const rows = Array.from({ length: 40 }, (_, index) => command(String(index)));
    expect(reconcileProcesses(history(rows), [], 100, false).rows).toHaveLength(20);
  });

  it("expires listed exited terminals without re-adding them on later ticks or reopening", () => {
    const exited = [terminal("pty", false)];
    const recent = reconcileProcesses(history([terminal("pty")]), exited, 100, false);
    expect(recent.rows[0]).toMatchObject({ active: false, status: "exited", missingSince: 100 });
    expect(reconcileProcesses(recent, exited, 29_000, false).rows).toHaveLength(1);
    const expired = reconcileProcesses(recent, exited, 30_100, false);
    expect(expired.rows).toEqual([]);
    expect(reconcileProcesses(expired, exited, 31_100, false).rows).toEqual([]);
    expect(reconcileProcesses(expired, exited, 31_100, true).rows).toEqual([]);
    expect(reconcileProcesses(expired, [terminal("pty")], 31_100, false).rows).toHaveLength(1);
  });

  it.each(["listed", "missing"])(
    "pins %s inactive terminals while open, then expires on close",
    (mode) => {
      const current = mode === "listed" ? [terminal("pty", false)] : [];
      const recent = reconcileProcesses(history([terminal("pty")]), current, 100, false);
      expect(recent.rows).toHaveLength(1);
      expect(recent.rows[0]?.active).toBe(false);
      expect(reconcileProcesses(recent, current, 30_100, false).rows).toEqual([]);
      const pinned = reconcileProcesses(recent, current, 90_000, true);
      expect(pinned.rows).toHaveLength(1);
      expect(reconcileProcesses(pinned, current, 90_000, false).rows).toEqual([]);
    },
  );

  it("bounds all inactive rows together, including still-listed exited terminals", () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => command(`c${i}`)),
      ...Array.from({ length: 15 }, (_, i) => terminal(`t${i}`)),
    ];
    const current = Array.from({ length: 15 }, (_, i) => terminal(`t${i}`, false));
    const recent = reconcileProcesses(history(rows), current, 100, false);
    expect(recent.rows).toHaveLength(20);
    const expired = reconcileProcesses(recent, current, 30_100, false);
    expect(expired.rows).toEqual([]);
    expect(reconcileProcesses(expired, current, 31_100, false).rows).toEqual([]);
    expect(reconcileProcesses(history(rows), current, 100, true).rows).toHaveLength(30);
  });
});

describe("session process scope", () => {
  it("never discovers work through a focused connection other than its explicit owner", async () => {
    mocks.shells.mockClear();
    mocks.terminals.mockClear();
    mocks.client.mockClear();
    mocks.catalog.mockReturnValue([]);
    const root = { id: "root", location: { directory: "/origin" } } as PalotSession;
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "other",
      profileID: "other-profile",
      connected: true,
      capabilities: { pty: "persistent" },
    } as never);
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const hook = renderHook(
      () =>
        useSessionProcesses(root, new Set(["root"]), false, {
          profileID: "origin-profile",
          connectionID: "origin",
        }),
      { wrapper },
    );
    expect(hook.result.current.rows).toEqual([]);
    expect(mocks.shells).not.toHaveBeenCalled();
    expect(mocks.terminals).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });
  it("discovers settled catalog descendants without execution IDs and excludes unrelated or cyclic ancestry", async () => {
    const location = { directory: "/repo" };
    const root = { id: "root", parentID: null, location } as PalotSession;
    const catalog = [
      root,
      { id: "settled", parentID: "root", location, outcome: "succeeded" },
      { id: "grandchild", parentID: "settled", location },
      { id: "unrelated", parentID: null, location },
      { id: "cycle-a", parentID: "cycle-b", location },
      { id: "cycle-b", parentID: "cycle-a", location },
    ] as PalotSession[];
    mocks.catalog.mockReturnValue(catalog);
    mocks.shells.mockResolvedValue(
      catalog.slice(1).map((owner) => ({ ...command(`shell-${owner.id}`), sessionID: owner.id })),
    );
    mocks.terminals.mockClear();
    // Even a malformed endpoint response must not leak another owner's terminal.
    mocks.terminals.mockImplementation(async ({ sessionID }) =>
      sessionID === "settled"
        ? [
            { ...terminal("pty-settled"), sessionID: "settled" },
            { ...terminal("pty-unrelated"), sessionID: "unrelated" },
          ]
        : [],
    );
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "settled-descendants",
      connected: true,
      capabilities: { pty: "persistent" },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const ids = new Set(["root"]);
    const hook = renderHook(() => useSessionProcesses(root, ids, false), { wrapper });
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(3));
    expect(mocks.client).toHaveBeenCalledWith("settled-descendants");
    expect(hook.result.current.rows.map((row) => row.id)).toEqual([
      "shell-settled",
      "shell-grandchild",
      "pty-settled",
    ]);
    expect([...hook.result.current.owners.keys()]).toEqual(["root", "settled", "grandchild"]);
    expect(mocks.terminals.mock.calls.map(([input]) => input.sessionID).sort()).toEqual([
      "grandchild",
      "root",
      "settled",
    ]);
    hook.unmount();
    client.clear();
  });

  it("filters unrelated shell and terminal owners, supports child locations, and clears on disconnect", async () => {
    const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
    const child = {
      id: "child",
      title: "Child task",
      location: { directory: "/child", workspaceID: "child-workspace" },
    } as PalotSession;
    mocks.catalog.mockReturnValue([root, child]);
    mocks.locations.mockResolvedValue([{ directory: "/repo" }, { directory: "/child" }]);
    mocks.shells.mockImplementation(async (location) =>
      location.directory === "/repo"
        ? [command("a"), { ...command("unrelated"), sessionID: "other" }]
        : [{ ...command("b"), sessionID: "child" }],
    );
    mocks.terminals.mockImplementation(async ({ sessionID }) =>
      sessionID === "root"
        ? [
            { id: "pty", sessionID: "root", status: "running", foregroundProcess: "vim" },
            { id: "unrelated-pty", sessionID: "other", status: "running" },
          ]
        : [],
    );
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "one",
      profileID: "profile",
      connected: true,
      capabilities: { pty: "persistent" },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const ids = new Set(["root", "child"]);
    const hook = renderHook(() => useSessionProcesses(root, ids, false), { wrapper });
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(3));
    expect(hook.result.current.commands).toBe(2);
    expect(hook.result.current.terminals).toBe(1);
    // The child's worktree is read once the loaded-location list confirms it.
    expect(hook.result.current.rows.map((row) => row.id).sort()).toEqual(["a", "b", "pty"]);
    mocks.shells.mockResolvedValue([]);
    mocks.get.mockImplementation(async ({ id }) => ({
      data: {
        id,
        status: "exited",
        exit: 1,
        metadata: { sessionID: id === "a" ? "root" : "child" },
      },
    }));
    mocks.terminals.mockClear();
    await act(async () => {
      await client.invalidateQueries({ queryKey: openCodeKeys.all("one") });
    });
    expect(mocks.terminals).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(hook.result.current.rows[0]).toMatchObject({
        id: "a",
        active: false,
        status: "exited",
        exit: 1,
      }),
    );
    expect(hook.result.current.commands).toBe(0);
    expect(hook.result.current.rows).toHaveLength(3);
    expect(mocks.get).toHaveBeenCalledWith(
      { id: "b", location: { directory: "/child" } },
      { signal: expect.any(AbortSignal) },
    );
    mocks.terminals.mockRejectedValue(new Error("Daemon unavailable"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: openCodeKeys.all("one") });
    });
    await waitFor(() =>
      expect(hook.result.current.error).toBe("Terminals could not be refreshed."),
    );
    mocks.terminals.mockResolvedValue([]);
    await act(async () => {
      await hook.result.current.retry();
    });
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    act(() => store.set(runtimeAtom, null));
    expect(hook.result.current.rows).toEqual([]);
    expect(hook.result.current.commands).toBe(0);
    hook.unmount();
    client.clear();
  });

  it("reads only loaded subagent directories while closed and every directory once opened", async () => {
    const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
    const warm = { id: "warm", parentID: "root", location: { directory: "/wt-warm" } };
    const idle = { id: "idle", parentID: "root", location: { directory: "/wt-idle" } };
    mocks.catalog.mockReturnValue([root, warm, idle]);
    mocks.locations.mockResolvedValue([{ directory: "/wt-warm" }]);
    mocks.shells.mockReset();
    mocks.shells.mockImplementation(async (location) =>
      location.directory === "/wt-idle" ? [{ ...command("idle-shell"), sessionID: "idle" }] : [],
    );
    mocks.terminals.mockResolvedValue([]);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "one",
      profileID: "profile",
      connected: true,
      capabilities: { pty: "persistent" },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const directories = () => mocks.shells.mock.calls.map(([location]) => location.directory);
    const hook = renderHook(({ open }) => useSessionProcesses(root, new Set(["root"]), open), {
      wrapper,
      initialProps: { open: false },
    });
    await waitFor(() => expect(directories().sort()).toEqual(["/repo", "/wt-warm"]));
    // A late loaded-location list or an invalidation never reaches the idle worktree.
    await act(async () => {
      await client.invalidateQueries({ queryKey: openCodeKeys.runningShellsRoot("one") });
    });
    expect(directories()).not.toContain("/wt-idle");
    expect(hook.result.current.commands).toBe(0);
    // Live work there marks it loaded (see use-opencode-query-events), enabling the read.
    act(() => client.setQueryData(openCodeKeys.loadedLocations("one"), ["/wt-warm", "/wt-idle"]));
    await waitFor(() => expect(directories()).toContain("/wt-idle"));
    await waitFor(() => expect(hook.result.current.commands).toBe(1));
    // Opening the list is explicit and reads every family directory, loaded or not.
    act(() => client.setQueryData(openCodeKeys.loadedLocations("one"), []));
    mocks.shells.mockClear();
    hook.rerender({ open: true });
    await waitFor(() => expect(directories().sort()).toEqual(["/repo", "/wt-idle", "/wt-warm"]));
    hook.unmount();
    client.clear();
  });

  it("with a job list, reads only directories with live family jobs, also when opened", async () => {
    const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
    const busy = { id: "busy", parentID: "root", location: { directory: "/wt-busy" } };
    const idle = { id: "idle", parentID: "root", location: { directory: "/wt-idle" } };
    mocks.catalog.mockReturnValue([root, busy, idle]);
    mocks.locations.mockResolvedValue([]);
    mocks.jobs.mockResolvedValueOnce([{ sessionID: "busy" }]);
    mocks.jobs.mockResolvedValue([{ sessionID: "busy" }]);
    mocks.shells.mockReset();
    mocks.shells.mockImplementation(async (location) =>
      location.directory === "/wt-busy" ? [{ ...command("busy-shell"), sessionID: "busy" }] : [],
    );
    mocks.terminals.mockResolvedValue([]);
    const store = createStore();
    store.set(runtimeAtom, { connectionID: "one", profileID: "profile", connected: true } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const directories = () => mocks.shells.mock.calls.map(([location]) => location.directory);
    const hook = renderHook(({ open }) => useSessionProcesses(root, new Set(["root"]), open), {
      wrapper,
      initialProps: { open: false },
    });
    await waitFor(() => expect(directories().sort()).toEqual(["/repo", "/wt-busy"]));
    await waitFor(() => expect(hook.result.current.commands).toBe(1));
    expect(mocks.jobs).toHaveBeenCalledWith(
      { sessionID: "root", descendants: true, kind: "shell", status: "running" },
      expect.anything(),
    );
    hook.rerender({ open: true });
    await act(async () => {
      await client.invalidateQueries({ queryKey: openCodeKeys.runningShellsRoot("one") });
    });
    expect(directories()).not.toContain("/wt-idle");
    hook.unmount();
    client.clear();
    mocks.jobs.mockReset();
    mocks.jobs.mockRejectedValue(new Error("Not Found"));
  });

  it("skips the loaded-location list when the whole family shares the task directory", async () => {
    mocks.locations.mockClear();
    mocks.shells.mockResolvedValue([]);
    const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
    mocks.catalog.mockReturnValue([
      root,
      { id: "child", parentID: "root", location: { directory: "/repo" } },
    ]);
    const store = createStore();
    store.set(runtimeAtom, { connectionID: "one", connected: true } as never);
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const hook = renderHook(() => useSessionProcesses(root, new Set(["root"]), false), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(mocks.locations).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });

  it("does not request persistent terminals on legacy runtimes", async () => {
    mocks.terminals.mockClear();
    mocks.shells.mockResolvedValue([]);
    mocks.catalog.mockReturnValue([]);
    const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "legacy",
      connected: true,
      capabilities: { pty: "legacy" },
    } as never);
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const ids = new Set(["root"]);
    const hook = renderHook(() => useSessionProcesses(root, ids, false), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(mocks.terminals).not.toHaveBeenCalled();
    expect(hook.result.current.terminalsSupported).toBe(false);
    hook.unmount();
    client.clear();
  });
});

describe("session process polling", () => {
  const root = { id: "root", location: { directory: "/repo" } } as PalotSession;
  const ids = new Set(["root"]);

  function setup(open: boolean) {
    vi.useFakeTimers();
    mocks.shells.mockReset();
    mocks.terminals.mockReset();
    mocks.catalog.mockReturnValue([root]);
    mocks.shells.mockResolvedValue([]);
    mocks.terminals.mockResolvedValue([]);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "one",
      profileID: "profile",
      connected: true,
      capabilities: { pty: "persistent" },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </Provider>
    );
    const hook = renderHook(({ open }) => useSessionProcesses(root, ids, open), {
      wrapper,
      initialProps: { open },
    });
    return {
      client,
      hook,
      cleanup() {
        hook.unmount();
        client.clear();
        vi.useRealTimers();
      },
    };
  }

  it("reads once on mount and never polls while the list is closed", async () => {
    const { hook, cleanup } = setup(false);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.shells).toHaveBeenCalledTimes(1);
    expect(mocks.terminals).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.shells).toHaveBeenCalledTimes(1);
    expect(mocks.terminals).toHaveBeenCalledTimes(1);
    expect(hook.result.current.commands).toBe(0);
    cleanup();
  });

  it("polls commands and terminals only while the list is open", async () => {
    const { hook, cleanup } = setup(false);
    await act(() => vi.advanceTimersByTimeAsync(0));
    hook.rerender({ open: true });
    // Opening refreshes at once, then polls.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(mocks.shells).toHaveBeenCalledTimes(2);
    expect(mocks.terminals).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(SHELL_POLL_MS * 3));
    expect(mocks.shells.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.terminals.mock.calls.length).toBeGreaterThanOrEqual(3);
    hook.rerender({ open: false });
    await act(() => vi.advanceTimersByTimeAsync(0));
    const shells = mocks.shells.mock.calls.length;
    const terminals = mocks.terminals.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(TERMINAL_POLL_MS * 5));
    expect(mocks.shells).toHaveBeenCalledTimes(shells);
    expect(mocks.terminals).toHaveBeenCalledTimes(terminals);
    cleanup();
  });

  it("follows shell events while closed", async () => {
    const { client, hook, cleanup } = setup(false);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(hook.result.current.commands).toBe(0);
    mocks.shells.mockResolvedValue([command("a")]);
    const event = {
      type: "shell.created",
      location: { directory: "/repo", workspaceID: "workspace" },
      data: {},
    } as PalotEvent;
    await act(async () => {
      for (const queryKey of openCodeInvalidationKeys("one", event))
        await client.invalidateQueries({ queryKey });
    });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(hook.result.current.commands).toBe(1);
    mocks.shells.mockResolvedValue([]);
    await act(async () => {
      for (const queryKey of openCodeInvalidationKeys("one", {
        ...event,
        type: "shell.exited",
      } as PalotEvent))
        await client.invalidateQueries({ queryKey });
    });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(hook.result.current.commands).toBe(0);
    expect(mocks.shells).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("stops polling a deleted directory", async () => {
    vi.useFakeTimers();
    const missing = {
      _tag: "LocationNotFoundError",
      location: { directory: "/repo" },
      message: "Location not found",
    };
    const { cleanup } = setup(true);
    mocks.shells.mockRejectedValue(missing);
    await act(() => vi.advanceTimersByTimeAsync(SHELL_POLL_MS * 5));
    const calls = mocks.shells.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(2);
    await act(() => vi.advanceTimersByTimeAsync(SHELL_POLL_MS * 5));
    expect(mocks.shells).toHaveBeenCalledTimes(calls);
    cleanup();
  });
});
