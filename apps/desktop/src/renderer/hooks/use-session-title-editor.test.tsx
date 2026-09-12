import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PalotSession } from "../../shared";
import { useSessionTitleEditor } from "./use-session-title-editor";

function session(title: string): PalotSession {
  return {
    id: "session",
    parentID: null,
    projectID: "project",
    title,
    agent: null,
    model: null,
    location: { directory: "/project" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

describe("useSessionTitleEditor", () => {
  it("uses the session title outside editing and preserves the active draft", () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const result = renderHook(({ value }) => useSessionTitleEditor(value), {
      wrapper,
      initialProps: { value: session("Initial") },
    });

    result.rerender({ value: session("Updated") });
    expect(result.result.current.draft).toBe("Updated");

    act(() => {
      result.result.current.start();
      result.result.current.setDraft("Local draft");
    });
    result.rerender({ value: session("Remote update") });
    expect(result.result.current.draft).toBe("Local draft");

    act(() => result.result.current.cancel());
    expect(result.result.current.draft).toBe("Remote update");
  });
});
