import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, SessionTriageSnapshot } from "../../shared";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { runtimeAtom } from "../atoms/workspace";
import { installSourceControl, pullRequestLink } from "../components/pull-requests/test-fixtures";
import { toast } from "../components/ui/toast";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { seedCatalog } from "../test-utils/render-with-router";
import { useInboxController } from "./use-inbox-controller";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "palot");
});

describe("useInboxController", () => {
  it("reloads triage and announces the task when a merged pull request settles it", async () => {
    const settled: SessionTriageSnapshot = {
      profileID: "profile",
      bootstrapThrough: { updatedAt: 1, sessionID: "task-1" },
      sessions: [],
    };
    const load = vi.spyOn(palot, "loadSessionTriage").mockResolvedValue(settled);
    const add = vi.spyOn(toast, "add").mockReturnValue("toast");
    const { emit } = installSourceControl({
      listPullRequestLinks: vi.fn(async () => ({
        ok: true as const,
        value: [pullRequestLink("task-1", 42, { settledAt: 5, pullRequest: { state: "merged" } })],
      })),
    });
    const store = createStore();
    store.set(runtimeAtom, {
      profileID: "profile",
      connectionID: "connection",
      connected: false,
    } as OpenCodeRuntimeStatus);
    const queryClient = createRendererQueryClient();
    seedCatalog(
      queryClient,
      {
        sessions: [
          {
            id: "task-1",
            parentID: null,
            projectID: "project",
            title: "Fix login",
            agent: null,
            model: null,
            location: { directory: "/repo" },
            createdAt: 1,
            updatedAt: 1,
            archivedAt: null,
            cost: null,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ],
      },
      "connection",
    );
    renderHook(() => useInboxController(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </Provider>
      ),
    });

    act(() =>
      emit({
        type: "pull-requests",
        profileID: "profile",
        sessionIDs: ["task-1"],
        reason: "synced",
      }),
    );
    expect(load).not.toHaveBeenCalled();

    act(() =>
      emit({
        type: "pull-requests",
        profileID: "profile",
        sessionIDs: ["task-1"],
        reason: "settled",
      }),
    );
    await waitFor(() => expect(store.get(sessionTriageSnapshotAtom)).toBe(settled));
    expect(load).toHaveBeenCalledWith("profile");
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        type: "info",
        title: "Settled Fix login after #42 merged",
      }),
    );
  });
});
