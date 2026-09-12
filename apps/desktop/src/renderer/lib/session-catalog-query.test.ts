import type { PermissionRuleset, SessionInfo } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PalotEvent } from "../../shared";
import { openCodeKeys } from "./opencode-query";
import { mapSession } from "../services/opencode-mappers";
import {
  applyOpenCodeCatalogEvent,
  cacheSession,
  patchSession,
  rootSessionInfo,
  seedSessionDetails,
  sessionCatalogInfo,
  type RootSessionCatalogData,
} from "./session-catalog-query";

function session(id: string, updated = 1): SessionInfo {
  return {
    id,
    projectID: "project-1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated },
    location: { directory: "/repo" },
  };
}

describe("official session catalog cache", () => {
  it("projects foreign permission updates across detail, root, child and live catalog records", () => {
    const queryClient = new QueryClient();
    const value = session("session-permissions");
    const full: PermissionRuleset = [{ action: "*", resource: "*", effect: "allow" }];
    seedSessionDetails(queryClient, "connection", [value]);
    seedSessionDetails(queryClient, "other", [{ ...value, permissions: full }]);
    queryClient.setQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions("connection"), {
      pages: [{ data: [value], cursor: {} }],
      pageParams: [null],
    });
    queryClient.setQueryData(openCodeKeys.childSessions("connection", "parent"), [value]);
    const rulesets: PermissionRuleset[] = [
      full,
      [],
      [{ action: "shell", resource: "git *", effect: "ask" }],
    ];
    for (const [index, permissions] of rulesets.entries()) {
      applyOpenCodeCatalogEvent(queryClient, "connection", {
        id: `permissions-${index}`,
        type: "session.permissions.updated",
        created: index + 2,
        createdAt: index + 2,
        receiveSequence: index + 1,
        data: { sessionID: value.id, permissions },
      } as PalotEvent);
      expect(
        queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id))
          ?.permissions,
      ).toEqual(permissions);
      expect(
        rootSessionInfo(queryClient.getQueryData(openCodeKeys.rootSessions("connection")))[0]
          ?.permissions,
      ).toEqual(permissions);
      expect(
        queryClient.getQueryData<SessionInfo[]>(
          openCodeKeys.childSessions("connection", "parent"),
        )?.[0]?.permissions,
      ).toEqual(permissions);
      expect(sessionCatalogInfo(queryClient, "connection")[0]?.permissions).toEqual(permissions);
      expect(sessionCatalogInfo(queryClient, "other")[0]?.permissions).toEqual(full);
    }
  });

  it("caches an acknowledged rules mutation and preserves it through a renderer round trip", () => {
    const queryClient = new QueryClient();
    const value = {
      ...session("session-permissions"),
      permissions: [{ action: "*", resource: "*", effect: "allow" as const }],
    };
    seedSessionDetails(queryClient, "connection", [value]);
    cacheSession(queryClient, "connection", { ...mapSession(value), permissions: [] });
    expect(sessionCatalogInfo(queryClient, "connection")[0]?.permissions).toEqual([]);
    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id))
        ?.permissions,
    ).toEqual([]);
    const { permissions: _permissions, ...withoutRules } = mapSession(value);
    cacheSession(queryClient, "connection", withoutRules);
    expect(sessionCatalogInfo(queryClient, "connection")[0]?.permissions).toEqual([]);
  });

  it("flattens pages, deduplicates sessions, and seeds detail entries", () => {
    const queryClient = new QueryClient();
    const newer = session("session-1", 3);
    const data: RootSessionCatalogData = {
      pages: [
        { data: [session("session-1", 1)], cursor: { next: "older" } },
        { data: [newer, session("session-2", 2)], cursor: {} },
      ],
      pageParams: [null, "older"],
    };

    const sessions = rootSessionInfo(data);
    seedSessionDetails(queryClient, "connection", sessions);

    expect(sessions.map((value) => value.id)).toEqual(["session-1", "session-2"]);
    expect(queryClient.getQueryData(openCodeKeys.session("connection", "session-1"))).toBe(newer);
  });

  it("patches viewed state across detail and root page caches", () => {
    const queryClient = new QueryClient();
    const value = session("session-1", 3);
    queryClient.setQueryData(openCodeKeys.session("connection", value.id), value);
    queryClient.setQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions("connection"), {
      pages: [{ data: [value], cursor: {} }],
      pageParams: [null],
    });
    const event = {
      id: "viewed",
      type: "session.viewed",
      created: 4,
      createdAt: 4,
      receiveSequence: 1,
      data: { sessionID: value.id, idle: 3 },
    } as PalotEvent;

    applyOpenCodeCatalogEvent(queryClient, "connection", event);

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id))?.time
        .viewed,
    ).toBe(3);
    expect(
      queryClient.getQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions("connection"))
        ?.pages[0]?.data[0]?.time.viewed,
    ).toBe(3);
  });

  it("inserts created sessions and persists terminal outcomes from events", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<RootSessionCatalogData>(openCodeKeys.rootSessions("connection"), {
      pages: [{ data: [], cursor: {} }],
      pageParams: [null],
    });
    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "created",
      type: "session.created",
      created: 10,
      createdAt: 10,
      receiveSequence: 1,
      data: {
        sessionID: "session-created",
        projectID: "project-1",
        location: { directory: "/repo" },
        slug: "created",
        title: "Created task",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        version: "1",
      },
    } as PalotEvent);
    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "completed",
      type: "session.execution.failed",
      created: 20,
      createdAt: 20,
      receiveSequence: 2,
      data: {
        sessionID: "session-created",
        error: { type: "ProviderError", message: "Failed" },
      },
    } as PalotEvent);

    const detail = queryClient.getQueryData<SessionInfo>(
      openCodeKeys.session("connection", "session-created"),
    );
    expect(detail?.outcome).toBe("failed");
    expect(detail?.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }]);
    expect(detail?.time.idle).toBe(20);
    expect(
      rootSessionInfo(queryClient.getQueryData(openCodeKeys.rootSessions("connection"))),
    ).toHaveLength(1);
  });

  it("projects root, child, and detail caches with detail precedence", () => {
    const queryClient = new QueryClient();
    const root = session("root", 1);
    const child = { ...session("child", 2), parentID: root.id };
    seedSessionDetails(queryClient, "connection", [
      root,
      child,
      { ...root, title: "Fresh detail", time: { ...root.time, updated: 4 } },
    ]);

    expect(sessionCatalogInfo(queryClient, "connection").map((value) => value.id)).toEqual([
      "root",
      "child",
    ]);
    expect(sessionCatalogInfo(queryClient, "connection")[0]?.title).toBe("Fresh detail");
  });

  it("merges renderer mutation results without losing official unread timestamps", () => {
    const queryClient = new QueryClient();
    const value = {
      ...session("session-1", 3),
      time: { created: 1, updated: 3, idle: 8, viewed: 5 },
    };
    queryClient.setQueryData(openCodeKeys.session("connection", value.id), value);

    cacheSession(queryClient, "connection", {
      id: value.id,
      parentID: null,
      projectID: value.projectID,
      title: "Renamed",
      agent: null,
      model: null,
      location: value.location,
      createdAt: value.time.created,
      updatedAt: value.time.updated,
      archivedAt: null,
      cost: 0,
      tokens: value.tokens,
    });
    patchSession(queryClient, "connection", value.id, (current) => ({
      ...current,
      model: { id: "model", providerID: "provider" },
    }));

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id)),
    ).toMatchObject({
      title: "Renamed",
      model: { id: "model", providerID: "provider" },
      time: { idle: 8, viewed: 5 },
    });
  });

  it("does not let an older snapshot overwrite newer event metadata", () => {
    const queryClient = new QueryClient();
    const older = { ...session("session-1", 5), title: "Old title" };
    queryClient.setQueryData(openCodeKeys.session("connection", older.id), {
      ...older,
      title: "New title",
      time: { ...older.time, updated: 10, idle: 10 },
    });

    seedSessionDetails(queryClient, "connection", [older]);

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", older.id)),
    ).toMatchObject({ title: "New title", time: { updated: 10, idle: 10 } });
  });

  it("persists aborted failures as interrupted outcomes", () => {
    const queryClient = new QueryClient();
    const value = session("session-1", 5);
    queryClient.setQueryData(openCodeKeys.session("connection", value.id), value);

    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "aborted",
      type: "session.execution.failed",
      created: 10,
      createdAt: 10,
      receiveSequence: 1,
      data: {
        sessionID: value.id,
        error: { type: "MessageAbortedError", message: "Stopped" },
      },
    } as PalotEvent);

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id))?.outcome,
    ).toBe("interrupted");
  });

  it("clears the previous outcome when a new execution starts", () => {
    const queryClient = new QueryClient();
    const value = { ...session("session-1", 5), outcome: "failed" as const };
    queryClient.setQueryData(openCodeKeys.session("connection", value.id), value);

    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "started",
      type: "session.execution.started",
      created: 10,
      createdAt: 10,
      receiveSequence: 1,
      data: { sessionID: value.id },
    } as PalotEvent);

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session("connection", value.id))?.outcome,
    ).toBeUndefined();
  });

  it("removes cached descendants when a root session is deleted", () => {
    const queryClient = new QueryClient();
    const root = session("root", 3);
    const child = { ...session("child", 2), parentID: root.id };
    const grandchild = { ...session("grandchild", 1), parentID: child.id };
    seedSessionDetails(queryClient, "connection", [root, child, grandchild]);
    queryClient.setQueryData(openCodeKeys.childSessions("connection", root.id), [child]);
    queryClient.setQueryData(openCodeKeys.childSessions("connection", child.id), [grandchild]);

    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "deleted",
      type: "session.deleted",
      created: 4,
      createdAt: 4,
      receiveSequence: 1,
      data: { sessionID: root.id },
    } as PalotEvent);

    expect(sessionCatalogInfo(queryClient, "connection")).toEqual([]);
  });

  it("removes cached descendants when a nested session is deleted", () => {
    const queryClient = new QueryClient();
    const root = session("root", 3);
    const child = { ...session("child", 2), parentID: root.id };
    const grandchild = { ...session("grandchild", 1), parentID: child.id };
    seedSessionDetails(queryClient, "connection", [root, child, grandchild]);
    queryClient.setQueryData(openCodeKeys.childSessions("connection", root.id), [child]);
    queryClient.setQueryData(openCodeKeys.childSessions("connection", child.id), [grandchild]);

    applyOpenCodeCatalogEvent(queryClient, "connection", {
      id: "deleted",
      type: "session.deleted",
      created: 4,
      createdAt: 4,
      receiveSequence: 1,
      data: { sessionID: child.id },
    } as PalotEvent);

    expect(sessionCatalogInfo(queryClient, "connection").map((value) => value.id)).toEqual([
      root.id,
    ]);
  });
});
