import type { OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMcpServer, PalotProject, PalotSettingsSnapshot } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { ToolSettings } from "./settings";
import { toast } from "./ui/toast";

const services = vi.hoisted(() => ({
  disconnectMcpServer: vi.fn(),
  removeMcpServer: vi.fn(),
  connectIntegrationOAuth: vi.fn(),
  integrationOAuthStatus: vi.fn(),
  completeIntegrationOAuth: vi.fn(),
  cancelIntegrationOAuth: vi.fn(),
}));
vi.mock("../services/palot", () => ({ palot: services }));

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Example",
  sandboxes: [],
  vcs: null,
  updatedAt: null,
};

function snapshot(mcpServers: PalotMcpServer[]): PalotSettingsSnapshot {
  return {
    location: { directory: "/repo" },
    catalog: { models: [], providers: [], defaultModel: null, errors: [] },
    configSources: [],
    agents: [],
    integrations: [],
    mcpServers,
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

const server = (patch: Partial<PalotMcpServer> = {}): PalotMcpServer => ({
  name: "docs",
  status: "failed",
  error: "spawn ENOENT",
  integrationID: null,
  ...patch,
});

function fakeClient(mcp: Record<string, unknown>, integration: Record<string, unknown> = {}) {
  const resolved = { directory: "/repo", project: { id: project.id, directory: "/repo" } };
  setOpenCodeClientForTest({
    location: { get: vi.fn().mockResolvedValue(resolved) },
    // Reads are stable (`mcp.list`); connecting and editing servers are experimental since 2.2.1.
    mcp,
    experimental: { mcp },
    integration,
  } as unknown as OpenCodeClient);
}

function renderTools(servers: PalotMcpServer[], directory = "/repo") {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    phase: "connected",
    connected: true,
    contractVersion: "2.0.31",
    version: "2.0.31",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const refresh = vi.fn(async () => {});
  const queryClient = createRendererQueryClient();
  const view = (dir: string, items: PalotMcpServer[]) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <ToolSettings
          project={project}
          location={{ directory: dir }}
          snapshot={snapshot(items)}
          refresh={refresh}
        />
      </Provider>
    </QueryClientProvider>
  );
  const result = render(view(directory, servers));
  return {
    refresh,
    rerender: (dir: string, items = servers) => result.rerender(view(dir, items)),
  };
}

async function openMcp() {
  await userEvent.setup().click(screen.getByRole("tab", { name: "MCP" }));
  return within(screen.getByRole("group", { name: "docs MCP server" }));
}

let toastAdd: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  toastAdd = vi.spyOn(toast, "add").mockReturnValue("toast");
  for (const mock of Object.values(services)) mock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

describe("MCP server recovery", () => {
  it.each([
    [{ status: "connected", error: null }, "Disconnect", false],
    [{ status: "failed" }, "Retry", false],
    [{ status: "pending", error: null }, "Connecting…", true],
    [{ status: "needs_auth", error: "Unauthorized", integrationID: "mcp_docs" }, "Sign in", false],
    [{ status: "disabled", error: null }, "Connect", false],
  ] as const)("offers the recovery step for %o", async (patch, label, disabled) => {
    renderTools([server(patch)]);
    const row = await openMcp();
    const button = row.getByRole("button", { name: label });
    expect((button as HTMLButtonElement).disabled).toBe(disabled);
  });

  it("shows why a failed server failed next to Retry", async () => {
    renderTools([server()]);
    const row = await openMcp();
    expect(row.getByText("spawn ENOENT")).toBeTruthy();
    expect(row.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("reports a retry that OpenCode accepted but still left failed", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue({
      data: [{ name: "docs", status: { status: "failed", error: "spawn EACCES" } }],
    });
    fakeClient({ connect, list });
    const { refresh } = renderTools([server()]);
    const row = await openMcp();

    await userEvent.setup().click(row.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Could not connect docs",
          description: "docs: spawn EACCES",
        }),
      ),
    );
    expect(connect).toHaveBeenCalledWith(
      { server: "docs", location: { directory: "/repo" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(list).toHaveBeenCalledWith(
      { location: { directory: "/repo" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("signs in through the server's integration and verifies the reconnect", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue({
      data: [{ name: "docs", status: { status: "connected" }, integrationID: "mcp_docs" }],
    });
    const get = vi.fn().mockResolvedValue({
      data: {
        id: "mcp_docs",
        name: "docs",
        methods: [{ id: "mcp_docs", type: "oauth", label: "docs" }],
        connections: [],
      },
    });
    fakeClient({ connect, list }, { get });
    services.connectIntegrationOAuth.mockResolvedValue({
      attemptID: "attempt-1",
      url: "https://auth.example/authorize",
      instructions: "",
      mode: "auto",
      createdAt: 1,
      expiresAt: 2,
    });
    services.integrationOAuthStatus.mockResolvedValue({
      status: "complete",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    });
    const { refresh } = renderTools([
      server({ status: "needs_auth", error: "Unauthorized", integrationID: "mcp_docs" }),
    ]);
    const row = await openMcp();
    const user = userEvent.setup();

    await user.click(row.getByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog");
    expect(get).toHaveBeenCalledWith(
      { integrationID: "mcp_docs", location: { directory: "/repo" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Add and use" }));

    await waitFor(
      () =>
        expect(toastAdd).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success", title: "docs connected" }),
        ),
      { timeout: 3_000 },
    );
    expect(services.connectIntegrationOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ integrationID: "mcp_docs", methodID: "mcp_docs" }),
    );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps sign-in open and says so when the server still needs authorization", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          name: "docs",
          status: { status: "needs_auth", error: "Token rejected" },
          integrationID: "mcp_docs",
        },
      ],
    });
    const get = vi.fn().mockResolvedValue({
      data: {
        id: "mcp_docs",
        name: "docs",
        methods: [{ id: "mcp_docs", type: "oauth", label: "docs" }],
        connections: [],
      },
    });
    fakeClient({ connect, list }, { get });
    services.connectIntegrationOAuth.mockResolvedValue({
      attemptID: "attempt-1",
      url: "https://auth.example/authorize",
      instructions: "",
      mode: "auto",
      createdAt: 1,
      expiresAt: 2,
    });
    services.integrationOAuthStatus.mockResolvedValue({
      status: "complete",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    });
    renderTools([server({ status: "needs_auth", integrationID: "mcp_docs" })]);
    const row = await openMcp();
    const user = userEvent.setup();

    await user.click(row.getByRole("button", { name: "Sign in" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Add and use" }),
    );

    await waitFor(
      () =>
        expect(toastAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "error",
            description: "docs still needs authorization: Token rejected",
          }),
        ),
      { timeout: 3_000 },
    );
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("drops a connect that finishes after the settings location changed", async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const connect = vi.fn(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => {
          signal = options.signal;
          finish = resolve;
        }),
    );
    const list = vi.fn().mockResolvedValue({
      data: [{ name: "docs", status: { status: "failed", error: "boom" } }],
    });
    fakeClient({ connect, list });
    const view = renderTools([server()]);
    const row = await openMcp();

    await userEvent.setup().click(row.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(
      (
        within(screen.getByRole("group", { name: "docs MCP server" })).getByRole("button", {
          name: "Connecting…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    view.rerender("/other");
    expect(signal.aborted).toBe(true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(list).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
    const moved = within(screen.getByRole("group", { name: "docs MCP server" }));
    expect((moved.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
