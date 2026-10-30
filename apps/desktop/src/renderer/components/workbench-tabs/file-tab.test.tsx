import type { FileContents } from "@pierre/diffs";
import type { FileProps } from "@pierre/diffs/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { workbenchFileEditsAtom } from "../../atoms/workbench-file-edits";
import { openCodeKeys } from "../../lib/opencode-query";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { FileTab } from "./file-tab";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerScope } from "../../lib/composer-scope";
import { formatReviewComment } from "../../lib/review-comments";

const mocks = vi.hoisted(() => ({
  file: vi.fn(
    (
      _props: Pick<
        FileProps<undefined, undefined>,
        "file" | "edit" | "options" | "lineAnnotations" | "renderAnnotation"
      > & { onEditChange?: (event: { file: FileContents }) => void },
    ) => null as ReactNode,
  ),
  query: { data: new TextEncoder().encode("const value = 1;\n"), isPending: false },
  read: vi.fn(async () => new TextEncoder().encode("const value = 1;\n")),
  write: vi.fn(async () => {}),
  client: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({
  File: mocks.file,
  EditProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../services/opencode-client", () => ({ openCodeClient: mocks.client }));
vi.mock("../../hooks/use-file-watch", () => ({ useFileWatch: vi.fn() }));
vi.mock("../../hooks/use-browser-session", () => ({ useBrowserSession: () => null }));
vi.mock("../../atoms/workspace", async () => ({
  runtimeAtom: (await import("jotai")).atom(null),
}));
vi.mock("../../hooks/use-workspace-file", () => ({ useWorkspaceFile: () => mocks.query }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.query.data = new TextEncoder().encode("const value = 1;\n");
  mocks.read.mockResolvedValue(mocks.query.data);
  mocks.write.mockResolvedValue();
  mocks.client.mockReturnValue({
    file: { read: mocks.read },
    experimental: { file: { write: mocks.write } },
  });
  mocks.file.mockImplementation(({ file, edit, onEditChange }) => (
    <textarea
      aria-label="File contents"
      defaultValue={file.contents}
      readOnly={!edit}
      onChange={(event) => onEditChange?.({ file: { ...file, contents: event.target.value } })}
    />
  ));
});

function renderTab(tab: Extract<WorkbenchTab, { kind: "file" }>, own = false, sessionID?: string) {
  const store = createStore();
  const queryClient = new QueryClient();
  if (own)
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: tab.resource.profileID,
    } as OpenCodeRuntimeStatus);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return {
    ...render(
      <FileTab
        tab={tab}
        scope={sessionID ? { profileID: tab.resource.profileID, sessionID } : undefined}
      />,
      { wrapper },
    ),
    store,
    queryClient,
  };
}

it("selects a referenced line range", () => {
  const tab: Extract<WorkbenchTab, { kind: "file" }> = {
    id: "file-tab",
    pinned: false,
    kind: "file",
    resource: {
      profileID: "profile-1",
      location: { directory: "/repo" },
      path: "src/a.ts",
      line: 3,
      endLine: 7,
    },
  };
  renderTab(tab);
  expect(mocks.file.mock.lastCall![0]).toMatchObject({ selectedLines: { start: 3, end: 7 } });
});

it("toggles Markdown checkboxes into the existing unsaved draft, never directly to disk", async () => {
  mocks.query.data = new TextEncoder().encode("- [ ] first\n- [x] done\n");
  const tab = {
    id: "markdown-task",
    kind: "file",
    pinned: false,
    resource: { profileID: "profile-1", location: { directory: "/repo" }, path: "tasks.md" },
  } as const;
  const { store } = renderTab(tab, true);
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  expect(store.get(workbenchFileEditsAtom).get(tab.id)?.getSnapshot()).toMatchObject({
    dirty: true,
    contents: "- [x] first\n- [x] done\n",
  });
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  expect(store.get(workbenchFileEditsAtom).get(tab.id)?.getSnapshot().dirty).toBe(false);
});

it("keeps another connection's Markdown checkboxes read-only", () => {
  mocks.query.data = new TextEncoder().encode("- [ ] task\n");
  renderTab({
    id: "foreign-md",
    kind: "file",
    pinned: false,
    resource: { profileID: "other", location: { directory: "/repo" }, path: "tasks.md" },
  });
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
});

it("keeps worker caching available across navigation and invalidates it after a file refresh", () => {
  const tab: Extract<WorkbenchTab, { kind: "file" }> = {
    id: "file-tab",
    pinned: false,
    kind: "file",
    resource: { profileID: "profile-1", location: { directory: "/repo" }, path: "src/a.ts" },
  };
  const { rerender } = renderTab(tab);
  const first = mocks.file.mock.lastCall![0].file;
  expect(first.cacheKey).toEqual(expect.any(String));
  expect(first.contents).toBe("const value = 1;\n");

  rerender(<FileTab tab={{ ...tab, resource: { ...tab.resource, line: 2 } }} />);
  expect(mocks.file.mock.lastCall![0].file.cacheKey).toBe(first.cacheKey);

  mocks.query.data = new TextEncoder().encode("const value = 2;\n");
  rerender(<FileTab tab={tab} />);
  const refreshed = mocks.file.mock.lastCall![0].file;
  expect(refreshed.contents).toBe("const value = 2;\n");
  expect(refreshed.cacheKey).not.toBe(first.cacheKey);

  rerender(<FileTab tab={{ ...tab, resource: { ...tab.resource, path: "src/a.txt" } }} />);
  expect(mocks.file.mock.lastCall![0].file.cacheKey).not.toBe(refreshed.cacheKey);
});

const editableTab: Extract<WorkbenchTab, { kind: "file" }> = {
  id: "editable-file",
  kind: "file",
  pinned: false,
  resource: { profileID: "profile-1", location: { directory: "/repo" }, path: "src/a.ts" },
};

it("saves explicitly through the owning connection and immediately updates the file cache", async () => {
  const { queryClient } = renderTab(editableTab, true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "const value = 2;\n" } });
  expect(mocks.write).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith({
      location: { directory: "/repo" },
      path: "src/a.ts",
      payload: new TextEncoder().encode("const value = 2;\n"),
    }),
  );
  expect(mocks.client).toHaveBeenCalledWith("connection");
  await waitFor(() =>
    expect(
      queryClient.getQueryData(openCodeKeys.file("connection", { directory: "/repo" }, "src/a.ts")),
    ).toEqual(new TextEncoder().encode("const value = 2;\n")),
  );
  expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
});

it("preserves dirty edits on a watch refresh and offers explicit conflict resolution", async () => {
  const { rerender, store } = renderTab(editableTab, true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "my edit\n" } });
  mocks.query.data = new TextEncoder().encode("agent edit\n");
  mocks.read.mockResolvedValue(mocks.query.data);
  rerender(<FileTab tab={editableTab} />);
  expect(screen.getByText("Changed on disk")).toBeTruthy();
  expect(store.get(workbenchFileEditsAtom).get(editableTab.id)?.getSnapshot().contents).toBe(
    "my edit\n",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ payload: new TextEncoder().encode("my edit\n") }),
    ),
  );
});

it("renders read-only with a reason when another connection is focused", () => {
  const { store, rerender } = renderTab(editableTab, true);
  act(() =>
    store.set(runtimeAtom, {
      connectionID: "other",
      profileID: "profile-2",
    } as OpenCodeRuntimeStatus),
  );
  rerender(<FileTab tab={editableTab} />);
  expect(mocks.file.mock.lastCall![0].edit).not.toBe(true);
  expect(screen.getByText("Read-only").getAttribute("title")).toContain(
    "connection that owns this file",
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
  expect(mocks.write).not.toHaveBeenCalled();
});

it("keeps markdown source edits when switching through Preview, then reloads a disk conflict", async () => {
  mocks.query.data = new TextEncoder().encode("# Original\n");
  const tab = { ...editableTab, resource: { ...editableTab.resource, path: "notes.md" } };
  const { store, rerender } = renderTab(tab, true);
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "# My edit\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByRole("heading", { name: "My edit" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  expect(mocks.file.mock.lastCall![0].file.contents).toBe("# My edit\n");
  mocks.query.data = new TextEncoder().encode("# Agent edit\n");
  mocks.read.mockResolvedValue(mocks.query.data);
  rerender(<FileTab tab={tab} />);
  fireEvent.click(screen.getByRole("button", { name: "Reload (discard my edits)" }));
  await waitFor(() =>
    expect(store.get(workbenchFileEditsAtom).get(tab.id)?.getSnapshot()).toMatchObject({
      contents: "# Agent edit\n",
      dirty: false,
      conflict: false,
    }),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});

it("previews a CSV as a table, edits its source, and shows the edit in the table before saving", () => {
  mocks.query.data = new TextEncoder().encode("name,value\nalpha,1\n");
  const tab = { ...editableTab, resource: { ...editableTab.resource, path: "data.csv" } };
  renderTab(tab, true);
  expect(screen.getByRole("table", { name: "Table: data.csv" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "label,amount\nbeta,2\n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.getByRole("columnheader", { name: "label" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
});

it.each([false, true])(
  "adds selected file lines to the scoped composer and annotates pending comments (editable: %s)",
  (own) => {
    mocks.file.mockImplementation(({ file, options, lineAnnotations, renderAnnotation }) => (
      <div>
        <button onClick={() => options?.onLineSelectionEnd?.({ start: 3, end: 2 })}>
          Select lines
        </button>
        {lineAnnotations?.map((annotation) => (
          <div key={annotation.lineNumber}>{renderAnnotation?.(annotation, file)}</div>
        ))}
      </div>
    ));
    const sessionID = `file-comment-${own}-${crypto.randomUUID()}`;
    const { store } = renderTab(editableTab, own, sessionID);
    fireEvent.click(screen.getByRole("button", { name: "Select lines" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Line comment" }), {
      target: { value: "Clarify this range." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    const comments = store.get(
      composerStateAtomFamily(composerScope("profile-1", `session:${sessionID}`)),
    ).comments;
    expect(comments).toHaveLength(1);
    expect(formatReviewComment(comments[0]!)).toBe(
      "The user made the following comment regarding lines 2 through 3 of src/a.ts: Clarify this range.",
    );
    expect(screen.getByLabelText("Pending comments on line 3").textContent).toContain(
      "Clarify this range.",
    );
    expect(mocks.write).not.toHaveBeenCalled();
    act(() =>
      store.set(
        composerStateAtomFamily(composerScope("profile-1", `session:${sessionID}`)),
        (current) => ({ ...current, comments: [] }),
      ),
    );
    expect(screen.queryByLabelText("Pending comments on line 3")).toBeNull();
  },
);
