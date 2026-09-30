import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FileDiffInfo } from "@opencode/client";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { TurnDiffTab } from "./turn-diff-tab";

const mocks = vi.hoisted(() => ({
  query: {
    available: true,
    isPending: true,
    isError: false,
    isFetching: false,
    error: new Error("diff failed"),
    data: [] as FileDiffInfo[],
    refetch: vi.fn(),
  },
  arguments: [] as unknown[],
}));
vi.mock("../../hooks/use-turn-diffs", () => ({
  useTurnDiffs: (...args: unknown[]) => {
    mocks.arguments = args;
    return mocks.query;
  },
}));
vi.mock("../../atoms/appearance", () => ({ resolvedAppearanceAtom: {} }));
vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => ({ codeThemePair: ["light", "dark"], scheme: "light" }),
}));
vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({ items }: { items: Array<{ id: string; type: string }> }) => (
    <div role="region" aria-label="Turn diff review">
      {items.map((item) => (
        <span key={item.id}>
          {item.id}: {item.type}
        </span>
      ))}
    </div>
  ),
}));

const tab: Extract<WorkbenchTab, { kind: "turn-diff" }> = {
  id: "turn",
  kind: "turn-diff",
  pinned: false,
  resource: {
    profileID: "profile",
    location: { directory: "/repo" },
    sessionID: "session",
    userMessageID: "user-1",
  },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(mocks.query, {
    available: true,
    isPending: true,
    isError: false,
    isFetching: false,
    data: [],
  });
});

it("distinguishes offline, loading, failure, empty and structured file diffs", () => {
  mocks.query.available = false;
  const { rerender } = render(<TurnDiffTab tab={tab} />);
  expect(screen.getByText("Connection unavailable")).toBeTruthy();
  mocks.query.available = true;
  rerender(<TurnDiffTab tab={tab} />);
  expect(screen.getByText("Loading turn changes")).toBeTruthy();
  mocks.query.isPending = false;
  mocks.query.isError = true;
  rerender(<TurnDiffTab tab={tab} />);
  expect(screen.getByText("diff failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mocks.query.refetch).toHaveBeenCalledOnce();
  mocks.query.isError = false;
  rerender(<TurnDiffTab tab={tab} />);
  expect(screen.getByText("No changes in this turn")).toBeTruthy();
  mocks.query.data = [
    {
      file: "src/a.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-before\n+after",
      additions: 1,
      deletions: 1,
    },
  ];
  rerender(<TurnDiffTab tab={tab} />);
  expect(screen.getByText(/src\/a.ts: diff/)).toBeTruthy();
  expect(screen.getByText("+1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh turn changes" }));
  expect(mocks.query.refetch).toHaveBeenCalledTimes(2);
  expect(mocks.arguments).toEqual(["profile", "session", "user-1", true]);
});
