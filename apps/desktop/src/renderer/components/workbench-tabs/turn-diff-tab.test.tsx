import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
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
  scrollTo: vi.fn(),
  openSearch: vi.fn(),
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
  CodeView: ({
    items,
    ref,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    options,
  }: {
    items: Array<{ id: string; type: string; collapsed?: boolean }>;
    ref?: Ref<unknown>;
    renderHeaderPrefix?(item: unknown): ReactNode;
    renderHeaderFilenameSuffix?(item: unknown): ReactNode;
    options?: { searchOptions?: { disableShortcuts?: boolean } };
  }) => {
    useImperativeHandle(ref, () => ({
      scrollTo: mocks.scrollTo,
      openSearch: mocks.openSearch,
      getInstance: () => undefined,
    }));
    const root = useRef<HTMLDivElement>(null);
    const disabled = options?.searchOptions?.disableShortcuts === true;
    useEffect(() => {
      // As @pierre/diffs does: CodeView binds Mod+F and Mod+Alt+F on its root, capturing.
      const element = root.current;
      const onKeyDown = (event: KeyboardEvent) => {
        if (disabled || !event.ctrlKey || event.key !== "f") return;
        event.preventDefault();
        event.stopPropagation();
        mocks.openSearch();
      };
      element?.addEventListener("keydown", onKeyDown, true);
      return () => element?.removeEventListener("keydown", onKeyDown, true);
    }, [disabled]);
    return (
      <div ref={root} role="region" aria-label="Turn diff review" tabIndex={0}>
        {items.map((item) => (
          <span key={item.id} data-testid={`item:${item.id}`} data-collapsed={item.collapsed}>
            {renderHeaderPrefix?.(item)}
            {item.id}: {item.type}
            {renderHeaderFilenameSuffix?.(item)}
          </span>
        ))}
        <input aria-label="Comment" />
      </div>
    );
  },
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

it("steps through changed files with buttons and pane keys, but not while typing", () => {
  Object.assign(mocks.query, { isPending: false });
  mocks.query.data = ["src/a.ts", "src/b.ts", "src/c.ts"].map((file) => ({
    file,
    status: "modified" as const,
    patch: "@@ -1 +1 @@\n-before\n+after",
    additions: 1,
    deletions: 1,
  }));
  render(<TurnDiffTab tab={tab} />);
  const position = () => screen.getByRole("group", { name: "File navigation" }).textContent;
  const previous = screen.getByRole("button", { name: "Previous file" }) as HTMLButtonElement;
  const next = screen.getByRole("button", { name: "Next file" }) as HTMLButtonElement;
  expect(position()).toContain("1 of 3");
  expect(previous.disabled).toBe(true);
  expect(next.getAttribute("aria-keyshortcuts")).toBe("J");

  fireEvent.click(next);
  expect(mocks.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "item", id: "src/b.ts", align: "start" }),
  );
  expect(position()).toContain("2 of 3");

  const review = screen.getByRole("region", { name: "Turn diff review" });
  fireEvent.keyDown(review, { key: "j" });
  expect(mocks.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ id: "src/c.ts" }));
  expect(position()).toContain("3 of 3");
  expect(next.disabled).toBe(true);

  // Typing in a field inside the pane, or using modifiers, never moves between files.
  mocks.scrollTo.mockClear();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), { key: "k" });
  fireEvent.keyDown(review, { key: "k", metaKey: true });
  expect(mocks.scrollTo).not.toHaveBeenCalled();

  fireEvent.keyDown(review, { key: "k" });
  expect(mocks.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ id: "src/b.ts" }));
  expect(position()).toContain("2 of 3");
});

it("scrolls to the requested file once its diff loads, and again on a new request", () => {
  mocks.query.data = ["src/a.ts", "src/b.ts"].map((file) => ({
    file,
    status: "modified" as const,
    patch: "@@ -1 +1 @@\n-before\n+after",
    additions: 1,
    deletions: 1,
  }));
  const at = (request: number): typeof tab => ({
    ...tab,
    resource: { ...tab.resource, file: { path: "src/b.ts", request } },
  });
  const { rerender } = render(<TurnDiffTab tab={at(1)} />);
  expect(mocks.scrollTo).not.toHaveBeenCalled();
  mocks.query.isPending = false;
  rerender(<TurnDiffTab tab={at(1)} />);
  expect(mocks.scrollTo).toHaveBeenCalledOnce();
  expect(mocks.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "item", id: "src/b.ts", align: "start" }),
  );
  expect(screen.getByRole("group", { name: "File navigation" }).textContent).toContain("2 of 2");

  // A refetch with the same request leaves the reader where they are.
  mocks.query.data = [...mocks.query.data];
  rerender(<TurnDiffTab tab={at(1)} />);
  expect(mocks.scrollTo).toHaveBeenCalledOnce();

  rerender(<TurnDiffTab tab={at(2)} />);
  expect(mocks.scrollTo).toHaveBeenCalledTimes(2);
});

it("starts lockfiles and generated files collapsed with a label, and counts them apart", () => {
  Object.assign(mocks.query, { isPending: false });
  mocks.query.data = [
    ["src/a.ts", 4, 1],
    ["bun.lock", 200, 50],
    ["src/routeTree.gen.ts", 30, 30],
  ].map(([file, additions, deletions]) => ({
    file: file as string,
    status: "modified" as const,
    patch: "@@ -1 +1 @@\n-before\n+after",
    additions: additions as number,
    deletions: deletions as number,
  }));
  render(<TurnDiffTab tab={tab} />);
  const item = (id: string) => screen.getByTestId(`item:${id}`);

  expect(item("src/a.ts").dataset.collapsed).toBe("false");
  expect(item("bun.lock").dataset.collapsed).toBe("true");
  expect(item("bun.lock").textContent).toContain("Lockfile");
  expect(item("src/routeTree.gen.ts").textContent).toContain("Generated");
  expect(screen.getByTitle("1 lockfile, 1 generated: +230 −80").parentElement!.textContent).toMatch(
    /1 file\+4-1/,
  );

  fireEvent.click(screen.getByRole("button", { name: "Expand bun.lock" }));
  expect(item("bun.lock").dataset.collapsed).toBe("false");
  expect(screen.getByRole("button", { name: "Collapse bun.lock" })).toBeTruthy();
});

it("opens Find in diff on Mod+F inside the diff, and CodeView's own search on Mod+Alt+F", () => {
  Object.assign(mocks.query, { isPending: false });
  mocks.query.data = [
    {
      file: "src/a.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-before\n+after",
      additions: 1,
      deletions: 1,
    },
  ];
  render(<TurnDiffTab tab={tab} />);
  const review = screen.getByRole("region", { name: "Turn diff review" });
  const findKey = { key: "f", code: "KeyF", ctrlKey: true };
  fireEvent.keyDown(review, findKey);
  // Focused in the commit that shows the bar, so the next key already lands in it.
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Find in diff" }));
  expect(mocks.openSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(review, { ...findKey, altKey: true });
  expect(mocks.openSearch).toHaveBeenCalledOnce();
});
