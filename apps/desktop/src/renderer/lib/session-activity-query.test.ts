import { QueryClient } from "@tanstack/react-query";
import type { SessionInfo, SessionLogOutput } from "@opencode/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent } from "../../shared";
import { openCodeKeys } from "./opencode-query";
import { openCodeInvalidationKeys } from "./opencode-query-events";
import { seedSessionDetails } from "./session-catalog-query";
import {
  applySessionActivityEvents,
  reuseSessionActivityData,
  sessionActivityQueryOptions,
  type SessionActivityData,
  updateSessionActivity,
} from "./session-activity-query";

const mocks = vi.hoisted(() => ({
  getSessionInfo: vi.fn<(sessionID: string, signal?: AbortSignal) => Promise<SessionInfo | null>>(),
  listActiveSessionIDs: vi.fn<() => Promise<string[]>>(),
  loadSessionLog:
    vi.fn<
      (sessionID: string, after?: number, signal?: AbortSignal) => Promise<SessionLogOutput[]>
    >(),
}));

vi.mock("../services/opencode-catalog", () => ({
  getSessionInfo: mocks.getSessionInfo,
  listActiveSessionIDs: mocks.listActiveSessionIDs,
  loadSessionLog: mocks.loadSessionLog,
}));

function event(type: PalotEvent["type"], sessionID: string, createdAt = 1): PalotEvent {
  return {
    id: `${type}-${createdAt}`,
    type,
    created: createdAt,
    createdAt,
    receiveSequence: createdAt,
    data: { sessionID },
  } as PalotEvent;
}

function synced(sessionID: string, seq?: number): SessionLogOutput {
  return { type: "log.synced", aggregateID: sessionID, seq };
}

describe("session activity query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionInfo.mockResolvedValue(null);
    mocks.loadSessionLog.mockResolvedValue([]);
  });

  it("reconciles execution state from one active-ID snapshot", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValueOnce(["session-active"]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, "connection-snapshot"),
    );

    expect(mocks.listActiveSessionIDs).toHaveBeenCalledOnce();
    expect(data.activeIDs).toEqual(new Set(["session-active"]));
    expect(data.execution.get("session-active")).toEqual({
      status: "running",
      startedAt: null,
      completedAt: null,
    });
  });

  it("preserves activity identity when a repeated snapshot has no changes", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue(["session-active"]);
    const options = sessionActivityQueryOptions(queryClient, "connection-stable");

    const first = await queryClient.fetchQuery(options);
    const second = await queryClient.fetchQuery(options);

    expect(second).toBe(first);
    expect(second.activeIDs).toBe(first.activeIDs);
    expect(second.execution).toBe(first.execution);
    expect(second.statuses).toBe(first.statuses);
  });

  it("skips durable reconciliation for an unchanged synchronized snapshot", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue(["session-active"]);
    const options = sessionActivityQueryOptions(queryClient, "connection-fast-snapshot", true);

    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery(options);

    expect(mocks.listActiveSessionIDs).toHaveBeenCalledTimes(2);
    expect(mocks.loadSessionLog).toHaveBeenCalledOnce();
  });

  it("repairs running execution even when the active-ID projection already looks inactive", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-split-projection";
    mocks.listActiveSessionIDs.mockResolvedValueOnce(["session-active"]);
    const options = sessionActivityQueryOptions(queryClient, connectionID, true);
    await queryClient.fetchQuery(options);
    updateSessionActivity(queryClient, connectionID, (current) => ({
      ...current,
      activeIDs: new Set(),
    }));
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);

    const settled = await queryClient.fetchQuery(options);

    expect(settled.execution.get("session-active")?.status).toBe("inactive");
    expect(settled.statuses.get("session-active")).toEqual({ type: "idle" });
  });

  it("uses ordered events and explicit recovery instead of activity polling", () => {
    const queryClient = new QueryClient();
    const options = sessionActivityQueryOptions(queryClient, "connection-polling", true);

    expect(options.refetchInterval).toBe(false);
  });

  it("reuses semantically equivalent activity snapshots at the query boundary", () => {
    const current: SessionActivityData = {
      activeIDs: new Set(["active"]),
      execution: new Map([["active", { status: "running", startedAt: 1, completedAt: null }]]),
      statuses: new Map([["active", { type: "busy" }]]),
    };
    const next: SessionActivityData = {
      activeIDs: new Set(current.activeIDs),
      execution: new Map([["active", { status: "running", startedAt: 1, completedAt: null }]]),
      statuses: new Map([["active", { type: "busy" }]]),
    };

    expect(reuseSessionActivityData(current, next)).toBe(current);
  });

  it("hydrates an active execution start from the durable session log", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValueOnce(["session-active"]);
    mocks.loadSessionLog.mockResolvedValueOnce([
      {
        ...event("session.execution.started", "session-active", 10),
        durable: { aggregateID: "session-active", seq: 4, version: 1 },
      } as SessionLogOutput,
      synced("session-active", 4),
    ]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, "connection-log"),
    );

    expect(data.execution.get("session-active")).toEqual({
      status: "running",
      startedAt: 10,
      completedAt: null,
    });
  });

  it("continues durable hydration from the last session cursor", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue(["session-active"]);
    mocks.loadSessionLog
      .mockResolvedValueOnce([synced("session-active", 7)])
      .mockResolvedValueOnce([synced("session-active", 7)]);

    await queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, "connection-cursor"));
    await queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, "connection-cursor"));

    expect(mocks.loadSessionLog).toHaveBeenNthCalledWith(
      2,
      "session-active",
      7,
      expect.any(AbortSignal),
      "connection-cursor",
    );
  });

  it("hydrates the selected session even when it is no longer active", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);
    mocks.loadSessionLog.mockResolvedValueOnce([
      {
        ...event("session.execution.started", "session-selected", 10),
        durable: { aggregateID: "session-selected", seq: 1, version: 1 },
      } as SessionLogOutput,
      {
        ...event("session.execution.succeeded", "session-selected", 20),
        durable: { aggregateID: "session-selected", seq: 2, version: 1 },
      } as SessionLogOutput,
      synced("session-selected", 2),
    ]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(
        queryClient,
        "connection-selected-log",
        false,
        "session-selected",
      ),
    );

    expect(data.execution.get("session-selected")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 20,
    });
  });

  it("keeps durable unmatched starts active when the active snapshot races behind", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);
    mocks.loadSessionLog.mockResolvedValueOnce([
      {
        ...event("session.execution.started", "session-selected", 10),
        durable: { aggregateID: "session-selected", seq: 1, version: 1 },
      } as SessionLogOutput,
      synced("session-selected", 1),
    ]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, "connection-racing-log", false, "session-selected"),
    );

    expect(data.activeIDs).toEqual(new Set(["session-selected"]));
    expect(data.statuses.get("session-selected")).toEqual({ type: "busy" });
  });

  it("settles an unmatched durable start on the next authoritative snapshot", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue([]);
    mocks.loadSessionLog
      .mockResolvedValueOnce([
        {
          ...event("session.execution.started", "session-selected", 10),
          durable: { aggregateID: "session-selected", seq: 1, version: 1 },
        } as SessionLogOutput,
        synced("session-selected", 1),
      ])
      .mockResolvedValueOnce([synced("session-selected", 1)])
      .mockResolvedValueOnce([
        {
          ...event("session.execution.succeeded", "session-selected", 20),
          durable: { aggregateID: "session-selected", seq: 2, version: 1 },
        } as SessionLogOutput,
        synced("session-selected", 2),
      ]);
    const options = sessionActivityQueryOptions(
      queryClient,
      "connection-durable-lifecycle",
      false,
      "session-selected",
    );

    await queryClient.fetchQuery(options);
    const running = await queryClient.fetchQuery(options);
    const settled = await queryClient.fetchQuery(options);

    expect(running.activeIDs).toEqual(new Set());
    expect(running.execution.get("session-selected")?.status).toBe("inactive");
    expect(settled.activeIDs).toEqual(new Set());
    expect(settled.execution.get("session-selected")?.status).toBe("succeeded");
  });

  it("does not permanently protect a selected session from inactive snapshots", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue([]);
    mocks.loadSessionLog
      .mockResolvedValueOnce([
        {
          ...event("session.execution.started", "session-selected", 10),
          durable: { aggregateID: "session-selected", seq: 1, version: 1 },
        } as SessionLogOutput,
        synced("session-selected", 1),
      ])
      .mockResolvedValue([synced("session-selected", 1)]);
    const options = sessionActivityQueryOptions(
      queryClient,
      "connection-missed-terminal",
      true,
      "session-selected",
    );

    const hydrated = await queryClient.fetchQuery(options);
    const settled = await queryClient.fetchQuery(options);
    const stillSettled = await queryClient.fetchQuery(options);

    expect(hydrated.execution.get("session-selected")?.status).toBe("running");
    expect(settled.execution.get("session-selected")?.status).toBe("inactive");
    expect(settled.activeIDs).toEqual(new Set());
    expect(stillSettled).toBe(settled);
  });

  it("settles a durable start after a final step prompts another active snapshot", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValue([]);
    mocks.loadSessionLog
      .mockResolvedValueOnce([
        {
          ...event("session.execution.started", "session-selected", 10),
          durable: { aggregateID: "session-selected", seq: 1, version: 1 },
        } as SessionLogOutput,
        {
          ...event("session.step.ended", "session-selected", 20),
          data: {
            sessionID: "session-selected",
            assistantMessageID: "assistant",
            finish: "stop",
          },
          durable: { aggregateID: "session-selected", seq: 2, version: 1 },
        } as unknown as SessionLogOutput,
        synced("session-selected", 2),
      ])
      .mockResolvedValueOnce([synced("session-selected", 2)]);

    const options = sessionActivityQueryOptions(
      queryClient,
      "connection-final-step",
      true,
      "session-selected",
    );
    const hydrated = await queryClient.fetchQuery(options);
    const settled = await queryClient.fetchQuery(options);

    expect(hydrated.execution.get("session-selected")?.status).toBe("running");
    expect(settled.activeIDs).toEqual(new Set());
    expect(settled.execution.get("session-selected")?.status).toBe("inactive");
    expect(settled.statuses.get("session-selected")).toEqual({ type: "idle" });
  });

  it("settles live activity from a final step after the status snapshot turns inactive", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-live-final-step";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-selected", 10),
      {
        ...event("session.step.ended", "session-selected", 20),
        data: {
          sessionID: "session-selected",
          assistantMessageID: "assistant",
          finish: "stop",
        },
      } as PalotEvent,
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);

    const settled = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID, true, "session-selected"),
    );

    expect(settled.activeIDs).toEqual(new Set());
    expect(settled.execution.get("session-selected")?.status).toBe("inactive");
    expect(settled.statuses.get("session-selected")).toEqual({ type: "idle" });
  });

  it("does not let stale durable starts overwrite a newer live completion", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-stale-durable-start";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-selected", 10),
      event("session.execution.succeeded", "session-selected", 30),
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);
    mocks.loadSessionLog.mockResolvedValueOnce([
      {
        ...event("session.execution.started", "session-selected", 10),
        durable: { aggregateID: "session-selected", seq: 1, version: 1 },
      } as SessionLogOutput,
      synced("session-selected", 1),
    ]);

    const settled = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID, true, "session-selected"),
    );

    expect(settled.activeIDs).toEqual(new Set());
    expect(settled.execution.get("session-selected")?.status).toBe("succeeded");
    expect(settled.statuses.get("session-selected")).toEqual({ type: "idle" });
  });

  it("accepts a newer durable event that shares the live event timestamp", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-same-timestamp";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-selected", 10),
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);
    mocks.loadSessionLog.mockResolvedValueOnce([
      {
        ...event("session.execution.succeeded", "session-selected", 10),
        durable: { aggregateID: "session-selected", seq: 1, version: 1 },
      } as SessionLogOutput,
      synced("session-selected", 1),
    ]);

    const settled = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID, true, "session-selected"),
    );

    expect(settled.execution.get("session-selected")?.status).toBe("succeeded");
  });

  it("trusts the active snapshot after a tool-call step", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-tool-step";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-selected", 10),
      {
        ...event("session.step.ended", "session-selected", 20),
        data: {
          sessionID: "session-selected",
          assistantMessageID: "assistant",
          finish: "tool-calls",
        },
      } as PalotEvent,
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);

    const running = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID, true, "session-selected"),
    );

    expect(running.activeIDs).toEqual(new Set());
    expect(running.execution.get("session-selected")?.status).toBe("inactive");
    expect(running.statuses.get("session-selected")).toEqual({ type: "idle" });
  });

  it("fetches metadata only for active sessions missing from the catalog", async () => {
    const queryClient = new QueryClient();
    const known = {
      id: "session-known",
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: "/repo" },
    } satisfies SessionInfo;
    const unknown = { ...known, id: "session-unknown" };
    seedSessionDetails(queryClient, "connection-metadata", [known]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([known.id, unknown.id]);
    mocks.getSessionInfo.mockResolvedValueOnce(unknown);

    await queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, "connection-metadata"));

    expect(mocks.getSessionInfo).toHaveBeenCalledOnce();
    expect(mocks.getSessionInfo).toHaveBeenCalledWith(
      unknown.id,
      expect.any(AbortSignal),
      "connection-metadata",
    );
    expect(
      queryClient.getQueryData(openCodeKeys.session("connection-metadata", unknown.id)),
    ).toEqual(unknown);
  });

  it("keeps the authoritative active snapshot when metadata hydration fails", async () => {
    const queryClient = new QueryClient();
    mocks.listActiveSessionIDs.mockResolvedValueOnce(["session-active"]);
    mocks.getSessionInfo.mockRejectedValueOnce(new Error("metadata unavailable"));

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, "connection-metadata-failure"),
    );

    expect(data.activeIDs).toEqual(new Set(["session-active"]));
    expect(data.execution.get("session-active")?.status).toBe("running");
  });

  it("hydrates a missing parent for an already-known active child", async () => {
    const queryClient = new QueryClient();
    const child = {
      id: "session-child",
      parentID: "session-parent",
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 2, updated: 2 },
      location: { directory: "/repo" },
    } satisfies SessionInfo;
    const parent = { ...child, id: child.parentID, parentID: undefined } satisfies SessionInfo;
    seedSessionDetails(queryClient, "connection-parent", [child]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([child.id]);
    mocks.getSessionInfo.mockResolvedValueOnce(parent);

    await queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, "connection-parent"));

    expect(mocks.getSessionInfo).toHaveBeenCalledWith(
      parent.id,
      expect.any(AbortSignal),
      "connection-parent",
    );
    expect(queryClient.getQueryData(openCodeKeys.session("connection-parent", parent.id))).toEqual(
      parent,
    );
  });

  it("does not reinsert metadata that resolves after session deletion", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-deleted";
    const deleted = {
      id: "session-deleted",
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: "/repo" },
    } satisfies SessionInfo;
    let resolveMetadata: (session: SessionInfo) => void = () => undefined;
    mocks.getSessionInfo.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMetadata = resolve;
      }),
    );
    const { hydrateSessionLineage } = await import("./session-activity-query");
    const hydrate = hydrateSessionLineage(queryClient, connectionID, [deleted.id]);
    await vi.waitFor(() => expect(mocks.getSessionInfo).toHaveBeenCalledOnce());
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.deleted", deleted.id, 10),
    ]);
    resolveMetadata(deleted);
    await hydrate;

    expect(
      queryClient.getQueryData(openCodeKeys.session(connectionID, deleted.id)),
    ).toBeUndefined();
  });

  it("retries failed metadata hydration on the next activity snapshot", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-retry-metadata";
    const session = {
      id: "session-terminal",
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: "succeeded" as const,
      time: { created: 1, updated: 10, idle: 10 },
      location: { directory: "/repo" },
    } satisfies SessionInfo;
    const { hydrateSessionLineage } = await import("./session-activity-query");
    mocks.getSessionInfo.mockRejectedValueOnce(new Error("temporary failure"));
    await hydrateSessionLineage(queryClient, connectionID, [session.id]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);
    mocks.getSessionInfo.mockResolvedValueOnce(session);

    await queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, connectionID));

    expect(queryClient.getQueryData(openCodeKeys.session(connectionID, session.id))).toEqual(
      session,
    );
  });

  it("updates execution and runtime status directly from events", () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-events";

    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-1", 10),
    ]);
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.succeeded", "session-1", 20),
    ]);

    const data = queryClient.getQueryData<SessionActivityData>(
      openCodeKeys.sessionActivity(connectionID),
    );
    expect(data?.execution.get("session-1")).toEqual({
      status: "succeeded",
      startedAt: 10,
      completedAt: 20,
    });
    expect(data?.activeIDs).toEqual(new Set());
    expect(data?.statuses.get("session-1")).toEqual({ type: "idle" });
  });

  it("repairs a missed terminal event from the active snapshot", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-repair";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-stale", 10),
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID),
    );

    expect(data.activeIDs).toEqual(new Set());
    expect(data.execution.get("session-stale")?.status).toBe("inactive");
    expect(data.statuses.get("session-stale")).toEqual({ type: "idle" });
  });

  it("replaces stale terminal execution with the authoritative catalog outcome", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-terminal-repair";
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-stale", 10),
      event("session.execution.failed", "session-stale", 20),
    ]);
    seedSessionDetails(queryClient, connectionID, [
      {
        id: "session-stale",
        projectID: "project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        outcome: "succeeded",
        time: { created: 1, updated: 30, idle: 30 },
        location: { directory: "/repo" },
      } satisfies SessionInfo,
    ]);
    mocks.listActiveSessionIDs.mockResolvedValueOnce([]);

    const data = await queryClient.fetchQuery(
      sessionActivityQueryOptions(queryClient, connectionID),
    );

    expect(data.execution.get("session-stale")).toMatchObject({
      status: "succeeded",
      completedAt: 30,
    });
  });

  it("does not route projected activity events through generic invalidation", () => {
    const status = {
      ...event("session.status", "session-1", 10),
      data: { sessionID: "session-1", status: { type: "busy" } },
    } as PalotEvent;
    const terminal = event("session.execution.succeeded", "session-1", 20);

    expect(openCodeInvalidationKeys("connection-routing", status)).not.toContainEqual(
      openCodeKeys.sessionActivity("connection-routing"),
    );
    expect(openCodeInvalidationKeys("connection-routing", terminal)).not.toContainEqual(
      openCodeKeys.sessionActivity("connection-routing"),
    );
  });

  it("preserves an execution event received during snapshot fetch", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection-race";
    let resolveSnapshot: (sessionIDs: string[]) => void = () => undefined;
    mocks.listActiveSessionIDs.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const fetch = queryClient.fetchQuery(sessionActivityQueryOptions(queryClient, connectionID));
    await vi.waitFor(() => expect(mocks.listActiveSessionIDs).toHaveBeenCalled());
    applySessionActivityEvents(queryClient, connectionID, [
      event("session.execution.started", "session-live", 30),
    ]);
    resolveSnapshot([]);

    const data = await fetch;
    expect(data.activeIDs).toEqual(new Set(["session-live"]));
    expect(data.execution.get("session-live")).toEqual({
      status: "running",
      startedAt: 30,
      completedAt: null,
    });
    expect(data.statuses.get("session-live")).toEqual({ type: "busy" });
  });
});
