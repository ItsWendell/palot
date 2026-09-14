import type { OpenCodeClient, PluginInfo } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PalotModel,
  PalotPlugin,
  PalotProject,
  PalotSettingsSnapshot,
  SettingsCapability,
} from "../../shared";
import { modelPickerPreferencesAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import { openCodeInvalidationKeys } from "../lib/opencode-query-events";
import { openCodeKeys } from "../lib/opencode-query";
import { modelProjectPreferenceKey } from "../lib/model-preferences";
import { createRendererQueryClient } from "../lib/query-client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { checkPlugins, loadSettings } from "../services/opencode-settings";
import { palot } from "../services/palot";
import { ModelSettings, PluginSettings, ToolSettings } from "./settings";

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Example",
  sandboxes: [],
  vcs: null,
  updatedAt: null,
};
const location = {
  directory: "/repo",
  project: { id: project.id, directory: "/repo", canonical: "/repo" },
};

function connectedSettingsStore() {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
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
  });
  return store;
}
const preferenceScope = modelProjectPreferenceKey("local-default", project.id);

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

describe("Settings inventory", () => {
  const plugin: PalotPlugin = {
    id: "Example plugin",
    source: {
      type: "package",
      target: "@acme/workflow@latest",
      version: "1.0.0",
      outdated: false,
      updating: false,
    },
    features: { server: true },
    state: { status: "active" },
  };

  function toolsSnapshot(patch: Partial<PalotSettingsSnapshot> = {}): PalotSettingsSnapshot {
    return {
      location,
      catalog: { models: [], providers: [], defaultModel: null, errors: [] },
      configSources: [],
      agents: [],
      integrations: [],
      mcpServers: [],
      mcpResources: [],
      mcpResourceTemplates: [],
      savedPermissions: [],
      plugins: [plugin],
      skills: [],
      commands: [],
      references: [],
      websearchProviders: [],
      errors: [],
      ...patch,
    };
  }

  function renderTools(
    snapshot: PalotSettingsSnapshot | null = toolsSnapshot(),
    pendingCapabilities: SettingsCapability[] = [],
    capabilityStates?: Parameters<typeof ToolSettings>[0]["capabilityStates"],
  ) {
    const refresh = vi.fn(async () => {});
    const queryClient = createRendererQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={connectedSettingsStore()}>
          <ToolSettings
            project={project}
            location={location}
            snapshot={snapshot}
            pendingCapabilities={pendingCapabilities}
            capabilityStates={capabilityStates}
            refresh={refresh}
          />
        </Provider>
      </QueryClientProvider>,
    );
    return { refresh };
  }

  it("opens Plugins first and supports arrow-key inventory navigation", async () => {
    renderTools();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Plugins",
      "MCP",
      "Skills",
      "Commands",
      "References",
      "Web search",
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Plugins" })).toBeTruthy();
    tabs[0]!.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "MCP" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "MCP" })).toBeTruthy();
    expect(screen.queryByRole("tabpanel", { name: "Plugins" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search mcp" })).toBeTruthy();
  });

  it("hides built-ins by default, lists them last when shown, and scopes search to the toggle", async () => {
    const builtin: PalotPlugin = {
      ...plugin,
      id: "Built-in tools",
      source: { type: "builtin" },
    };
    renderTools(toolsSnapshot({ plugins: [builtin, plugin] }));
    const user = userEvent.setup();
    const toggle = screen.getByRole("switch", { name: "Show built-in plugins" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("group", { name: "Built-in tools plugin" })).toBeNull();
    expect(screen.getByText("1 plugin · 1 built-in hidden")).toBeTruthy();
    await user.click(toggle);
    expect(screen.getAllByRole("group").map((row) => row.getAttribute("aria-label"))).toEqual([
      "Example plugin plugin",
      "Built-in tools plugin",
    ]);
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await user.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.type(screen.getByRole("searchbox", { name: "Search plugins" }), "Built-in tools");
    expect(screen.getByText("1 of 2 plugins")).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByRole("group", { name: "Built-in tools plugin" })).toBeNull();
    expect(screen.getByText("No plugins match this search.")).toBeTruthy();
    expect(screen.getByText("0 of 1 plugins · 1 built-in hidden")).toBeTruthy();
  });

  it("explains an inventory containing only hidden built-ins and lets users reveal it", async () => {
    renderTools(toolsSnapshot({ plugins: [{ ...plugin, source: { type: "builtin" } }] }));
    expect(
      screen.getByText("No added plugins. Show built-in plugins to browse OpenCode defaults."),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("switch", { name: "Show built-in plugins" }));
    expect(screen.getByRole("group", { name: "Example plugin plugin" })).toBeTruthy();
    expect(screen.queryByText(/No added plugins/)).toBeNull();
  });

  it("filters by source and description, distinguishes no matches, and keeps searches scoped without fetching", async () => {
    const load = vi.spyOn(palot, "loadSettings");
    const { refresh } = renderTools(
      toolsSnapshot({
        references: [
          {
            name: "Handbook",
            path: "/references/handbook",
            hidden: false,
            description: "Deployment procedures",
            sourceType: "git",
            source: "https://example.com/team/operations",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "Search plugins" });
    await user.type(search, "acme/workflow");
    expect(screen.getByRole("group", { name: "Example plugin plugin" })).toBeTruthy();
    await user.clear(search);
    await user.type(search, "missing-source");
    expect(screen.getByText("No plugins match this search.")).toBeTruthy();
    expect(screen.queryByText("No plugins were returned.")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "References" }));
    const referencesSearch = screen.getByRole("searchbox", { name: "Search references" });
    expect((referencesSearch as HTMLInputElement).value).toBe("");
    await user.type(referencesSearch, "team/operations");
    expect(
      within(screen.getByRole("tabpanel", { name: "References" })).getByText("Handbook"),
    ).toBeTruthy();
    await user.clear(referencesSearch);
    await user.type(referencesSearch, "Deployment procedures");
    expect(
      within(screen.getByRole("tabpanel", { name: "References" })).getByText("Handbook"),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(
      (screen.getByRole("searchbox", { name: "Search plugins" }) as HTMLInputElement).value,
    ).toBe("missing-source");
    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps in-flight plugin actions disabled across tab switches", async () => {
    const pending = Promise.withResolvers<PalotPlugin[]>();
    const check = vi.spyOn(palot, "checkPlugins").mockReturnValue(pending.promise);
    renderTools(
      toolsSnapshot({
        plugins: [
          {
            ...plugin,
            source: { type: "package", target: "@acme/workflow@latest", outdated: true },
          },
        ],
      }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await user.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Update" }).hasAttribute("disabled")).toBe(true);
    await act(async () => pending.resolve([plugin]));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("does not call failed, loading, or unavailable inventories empty", async () => {
    renderTools(
      toolsSnapshot({
        plugins: [],
        errors: [{ capability: "plugins", label: "Plugins", message: "Inventory request failed" }],
      }),
      ["skills"],
    );
    const user = userEvent.setup();
    expect(
      within(screen.getByRole("tabpanel", { name: "Plugins" })).getByRole("alert").textContent,
    ).toContain("Inventory request failed");
    expect(screen.queryByText("No plugins were returned.")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    expect(
      within(screen.getByRole("tabpanel", { name: "Skills" })).getByRole("status").textContent,
    ).toContain("Loading skills");
    expect(screen.queryByText("No skills were returned.")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Commands" }));
    expect(
      within(screen.getByRole("tabpanel", { name: "Commands" })).getByText(
        "No commands were returned.",
      ),
    ).toBeTruthy();
    cleanup();
    renderTools(toolsSnapshot({ plugins: [] }), [], { plugins: { status: "unavailable" } });
    expect(
      within(screen.getByRole("tabpanel", { name: "Plugins" })).getByText(
        /Plugins are unavailable/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No plugins were returned.")).toBeNull();
  });

  it("keeps a successful plugin list usable when SDK diagnostics differ from the failed plugin error", () => {
    const activationError =
      "Error: Workflow plugin activation failed at setup (/repo/.local/desktop-e2e/workflow-failed-plugin/index.mjs:3:23) at anonymous ($bunfs/root/chunk-x9xz630c.js:1399:25532)";
    renderTools(
      toolsSnapshot({
        plugins: [
          {
            ...plugin,
            source: { type: "package", target: "@acme/workflow@latest", outdated: true },
          },
          {
            ...plugin,
            id: "Workflow",
            source: { type: "local", path: "/repo/workflow" },
            state: { status: "failed", error: activationError },
          },
        ],
        errors: [
          {
            capability: "plugins",
            label: "Plugins",
            message: `PluginActivationError: ${activationError}\n    at Effect.runPromise (/sdk/activation.js:24:8)`,
          },
        ],
      }),
    );
    const panel = within(screen.getByRole("tabpanel", { name: "Plugins" }));
    expect(panel.queryByText("Could not load plugins.")).toBeNull();
    expect(panel.getByRole("group", { name: "Example plugin plugin" })).toBeTruthy();
    expect(panel.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(panel.getByRole("button", { name: "Update" }).hasAttribute("disabled")).toBe(false);
    const failed = within(panel.getByRole("group", { name: "Workflow plugin" }));
    expect(failed.getByText("Failed")).toBeTruthy();
    const details = failed.getByText(activationError).closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it("keeps cached plugin rows and actions on refresh failure with collapsed diagnostics", async () => {
    const message =
      "Error: Connection reset at request (/sdk/plugin/list.js:401:9)\n    at async refreshPlugins (/sdk/client.js:93:4)";
    renderTools(toolsSnapshot(), [], { plugins: { status: "error", message } });
    const panel = within(screen.getByRole("tabpanel", { name: "Plugins" }));
    expect(panel.getByRole("group", { name: "Example plugin plugin" })).toBeTruthy();
    expect(panel.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(
      panel.getByText("Could not refresh plugins. Showing the last loaded inventory."),
    ).toBeTruthy();
    const details = panel.getByText(/Error: Connection reset/).closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    await userEvent.setup().click(panel.getByText("Error details for plugins"));
    expect(details?.open).toBe(true);
    expect(panel.queryByText("No plugins were returned.")).toBeNull();
  });

  it("shows labeled plugin status and expandable error details without claiming update checks succeeded", async () => {
    renderTools(
      toolsSnapshot({
        plugins: [
          {
            ...plugin,
            state: {
              status: "failed",
              error: "Could not activate\nDetailed failure context",
              ref: "https://example.com/errors/activation",
            },
          },
        ],
      }),
    );
    const row = screen.getByRole("group", { name: "Example plugin plugin" });
    expect(within(row).getByText("Failed")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByText("Up to date")).toBeNull();
    const details = within(row).getByText("Error details for Example plugin");
    expect(details.closest("details")?.open).toBe(false);
    await userEvent.setup().click(details);
    expect(details.closest("details")?.open).toBe(true);
    expect(within(row).getByText(/Detailed failure context/).textContent).toContain(
      "https://example.com/errors/activation",
    );
  });

  it("shows event-refreshed plugin versions and removals after checking updates", async () => {
    let inventory: PluginInfo[] = [
      {
        id: "example",
        source: { type: "package", target: "example@latest", version: "1.0.0" },
        features: { server: true },
        state: { status: "active" },
      },
    ];
    const list = vi.fn(async () => ({ location, data: inventory }));
    setOpenCodeClientForTest({
      plugin: {
        list,
        check: vi.fn(async () => {
          const checked = [
            {
              ...inventory[0]!,
              source: {
                type: "package",
                target: "example@latest",
                version: "1.0.0",
                outdated: true,
              },
            },
          ];
          return { location, data: checked };
        }),
      },
    } as unknown as OpenCodeClient);
    vi.spyOn(palot, "loadSettings").mockImplementation(loadSettings);
    vi.spyOn(palot, "checkPlugins").mockImplementation(checkPlugins);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();
    function Probe() {
      const settings = useSettingsSnapshot({
        projectID: project.id,
        directory: "/repo",
        capabilities: ["plugins"],
      });
      return (
        <PluginSettings
          project={project}
          location={location}
          plugins={settings.data?.plugins ?? []}
          refresh={async () => {
            await settings.refetch();
          }}
        />
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Probe />
        </Provider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await screen.findByText("1.0.0");
    const pendingList = Promise.withResolvers<{ location: typeof location; data: PluginInfo[] }>();
    list.mockImplementationOnce(() => pendingList.promise);
    let refresh: Promise<void> | undefined;
    act(() => {
      refresh = queryClient.refetchQueries({
        queryKey: openCodeKeys.settingsLocation("connection-1", location),
      });
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText("Update available");
    await act(async () => {
      pendingList.resolve({ location, data: inventory });
      await refresh;
    });
    expect(screen.getByText("Update available")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" }).hasAttribute("disabled")).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);

    async function publishInventoryChange() {
      await act(async () => {
        const keys = openCodeInvalidationKeys("connection-1", {
          id: "plugin-change",
          created: 1,
          createdAt: 1,
          receiveSequence: 1,
          type: "plugin.updated",
          location,
          data: {},
        });
        await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      });
    }
    inventory = [
      { ...inventory[0]!, source: { type: "package", target: "example@latest", version: "2.0.0" } },
    ];
    await publishInventoryChange();
    await screen.findByText("2.0.0");
    expect(screen.queryByText("1.0.0")).toBeNull();
    expect(screen.queryByText("Update available")).toBeNull();
    inventory = [];
    await publishInventoryChange();
    await screen.findByText("No plugins were returned.");
    expect(screen.queryByText("example")).toBeNull();
  });

  it.each([1, 2])(
    "preserves hidden direct OpenAI through visibility edits with %i same-brand connections present",
    async (count) => {
      const model: PalotModel = {
        id: "reasoner",
        modelID: "reasoner",
        providerID: "company-openai",
        canonicalProviderID: "openai",
        name: "Company reasoner",
        family: null,
        variants: [],
        inputLimit: null,
        contextLimit: 10000,
        outputLimit: 1000,
        releasedAt: 0,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        status: "active",
      };
      const directModel: PalotModel = {
        ...model,
        providerID: "openai",
        name: "Direct reasoner",
      };
      const otherModel: PalotModel = {
        ...model,
        id: "other",
        modelID: "other",
        providerID: "anthropic",
        canonicalProviderID: "anthropic",
        name: "Other model",
      };
      const aliases = [
        model,
        { ...model, providerID: "personal-openai", name: "Personal reasoner" },
      ].slice(0, count);
      const snapshot: PalotSettingsSnapshot = {
        location,
        catalog: {
          models: [directModel, ...aliases, otherModel],
          providers: [],
          defaultModel: null,
          errors: [],
        },
        configSources: [],
        agents: [],
        integrations: [],
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
      const store = connectedSettingsStore();
      store.set(modelPickerPreferencesAtom, {
        [preferenceScope]: {
          hidden: ["openai/reasoner"],
          order: ["openai/reasoner"],
        },
      });
      const view = render(
        <Provider store={store}>
          <ModelSettings project={project} snapshot={snapshot} />
        </Provider>,
      );
      expect(
        screen.getByRole("switch", { name: "Enable Direct reasoner" }).getAttribute("aria-checked"),
      ).toBe("false");
      view.rerender(
        <Provider store={store}>
          <ModelSettings
            project={project}
            snapshot={{
              ...snapshot,
              catalog: { ...snapshot.catalog, models: [...aliases, otherModel] },
            }}
          />
        </Provider>,
      );
      for (const alias of aliases) {
        expect(
          screen
            .getByRole("switch", { name: `Disable ${alias.name}` })
            .getAttribute("aria-checked"),
        ).toBe("true");
      }
      const control = screen.getByRole("switch", { name: "Disable Other model" });
      const user = userEvent.setup();
      await user.click(control);
      await waitFor(() => expect(control.getAttribute("aria-checked")).toBe("false"));
      expect(store.get(modelPickerPreferencesAtom)[preferenceScope]?.hidden).toEqual([
        "openai/reasoner",
        "anthropic/other",
      ]);
      await user.click(screen.getByRole("button", { name: "Deselect all" }));
      expect(store.get(modelPickerPreferencesAtom)[preferenceScope]?.hidden).toEqual(
        expect.arrayContaining(["openai/reasoner", "anthropic/other", "company-openai/reasoner"]),
      );
      await user.click(screen.getByRole("button", { name: "Select all" }));
      expect(store.get(modelPickerPreferencesAtom)[preferenceScope]?.hidden).toEqual([
        "openai/reasoner",
      ]);
      view.rerender(
        <Provider store={store}>
          <ModelSettings project={project} snapshot={snapshot} />
        </Provider>,
      );
      expect(
        screen.getByRole("switch", { name: "Enable Direct reasoner" }).getAttribute("aria-checked"),
      ).toBe("false");
      for (const alias of aliases) {
        expect(
          screen
            .getByRole("switch", { name: `Disable ${alias.name}` })
            .getAttribute("aria-checked"),
        ).toBe("true");
      }
      expect(
        screen.getByRole("switch", { name: "Disable Other model" }).getAttribute("aria-checked"),
      ).toBe("true");
    },
  );
});
