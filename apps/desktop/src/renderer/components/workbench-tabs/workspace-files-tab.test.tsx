import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { workbenchStateAtom } from "../../atoms/workbench";
import { workspaceFileSelectionAtom } from "../../atoms/workspace-file-selection";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/workspace-file-drag";
import { createRendererQueryClient } from "../../lib/query-client";
import { openCodeKeys } from "../../lib/opencode-query";
import { workbenchScopeKey, type WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { WorkspaceFilesTab, workspaceRelativePath } from "./workspace-files-tab";

vi.mock("../../atoms/workspace", async () => ({ runtimeAtom: (await import("jotai")).atom(null) }));

const scope = { profileID: "profile", sessionID: "session" };
const tab: Extract<WorkbenchTab, { kind: "workspace-files" }> = {
  id: "files",
  kind: "workspace-files",
  pinned: true,
  resource: { profileID: "profile", location: { directory: "/repo", workspaceID: "ws" } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(active = true) {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "remote",
    profileID: "profile",
    contractVersion: "2.0.3",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "2.0.3",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const queryClient = createRendererQueryClient();
  const view = (shown: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <WorkspaceFilesTab tab={tab} pane="bottom" scope={scope} active={shown} />
      </Provider>
    </QueryClientProvider>
  );
  const rendered = render(view(active));
  return { store, rerender: (shown: boolean) => rendered.rerender(view(shown)), queryClient };
}

function treeContents() {
  const root = document
    .querySelector("file-tree-container")
    ?.shadowRoot?.querySelector<HTMLElement>("[role=tree]");
  expect(root).toBeTruthy();
  return within(root!);
}

function treeItem(name: string) {
  return waitFor(() => treeContents().getByRole("treeitem", { name }));
}

it("names the actual shadow tree, reveals a nested active file without opening it, and exports a file drag", async () => {
  vi.spyOn(palot, "listWorkspaceDirectory").mockImplementation(async (input) =>
    input.path === "src/nested"
      ? [{ type: "file", path: "src/nested/a.ts" }]
      : [{ type: "directory", path: input.path === "src" ? "src/nested" : "src" }],
  );
  const { store } = mount();
  await treeItem("src");
  act(() =>
    store.set(workspaceFileSelectionAtom, {
      [workbenchScopeKey(scope)]: { location: tab.resource.location, path: "src/nested/a.ts" },
    }),
  );
  const file = await treeItem("a.ts");
  await waitFor(() => expect(file.getAttribute("aria-selected")).toBe("true"));
  expect(file.closest('[role="tree"]')?.getAttribute("aria-label")).toBe("Workspace files");
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs ?? []).toEqual(
    [],
  );
  await waitFor(() => expect(file.draggable).toBe(true));
  const dataTransfer = { effectAllowed: "none", setData: vi.fn() };
  fireEvent.dragStart(file, { dataTransfer, composed: true });
  expect(dataTransfer.setData).toHaveBeenCalledWith(
    WORKSPACE_FILE_DRAG_TYPE,
    JSON.stringify({ profileID: "profile", ...tab.resource.location, path: "src/nested/a.ts" }),
  );
});

it("resolves server file paths only within the workspace", () => {
  expect(workspaceRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("/repo", "src\\a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("C:\\repo", "C:\\repo\\src\\a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("/repo", "/repo2/a.ts")).toBeNull();
  expect(workspaceRelativePath("/repo", "../secret")).toBeNull();
  expect(workspaceRelativePath("/repo", "/repo/src/../../secret")).toBeNull();
  expect(workspaceRelativePath("/repo", "C:/secret")).toBeNull();
});

it("lazily expands folders, sorts siblings, and opens files in the same pane and location", async () => {
  const list = vi.spyOn(palot, "listWorkspaceDirectory").mockImplementation(async (input) =>
    input.path === "src"
      ? [
          { type: "file", path: "/repo/src/z.ts" },
          { type: "directory", path: "src/nested" },
          { type: "file", path: "/repo/src/a.ts" },
          { type: "file", path: "/outside/secret" },
          { type: "directory", path: "../escape" },
        ]
      : [
          { type: "file", path: "README.md" },
          { type: "directory", path: "src" },
          { type: "directory", path: "docs" },
          { type: "directory", path: "/outside/secret" },
        ],
  );
  vi.spyOn(palot, "findWorkspaceFiles").mockResolvedValue([]);
  const { store } = mount();
  const folder = await treeItem("src");
  expect(list).toHaveBeenCalledTimes(1);
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  expect(
    treeContents()
      .getAllByRole("treeitem")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual(["docs", "src", "README.md"]);
  fireEvent.click(folder);
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith(
      { directory: "/repo", workspaceID: "ws", path: "src" },
      expect.any(AbortSignal),
      "remote",
    ),
  );
  const file = await treeItem("a.ts");
  expect(list).toHaveBeenCalledTimes(2);
  expect(treeContents().queryByText("secret")).toBeNull();
  expect(treeContents().queryByText("escape")).toBeNull();
  expect(
    treeContents()
      .getAllByRole("treeitem")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual(["docs", "src", "nested", "a.ts", "z.ts", "README.md"]);
  fireEvent.click(file);
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs).toMatchObject(
    [
      {
        kind: "file",
        resource: { profileID: "profile", location: tab.resource.location, path: "src/a.ts" },
      },
    ],
  );
});

it("refreshes expanded directories on request and file-query invalidation, retaining expansion", async () => {
  let filename = "a.ts";
  const list = vi
    .spyOn(palot, "listWorkspaceDirectory")
    .mockImplementation(async (input) =>
      input.path === "src"
        ? [{ type: "file", path: `src/${filename}` }]
        : [{ type: "directory", path: "src" }],
    );
  const { queryClient, rerender } = mount();
  fireEvent.click(await treeItem("src"));
  await treeItem("a.ts");
  filename = "b.ts";
  fireEvent.click(screen.getByRole("button", { name: "Refresh workspace files" }));
  await treeItem("b.ts");
  expect((await treeItem("src")).getAttribute("aria-expanded")).toBe("true");
  expect(treeContents().queryByRole("treeitem", { name: "a.ts" })).toBeNull();
  expect(list).toHaveBeenCalledTimes(4);

  filename = "c.ts";
  await act(() => queryClient.invalidateQueries({ queryKey: openCodeKeys.files("remote") }));
  await treeItem("c.ts");
  expect(list).toHaveBeenCalledTimes(6);
  rerender(false);
  expect((await treeItem("src")).getAttribute("aria-expanded")).toBe("true");
  await act(() => queryClient.invalidateQueries({ queryKey: openCodeKeys.files("remote") }));
  expect(list).toHaveBeenCalledTimes(6);
  rerender(true);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(8));
  expect((await treeItem("src")).getAttribute("aria-expanded")).toBe("true");
});

it("keeps a failed folder expandable and retries its listing", async () => {
  let failed = true;
  vi.spyOn(palot, "listWorkspaceDirectory").mockImplementation(async (input) => {
    if (!input.path) return [{ type: "directory", path: "src" }];
    if (failed) throw new Error("listing failed");
    return [{ type: "file", path: "src/a.ts" }];
  });
  mount();
  fireEvent.click(await treeItem("src"));
  expect((await screen.findByRole("alert")).textContent).toContain("listing failed");
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await treeItem("a.ts");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("supports keyboard expansion and preserves nested expansion across collapse and search", async () => {
  const list = vi
    .spyOn(palot, "listWorkspaceDirectory")
    .mockImplementation(async (input) =>
      input.path === "src/nested"
        ? [{ type: "file", path: "src/nested/a.ts" }]
        : [{ type: "directory", path: input.path === "src" ? "src/nested" : "src" }],
    );
  vi.spyOn(palot, "findWorkspaceFiles").mockResolvedValue([
    { type: "file", path: "src/nested/a.ts" },
  ]);
  const { queryClient } = mount();
  fireEvent.keyDown(await treeItem("src"), { key: "ArrowRight" });
  fireEvent.keyDown(await treeItem("src"), { key: "ArrowRight" });
  fireEvent.keyDown(await treeItem("nested"), { key: "ArrowRight" });
  await treeItem("a.ts");
  expect(list).toHaveBeenCalledTimes(3);
  fireEvent.click(await treeItem("src"));
  await waitFor(() => expect(treeContents().queryByRole("treeitem", { name: "a.ts" })).toBeNull());
  await act(() => queryClient.invalidateQueries({ queryKey: openCodeKeys.files("remote") }));
  expect(list).toHaveBeenCalledTimes(4); // Only the root remains subscribed.
  fireEvent.click(await treeItem("src"));
  await treeItem("a.ts");
  expect((await treeItem("nested")).getAttribute("aria-expanded")).toBe("true");

  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a.ts" } });
  await screen.findByRole("button", { name: "src/nested/a.ts" });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  await treeItem("a.ts");
  expect((await treeItem("nested")).getAttribute("aria-expanded")).toBe("true");
});

it("removes descendants when a refreshed parent no longer contains the folder", async () => {
  let removed = false;
  vi.spyOn(palot, "listWorkspaceDirectory").mockImplementation(async (input) =>
    input.path === "src"
      ? [{ type: "file", path: "src/a.ts" }]
      : removed
        ? [{ type: "file", path: "README.md" }]
        : [{ type: "directory", path: "src" }],
  );
  mount();
  fireEvent.click(await treeItem("src"));
  await treeItem("a.ts");
  removed = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh workspace files" }));
  await treeItem("README.md");
  expect(treeContents().queryByRole("treeitem", { name: "src" })).toBeNull();
  expect(treeContents().queryByRole("treeitem", { name: "a.ts" })).toBeNull();
});

it("searches with a limit, shows empty and error states, and clears back to the directory", async () => {
  vi.spyOn(palot, "listWorkspaceDirectory").mockResolvedValue([]);
  const search = vi.spyOn(palot, "findWorkspaceFiles").mockResolvedValue([
    { type: "file", path: "src/a.ts" },
    { type: "file", path: "/outside/secret" },
    { type: "file", path: "../escape" },
  ]);
  const { store } = mount();
  expect(await screen.findByText("No files in this directory")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search workspace files" }), {
    target: { value: "a.ts" },
  });
  expect(await screen.findByRole("button", { name: "src/a.ts" })).toBeTruthy();
  expect(screen.queryByText("/outside/secret")).toBeNull();
  expect(screen.queryByText("../escape")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "src/a.ts" }));
  expect(
    store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs[0],
  ).toMatchObject({ kind: "file", resource: { path: "src/a.ts" } });
  expect(search).toHaveBeenCalledWith(
    { directory: "/repo", workspaceID: "ws", query: "a.ts", limit: 50 },
    expect.any(AbortSignal),
    "remote",
  );
  search.mockRejectedValue(new Error("search failed"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  expect(await screen.findByText("search failed")).toBeTruthy();
  search.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No matching files")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(await screen.findByText("No files in this directory")).toBeTruthy();
});

it("does not fetch while hidden or attached to another connection", async () => {
  const list = vi.spyOn(palot, "listWorkspaceDirectory").mockResolvedValue([]);
  const { rerender, store } = mount(false);
  expect(list).not.toHaveBeenCalled();
  store.set(runtimeAtom, { ...store.get(runtimeAtom)!, profileID: "other" });
  rerender(true);
  expect(await screen.findByText("Files unavailable")).toBeTruthy();
  expect(list).not.toHaveBeenCalled();
});
