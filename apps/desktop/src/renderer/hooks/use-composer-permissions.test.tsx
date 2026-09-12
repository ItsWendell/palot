import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { approvalPresetRules } from "../lib/session-permissions";
import { useComposerPermissions } from "./use-composer-permissions";
import { createRendererQueryClient } from "../lib/query-client";
import { cacheSessions, patchSession } from "../lib/session-catalog-query";
import { openCodeReconciler } from "../lib/open-code-reconciler";

vi.mock("../services/palot", () => ({ palot: { setSessionPermissions: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const session: PalotSession = {
  id: "session-permissions",
  parentID: null,
  projectID: "project",
  title: "Permissions",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function setup(draft: boolean) {
  const store = createStore();
  const queryClient = createRendererQueryClient();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: "/test/opencode2",
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const hook = renderHook(({ session, scope }) => useComposerPermissions(session, draft, scope), {
    initialProps: { session, scope: "scope-a" },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    ),
  });
  return { ...hook, store, queryClient };
}

describe("useComposerPermissions", () => {
  it("caches acknowledged rules only on the connection that owned the request", async () => {
    const pending = Promise.withResolvers<void>();
    vi.mocked(palot.setSessionPermissions).mockReturnValue(pending.promise);
    const hook = setup(false);
    cacheSessions(hook.queryClient, "connection", [session]);
    cacheSessions(hook.queryClient, "other", [session]);
    let action!: Promise<void>;
    act(() => {
      action = hook.result.current.select("full");
    });
    act(() =>
      hook.store.set(runtimeAtom, { ...hook.store.get(runtimeAtom)!, connectionID: "other" }),
    );
    await act(async () => {
      pending.resolve();
      await action;
    });
    const reconciler = openCodeReconciler(hook.queryClient);
    expect(reconciler.session("connection", session.id)?.permissions).toEqual(
      approvalPresetRules("full"),
    );
    expect(reconciler.session("other", session.id)?.permissions).toBeUndefined();
  });

  it("does not let an unsequenced ACK overwrite a newer permission event", async () => {
    const pending = Promise.withResolvers<void>();
    vi.mocked(palot.setSessionPermissions).mockReturnValue(pending.promise);
    const hook = setup(false);
    cacheSessions(hook.queryClient, "connection", [session]);
    let action!: Promise<void>;
    act(() => {
      action = hook.result.current.select("full");
    });
    const custom = [{ action: "edit", resource: "*", effect: "deny" as const }];
    patchSession(hook.queryClient, "connection", session.id, (value) => ({
      ...value,
      permissions: custom,
    }));
    await act(async () => {
      pending.resolve();
      await action;
    });
    expect(
      openCodeReconciler(hook.queryClient).session("connection", session.id)?.permissions,
    ).toEqual(custom);
  });

  it("keeps elevated drafts local and resets when leaving and returning to a draft", async () => {
    const hook = setup(true);
    await act(() => hook.result.current.select("full"));
    expect(hook.result.current.draftMode).toBe("full");
    expect(palot.setSessionPermissions).not.toHaveBeenCalled();
    hook.rerender({ session, scope: "scope-b" });
    expect(hook.result.current.mode).toBe("normal");
    hook.rerender({ session, scope: "scope-a" });
    expect(hook.result.current.mode).toBe("normal");
  });

  it("resets elevated draft selection after creation and on connection changes", async () => {
    const hook = setup(true);
    await act(() => hook.result.current.select("full"));
    act(() => hook.result.current.resetDraft());
    expect(hook.result.current.mode).toBe("normal");
    await act(() => hook.result.current.select("full"));
    act(() =>
      hook.store.set(runtimeAtom, { ...hook.store.get(runtimeAtom)!, connectionID: "other" }),
    );
    expect(hook.result.current.mode).toBe("normal");
  });

  it("guards duplicate changes and sends while pending, without optimistic elevation", async () => {
    const pending = Promise.withResolvers<void>();
    vi.mocked(palot.setSessionPermissions).mockReturnValue(pending.promise);
    const hook = setup(false);
    let action!: Promise<void>;
    act(() => {
      action = hook.result.current.select("full");
    });
    expect(hook.result.current.busy).toBe(true);
    expect(hook.result.current.mode).toBe("normal");
    expect(() => hook.result.current.assertReady()).toThrow(/Wait for the permission change/);
    await expect(hook.result.current.select("normal")).rejects.toThrow(/Wait/);
    expect(palot.setSessionPermissions).toHaveBeenCalledExactlyOnceWith(
      {
        sessionID: session.id,
        permissions: approvalPresetRules("full"),
      },
      "connection",
    );
    await act(async () => {
      pending.resolve();
      await action;
    });
    expect(hook.result.current.busy).toBe(false);
    hook.rerender({
      session: { ...session, permissions: approvalPresetRules("full") },
      scope: "scope-a",
    });
    expect(hook.result.current.mode).toBe("full");
    hook.rerender({
      session: { ...session, permissions: [{ action: "edit", resource: "*", effect: "deny" }] },
      scope: "scope-a",
    });
    expect(hook.result.current.mode).toBe("custom");
  });

  it("leaves authoritative permissions unchanged after failure and permits retry", async () => {
    vi.mocked(palot.setSessionPermissions)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(undefined);
    const hook = setup(false);
    await act(async () => {
      await expect(hook.result.current.select("full")).rejects.toThrow("Offline");
    });
    expect(hook.result.current.mode).toBe("normal");
    expect(hook.result.current.busy).toBe(false);
    await act(() => hook.result.current.select("full"));
    expect(palot.setSessionPermissions).toHaveBeenCalledTimes(2);
  });

  it("rejects a callback retained across a connection switch", async () => {
    const hook = setup(false);
    const oldSelect = hook.result.current.select;
    act(() =>
      hook.store.set(runtimeAtom, { ...hook.store.get(runtimeAtom)!, connectionID: "other" }),
    );
    await expect(oldSelect("full")).rejects.toThrow(/server connection changed/);
    expect(palot.setSessionPermissions).not.toHaveBeenCalled();
  });
});
