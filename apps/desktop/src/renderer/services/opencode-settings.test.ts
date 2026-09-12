import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "./opencode-client";
import {
  activateCredential,
  addMcpServer,
  checkPluginUpdates,
  checkPlugins,
  connectMcpServer,
  connectIntegrationCommand,
  connectIntegrationOAuth,
  disconnectMcpServer,
  loadSettings,
  removeMcpServer,
  updatePlugin,
  updatePlugins,
} from "./opencode-settings";

const location = {
  directory: "/repo",
  project: { id: "project-1", directory: "/repo", canonical: "/repo" },
};

function client(overrides: Record<string, unknown> = {}): OpenCodeClient {
  return {
    location: { get: vi.fn().mockResolvedValue(location) },
    config: { get: vi.fn().mockResolvedValue([]) },
    model: {
      list: vi.fn().mockResolvedValue({ location, data: [] }),
      default: vi.fn().mockResolvedValue({ location, data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ location, data: [] }) },
    agent: { list: vi.fn().mockResolvedValue({ location, data: [] }) },
    integration: {
      list: vi.fn().mockResolvedValue({ location, data: [] }),
    },
    mcp: {
      list: vi.fn().mockResolvedValue({ location, data: [] }),
      resource: {
        catalog: vi.fn().mockResolvedValue({
          location,
          data: { resources: [], templates: [] },
        }),
      },
    },
    permission: { saved: { list: vi.fn().mockResolvedValue([]) } },
    plugin: {
      list: vi.fn().mockResolvedValue({ location, data: [] }),
      awaitActivation: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({ location, data: [] }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    skill: { list: vi.fn().mockResolvedValue({ location, data: [] }) },
    command: { list: vi.fn().mockResolvedValue({ location, data: [] }) },
    reference: { list: vi.fn().mockResolvedValue({ location, data: [] }) },
    websearch: { providers: vi.fn().mockResolvedValue({ location, data: [] }) },
    ...overrides,
  } as unknown as OpenCodeClient;
}

afterEach(() => {
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

describe("renderer OpenCode settings service", () => {
  it.each(["disable", "notify", "auto"])("summarizes the %s update policy", async (update) => {
    setOpenCodeClientForTest(
      client({
        config: {
          get: vi.fn().mockResolvedValue([
            {
              type: "document",
              path: "/repo/opencode.json",
              info: { update, autoupdate: false },
            },
          ]),
        },
      }),
    );
    const result = await loadSettings({
      directory: "/repo",
      projectID: "project-1",
      capabilities: ["config"],
    });
    expect(result.configSources[0]?.summary).toEqual({ update });
  });

  it("keeps failed and non-server plugins in the typed inventory without checking or updating", async () => {
    const data = [
      {
        id: "tools",
        source: {
          type: "package",
          target: "@acme/tools@beta",
          version: "1.0.0",
          outdated: true,
          updating: true,
        },
        features: { server: true, rpc: true },
        state: { status: "active" },
      },
      {
        source: { type: "local", path: "/repo/.opencode/plugins/broken.ts" },
        features: {},
        state: { status: "failed", error: "Setup failed", ref: "broken.ts" },
      },
      {
        id: "terminal",
        source: { type: "builtin" },
        features: { tui: true },
        state: { status: "active" },
      },
    ];
    const plugin = {
      list: vi.fn().mockResolvedValue({ location, data }),
      check: vi.fn(),
      update: vi.fn(),
      awaitActivation: vi.fn(),
    };
    setOpenCodeClientForTest(client({ plugin }));
    const result = await loadSettings({
      directory: "/repo",
      projectID: "project-1",
      capabilities: ["plugins"],
    });
    expect(result.plugins).toEqual(data);
    expect(result.errors).toContainEqual({
      capability: "plugins",
      label: "Plugins",
      message: "Setup failed",
      reference: "broken.ts",
    });
    expect(plugin.check).not.toHaveBeenCalled();
    expect(plugin.update).not.toHaveBeenCalled();
    expect(plugin.awaitActivation).not.toHaveBeenCalled();
  });

  it("checks package updates explicitly in the selected workspace without installing", async () => {
    const check = vi.fn().mockResolvedValue({ location, data: [] });
    const update = vi.fn();
    setOpenCodeClientForTest(client({ plugin: { check, update } }));
    await checkPluginUpdates({
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
    });
    expect(check).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the exact package target and waits for activation before completing", async () => {
    const order: string[] = [];
    const update = vi.fn().mockImplementation(async () => {
      order.push("update");
    });
    const awaitActivation = vi.fn().mockImplementation(async () => {
      order.push("activation");
    });
    setOpenCodeClientForTest(client({ plugin: { update, awaitActivation } }));
    await updatePlugin({
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
      target: "@acme/tools@beta",
    });
    expect(update).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" }, targets: ["@acme/tools@beta"] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(awaitActivation).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(order).toEqual(["update", "activation"]);
  });

  it("propagates package update and activation failures", async () => {
    const update = vi.fn().mockRejectedValue(new Error("Registry unavailable"));
    const awaitActivation = vi.fn().mockRejectedValue(new Error("Activation timed out"));
    setOpenCodeClientForTest(client({ plugin: { update, awaitActivation } }));
    const input = { projectID: "project-1", directory: "/repo", target: "tools" };
    await expect(updatePlugin(input)).rejects.toThrow("Registry unavailable");
    expect(awaitActivation).not.toHaveBeenCalled();
    update.mockResolvedValue(undefined);
    await expect(updatePlugin(input)).rejects.toThrow("Activation timed out");
  });

  it.each(["disable", "notify", "auto", undefined] as const)(
    "preserves the configured update policy %s without choosing a default",
    async (update) => {
      const value = client();
      vi.mocked(value.config.get).mockResolvedValue([
        {
          type: "document",
          path: "/home/user/.config/opencode/opencode.json",
          info: update === undefined ? {} : { update },
        },
      ]);
      setOpenCodeClientForTest(value);

      const result = await loadSettings({
        projectID: "project-1",
        directory: "/repo",
        capabilities: ["config"],
      });

      expect(result.configSources[0]?.summary).toEqual(update === undefined ? {} : { update });
    },
  );

  it("keeps documents and failed-plugin diagnostics when activation rejects", async () => {
    const value = client();
    vi.mocked(value.config.get).mockResolvedValue([
      { type: "document", path: "/repo/opencode.json", info: { default_agent: "build" } },
    ]);
    vi.mocked(value.plugin.awaitActivation).mockRejectedValue(new Error("activation unavailable"));
    vi.mocked(value.plugin.list).mockResolvedValue({
      location,
      data: [
        {
          source: { type: "local", path: "/repo/broken.ts" },
          features: {},
          state: { status: "failed", error: "setup failed", ref: "failure-1" },
        },
      ],
    });
    setOpenCodeClientForTest(value);

    const result = await loadSettings({
      projectID: "project-1",
      directory: "/repo",
      capabilities: ["config", "plugins", "agents"],
    });

    expect(result.configSources[0]?.summary?.defaultAgent).toBe("build");
    expect(result.plugins[0]).toMatchObject({ state: { status: "failed", ref: "failure-1" } });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "agents", message: "activation unavailable" }),
        expect.objectContaining({ capability: "plugins", message: "setup failed" }),
      ]),
    );
    expect(value.agent.list).not.toHaveBeenCalled();
  });

  it("keeps successful capabilities when one request times out", async () => {
    const deadlines: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    const value = client();
    vi.mocked(value.config.get).mockResolvedValue([
      { type: "document", path: "/repo/opencode.json", info: {} },
    ]);
    let pluginSignal: AbortSignal | undefined;
    vi.mocked(value.plugin.list).mockImplementation((_input, options) => {
      pluginSignal = options!.signal;
      return new Promise((_resolve, reject) => {
        pluginSignal!.addEventListener("abort", () => reject(pluginSignal!.reason), { once: true });
      });
    });
    setOpenCodeClientForTest(value);
    const pending = loadSettings({
      projectID: "project-1",
      directory: "/repo",
      capabilities: ["config", "plugins"],
    });
    const deadline = deadlines.find((controller) => controller.signal === pluginSignal)!;
    deadline.abort(new DOMException("Plugin inventory timed out", "TimeoutError"));

    const result = await pending;
    expect(result.configSources[0]?.path).toBe("/repo/opencode.json");
    expect(result.errors).toContainEqual(
      expect.objectContaining({ capability: "plugins", message: "Plugin inventory timed out" }),
    );
    expect(deadlines.filter((controller) => controller.signal.aborted)).toHaveLength(1);
  });

  it("loads only requested settings capabilities", async () => {
    const config = vi.fn().mockResolvedValue([]);
    const agents = vi.fn().mockResolvedValue({ location, data: [] });
    const getLocation = vi.fn().mockResolvedValue(location);
    const value = client({
      location: { get: getLocation },
      config: { get: config },
      agent: { list: agents },
    });
    setOpenCodeClientForTest(value);

    await loadSettings({
      projectID: "project-1",
      directory: "/repo",
      capabilities: ["config"],
    });

    expect(config).toHaveBeenCalledOnce();
    expect(agents).not.toHaveBeenCalled();
    expect(getLocation).not.toHaveBeenCalled();
    expect(value.model.list).not.toHaveBeenCalled();
  });

  it("preserves OpenCode's active-first connection ordering", async () => {
    setOpenCodeClientForTest(
      client({
        integration: {
          list: vi.fn().mockResolvedValue({
            location,
            data: [
              {
                id: "anthropic",
                name: "Anthropic",
                methods: [],
                connections: [
                  { type: "credential", id: "active", label: "Work" },
                  { type: "credential", id: "inactive", label: "Personal" },
                  { type: "env", name: "ANTHROPIC_API_KEY" },
                ],
              },
            ],
          }),
        },
      }),
    );

    const result = await loadSettings({
      projectID: "project-1",
      directory: "/repo",
      capabilities: ["integrations"],
    });

    expect(result.integrations[0]?.connections).toEqual([
      { type: "credential", id: "active", label: "Work", active: true },
      { type: "credential", id: "inactive", label: "Personal", active: false },
      { type: "env", id: null, label: "ANTHROPIC_API_KEY", active: false },
    ]);
  });

  it("keeps successful settings projections when another capability fails", async () => {
    setOpenCodeClientForTest(
      client({
        config: {
          get: vi.fn().mockResolvedValue([
            {
              type: "document",
              path: "/repo/opencode.json",
              info: {
                model: { providerID: "openai", model: "gpt-5.6" },
                update: "notify",
                formatter: {
                  prettier: {
                    command: ["prettier", "--write"],
                    extensions: [".ts"],
                    environment: { NODE_ENV: "development" },
                  },
                },
                lsp: {
                  typescript: {
                    command: ["typescript-language-server", "--stdio"],
                    initialization: { preferences: {} },
                  },
                },
                permissions: [{ action: "read", resource: "*", effect: "allow" }],
              },
            },
          ]),
        },
        agent: { list: vi.fn().mockRejectedValue(new Error("agents unavailable")) },
        integration: {
          list: vi.fn().mockResolvedValue({
            location,
            data: [
              {
                id: "github",
                name: "GitHub",
                metadata: { category: "source-control" },
                methods: [
                  {
                    id: "oauth",
                    type: "oauth",
                    label: "Browser",
                    form: [
                      {
                        key: "account",
                        type: "string",
                        title: "Account",
                        required: true,
                      },
                    ],
                  },
                ],
                connections: [
                  { type: "credential", id: "credential-1", label: "Work" },
                  { type: "credential", id: "credential-2", label: "Personal" },
                  { type: "env", name: "GITHUB_TOKEN" },
                ],
              },
            ],
          }),
        },
        mcp: {
          list: vi.fn().mockResolvedValue({
            location,
            data: [{ name: "docs", status: { status: "connected" } }],
          }),
          resource: {
            catalog: vi.fn().mockRejectedValue(new Error("resources unavailable")),
          },
        },
        permission: {
          saved: {
            list: vi
              .fn()
              .mockResolvedValue([
                { id: "permission-1", projectID: "project-1", action: "read", resource: "*" },
              ]),
          },
        },
      }),
    );

    const result = await loadSettings({
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
    });

    expect(result.location).toEqual({ directory: "/repo", workspaceID: "workspace-1" });
    expect(result.configSources[0]).toMatchObject({
      path: "/repo/opencode.json",
      summary: {
        model: "openai/gpt-5.6",
        update: "notify",
        formatterCount: 1,
        lspCount: 1,
      },
      formatters: [{ id: "prettier", executable: "prettier", argumentCount: 1 }],
      languageServers: [{ id: "typescript", executable: "typescript-language-server" }],
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
    });
    expect(result.integrations[0]).toMatchObject({
      id: "github",
      methods: [{ id: "oauth", form: [{ key: "account", required: true }] }],
      connections: [
        { id: "credential-1", label: "Work", active: true },
        { id: "credential-2", label: "Personal", active: false },
        { id: null, label: "GITHUB_TOKEN", active: false },
      ],
      metadata: { category: "source-control" },
    });
    expect(result.mcpServers).toEqual([
      { name: "docs", status: "connected", error: null, integrationID: null },
    ]);
    expect(result.savedPermissions).toHaveLength(1);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "agents", message: "agents unavailable" }),
        expect.objectContaining({
          capability: "mcpResources",
          message: "resources unavailable",
        }),
      ]),
    );
  });

  it("projects active plugins and reports plugin load failures", async () => {
    setOpenCodeClientForTest(
      client({
        plugin: {
          awaitActivation: vi.fn().mockResolvedValue(undefined),
          list: vi.fn().mockResolvedValue({
            location,
            data: [
              {
                id: "opencode-preview-plugin",
                source: { type: "local", path: "/repo/.opencode/plugins/preview" },
                features: { server: true, rpc: true },
                state: { status: "active" },
              },
              {
                source: { type: "local", path: "/repo/.opencode/plugins/broken" },
                features: {},
                state: {
                  status: "failed",
                  error: "plugin failed to load",
                  ref: "plugin-load-42",
                },
              },
            ],
          }),
        },
      }),
    );

    const result = await loadSettings({ projectID: "project-1", directory: "/repo" });

    expect(result.plugins).toEqual([
      expect.objectContaining({
        id: "opencode-preview-plugin",
        source: { type: "local", path: "/repo/.opencode/plugins/preview" },
        state: { status: "active" },
      }),
      expect.objectContaining({
        state: { status: "failed", error: "plugin failed to load", ref: "plugin-load-42" },
      }),
    ]);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        capability: "plugins",
        message: "plugin failed to load",
        reference: "plugin-load-42",
      }),
    );
  });

  it("checks and updates package plugins through the official client", async () => {
    const check = vi.fn().mockResolvedValue({
      location,
      data: [
        {
          id: "example",
          source: {
            type: "package",
            target: "@example/opencode-plugin@latest",
            version: "1.0.0",
            outdated: true,
          },
          features: { server: true },
          state: { status: "active" },
        },
      ],
    });
    const update = vi.fn().mockResolvedValue(undefined);
    const awaitActivation = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ plugin: { list: vi.fn(), awaitActivation, check, update } }));

    await expect(
      checkPlugins({ projectID: "project-1", directory: "/repo", workspaceID: "workspace-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "example",
        source: {
          type: "package",
          target: "@example/opencode-plugin@latest",
          version: "1.0.0",
          outdated: true,
        },
      }),
    ]);
    await updatePlugins({
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
      targets: ["@example/opencode-plugin@latest"],
    });

    expect(check).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(update).toHaveBeenCalledWith(
      {
        location: { directory: "/repo", workspace: "workspace-1" },
        targets: ["@example/opencode-plugin@latest"],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(awaitActivation).toHaveBeenCalledOnce();
    expect(awaitActivation).toHaveBeenLastCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("adds an MCP server through the official client after resolving the location", async () => {
    const get = vi.fn().mockResolvedValue(location);
    const add = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ location: { get }, mcp: { add } }));

    await addMcpServer({
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
      server: "docs",
      config: { type: "remote", url: "https://mcp.example.com" },
    });

    expect(get).toHaveBeenCalledWith(
      { location: { directory: "/repo", workspace: "workspace-1" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(add).toHaveBeenCalledWith(
      {
        server: "docs",
        location: { directory: "/repo", workspace: "workspace-1" },
        config: { type: "remote", url: "https://mcp.example.com" },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("activates a stored credential through the official client", async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    const integrations = vi.fn().mockResolvedValue({
      location,
      data: [
        {
          id: "anthropic",
          name: "Anthropic",
          methods: [],
          connections: [{ type: "credential", id: "credential-1", label: "Work" }],
        },
      ],
    });
    setOpenCodeClientForTest(
      client({
        integration: { list: integrations },
        credential: { activate },
      }),
    );

    await activateCredential({
      projectID: "project-1",
      directory: "/repo",
      credentialID: "credential-1",
    });

    expect(activate).toHaveBeenCalledWith(
      { credentialID: "credential-1", location: { directory: "/repo" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses the project resolved from the settings location for saved permissions", async () => {
    const list = vi.fn().mockResolvedValue([]);
    setOpenCodeClientForTest(
      client({
        location: {
          get: vi.fn().mockResolvedValue({
            ...location,
            project: { ...location.project, id: "resolved-project" },
          }),
        },
        permission: { saved: { list } },
      }),
    );

    await loadSettings({ projectID: "stale-project", directory: "/repo" });

    expect(list).toHaveBeenCalledWith(
      { projectID: "resolved-project" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("cancels the aggregate settings read through the caller signal", async () => {
    let capabilitySignal: AbortSignal | undefined;
    const config = vi.fn().mockImplementation((_input, options) => {
      capabilitySignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
      });
    });
    setOpenCodeClientForTest(client({ config: { get: config } }));
    const controller = new AbortController();
    const pending = loadSettings({ projectID: "project-1", directory: "/repo" }, controller.signal);
    await vi.waitFor(() => expect(capabilitySignal).toBeDefined());

    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(capabilitySignal?.aborted).toBe(true);
  });

  it("maps an official OAuth connection attempt to the Palot result", async () => {
    const connect = vi.fn().mockResolvedValue({
      location,
      data: {
        attemptID: "attempt-1",
        url: "https://github.com/login/oauth/authorize",
        instructions: "Continue in your browser",
        mode: "code",
        time: { created: 10, expires: "Infinity" },
      },
    });
    setOpenCodeClientForTest(client({ integration: { oauth: { connect } } }));

    const result = await connectIntegrationOAuth({
      projectID: "project-1",
      directory: "/repo",
      integrationID: "github",
      methodID: "oauth",
      answer: { account: "work" },
      label: "Work",
    });

    expect(connect).toHaveBeenCalledWith(
      {
        integrationID: "github",
        methodID: "oauth",
        location: { directory: "/repo" },
        answer: { account: "work" },
        label: "Work",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({
      attemptID: "attempt-1",
      url: "https://github.com/login/oauth/authorize",
      instructions: "Continue in your browser",
      mode: "code",
      createdAt: 10,
      expiresAt: Number.POSITIVE_INFINITY,
    });
  });

  it("rechecks the approved integration command before executing it", async () => {
    const list = vi.fn().mockResolvedValue({
      location,
      data: [
        {
          id: "github",
          name: "GitHub",
          connections: [],
          methods: [
            {
              id: "gh-cli",
              type: "command",
              label: "GitHub CLI",
              command: ["gh", "auth", "login"],
            },
          ],
        },
      ],
    });
    const connect = vi.fn().mockResolvedValue({
      location,
      data: { attemptID: "command-1", time: { created: 20, expires: 40 } },
    });
    setOpenCodeClientForTest(client({ integration: { list, command: { connect } } }));

    const result = await connectIntegrationCommand({
      projectID: "project-1",
      directory: "/repo",
      integrationID: "github",
      methodID: "gh-cli",
      command: ["gh", "auth", "login"],
      label: "Work CLI",
    });

    expect(list).toHaveBeenCalledWith(
      { location: { directory: "/repo" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(connect).toHaveBeenCalledWith(
      {
        integrationID: "github",
        methodID: "gh-cli",
        location: { directory: "/repo" },
        label: "Work CLI",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({ attemptID: "command-1", createdAt: 20, expiresAt: 40 });
  });

  it("rejects an integration command that changed after approval", async () => {
    const connect = vi.fn();
    const list = vi.fn().mockResolvedValue({
      location,
      data: [
        {
          id: "github",
          name: "GitHub",
          connections: [],
          methods: [
            { id: "gh-cli", type: "command", label: "GitHub CLI", command: ["rm", "-rf", "/"] },
          ],
        },
      ],
    });
    setOpenCodeClientForTest(client({ integration: { list, command: { connect } } }));

    await expect(
      connectIntegrationCommand({
        projectID: "project-1",
        directory: "/repo",
        integrationID: "github",
        methodID: "gh-cli",
        command: ["gh", "auth", "login"],
      }),
    ).rejects.toThrow("changed after it was reviewed");
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects unsafe remote MCP URLs before registration", async () => {
    const add = vi.fn();
    setOpenCodeClientForTest(client({ mcp: { add } }));

    await expect(
      addMcpServer({
        projectID: "project-1",
        directory: "/repo",
        server: "unsafe",
        config: { type: "remote", url: "file:///tmp/server" },
      }),
    ).rejects.toThrow("HTTP or HTTPS");
    expect(add).not.toHaveBeenCalled();
  });

  it("connects, disconnects, and removes an MCP server in its owning location", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ mcp: { connect, disconnect, remove } }));
    const input = {
      projectID: "project-1",
      directory: "/repo",
      server: "docs",
    };

    await connectMcpServer(input);
    await disconnectMcpServer(input);
    await removeMcpServer(input);

    const expected = { server: "docs", location: { directory: "/repo" } };
    expect(connect).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(disconnect).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(remove).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
