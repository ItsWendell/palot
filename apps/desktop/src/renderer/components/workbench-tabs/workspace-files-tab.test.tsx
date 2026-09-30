import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { workbenchStateAtom } from "../../atoms/workbench";
import { createRendererQueryClient } from "../../lib/query-client";
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

it("resolves server file paths only within the workspace", () => {
  expect(workspaceRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("/repo", "src\\a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("C:\\repo", "C:\\repo\\src\\a.ts")).toBe("src/a.ts");
  expect(workspaceRelativePath("/repo", "/repo2/a.ts")).toBeNull();
  expect(workspaceRelativePath("/repo", "../secret")).toBeNull();
  expect(workspaceRelativePath("/repo", "/repo/src/../../secret")).toBeNull();
  expect(workspaceRelativePath("/repo", "C:/secret")).toBeNull();
});

it("browses directories, restores focus after navigation, and opens files in the same pane and location", async () => {
  const list = vi.spyOn(palot, "listWorkspaceDirectory").mockImplementation(async (input) =>
    input.path === "src"
      ? [
          { type: "file", path: "/repo/src/a.ts" },
          { type: "file", path: "/outside/secret" },
        ]
      : [{ type: "directory", path: "src" }],
  );
  vi.spyOn(palot, "findWorkspaceFiles").mockResolvedValue([]);
  const { store } = mount();
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith(
      { directory: "/repo", workspaceID: "ws", path: "src" },
      expect.any(AbortSignal),
      "remote",
    ),
  );
  await screen.findByRole("button", { name: "a.ts" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "src" }));
  expect(screen.queryByText("secret")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
  expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(scope)]?.bottom.tabs).toMatchObject(
    [
      {
        kind: "file",
        resource: { profileID: "profile", location: tab.resource.location, path: "src/a.ts" },
      },
    ],
  );
});

it("searches with a limit, shows empty and error states, and clears back to the directory", async () => {
  vi.spyOn(palot, "listWorkspaceDirectory").mockResolvedValue([]);
  const search = vi
    .spyOn(palot, "findWorkspaceFiles")
    .mockResolvedValue([{ type: "file", path: "src/a.ts" }]);
  mount();
  expect(await screen.findByText("No files in this directory")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search workspace files" }), {
    target: { value: "a.ts" },
  });
  expect(await screen.findByRole("button", { name: "src/a.ts" })).toBeTruthy();
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
