// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuestLinksServer, type GuestSource } from "./server";
import type { GuestTranscript } from "../../shared/guest-links-contract";

const servers: GuestLinksServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});
function source(title: string) {
  let changed = () => {};
  const snapshot: GuestTranscript = {
    title,
    status: "idle",
    rows: [{ id: "1", role: "assistant", text: `${title} only` }],
  };
  const send = vi.fn(async (_text: string) => {});
  const dispose = vi.fn();
  return {
    send,
    dispose,
    update() {
      changed();
    },
    snapshot,
    adapter: {
      snapshot: async () => snapshot,
      subscribe(callback) {
        changed = callback;
        return dispose;
      },
      send,
    } satisfies GuestSource,
  };
}
async function setup(now?: () => number) {
  const server = new GuestLinksServer(undefined, now);
  servers.push(server);
  await server.enable(true);
  return server;
}
async function submit(url: string, text = "Please explain", name = "Alex") {
  return fetch(`${url}messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
}
async function snapshot(url: string) {
  const response = await fetch(`${url}events`);
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(first.value);
}

describe("guest listener", () => {
  it("starts only with an enabled share, scopes tokens to one task and exposes no other API", async () => {
    const server = new GuestLinksServer();
    servers.push(server);
    await expect(
      server.create({ connectionID: "a", sessionID: "one" }, 1, source("One").adapter),
    ).rejects.toThrow("Enable");
    await server.enable(true);
    const one = await server.create(
      { connectionID: "a", sessionID: "one" },
      1,
      source("One").adapter,
    );
    const two = await server.create(
      { connectionID: "b", sessionID: "two" },
      1,
      source("Two").adapter,
    );
    expect(await snapshot(one.localUrl)).toContain("One only");
    expect(await snapshot(one.localUrl)).not.toContain("Two");
    expect(await snapshot(two.localUrl)).not.toContain("One");
    expect((await fetch(`${one.localUrl}events?sessionID=two`)).status).toBe(404);
    expect((await fetch(new URL("/api/session/two", one.localUrl))).status).toBe(404);
    const unknown = one.localUrl.replace(/\/g\/[^/]+/, `/g/${"z".repeat(32)}`);
    expect((await fetch(unknown)).status).toBe(404);
    await server.revoke(one.id);
    expect((await fetch(one.localUrl)).status).toBe(404);
    expect((await fetch(two.localUrl)).status).toBe(200);
  });

  it("enforces expiry even before its timer and closes all streams on revoke", async () => {
    let now = Date.now();
    const server = await setup(() => now);
    const oneSource = source("One");
    const one = await server.create({ connectionID: "a", sessionID: "one" }, 1, oneSource.adapter);
    const two = await server.create(
      { connectionID: "b", sessionID: "two" },
      null,
      source("Two").adapter,
    );
    const response = await fetch(`${one.localUrl}events`);
    const reader = response.body!.getReader();
    await reader.read();
    now += 3600001;
    expect((await fetch(one.localUrl)).status).toBe(404);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("revoked");
    expect((await reader.read()).done).toBe(true);
    expect(oneSource.dispose).toHaveBeenCalledOnce();
    await server.revoke(two.id);
    await expect(fetch(two.localUrl)).rejects.toThrow();
  });

  it("never sends before owner approval; isolates receipts, dismisses, and prevents double sends", async () => {
    const server = await setup();
    const owner = source("One");
    const one = await server.create({ connectionID: "a", sessionID: "one" }, 24, owner.adapter);
    const two = await server.create(
      { connectionID: "b", sessionID: "two" },
      24,
      source("Two").adapter,
    );
    const result = await submit(one.localUrl);
    expect(result.status).toBe(202);
    const { receipt } = (await result.json()) as { receipt: string };
    expect(owner.send).not.toHaveBeenCalled();
    expect((await fetch(`${one.localUrl}messages`)).status).toBe(405);
    expect((await fetch(`${two.localUrl}messages/${receipt}`)).status).toBe(404);
    const first = server.state().pending[0]!;
    await server.decide(first.id, false);
    expect(owner.send).not.toHaveBeenCalled();
    expect(await (await fetch(`${one.localUrl}messages/${receipt}`)).json()).toEqual({
      status: "dismissed",
    });
    await submit(one.localUrl, "Approved suggestion", "Jamie");
    const second = server.state().pending[0]!;
    await server.decide(second.id, true);
    await expect(server.decide(second.id, true)).rejects.toThrow("no longer pending");
    expect(owner.send).toHaveBeenCalledExactlyOnceWith(
      "Guest message from Jamie (unverified):\n\nApproved suggestion",
      `msg_guest_${second.id.replaceAll("-", "")}`,
    );
    expect(server.state().pending).toEqual([]);
    await submit(one.localUrl);
    await server.enable(false);
    expect(server.state().pending).toEqual([]);
    await expect(fetch(one.localUrl)).rejects.toThrow();
  });

  it("bounds bodies, rejects simple cross-origin mutations, and rate limits submissions and assets", async () => {
    const server = await setup();
    const share = await server.create(
      { connectionID: "a", sessionID: "one" },
      1,
      source("One").adapter,
    );
    expect(
      (await fetch(`${share.localUrl}messages`, { method: "POST", body: "hello" })).status,
    ).toBe(415);
    expect((await submit(share.localUrl, "x".repeat(20000))).status).toBe(413);
    expect((await submit(share.localUrl, "hi", "Fake\nOwner")).status).toBe(400);
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await submit(share.localUrl)).status);
    expect(statuses).toContain(429);
    expect(server.state().pending.length).toBeLessThanOrEqual(10);
    let limited = false;
    for (let i = 0; i < 301; i++) {
      if ((await fetch(`${share.localUrl}page.css`)).status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("feeds refreshed snapshots through SSE and sends strict security headers", async () => {
    const server = await setup();
    const owner = source("One");
    const share = await server.create({ connectionID: "a", sessionID: "one" }, 1, owner.adapter);
    const response = await fetch(`${share.localUrl}events`);
    const reader = response.body!.getReader();
    await reader.read();
    owner.snapshot.rows.push({ id: "2", role: "user", text: "Live update" });
    owner.update();
    const live = new TextDecoder().decode((await reader.read()).value);
    expect(live).toContain("Live update");
    await reader.cancel();
    const page = await fetch(share.localUrl);
    expect(page.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(page.headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });
});
