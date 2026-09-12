import { Provider, createStore } from "jotai";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotMessage, PalotSession } from "../../shared";
import { composerDraftAtomFamily } from "../atoms/ui";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { runtimeAtom } from "../atoms/workspace";
import { composerScope } from "../lib/composer-scope";
import { palot } from "../services/palot";
import { useSessionFork } from "./use-session-fork";

const mocks = vi.hoisted(() => ({ open: vi.fn(), cache: vi.fn() }));
vi.mock("./use-navigation", () => ({ usePalotNavigation: () => ({ openSession: mocks.open }) }));
vi.mock("./use-session-catalog", () => ({ useCacheSession: () => mocks.cache }));
afterEach(() => {
  vi.restoreAllMocks();
  mocks.open.mockReset();
  mocks.cache.mockReset();
});

it("forks before the chosen prompt, restores before navigation, and leaves the source draft alone", async () => {
  const store = createStore();
  const sourceDraft = { text: "Unsent original", mentions: [], command: null };
  store.set(composerDraftAtomFamily(composerScope(null, "session:source")), sourceDraft);
  const fork = vi.spyOn(palot, "forkSession").mockResolvedValue({ id: "forked" } as PalotSession);
  const send = vi.spyOn(palot, "sendComposerPrompt");
  mocks.open.mockImplementation(async () => {
    expect(store.get(composerDraftAtomFamily(composerScope(null, "session:forked"))).text).toBe(
      "Revise this",
    );
    expect(store.get(composerStateAtomFamily(composerScope(null, "session:forked"))).sending).toBe(
      false,
    );
  });
  const { result } = renderHook(() => useSessionFork(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  await act(async () => {
    await result.current({
      sessionID: "source",
      beforeMessageID: "selected",
      restore: { id: "selected", type: "user", text: "Revise this", data: {} } as PalotMessage,
    });
  });
  expect(fork).toHaveBeenCalledWith(
    { sessionID: "source", beforeMessageID: "selected" },
    undefined,
  );
  expect(store.get(composerDraftAtomFamily(composerScope(null, "session:source")))).toEqual(
    sourceDraft,
  );
  expect(mocks.open).toHaveBeenCalledWith("forked", { profileID: undefined });
  expect(send).not.toHaveBeenCalled();
});

it.each(["profile", "connection"])(
  "does not cache, restore, or navigate an old fork after a %s switch",
  async (changed) => {
    const store = createStore();
    const origin = {
      connectionID: "origin-connection",
      profileID: "origin-profile",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected" as const,
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: null,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    };
    store.set(runtimeAtom, origin);
    let finish!: (session: PalotSession) => void;
    vi.spyOn(palot, "forkSession").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useSessionFork(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    let pending!: Promise<PalotSession>;
    act(() => {
      pending = result.current({
        sessionID: "source",
        beforeMessageID: "selected",
        restore: {
          id: "selected",
          type: "user",
          text: "Must not restore",
          data: {},
        } as PalotMessage,
      });
    });
    store.set(runtimeAtom, {
      ...origin,
      ...(changed === "profile"
        ? { profileID: "other-profile" }
        : { connectionID: "other-connection" }),
    });
    await act(async () => {
      finish({ id: "stale-fork" } as PalotSession);
      await expect(pending).rejects.toThrow("connection changed");
    });
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(
      store.get(composerDraftAtomFamily(composerScope("other-profile", "session:stale-fork"))).text,
    ).toBe("");
  },
);

it("forks a background duplicate and restores the draft under its immutable profile", async () => {
  const owner = {
    profileID: "background-profile",
    connectionID: "background-connection",
    connected: true,
    phase: "connected",
  } as OpenCodeRuntimeStatus;
  const store = createStore();
  store.set(runtimeAtom, { ...owner, profileID: "active-profile", connectionID: "active" });
  const pending = Promise.withResolvers<PalotSession>();
  const fork = vi.spyOn(palot, "forkSession").mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionFork(owner), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  let done!: Promise<PalotSession>;
  act(() => {
    done = result.current({
      sessionID: "duplicate",
      beforeMessageID: "prompt",
      restore: { id: "prompt", type: "user", text: "Background prompt", data: {} } as PalotMessage,
    });
  });
  store.set(runtimeAtom, { ...owner, profileID: "changed-profile", connectionID: "changed" });
  await act(async () => {
    pending.resolve({ id: "forked" } as PalotSession);
    await done;
  });
  expect(fork).toHaveBeenCalledWith(
    { sessionID: "duplicate", beforeMessageID: "prompt" },
    owner.connectionID,
  );
  expect(mocks.open).toHaveBeenCalledWith("forked", { profileID: owner.profileID });
  expect(
    store.get(composerDraftAtomFamily(composerScope(owner.profileID, "session:forked"))).text,
  ).toBe("Background prompt");
  expect(
    store.get(composerDraftAtomFamily(composerScope("changed-profile", "session:forked"))).text,
  ).toBe("");
});

it.each([null, { connected: false, phase: "connected" } as OpenCodeRuntimeStatus])(
  "rejects unavailable explicit fork owners without a mutation",
  async (owner) => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      phase: "connected",
      connectionID: "active",
    } as OpenCodeRuntimeStatus);
    const fork = vi.spyOn(palot, "forkSession");
    const { result } = renderHook(() => useSessionFork(owner), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    await expect(result.current({ sessionID: "duplicate" })).rejects.toThrow("unavailable");
    expect(fork).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  },
);
