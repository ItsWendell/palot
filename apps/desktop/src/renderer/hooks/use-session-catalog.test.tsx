import type { Project, SessionInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import {
  cacheRootSessions,
  patchSession,
  projectInfoFromPalot,
  seedSessionDetails,
  sessionCatalogInfo,
  sessionInfoFromPalot,
} from "../lib/session-catalog-query";
import { openCodeKeys } from "../lib/opencode-query";
import type { SessionActivityData } from "../lib/session-activity-query";
import {
  useChildSessions,
  useProjectCatalog,
  useRootSessionPagination,
  useSessionCatalog,
  useSessionCatalogSelector,
} from "./use-session-catalog";

const mocks = vi.hoisted(() => ({
  listChildSessionInfo: vi.fn(),
  listProjectInfo: vi.fn(),
  listRootSessionInfo: vi.fn(),
}));

vi.mock("../services/opencode-catalog", () => ({
  getSessionInfo: vi.fn(),
  listChildSessionInfo: mocks.listChildSessionInfo,
  listProjectInfo: mocks.listProjectInfo,
  listRootSessionInfo: mocks.listRootSessionInfo,
}));

vi.mock("../services/palot", () => ({
  palot: { isPreview: () => false },
}));

function session(id: string, parentID: string | null = null): PalotSession {
  return {
    id,
    parentID,
    projectID: "project",
    title: id,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 2,
    archivedAt: null,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function setup() {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: null,
    error: null,
    versionMismatch: null,
  });
  const queryClient = createRendererQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const selectSelectedLocation = (sessions: PalotSession[]) =>
  sessions.find((candidate) => candidate.id === "selected")?.location ?? null;
const sameLocation = (
  left: PalotSession["location"] | null,
  right: PalotSession["location"] | null,
) => left?.directory === right?.directory && left?.workspaceID === right?.workspaceID;

describe("Query session catalog hooks", () => {
  beforeEach(() => {
    mocks.listChildSessionInfo.mockReset();
    mocks.listProjectInfo.mockReset();
    mocks.listRootSessionInfo.mockReset();
  });

  it("loads the next root page without scanning its descendants", async () => {
    const root = session("root");
    const older = session("older");
    const { queryClient, wrapper } = setup();
    cacheRootSessions(queryClient, "connection", [root], { next: "cursor-2" });
    mocks.listRootSessionInfo.mockResolvedValue({
      data: [sessionInfoFromPalot(older)],
      cursor: {},
    });
    const result = renderHook(() => useRootSessionPagination(), { wrapper });

    await act(() => result.result.current.loadMore());

    expect(mocks.listRootSessionInfo).toHaveBeenCalledWith(
      { limit: 50, cursor: "cursor-2" },
      expect.any(AbortSignal),
      "connection",
    );
    expect(sessionCatalogInfo(queryClient, "connection").map((value) => value.id)).toEqual([
      "older",
      "root",
    ]);
    expect(queryClient.getQueriesData({ queryKey: openCodeKeys.requests("connection") })).toEqual(
      [],
    );
  });

  it("loads projects when the catalog cache is absent", async () => {
    const officialProject: Project = projectInfoFromPalot({
      id: "project",
      canonical: "/repo",
      name: "Repo",
      sandboxes: [],
      vcs: null,
      updatedAt: 2,
    });
    mocks.listProjectInfo.mockResolvedValue([officialProject]);
    const { wrapper } = setup();

    const result = renderHook(() => useProjectCatalog(), { wrapper });

    await waitFor(() =>
      expect(result.result.current.map((value) => value.id)).toEqual(["project"]),
    );
    expect(mocks.listProjectInfo).toHaveBeenCalledOnce();
  });

  it("hydrates child sessions into both the child list and detail caches", async () => {
    const child = session("child", "parent");
    const childInfo: SessionInfo = sessionInfoFromPalot(child);
    const { queryClient, wrapper } = setup();
    mocks.listChildSessionInfo.mockResolvedValue([childInfo]);

    const result = renderHook(() => useChildSessions("parent"), { wrapper });

    await waitFor(() => expect(result.result.current.map((value) => value.id)).toEqual([child.id]));
    expect(sessionCatalogInfo(queryClient, "connection")).toContainEqual(childInfo);
  });

  it("ignores activity query updates", () => {
    const { queryClient, wrapper } = setup();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useSessionCatalog();
      },
      { wrapper },
    );
    const baseline = renders;

    act(() => {
      queryClient.setQueryData<SessionActivityData>(openCodeKeys.sessionActivity("connection"), {
        activeIDs: new Set(["active"]),
        execution: new Map(),
        statuses: new Map(),
      });
    });

    expect(renders).toBe(baseline);
  });

  it("does not rerender when a selected catalog projection is unchanged", () => {
    const { queryClient, wrapper } = setup();
    const original = sessionInfoFromPalot(session("selected"));
    seedSessionDetails(queryClient, "connection", [original]);
    let renders = 0;
    const result = renderHook(
      () => {
        renders += 1;
        return useSessionCatalogSelector(selectSelectedLocation, sameLocation);
      },
      { wrapper },
    );
    const baseline = renders;

    act(() => {
      patchSession(queryClient, "connection", original.id, (current) => ({
        ...current,
        time: { ...current.time, updated: current.time.updated + 1 },
      }));
    });
    expect(renders).toBe(baseline);

    act(() => {
      patchSession(queryClient, "connection", original.id, (current) => ({
        ...current,
        location: { directory: "/other" },
      }));
    });
    expect(result.result.current?.directory).toBe("/other");
    expect(renders).toBeGreaterThan(baseline);
  });
});
