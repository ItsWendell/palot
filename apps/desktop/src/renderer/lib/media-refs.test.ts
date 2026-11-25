import { describe, expect, it, vi } from "vitest";
import { createMediaRefCache, mediaRef, supportsMediaRefs } from "./media-refs";

const ref = (digit: string) => `media:${digit.repeat(64)}`;

function setup(options: { maxEntries?: number; maxBytes?: number } = {}) {
  let created = 0;
  const read = vi.fn(async (_connectionID: string, _hash: string) => new Uint8Array(10));
  const revokeObjectURL = vi.fn();
  const cache = createMediaRefCache({
    read,
    createObjectURL: () => `blob:${++created}`,
    revokeObjectURL,
    ...options,
  });
  return { cache, read, revokeObjectURL };
}

describe("media references", () => {
  it("recognizes only stored-media references", () => {
    expect(mediaRef(ref("a"))).toBe(ref("a"));
    expect(mediaRef("data:image/png;base64,AAAA")).toBeUndefined();
    expect(mediaRef("media:not-a-hash")).toBeUndefined();
    expect(mediaRef(undefined)).toBeUndefined();
  });

  it("opts in from OpenCode 2.2.0 and for unknown versions", () => {
    expect(supportsMediaRefs("2.1.9")).toBe(false);
    expect(supportsMediaRefs("2.2.0")).toBe(true);
    expect(supportsMediaRefs("3.0.0")).toBe(true);
    expect(supportsMediaRefs(null)).toBe(true);
  });

  it("reads a reference once per connection and reuses its URL", async () => {
    const { cache, read } = setup();
    const first = cache.acquire("a", ref("1"), "image/png");
    const second = cache.acquire("a", ref("1"), "image/png");
    expect(await first.url).toBe("blob:1");
    expect(await second.url).toBe("blob:1");
    expect(cache.peek("a", ref("1"))).toBe("blob:1");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("a", "1".repeat(64));

    expect(await cache.acquire("b", ref("1"), "image/png").url).toBe("blob:2");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("revokes the least recently used released URL beyond its budget, never a leased one", async () => {
    const { cache, revokeObjectURL } = setup({ maxEntries: 2 });
    const one = cache.acquire("a", ref("1"), "image/png");
    await one.url;
    const two = cache.acquire("a", ref("2"), "image/png");
    await two.url;
    two.release();
    // `1` is still leased, so the released `2` goes even though it was used more recently.
    await cache.acquire("a", ref("3"), "image/png").url;
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:2");
    expect(cache.peek("a", ref("1"))).toBe("blob:1");
    expect(cache.peek("a", ref("2"))).toBeUndefined();

    one.release();
    await cache.acquire("a", ref("4"), "image/png").url;
    expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:1");
  });

  it("evicts by bytes as well as by count", async () => {
    const { cache, revokeObjectURL } = setup({ maxBytes: 15 });
    const one = cache.acquire("a", ref("1"), "image/png");
    await one.url;
    one.release();
    await cache.acquire("a", ref("2"), "image/png").url;
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:1");
  });

  it("revokes a disposed connection's URLs and fails its reads still in flight", async () => {
    const { cache, read, revokeObjectURL } = setup();
    await cache.acquire("a", ref("1"), "image/png").url;
    await cache.acquire("b", ref("1"), "image/png").url;
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
    read.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = cache.acquire("a", ref("2"), "image/png");

    cache.disposeConnection("a");
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:1");
    expect(cache.peek("a", ref("1"))).toBeUndefined();
    expect(cache.peek("b", ref("1"))).toBe("blob:2");
    finish(new Uint8Array(1));
    await expect(pending.url).rejects.toThrow("The connection was closed");
  });

  it("surfaces a failed read and tries again on the next acquire", async () => {
    const { cache, read } = setup();
    read.mockRejectedValueOnce(new Error("missing"));
    await expect(cache.acquire("a", ref("1"), "image/png").url).rejects.toThrow("missing");
    expect(cache.peek("a", ref("1"))).toBeUndefined();
    expect(await cache.acquire("a", ref("1"), "image/png").url).toBe("blob:1");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
