import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import {
  openCodeClient,
  openCodeFetch,
  registerOpenCodeRuntime,
  resetOpenCodeClientForTest,
  setFocusedOpenCodeRuntime,
} from "./opencode-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("renderer OpenCode client transport", () => {
  it("rejects unknown explicit owners instead of using the focused connection", () => {
    expect(() => openCodeClient("unknown")).toThrow("Unknown OpenCode connection");
  });

  it("binds clients and queued reads to their owner with independent read budgets", async () => {
    const runtime = (connectionID: string) =>
      ({ connectionID, profileID: `profile-${connectionID}` }) as OpenCodeRuntimeStatus;
    setFocusedOpenCodeRuntime(runtime("a"));
    registerOpenCodeRuntime(runtime("b"));
    const a = openCodeClient();
    const b = openCodeClient("b");
    const releases: Array<() => void> = [];
    const openCodeRequest = vi.fn(
      (_request: { connectionID: string; profileID: string; path: string }) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
              body: new TextEncoder().encode(JSON.stringify({ data: [], cursor: {} })).buffer,
            }),
          );
        }),
    );
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { openCodeRequest, cancelOpenCodeRequest: vi.fn() },
    });
    const pending = Array.from({ length: 7 }, () => a.session.list({ parentID: "same-id" }));
    await vi.waitFor(() => expect(openCodeRequest).toHaveBeenCalledTimes(6));
    setFocusedOpenCodeRuntime(runtime("b"));
    pending.push(b.session.list({ parentID: "same-id" }));
    await vi.waitFor(() => expect(openCodeRequest).toHaveBeenCalledTimes(7));
    expect(openCodeRequest.mock.calls[6]?.[0]).toMatchObject({
      connectionID: "b",
      profileID: "profile-b",
    });
    releases[0]!();
    await vi.waitFor(() => expect(openCodeRequest).toHaveBeenCalledTimes(8));
    expect(openCodeRequest.mock.calls[7]?.[0]).toMatchObject({
      connectionID: "a",
      profileID: "profile-a",
    });
    expect(a).toBe(openCodeClient("a"));
    expect(openCodeClient()).toBe(b);
    releases.forEach((release) => release());
    await Promise.all(pending);
  });

  it("runs official server.info and session.list through relative IPC requests", async () => {
    const openCodeRequest = vi.fn(async (request: { path: string }) => {
      const body =
        request.path === "/api/info"
          ? { version: "0.0.0-beta-19507", pid: 42 }
          : { data: [], cursor: {} };
      return {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify(body)).buffer,
      };
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: {
        openCodeRequest,
        cancelOpenCodeRequest: vi.fn(),
      } as unknown as PalotApi,
    });

    await openCodeClient().server.info();
    await openCodeClient().session.list({ limit: 50, parentID: null, order: "desc" });

    expect(openCodeRequest.mock.calls.map(([request]) => request.path)).toEqual([
      "/api/info",
      "/api/session?limit=50&order=desc&parentID=null",
    ]);
  });

  it("forwards AbortSignal cancellation to main", async () => {
    const cancelOpenCodeRequest = vi.fn().mockResolvedValue(undefined);
    const openCodeRequest = vi.fn((_request: { id: string }) => new Promise(() => undefined));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { openCodeRequest, cancelOpenCodeRequest } as unknown as PalotApi,
    });
    const controller = new AbortController();

    const pending = openCodeClient().server.info({ signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(openCodeRequest).toHaveBeenCalledOnce());
    controller.abort();

    await Promise.resolve();
    const requestID = openCodeRequest.mock.calls[0]?.[0].id;
    expect(requestID).toMatch(/^request-[0-9a-f-]+-1$/);
    expect(cancelOpenCodeRequest).toHaveBeenCalledWith(requestID);
    await rejected;
  });

  it("rejects timed out IPC even when main never answers cancellation", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const openCodeRequest = vi.fn(() => new Promise(() => undefined));
    const cancelOpenCodeRequest = vi.fn(() => new Promise<void>(() => undefined));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { openCodeRequest, cancelOpenCodeRequest },
    });
    const pending = openCodeFetch("https://opencode.invalid/api/info");
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(cancelOpenCodeRequest).toHaveBeenCalledOnce();
  });

  it("bounds slow Git reads separately and lets mutations and ordinary reads through", async () => {
    const controller = new AbortController();
    const openCodeRequest = vi.fn(() => new Promise(() => undefined));
    const cancelOpenCodeRequest = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { openCodeRequest, cancelOpenCodeRequest },
    });
    const fetch = (path: string, method = "GET") =>
      openCodeFetch(`https://opencode.invalid${path}`, { method, signal: controller.signal });
    const pending = Promise.allSettled([
      fetch("/api/vcs/status?directory=a"),
      fetch("/api/vcs/status?directory=b"),
      fetch("/api/vcs/status?directory=c"),
      ...Array.from({ length: 7 }, (_, index) => fetch(`/api/session?limit=${index + 1}`)),
      fetch("/api/session", "POST"),
    ]);
    await vi.waitFor(() => expect(openCodeRequest).toHaveBeenCalledTimes(9));
    controller.abort();
    expect((await pending).every((result) => result.status === "rejected")).toBe(true);
    expect(cancelOpenCodeRequest).toHaveBeenCalledTimes(9);
    expect(openCodeRequest).toHaveBeenCalledTimes(9);
  });
});
