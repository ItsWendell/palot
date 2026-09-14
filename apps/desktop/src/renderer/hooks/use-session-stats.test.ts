import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import type { SessionStatsInfo } from "@opencode/client";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { openCodeKeys } from "../lib/opencode-query";
import {
  SESSION_STATS_GC_TIME,
  SESSION_STATS_STALE_TIME,
  sessionStatsQueryOptions,
} from "./use-session-stats";

const input = {
  from: 10,
  to: 20,
  timezone: "Europe/Amsterdam",
  tools: "summary" as const,
  project: "project-1",
};

afterEach(() => vi.restoreAllMocks());

describe("session stats query", () => {
  it("retains same-server range placeholders but hides another server's usage during a delayed fetch", async () => {
    const client = createRendererQueryClient();
    const original = stats(10);
    client.setQueryData(sessionStatsQueryOptions("a", input).queryKey, original);
    const resolve = new Map<string, (value: SessionStatsInfo) => void>();
    const load = vi.spyOn(palot, "sessionStats").mockImplementation(
      (_input, _signal, connectionID) =>
        new Promise((done) => {
          resolve.set(connectionID!, done);
        }),
    );
    const observer = new QueryObserver(client, sessionStatsQueryOptions("a", input));
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(observer.getCurrentResult().data).toEqual(original);
      observer.setOptions(sessionStatsQueryOptions("a", { ...input, from: 5 }));
      expect(observer.getCurrentResult().data).toEqual(original);
      expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
      observer.setOptions(sessionStatsQueryOptions("b", input));
      expect(observer.getCurrentResult().data).toBeUndefined();
      expect(load.mock.calls.map((call) => call[2])).toEqual(["a", "b"]);
      resolve.get("a")!(stats(20));
      resolve.get("b")!(stats(30));
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.cost).toBe(30));
      expect(client.getQueryData(sessionStatsQueryOptions("a", input).queryKey)).toEqual(original);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
  it("uses a stable scoped key and heavy stale-while-revalidate settings", () => {
    const options = sessionStatsQueryOptions("connection-1", input);

    expect(options.queryKey).toEqual(openCodeKeys.sessionStats("connection-1", input));
    expect(options.staleTime).toBe(SESSION_STATS_STALE_TIME);
    expect(options.gcTime).toBe(SESSION_STATS_GC_TIME);
    expect(options.refetchOnMount).toBe(true);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    expect(options.retry).toBe(false);
  });

  it("keys every aggregate input without object identity", () => {
    expect(openCodeKeys.sessionStats("connection-1", { ...input })).toEqual(
      openCodeKeys.sessionStats("connection-1", input),
    );
    expect(
      openCodeKeys.sessionStats("connection-1", { ...input, project: "project-2" }),
    ).not.toEqual(openCodeKeys.sessionStats("connection-1", input));
    expect(openCodeKeys.sessionStats("connection-1", { ...input, tools: "detail" })).not.toEqual(
      openCodeKeys.sessionStats("connection-1", input),
    );
    expect(openCodeKeys.sessionStats("connection-1", { ...input, from: 11 })).not.toEqual(
      openCodeKeys.sessionStats("connection-1", input),
    );
  });
});

function stats(cost: number): SessionStatsInfo {
  return {
    range: { from: 10, to: 20 },
    sessions: 1,
    subagents: 0,
    prompts: 1,
    steps: 1,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost,
    tools: { mode: "none" },
    activeDays: 1,
    streak: 1,
    activity: [],
    models: [],
  };
}
