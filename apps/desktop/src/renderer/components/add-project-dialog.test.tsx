import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileSystemEntry } from "@opencode/client";
import type { OpenCodeProfile, OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { palot } from "../services/palot";
import { AddProjectDialog } from "./add-project-dialog";

const mocks = vi.hoisted(() => ({
  openSession: vi.fn(),
  overview: {
    connections: [] as { profile: OpenCodeProfile; runtime: OpenCodeRuntimeStatus }[],
    includedProfileIDs: ["local", "remote"],
  },
}));
vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => mocks.overview,
}));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));

function runtime(profileID: string): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID: `${profileID}-connection`,
    connected: true,
    phase: "connected",
    contractVersion: "test",
    binaryPath: null,
    version: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}
function session(): PalotSession {
  return {
    id: "task",
    title: "Task",
    parentID: null,
    projectID: "project",
    agent: null,
    model: null,
    location: { directory: "/srv/project" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}
let queryClient: QueryClient;
beforeEach(() => {
  window.localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.openSession.mockReset().mockResolvedValue(undefined);
  mocks.overview.includedProfileIDs = ["local", "remote"];
  mocks.overview.connections = [
    { profile: { id: "local", kind: "local", name: "Local" }, runtime: runtime("local") },
    {
      profile: {
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["https://remote.example"],
        credentialID: null,
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      },
      runtime: runtime("remote"),
    },
  ];
  vi.spyOn(palot, "listWorkspaceDirectory").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});
function mount(initialProfileID = "remote", store = createStore()) {
  const onClose = vi.fn();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <AddProjectDialog initialProfileID={initialProfileID} onClose={onClose} />
      </Provider>
    </QueryClientProvider>,
  );
  return { ...result, onClose, store };
}
function browse(path: string) {
  fireEvent.change(screen.getByLabelText("Folder path"), { target: { value: path } });
  fireEvent.click(screen.getByRole("button", { name: "Browse" }));
}

it("lazily browses the selected server, follows directories and supports breadcrumbs", async () => {
  vi.mocked(palot.listWorkspaceDirectory)
    .mockResolvedValueOnce([
      { path: "src", type: "directory" },
      { path: "README.md", type: "file" },
    ])
    .mockResolvedValue([]);
  mount();
  expect(palot.listWorkspaceDirectory).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Choose local folder…" })).toBeNull();
  browse("/srv/project");
  fireEvent.click(await screen.findByRole("button", { name: "Open folder src" }));
  await waitFor(() =>
    expect(palot.listWorkspaceDirectory).toHaveBeenLastCalledWith(
      { directory: "/srv/project/src" },
      expect.any(AbortSignal),
      "remote-connection",
    ),
  );
  expect(screen.queryByText("README.md")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Browse /srv" }));
  await waitFor(() =>
    expect(palot.listWorkspaceDirectory).toHaveBeenLastCalledWith(
      { directory: "/srv" },
      expect.any(AbortSignal),
      "remote-connection",
    ),
  );
});

it("aborts obsolete folder requests and never displays their late results", async () => {
  const old = Promise.withResolvers<FileSystemEntry[]>();
  vi.mocked(palot.listWorkspaceDirectory)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([{ path: "current", type: "directory" }]);
  mount();
  browse("/old");
  await waitFor(() => expect(palot.listWorkspaceDirectory).toHaveBeenCalledOnce());
  const signal = vi.mocked(palot.listWorkspaceDirectory).mock.calls[0]![1]!;
  browse("/new");
  expect(await screen.findByRole("button", { name: "Open folder current" })).toBeTruthy();
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve([{ path: "stale", type: "directory" }]));
  expect(screen.queryByRole("button", { name: "Open folder stale" })).toBeNull();
});

it("cancels the previous server's listing when the independent server selection changes", async () => {
  const pending = Promise.withResolvers<FileSystemEntry[]>();
  vi.mocked(palot.listWorkspaceDirectory)
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce([]);
  mount();
  browse("/same");
  await waitFor(() => expect(palot.listWorkspaceDirectory).toHaveBeenCalledOnce());
  const signal = vi.mocked(palot.listWorkspaceDirectory).mock.calls[0]![1]!;
  await userEvent.click(screen.getByRole("combobox", { name: "Server" }));
  await userEvent.click(await screen.findByRole("option", { name: "Local" }));
  expect(signal.aborted).toBe(true);
  browse("/same");
  await waitFor(() =>
    expect(palot.listWorkspaceDirectory).toHaveBeenLastCalledWith(
      { directory: "/same" },
      expect.any(AbortSignal),
      "local-connection",
    ),
  );
  await act(async () => pending.resolve([{ path: "remote-only", type: "directory" }]));
  expect(screen.queryByRole("button", { name: "Open folder remote-only" })).toBeNull();
});

it("keeps recent folders with their server when the dialog is reopened", async () => {
  vi.spyOn(palot, "createSession").mockResolvedValue(session());
  const first = mount();
  fireEvent.change(screen.getByLabelText("Folder path"), { target: { value: "/srv/project" } });
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  await waitFor(() => expect(first.onClose).toHaveBeenCalledOnce());
  first.unmount();
  mount("remote", first.store);
  expect((screen.getByLabelText("Folder path") as HTMLInputElement).value).toBe("/srv/project");
  expect(screen.getByRole("button", { name: "/srv/project" })).toBeTruthy();
  await userEvent.click(screen.getByRole("combobox", { name: "Server" }));
  await userEvent.click(await screen.findByRole("option", { name: "Local" }));
  expect((screen.getByLabelText("Folder path") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "/srv/project" })).toBeNull();
});

it("selects a server independently and retains its owner through creation and navigation", async () => {
  const created = Promise.withResolvers<PalotSession>();
  const create = vi.spyOn(palot, "createSession").mockReturnValue(created.promise);
  const view = mount("local");
  await userEvent.click(screen.getByRole("combobox", { name: "Server" }));
  await userEvent.click(await screen.findByRole("option", { name: "Remote" }));
  expect(screen.queryByRole("button", { name: "Choose local folder…" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Folder path"), { target: { value: "/srv/project" } });
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  expect(create).toHaveBeenCalledWith("/srv/project", undefined, "remote-connection");
  await act(async () => created.resolve(session()));
  expect(mocks.openSession).toHaveBeenCalledWith("task", { profileID: "remote" });
  expect(openCodeReconciler(queryClient).session("remote-connection", "task")?.id).toBe("task");
  expect(openCodeReconciler(queryClient).session("local-connection", "task")).toBeNull();
  expect(view.onClose).toHaveBeenCalledOnce();
});

it("offers a native picker only for the selected local server and ignores completion after closing", async () => {
  const picked = Promise.withResolvers<string | null>();
  const pick = vi.spyOn(palot, "pickDirectory").mockReturnValue(picked.promise);
  const view = mount("local");
  fireEvent.click(screen.getByRole("button", { name: "Choose local folder…" }));
  expect(pick).toHaveBeenCalledWith("local-connection");
  view.unmount();
  await act(async () => picked.resolve("/chosen"));
  expect(palot.listWorkspaceDirectory).not.toHaveBeenCalled();
  expect(mocks.openSession).not.toHaveBeenCalled();
});

it("does not create on a disabled server or silently fall back to another owner", () => {
  mocks.overview.includedProfileIDs = ["local"];
  const create = vi.spyOn(palot, "createSession");
  mount("remote");
  expect(screen.getByText(/This server is disabled or offline/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add project" }).hasAttribute("disabled")).toBe(true);
  expect(create).not.toHaveBeenCalled();
  expect(palot.listWorkspaceDirectory).not.toHaveBeenCalled();
});
