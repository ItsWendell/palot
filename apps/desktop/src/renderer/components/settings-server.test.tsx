import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRuntimeStatus, PalotSettingsSnapshot } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { createRendererQueryClient } from "../lib/query-client";
import * as clients from "../services/opencode-client";
import { palot } from "../services/palot";
import { Settings } from "./settings";

const fixtures = vi.hoisted(() => ({
  connections: [] as unknown[],
  session: null as unknown,
  navigate: vi.fn(),
}));
vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => ({ connections: fixtures.connections }),
}));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ closeSettings: fixtures.navigate, openSettings: fixtures.navigate }),
}));
vi.mock("../hooks/use-session-catalog", () => ({ useSelectedSession: () => fixtures.session }));

function runtime(id: string): OpenCodeRuntimeStatus {
  return {
    connectionID: `connection-${id}`,
    profileID: id,
    phase: "connected",
    connected: true,
    contractVersion: "2.0.3",
    version: "2.0.3",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

function snapshot(connectionID: string): PalotSettingsSnapshot {
  return {
    location: { directory: `/repo/${connectionID}` },
    configSources: [],
    catalog: { models: [], providers: [], defaultModel: null, errors: [] },
    agents: [],
    integrations: [
      {
        id: "example",
        name: "Example",
        methods: [],
        connections: [{ type: "credential", id: "credential", label: "Secondary", active: false }],
      },
    ],
    mcpServers: [],
    mcpResources: [],
    mcpResourceTemplates: [],
    savedPermissions: [],
    plugins: [],
    skills: [],
    commands: [],
    references: [],
    websearchProviders: [],
    errors: [],
  };
}

function setup(
  category: Parameters<typeof Settings>[0]["category"] = "providers",
  taskDirectory?: string,
) {
  fixtures.session = taskDirectory
    ? {
        id: "task-a",
        projectID: "shared-project",
        location: { directory: taskDirectory },
        title: "Task A",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        parentID: null,
      }
    : null;
  const store = createStore();
  store.set(runtimeAtom, runtime("a"));
  store.set(discoveredProfileIDsAtom, ["a", "b"]);
  store.set(includedProfileIDsAtom, ["a", "b"]);
  fixtures.connections = ["a", "b"].map((id) => ({
    profile: { id, name: `Server ${id.toUpperCase()}` },
    runtime: runtime(id),
    projects: [],
  }));
  const projectReads: string[] = [];
  const projectUpdates = vi.fn();
  vi.spyOn(clients, "openCodeClient").mockImplementation(
    (connectionID) =>
      ({
        project: {
          list: async () => {
            projectReads.push(connectionID!);
            return [
              {
                id: "shared-project",
                canonical: `/repo/${connectionID}`,
                name: "Project",
                sandboxes: [],
                time: { created: 1, updated: 1 },
              },
            ];
          },
          update: async (input: { projectID: string; name?: string }) => {
            projectUpdates(connectionID, input);
            return {
              id: input.projectID,
              canonical: `/repo/${connectionID}`,
              name: input.name,
              sandboxes: [],
              time: { created: 1, updated: 1 },
            };
          },
        },
      }) as unknown as OpenCodeClient,
  );
  const load = vi
    .spyOn(palot, "loadSettings")
    .mockImplementation(async (input) => snapshot(input.connectionID!));
  const activate = vi.spyOn(palot, "activateCredential").mockResolvedValue(undefined);
  const queryClient = createRendererQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <Settings category={category} />
      </Provider>
    </QueryClientProvider>,
  );
  return { store, load, activate, projectReads, projectUpdates };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fixtures.navigate.mockClear();
});

describe("independent settings server", () => {
  it("starts at the current task location and never reuses that path on another server", async () => {
    const { load } = setup("providers", "/worktrees/task-a");
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({ connectionID: "connection-a", directory: "/worktrees/task-a" }),
        expect.any(AbortSignal),
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Configure server" }));
    await user.click(screen.getByRole("option", { name: "Server B" }));
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({ connectionID: "connection-b", directory: "/repo/connection-b" }),
        expect.any(AbortSignal),
      ),
    );
    expect(
      load.mock.calls
        .filter(([input]) => input.connectionID === "connection-b")
        .every(([input]) => input.directory !== "/worktrees/task-a"),
    ).toBe(true);
  });

  it("keeps A settings and credential mutations owned by A when the task focuses B", async () => {
    const { store, load, activate, projectReads } = setup();
    await screen.findByText("Secondary");
    act(() => store.set(runtimeAtom, runtime("b")));
    expect(screen.getByRole("combobox", { name: "Configure server" }).textContent).toContain(
      "Server A",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(activate).toHaveBeenCalled());
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "connection-a", directory: "/repo/connection-a" }),
    );
    expect(load.mock.calls.every(([input]) => input.connectionID === "connection-a")).toBe(true);
    expect(projectReads).toEqual(["connection-a"]);
    expect(store.get(runtimeAtom)?.connectionID).toBe("connection-b");
    expect(fixtures.navigate).not.toHaveBeenCalled();
  });

  it("selects B's catalog and location without moving the task, then makes disabled B read-only", async () => {
    const { store, load, projectReads } = setup();
    await screen.findByText("Secondary");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Configure server" }));
    await user.click(screen.getByRole("option", { name: "Server B" }));
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({ connectionID: "connection-b", directory: "/repo/connection-b" }),
        expect.any(AbortSignal),
      ),
    );
    expect(projectReads).toEqual(["connection-a", "connection-b"]);
    expect(store.get(runtimeAtom)?.connectionID).toBe("connection-a");
    act(() => store.set(includedProfileIDsAtom, ["a"]));
    expect(screen.getByText(/Disabled · Settings are read-only/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh settings" }).hasAttribute("disabled")).toBe(
      true,
    );
    const before = load.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Refresh settings" }));
    expect(load.mock.calls).toHaveLength(before);
    expect(fixtures.navigate).not.toHaveBeenCalled();
  });

  it("does not expose a server selector or load server settings for app preferences", () => {
    const { load, projectReads } = setup("appearance");
    expect(screen.queryByRole("combobox", { name: "Configure server" })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(projectReads).toEqual([]);
  });

  it("edits A's project details while the task is on B", async () => {
    const { store, projectUpdates } = setup("project");
    const name = await screen.findByLabelText("Project name");
    act(() => store.set(runtimeAtom, runtime("b")));
    const user = userEvent.setup();
    await user.clear(name);
    await user.type(name, "Edited on A");
    await user.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() =>
      expect(projectUpdates).toHaveBeenCalledWith("connection-a", {
        projectID: "shared-project",
        name: "Edited on A",
      }),
    );
    expect(store.get(runtimeAtom)?.connectionID).toBe("connection-b");
  });

  it("does not read an offline server or fall back to the connected task server", async () => {
    const { load, projectReads, store } = setup();
    await screen.findByText("Secondary");
    fixtures.connections = [
      { profile: { id: "a", name: "Server A" }, runtime: runtime("a"), projects: [] },
      { profile: { id: "b", name: "Server B" }, runtime: null, projects: [] },
    ];
    // A store change lets the view observe the updated registry fixture.
    act(() => store.set(runtimeAtom, { ...runtime("a") }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Configure server" }));
    await user.click(screen.getByRole("option", { name: "Server B" }));
    expect(screen.getByText(/Offline · Settings are read-only/)).toBeTruthy();
    expect(screen.queryByText("Secondary")).toBeNull();
    expect(load.mock.calls.every(([input]) => input.connectionID === "connection-a")).toBe(true);
    expect(projectReads).toEqual(["connection-a"]);
    expect(store.get(runtimeAtom)?.connectionID).toBe("connection-a");
  });
});
