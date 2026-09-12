import type { SessionInfo } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent } from "../../shared";
import { openCodeKeys } from "./opencode-query";
import {
  applyOpenCodeCatalogEvent,
  cacheSession,
  childSessionsQueryOptions,
  reconcileSessionCatalog,
  rootSessionsQueryOptions,
  seedSessionDetails,
  sessionCatalogInfo,
  sessionQueryOptions,
} from "./session-catalog-query";

const mocks = vi.hoisted(() => ({
  getSessionInfo: vi.fn<(sessionID: string) => Promise<SessionInfo | null>>(),
  listChildSessionInfo: vi.fn<(parentID: string) => Promise<SessionInfo[]>>(),
  listProjectInfo: vi.fn().mockResolvedValue([]),
  listRootSessionInfo: vi.fn(),
}));

vi.mock("../services/opencode-catalog", () => ({
  getSessionInfo: mocks.getSessionInfo,
  listChildSessionInfo: mocks.listChildSessionInfo,
  listProjectInfo: mocks.listProjectInfo,
  listRootSessionInfo: mocks.listRootSessionInfo,
}));

function session(id: string, updated: number, parentID?: string): SessionInfo {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated, updated },
    location: { directory: "/repo" },
  };
}

describe("session catalog reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionInfo.mockResolvedValue(null);
    mocks.listProjectInfo.mockResolvedValue([]);
  });

  it("refreshes metadata for known child families", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    const staleChild = { ...session("child", 2, root.id), outcome: "failed" as const };
    const freshChild = {
      ...staleChild,
      outcome: "succeeded" as const,
      time: { ...staleChild.time, updated: 10, idle: 10 },
    };
    mocks.listRootSessionInfo.mockResolvedValue({ data: [root], cursor: {} });
    mocks.listChildSessionInfo
      .mockResolvedValueOnce([staleChild])
      .mockResolvedValueOnce([freshChild]);
    await queryClient.fetchInfiniteQuery(rootSessionsQueryOptions(queryClient, connectionID));
    await queryClient.fetchQuery(childSessionsQueryOptions(queryClient, connectionID, root.id));
    seedSessionDetails(queryClient, connectionID, [root, staleChild]);

    await reconcileSessionCatalog(queryClient, connectionID);

    expect(
      queryClient.getQueryData<SessionInfo>(openCodeKeys.session(connectionID, freshChild.id)),
    ).toMatchObject({ outcome: "succeeded", time: { updated: 10, idle: 10 } });
  });

  it("keeps a valid root that moves beyond the loaded page", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    mocks.listRootSessionInfo
      .mockResolvedValueOnce({ data: [root], cursor: {} })
      .mockResolvedValueOnce({ data: [], cursor: {} });
    mocks.getSessionInfo.mockResolvedValue(root);
    await queryClient.fetchInfiniteQuery(rootSessionsQueryOptions(queryClient, connectionID));
    seedSessionDetails(queryClient, connectionID, [root]);

    await reconcileSessionCatalog(queryClient, connectionID);

    expect(sessionCatalogInfo(queryClient, connectionID).map((value) => value.id)).toContain(
      root.id,
    );
  });

  it("filters deleted children from stale list snapshots", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    const child = session("child", 2, root.id);
    seedSessionDetails(queryClient, connectionID, [root, child]);
    queryClient.setQueryData(openCodeKeys.childSessions(connectionID, root.id), [child]);
    applyOpenCodeCatalogEvent(queryClient, connectionID, {
      id: "deleted",
      type: "session.deleted",
      created: 3,
      createdAt: 3,
      receiveSequence: 1,
      data: { sessionID: child.id },
    } as PalotEvent);
    mocks.listChildSessionInfo.mockResolvedValue([child]);

    const result = await queryClient.fetchQuery(
      childSessionsQueryOptions(queryClient, connectionID, root.id),
    );
    seedSessionDetails(queryClient, connectionID, result);

    expect(result).toEqual([]);
    expect(sessionCatalogInfo(queryClient, connectionID).map((value) => value.id)).toEqual([
      root.id,
    ]);
  });

  it("filters unknown descendants returned after their parent was deleted", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    const unknownChild = session("unknown-child", 2, root.id);
    seedSessionDetails(queryClient, connectionID, [root]);
    applyOpenCodeCatalogEvent(queryClient, connectionID, {
      id: "deleted",
      type: "session.deleted",
      created: 3,
      createdAt: 3,
      receiveSequence: 1,
      data: { sessionID: root.id },
    } as PalotEvent);
    mocks.listChildSessionInfo.mockResolvedValue([unknownChild]);

    const result = await queryClient.fetchQuery(
      childSessionsQueryOptions(queryClient, connectionID, root.id),
    );

    expect(result).toEqual([]);
  });

  it("blocks stale detail and renderer cache writes after deletion", async () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    const child = session("child", 2, root.id);
    seedSessionDetails(queryClient, connectionID, [root, child]);
    applyOpenCodeCatalogEvent(queryClient, connectionID, {
      id: "deleted",
      type: "session.deleted",
      created: 3,
      createdAt: 3,
      receiveSequence: 1,
      data: { sessionID: child.id },
    } as PalotEvent);
    mocks.getSessionInfo.mockResolvedValue(child);

    const detail = await queryClient.fetchQuery(
      sessionQueryOptions(queryClient, connectionID, child.id),
    );
    cacheSession(queryClient, connectionID, {
      id: child.id,
      parentID: root.id,
      projectID: child.projectID,
      title: null,
      agent: null,
      model: null,
      location: child.location,
      createdAt: child.time.created,
      updatedAt: child.time.updated,
      archivedAt: null,
      cost: child.cost,
      tokens: child.tokens,
    });

    expect(detail).toBeNull();
    expect(sessionCatalogInfo(queryClient, connectionID).map((value) => value.id)).toEqual([
      root.id,
    ]);
  });

  it("removes an orphaned nested descendant when its deleted lineage resolves", () => {
    const queryClient = new QueryClient();
    const connectionID = "connection";
    const root = session("root", 1);
    const child = session("child", 2, root.id);
    const grandchild = session("grandchild", 3, child.id);
    seedSessionDetails(queryClient, connectionID, [root]);
    applyOpenCodeCatalogEvent(queryClient, connectionID, {
      id: "deleted",
      type: "session.deleted",
      created: 4,
      createdAt: 4,
      receiveSequence: 1,
      data: { sessionID: root.id },
    } as PalotEvent);

    seedSessionDetails(queryClient, connectionID, [grandchild]);
    seedSessionDetails(queryClient, connectionID, [child]);

    expect(sessionCatalogInfo(queryClient, connectionID)).toEqual([]);
  });
});
