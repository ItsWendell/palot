import { describe, expect, it } from "vitest";
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

describe("session stats query", () => {
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
