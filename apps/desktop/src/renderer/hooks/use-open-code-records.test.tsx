import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  OpenCodeProjectRecord,
  OpenCodeSessionRuntimeRecord,
} from "../lib/open-code-data-graph";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createRendererQueryClient } from "../lib/query-client";
import { useOpenCodeRecords } from "./use-open-code-records";

describe("useOpenCodeRecords", () => {
  it("isolates record kinds, connections, and sessions while observing live updates", async () => {
    const queryClient = createRendererQueryClient();
    const graph = openCodeReconciler(queryClient).graph;
    const runtime: OpenCodeSessionRuntimeRecord = {
      connectionID: "connection",
      kind: "session-runtime",
      entityID: "session-one",
      sessionID: "session-one",
      value: { active: true, execution: null, status: { type: "busy" } },
    };
    const project: OpenCodeProjectRecord = {
      connectionID: "connection",
      kind: "project",
      entityID: "project",
      sessionID: null,
      value: {
        id: "project",
        canonical: "/repo",
        sandboxes: [],
        time: { created: 1, updated: 1 },
      },
    };
    graph.commit((writer) => {
      writer.upsert(runtime);
      writer.upsert({ ...runtime, entityID: "session-two", sessionID: "session-two" });
      writer.upsert({ ...runtime, connectionID: "other-connection" });
      writer.upsert(project);
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const initialProps: { sessionID: string | null | undefined } = { sessionID: undefined };
    const { result, rerender, unmount } = renderHook(
      ({ sessionID }: { sessionID: string | null | undefined }) => ({
        runtime: useOpenCodeRecords("connection", "session-runtime", sessionID),
        projects: useOpenCodeRecords("connection", "project", null),
      }),
      { wrapper, initialProps },
    );

    await waitFor(() => expect(result.current.runtime).toHaveLength(2));
    expect(result.current.runtime.map((record) => record.sessionID).sort()).toEqual([
      "session-one",
      "session-two",
    ]);
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0]?.value.canonical).toBe("/repo");

    const previous = result.current.runtime;
    rerender({ sessionID: undefined });
    expect(result.current.runtime).toBe(previous);

    rerender({ sessionID: "session-one" });
    await waitFor(() => expect(result.current.runtime).toHaveLength(1));
    expect(result.current.runtime[0]?.sessionID).toBe("session-one");
    expect(result.current.runtime[0]?.value.active).toBe(true);

    act(() => {
      graph.commit((writer) =>
        writer.upsert({
          ...runtime,
          value: { active: false, execution: null, status: { type: "idle" } },
        }),
      );
    });
    await waitFor(() => expect(result.current.runtime[0]?.value.active).toBe(false));

    rerender({ sessionID: null });
    await waitFor(() => expect(result.current.runtime).toEqual([]));
    expect(result.current.projects[0]?.sessionID).toBeNull();
    unmount();
    queryClient.clear();
  });
});
