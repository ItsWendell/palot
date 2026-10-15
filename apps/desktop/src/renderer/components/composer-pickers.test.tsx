import { useState } from "react";
import { Provider, createStore } from "jotai";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotModel, PalotProvider, PalotSession } from "../../shared";
import { modelPickerUsageAtom } from "../lib/model-preferences";
import { ModelPicker, ReasoningPicker } from "./composer-pickers";

vi.mock("../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const DAY = 24 * 60 * 60 * 1000;
const SCOPE = JSON.stringify(["profile", "project"]);

function model(
  providerID: string,
  id: string,
  name: string,
  overrides: Partial<PalotModel> = {},
): PalotModel {
  return {
    id,
    modelID: id,
    providerID,
    name,
    family: null,
    variants: [],
    inputLimit: null,
    contextLimit: 200_000,
    outputLimit: 32_000,
    releasedAt: Date.now() - 400 * DAY,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    status: "active",
    ...overrides,
  };
}

const deep = model("openai", "deep", "Deep", {
  variants: ["low", "high"],
  capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
  cost: [
    { contextOver: null, input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    { contextOver: 200_000, input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 0 },
  ],
});
const fast = model("openai", "fast", "Fast", { releasedAt: Date.now() - 3 * DAY });
const legacy = model("openai", "legacy", "Legacy", { status: "deprecated" });
const sonnet = model("anthropic", "sonnet", "Claude Sonnet", { contextLimit: 1_000_000 });
const models = [deep, fast, legacy, sonnet];
const providers: PalotProvider[] = [
  { id: "openai", name: "OpenAI", integrationID: null, package: "openai", disabled: false },
  { id: "anthropic", name: "Anthropic", integrationID: null, package: "a", disabled: false },
];
const session: PalotSession = {
  id: "session",
  parentID: null,
  projectID: "project",
  title: null,
  agent: null,
  model: { id: "deep", providerID: "openai" },
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function renderModelPicker(store = createStore()) {
  const onSelectModel = vi.fn().mockResolvedValue(undefined);
  const onManageModels = vi.fn();
  const complete = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <ModelPicker
        session={session}
        models={models}
        catalogModels={models}
        defaultModel={fast}
        providers={providers}
        preferenceScope={SCOPE}
        open={open}
        onOpenChange={setOpen}
        onSelectionComplete={complete}
        onSelectModel={onSelectModel}
        onManageModels={onManageModels}
        disabled={false}
      />
    );
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return { store, onSelectModel, onManageModels, complete };
}

const groupOptions = (name: string) =>
  within(screen.getByRole("group", { name }))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("ModelPicker", () => {
  it("lists favorites, recent models, then every visible model by provider", async () => {
    const store = createStore();
    store.set(modelPickerUsageAtom, {
      [SCOPE]: { favorites: ["anthropic/sonnet"], recent: ["anthropic/sonnet", "openai/fast"] },
    });
    renderModelPicker(store);
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep" }));
    const list = await screen.findByRole("listbox", { name: "Models" });
    expect(
      within(list)
        .getAllByRole("group")
        .map((group) => group.getAttribute("data-picker-section")),
    ).toEqual(["favorites", "recent", "provider:openai", "provider:anthropic"]);
    expect(groupOptions("Favorites")).toEqual(["Claude SonnetAnthropic1M"]);
    // A favorite isn't repeated under Recent.
    expect(groupOptions("Recent")).toEqual(["FastNewDefaultOpenAI200K"]);
    expect(groupOptions("OpenAI")).toEqual([
      "Deep200K",
      "FastNewDefault200K",
      "LegacyDeprecated200K",
    ]);
    // Searching drops the shortcut sections so each model appears once.
    await userEvent.type(screen.getByRole("combobox", { name: "Choose model" }), "claude");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Claude Sonnet1M",
    ]);
  });

  it("stars a model from the details and persists it per project", async () => {
    const { store } = renderModelPicker();
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep" }));
    const details = await screen.findByRole("complementary", { name: "Details" });
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    await userEvent.click(within(details).getByRole("button", { name: "Add to favorites" }));
    expect(store.get(modelPickerUsageAtom)[SCOPE]?.favorites).toEqual(["openai/deep"]);
    expect(groupOptions("Favorites")).toEqual(["DeepOpenAI200K"]);
    const remove = within(details).getByRole("button", { name: "Remove from favorites" });
    expect(remove.getAttribute("aria-pressed")).toBe("true");
  });

  it("describes the highlighted model", async () => {
    renderModelPicker();
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep" }));
    const details = await screen.findByRole("complementary", { name: "Details" });
    const text = details.textContent ?? "";
    expect(within(details).getByText("OpenAI")).toBeTruthy();
    expect(within(details).getByTitle("deep").textContent).toBe("deep");
    expect(text).toContain("Context200K tokens");
    expect(text).toContain("Max output32K tokens");
    expect(text).toContain("InputText, Image, PDF");
    expect(text).toContain("ToolsSupported");
    expect(text).toContain("$1.25 in · $10.00 out");
    expect(text).toContain("per 1M tokens, base tier");
    expect(text).toContain("ReasoningLow, High");
  });

  it("switches models, remembers them as recent, and opens model settings", async () => {
    const { store, onSelectModel, onManageModels, complete } = renderModelPicker();
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep" }));
    await userEvent.click(await screen.findByRole("option", { name: /^Claude Sonnet/ }));
    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledExactlyOnceWith({
        id: "sonnet",
        providerID: "anthropic",
      }),
    );
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(store.get(modelPickerUsageAtom)[SCOPE]?.recent).toEqual(["anthropic/sonnet"]);
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep" }));
    await userEvent.click(await screen.findByRole("button", { name: "Manage models" }));
    expect(onManageModels).toHaveBeenCalledOnce();
  });
});

describe("ReasoningPicker", () => {
  function renderReasoning(sessionModel: PalotSession["model"]) {
    const onSelectVariant = vi.fn().mockResolvedValue(undefined);
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <ReasoningPicker
          session={{ ...session, model: sessionModel }}
          catalogModels={models}
          defaultModel={fast}
          open={open}
          onOpenChange={setOpen}
          onSelectionComplete={vi.fn()}
          onSelectVariant={onSelectVariant}
          disabled={false}
        />
      );
    }
    render(<Harness />);
    return { onSelectVariant };
  }

  it("is hidden for models without reasoning options", () => {
    renderReasoning({ id: "fast", providerID: "openai" });
    expect(screen.queryByRole("button", { name: /^Reasoning:/ })).toBeNull();
  });

  it("offers Auto and each variant and applies the chosen effort", async () => {
    const { onSelectVariant } = renderReasoning({
      id: "deep",
      providerID: "openai",
      variant: "high",
    });
    await userEvent.click(screen.getByRole("button", { name: "Reasoning: High" }));
    expect(
      screen
        .getAllByRole("option")
        .map((option) => [option.textContent, option.getAttribute("aria-selected")]),
    ).toEqual([
      ["AutoUse the model's default effort", "false"],
      ["Low", "false"],
      ["High", "true"],
    ]);
    await userEvent.click(screen.getByRole("option", { name: /^Auto/ }));
    await waitFor(() =>
      expect(onSelectVariant).toHaveBeenCalledExactlyOnceWith({ id: "deep", providerID: "openai" }),
    );
  });
});
