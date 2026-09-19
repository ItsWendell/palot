import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import * as clients from "./opencode-client";
import {
  createWorktree,
  listWorktrees,
  refreshWorktrees,
  removeWorktree,
  worktreeRemovalRequiresForce,
} from "./opencode-worktrees";

afterEach(() => {
  resetOpenCodeClientForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("renderer OpenCode worktree service", () => {
  it("creates and resolves a remote worktree on its explicit owner, not the focused server", async () => {
    const create = vi.fn().mockResolvedValue({ directory: "/srv/worktrees/new" });
    const get = vi.fn().mockResolvedValue({});
    const focusedCreate = vi.fn();
    vi.spyOn(clients, "openCodeClient").mockImplementation(
      (connectionID) =>
        (connectionID === "remote-a"
          ? { worktree: { create }, location: { get } }
          : { worktree: { create: focusedCreate } }) as unknown as OpenCodeClient,
    );
    await expect(createWorktree("/srv/repo", "feature", undefined, "remote-a")).resolves.toEqual({
      directory: "/srv/worktrees/new",
    });
    expect(create).toHaveBeenCalledWith(
      { projectID: "/srv/repo", branch: "feature" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(get).toHaveBeenCalledWith(
      { location: { directory: "/srv/worktrees/new" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(focusedCreate).not.toHaveBeenCalled();
  });

  it("uses the official worktree resource for every operation", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue([{ directory: "/worktree", strategy: "git" }]);
    const create = vi.fn().mockResolvedValue({ directory: "/worktree/new" });
    const remove = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({});
    setOpenCodeClientForTest({
      worktree: { refresh, list, create, remove },
      location: { get },
    } as unknown as OpenCodeClient);

    await refreshWorktrees("/repo/source");
    await expect(listWorktrees("/repo/source")).resolves.toEqual([
      { directory: "/worktree", strategy: "git" },
    ]);
    await expect(createWorktree("/repo/source")).resolves.toEqual({
      directory: "/worktree/new",
    });
    await removeWorktree("/repo/source", "/worktree/new");
    await removeWorktree("/repo/source", "/worktree/dirty", true);

    expect(refresh).toHaveBeenCalledWith(
      { projectID: "/repo/source" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(list).toHaveBeenCalledWith(
      { projectID: "/repo/source" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(create).toHaveBeenCalledWith(
      { projectID: "/repo/source" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await createWorktree("/repo/source", "release");
    expect(create).toHaveBeenLastCalledWith(
      {
        projectID: "/repo/source",
        branch: "release",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(remove).toHaveBeenCalledWith(
      { projectID: "/repo/source", directory: "/worktree/new", force: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(remove).toHaveBeenCalledWith(
      { projectID: "/repo/source", directory: "/worktree/dirty", force: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("recognizes force-required worktree errors through client cause wrappers", () => {
    expect(
      worktreeRemovalRequiresForce({
        cause: { name: "WorktreeError", data: { message: "dirty", forceRequired: true } },
      }),
    ).toBe(true);
    expect(worktreeRemovalRequiresForce(new Error("unrelated"))).toBe(false);
  });

  it("preserves root entries and custom strategies without inventing management ownership", async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        { directory: "/repo" },
        { directory: "/custom/worktree", strategy: "plugin-strategy" },
      ]);
    setOpenCodeClientForTest({ worktree: { list } } as unknown as OpenCodeClient);
    await expect(listWorktrees("/repo")).resolves.toEqual([
      { directory: "/repo", strategy: null },
      { directory: "/custom/worktree", strategy: "plugin-strategy" },
    ]);
  });

  it("propagates operation failures without losing force-required data", async () => {
    const error = { cause: { data: { forceRequired: true } } };
    const remove = vi.fn().mockRejectedValue(error);
    const create = vi.fn().mockRejectedValue(error);
    const get = vi.fn();
    setOpenCodeClientForTest({
      worktree: { remove, create },
      location: { get },
    } as unknown as OpenCodeClient);
    await expect(removeWorktree("/repo", "/worktree")).rejects.toBe(error);
    await expect(createWorktree("/repo")).rejects.toBe(error);
    expect(get).not.toHaveBeenCalled();
  });

  it("allows long worktree setup while reads still time out promptly", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    let setupSignal: AbortSignal | undefined;
    let readSignal: AbortSignal | undefined;
    let completeSetup!: (value: { directory: string }) => void;
    setOpenCodeClientForTest({
      worktree: {
        create: (_input: unknown, options?: { signal?: AbortSignal }) => {
          setupSignal = options?.signal;
          return new Promise((resolve) => {
            completeSetup = resolve;
          });
        },
        list: (_input: unknown, options?: { signal?: AbortSignal }) => {
          readSignal = options?.signal;
          return Promise.resolve([]);
        },
      },
      location: { get: vi.fn().mockResolvedValue({}) },
    } as unknown as OpenCodeClient);

    const creation = createWorktree("/repo");
    await listWorktrees("/repo");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readSignal?.aborted).toBe(true);
    expect(setupSignal?.aborted).toBe(false);
    completeSetup({ directory: "/repo-copy" });
    await expect(creation).resolves.toEqual({ directory: "/repo-copy" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(setupSignal?.aborted).toBe(true);
  });

  it("keeps caller cancellation during worktree setup", async () => {
    const controller = new AbortController();
    const location = vi.fn();
    setOpenCodeClientForTest({
      worktree: {
        create: (_input: unknown, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const signal = options?.signal;
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
      location: { get: location },
    } as unknown as OpenCodeClient);
    const creation = createWorktree("/repo", undefined, controller.signal);
    controller.abort(new Error("Cancelled setup"));
    await expect(creation).rejects.toThrow("Cancelled setup");
    expect(location).not.toHaveBeenCalled();
  });
});
