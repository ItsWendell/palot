import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent } from "../../../shared";
import { usageSession } from "../../lib/usage-analytics";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import {
  applyUsageTaskEvents,
  loadUsageSessions,
  usageTaskKeys,
  type UsageTasksData,
} from "./use-usage-tasks";

afterEach(resetOpenCodeClientForTest);

const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

function info(id: string, updated: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    projectID: "project",
    cost: 1,
    tokens: zero,
    time: { created: updated, updated },
    location: { directory: "/repo" },
    ...extra,
  } as SessionInfo;
}

describe("loadUsageSessions", () => {
  it("pages newest first until a session predates the range, then fetches missing roots", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [info("a", 900), info("child", 800, { parentID: "old-root", cost: 5 })],
        cursor: { next: "page-2" },
      })
      .mockResolvedValueOnce({
        data: [info("b", 600), info("too-old", 100)],
        cursor: { next: "page-3" },
      });
    const get = vi.fn().mockResolvedValue(info("old-root", 50, { title: "Old root" }));
    setOpenCodeClientForTest({ session: { list, get } } as unknown as OpenCodeClient);

    const result = await loadUsageSessions("connection", { from: 500, project: "project" });

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      1,
      { limit: 100, project: "project", order: "desc" },
      expect.anything(),
    );
    expect(list).toHaveBeenNthCalledWith(
      2,
      { limit: 100, project: "project", cursor: "page-2" },
      expect.anything(),
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(false);
    expect(result.sessions.map((session) => session.id)).toEqual(["a", "child", "b", "old-root"]);
  });
});

describe("applyUsageTaskEvents", () => {
  function usageEvent(sessionID: string, cost: number, createdAt: number) {
    return {
      type: "session.usage.updated",
      createdAt,
      data: { sessionID, cost, tokens: zero },
    } as unknown as PalotEvent;
  }

  it("patches known sessions and adds new ones the reconciler knows, per project", () => {
    const queryClient = new QueryClient();
    const all = usageTaskKeys.list("connection", { from: 500, project: null });
    const other = usageTaskKeys.list("connection", { from: 500, project: "other" });
    queryClient.setQueryData<UsageTasksData>(all, {
      sessions: [usageSession(info("a", 600))],
      truncated: false,
    });
    queryClient.setQueryData<UsageTasksData>(other, { sessions: [], truncated: false });
    const known = new Map([["new", info("new", 700, { parentID: "a" })]]);

    applyUsageTaskEvents(
      queryClient,
      "connection",
      [usageEvent("a", 3, 650), usageEvent("new", 2, 700), usageEvent("unknown", 9, 700)],
      (sessionID) => known.get(sessionID) ?? null,
    );

    const sessions = queryClient.getQueryData<UsageTasksData>(all)?.sessions;
    expect(sessions?.map((session) => [session.id, session.cost, session.updated])).toEqual([
      ["a", 3, 650],
      ["new", 2, 700],
    ]);
    expect(queryClient.getQueryData<UsageTasksData>(other)?.sessions).toEqual([]);
  });
});
