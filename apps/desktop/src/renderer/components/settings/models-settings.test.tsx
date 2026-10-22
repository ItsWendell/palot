import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotModel, PalotProject, PalotSettingsSnapshot } from "../../../shared";
import { defaultModelsAtom, modelPickerPreferencesAtom } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { modelProjectPreferenceKey } from "../../lib/model-preferences";
import { ModelSettings } from "./models-settings";

vi.mock("./settings-links", () => ({
  useModelProviderLinks: () => ({ available: false, openModels() {}, openProviders() {} }),
  useModelsProviderParam: () => undefined,
}));

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Example",
  sandboxes: [],
  vcs: null,
  updatedAt: null,
};
const scope = modelProjectPreferenceKey("local-default", project.id);
const DAY = 24 * 60 * 60 * 1000;

function model(patch: Partial<PalotModel> & Pick<PalotModel, "id" | "providerID" | "name">) {
  return {
    modelID: patch.id,
    family: null,
    variants: [],
    inputLimit: null,
    contextLimit: 200_000,
    outputLimit: 32_000,
    releasedAt: Date.now() - 400 * DAY,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    status: "active",
    ...patch,
  } satisfies PalotModel;
}

const gptNew = model({
  id: "gpt-new",
  providerID: "openai",
  name: "GPT New",
  releasedAt: Date.now() - 5 * DAY,
  variants: ["low", "high"],
  capabilities: { tools: true, temperature: true, input: ["text", "image"], output: ["text"] },
  cost: [
    { contextOver: null, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    { contextOver: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
  ],
});
const gptMini = model({
  id: "gpt-mini",
  providerID: "openai",
  name: "GPT Mini",
  status: "beta",
  capabilities: { tools: false, temperature: false, input: ["text"], output: ["text"] },
  cost: [{ contextOver: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
});
const claudeOld = model({
  id: "claude-old",
  providerID: "anthropic",
  name: "Claude Old",
  status: "deprecated",
});

function snapshot(): PalotSettingsSnapshot {
  return {
    location: { directory: "/repo" },
    configSources: [
      {
        type: "document",
        path: "/home/me/.config/opencode/opencode.json",
        summary: { model: "openai/gpt-mini" },
        formatters: [],
        languageServers: [],
        permissions: [],
      },
    ],
    catalog: {
      models: [gptNew, gptMini, claudeOld],
      defaultModel: gptMini,
      providers: [
        { id: "openai", name: "OpenAI", integrationID: "openai", package: "", disabled: false },
        {
          id: "anthropic",
          name: "Anthropic",
          integrationID: "anthropic",
          package: "",
          disabled: false,
        },
      ],
      errors: [],
    },
    agents: [
      {
        id: "plan",
        name: "plan",
        description: null,
        mode: "primary",
        hidden: false,
        color: null,
        steps: null,
        model: { providerID: "anthropic", id: "claude-old" },
        permissions: [],
      },
    ],
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
}

function renderModels(focusProvider?: string) {
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
  store.set(defaultModelsAtom, { [scope]: { providerID: "openai", id: "gpt-new" } });
  render(
    <Provider store={store}>
      <ModelSettings project={project} snapshot={snapshot()} focusProvider={focusProvider} />
    </Provider>,
  );
  return store;
}

const group = (name: string) => screen.queryByRole("region", { name: `${name} models` });
const trigger = (name: string) =>
  group(name)!.querySelector<HTMLElement>('[data-slot="accordion-trigger"]')!;

afterEach(cleanup);

describe("Models settings", () => {
  it("shows OpenCode's configured default with its file next to Palot's project override", () => {
    renderModels();
    expect(screen.getByText(/OpenCode config sets model to openai\/gpt-mini/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Config file" }).textContent).toContain(
      "/home/me/.config/opencode/opencode.json",
    );
    expect(
      screen.getByText(
        "Palot uses OpenAI · GPT New for new tasks in this project; OpenCode's own default is OpenAI · GPT Mini.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Anthropic · Claude Old")).toBeTruthy();
  });

  it("groups models by provider with visibility counts, prices, and badges", () => {
    renderModels();
    const openAI = group("OpenAI")!;
    expect(within(openAI).getByText("2 of 2 shown")).toBeTruthy();
    expect(
      within(openAI).getByText("$3 in · $15 out per M · tiered above 200K tokens"),
    ).toBeTruthy();
    expect(within(openAI).getByText("Free")).toBeTruthy();
    expect(within(openAI).getByText("New")).toBeTruthy();
    expect(within(openAI).getByText("Beta")).toBeTruthy();
    expect(within(openAI).getByText("2 effort levels")).toBeTruthy();
    expect(within(group("Anthropic")!).getByText("Deprecated")).toBeTruthy();
  });

  it("shows fixed temperature only when the model explicitly does not support it", () => {
    renderModels();
    const row = (name: string) =>
      within(
        screen
          .getByRole("switch", { name: `Show ${name}` })
          .closest<HTMLElement>('[data-slot="model-row"]')!,
      );

    expect(row("GPT Mini").getByText("Fixed temperature")).toBeTruthy();
    expect(row("GPT New").queryByText("Fixed temperature")).toBeNull();
    expect(row("Claude Old").queryByText("Fixed temperature")).toBeNull();
  });

  it("filters with chips and keeps provider groups while searching", async () => {
    const user = userEvent.setup();
    renderModels();
    const chips = screen.getByRole("group", { name: "Filter models" });
    await user.click(within(chips).getByRole("button", { name: "Vision" }));
    expect(group("Anthropic")).toBeNull();
    expect(within(group("OpenAI")!).getByRole("switch", { name: "Show GPT New" })).toBeTruthy();
    expect(within(group("OpenAI")!).queryByRole("switch", { name: "Show GPT Mini" })).toBeNull();
    await user.click(within(chips).getByRole("button", { name: "Deprecated" }));
    expect(screen.getByText("No models match this search and these filters.")).toBeTruthy();
    await user.click(within(chips).getByRole("button", { name: "Vision" }));
    await user.click(within(chips).getByRole("button", { name: "Deprecated" }));

    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "anthropic");
    expect(group("OpenAI")).toBeNull();
    expect(within(group("Anthropic")!).getByText("1 of 1 shown")).toBeTruthy();
    expect(
      within(group("Anthropic")!).getByRole("switch", { name: "Show Claude Old" }),
    ).toBeTruthy();
  });

  it("hides a whole provider and moves Palot's override off a hidden model", async () => {
    const user = userEvent.setup();
    const store = renderModels();
    await user.click(screen.getByRole("switch", { name: "Show all OpenAI models" }));
    await waitFor(() =>
      expect(store.get(modelPickerPreferencesAtom)[scope]?.hidden).toEqual([
        "openai/gpt-new",
        "openai/gpt-mini",
      ]),
    );
    expect(within(group("OpenAI")!).getByText("0 of 2 shown")).toBeTruthy();
    expect(store.get(defaultModelsAtom)[scope]).toEqual({
      providerID: "anthropic",
      id: "claude-old",
    });
    await user.click(screen.getByRole("switch", { name: "Show all OpenAI models" }));
    expect(store.get(modelPickerPreferencesAtom)[scope]?.hidden).toEqual([]);
  });

  it("expands only the deep-linked provider", () => {
    renderModels("anthropic");
    expect(trigger("Anthropic").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("OpenAI").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("switch", { name: "Show GPT New" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Show Claude Old" })).toBeTruthy();
  });
});
