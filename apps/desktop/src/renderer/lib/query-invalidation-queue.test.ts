import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryInvalidationQueue } from "./query-invalidation-queue";

describe("query invalidation queue", () => {
  afterEach(() => vi.useRealTimers());

  it("absorbs overlapping MCP/catalog prefixes across batches", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const fetch = vi.fn().mockResolvedValue("fresh");
    const key = ["connection", "settings", "/project"];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: fetch,
      initialData: "old",
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const queue = createQueryInvalidationQueue(client);
    queue.invalidate(key);
    await vi.advanceTimersByTimeAsync(75);
    queue.invalidate(["connection", "settings"]);
    queue.invalidate(key);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(75);
    expect(fetch).toHaveBeenCalledOnce();
    expect(client.getQueryData(key)).toBe("fresh");
    queue.dispose();
    unsubscribe();
    client.clear();
  });

  it("refreshes unrelated keys independently while serializing same-key follow-ups", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    let finish!: (value: string) => void;
    const first = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue("latest");
    const second = vi.fn().mockResolvedValue("second");
    const unsubscribes = [first, second].map((queryFn, index) =>
      new QueryObserver(client, {
        queryKey: ["connection", index],
        queryFn,
        initialData: "old",
        staleTime: Infinity,
      }).subscribe(() => {}),
    );
    const queue = createQueryInvalidationQueue(client);
    queue.invalidate(["connection"]);
    await vi.advanceTimersByTimeAsync(150);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    queue.invalidate(["connection", 0]);
    queue.invalidate(["connection", 0]);
    queue.invalidate(["connection", 1]);
    await vi.advanceTimersByTimeAsync(150);
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledOnce();
    finish("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(150);
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["connection", 0])).toBe("latest");
    queue.dispose();
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });

  it("discards a pending follow-up when disposed during an active read", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    let finish!: (value: string) => void;
    const fetch = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const unsubscribe = new QueryObserver(client, {
      queryKey: ["connection"],
      queryFn: fetch,
      initialData: "old",
      staleTime: Infinity,
    }).subscribe(() => {});
    const queue = createQueryInvalidationQueue(client);
    queue.invalidate(["connection"]);
    await vi.advanceTimersByTimeAsync(150);
    queue.invalidate(["connection"]);
    queue.dispose();
    finish("fresh");
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).toHaveBeenCalledOnce();
    expect(client.getQueryData(["connection"])).toBe("fresh");
    unsubscribe();
    client.clear();
  });

  it("cancels queued work on disposal and leaves inactive caches stale", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    client.setQueryData(["connection", "inactive"], "old");
    const queue = createQueryInvalidationQueue(client);
    queue.invalidate(["connection"]);
    await vi.advanceTimersByTimeAsync(150);
    expect(client.getQueryState(["connection", "inactive"])?.isInvalidated).toBe(true);
    client.setQueryData(["connection", "inactive"], "new");
    queue.invalidate(["connection"]);
    queue.dispose();
    await vi.advanceTimersByTimeAsync(150);
    expect(client.getQueryState(["connection", "inactive"])?.isInvalidated).toBe(false);
    client.clear();
  });
});
