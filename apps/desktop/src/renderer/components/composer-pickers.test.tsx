import { useRef, useState, type ReactElement } from "react";
import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as renderUi, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotModel, PalotProvider, PalotSession } from "../../shared";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { modelPickerUsageAtom } from "../lib/model-preferences";
import { openCodeKeys } from "../lib/opencode-query";
import { toast } from "./ui/toast";
import { createRendererQueryClient } from "../lib/query-client";
import { ModelPopover } from "./composer-pickers";

vi.mock("../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
afterEach(cleanup);

// The picker reads Console limits through the app's query client.
function render(ui: ReactElement, client = createRendererQueryClient()) {
  return renderUi(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
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

function renderModelPopover({
  store = createStore(),
  sessionModel = session.model,
}: {
  store?: ReturnType<typeof createStore>;
  sessionModel?: PalotSession["model"];
} = {}) {
  const onSelectModel = vi.fn().mockResolvedValue(undefined);
  const onSelectVariant = vi.fn().mockResolvedValue(undefined);
  const onManageModels = vi.fn();
  const complete = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    const editor = useRef<HTMLTextAreaElement>(null);
    return (
      <>
        <textarea ref={editor} aria-label="Editor" />
        <ModelPopover
          session={{ ...session, model: sessionModel }}
          models={models}
          catalogModels={models}
          defaultModel={fast}
          providers={providers}
          preferenceScope={SCOPE}
          open={open}
          onOpenChange={setOpen}
          finalFocus={() => editor.current}
          onSelectionComplete={complete}
          onSelectModel={onSelectModel}
          onSelectVariant={onSelectVariant}
          onManageModels={onManageModels}
          disabled={false}
        />
      </>
    );
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return { store, onSelectModel, onSelectVariant, onManageModels, complete };
}

const groupOptions = (name: string) =>
  within(screen.getByRole("group", { name }))
    .getAllByRole("option")
    .map((option) => option.textContent);

const effortOptions = () =>
  within(screen.getByRole("listbox", { name: /^Effort for/ }))
    .getAllByRole("option")
    .map((option) => [option.textContent, option.getAttribute("aria-selected")]);

describe("ModelPopover", () => {
  it("shows what Console leaves each paid model and warns once when the selected one runs low", async () => {
    const user = userEvent.setup();
    const resetsAt = Date.now() + 2 * 60 * 60_000;
    const gpt = model("opencode", "gpt", "GPT", {
      cost: [{ contextOver: null, input: 3, output: 15, cacheRead: 0, cacheWrite: 0 }],
    });
    const kimi = model("opencode-go", "kimi", "Kimi", {
      cost: [{ contextOver: null, input: 1, output: 4, cacheRead: 0, cacheWrite: 0 }],
    });
    const consoleModels = [gpt, kimi, sonnet];
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "one",
      profileID: "profile",
      connected: true,
      phase: "connected",
      version: "2.4.1",
    } as OpenCodeRuntimeStatus);
    const client = createRendererQueryClient();
    const meter = (percent: number) => ({ percent, limited: false, resetsAt });
    client.setQueryData(openCodeKeys.usageLimits("one", "/workspace"), {
      workspace: { id: "wrk_1", usageURL: "https://opencode.ai/console/wrk_1/usage" },
      go: { rolling: meter(38), weekly: meter(10), monthly: meter(5) },
      budgets: [
        {
          id: "all",
          limit: 100,
          spent: 90,
          scope: "each",
          per: "set",
          coverage: "all",
          models: [],
          vendors: [],
          picked: false,
          shared: false,
          resetsAt,
        },
      ],
    });
    const notify = vi.spyOn(toast, "add");
    const props = {
      session: { ...session, model: { id: "gpt", providerID: "opencode" } },
      models: consoleModels,
      catalogModels: consoleModels,
      defaultModel: null,
      providers: [
        ...providers,
        {
          id: "opencode",
          name: "OpenCode",
          integrationID: "opencode",
          package: "o",
          disabled: false,
        },
        { id: "opencode-go", name: "Go", integrationID: "opencode", package: "o", disabled: false },
      ],
      preferenceScope: SCOPE,
      onSelectionComplete: vi.fn(),
      onSelectModel: vi.fn(),
      onSelectVariant: vi.fn(),
      onManageModels: vi.fn(),
      disabled: false,
    };
    function Harness() {
      const [open, setOpen] = useState(false);
      return <ModelPopover {...props} open={open} onOpenChange={setOpen} />;
    }
    const view = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
      client,
    );
    await user.click(screen.getByRole("button", { name: /^Model: GPT/ }));
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(resetsAt);
    const sameDay = new Date(resetsAt).toDateString() === new Date().toDateString();
    const gptRow = groupOptions("OpenCode").find((text) => text?.startsWith("GPT"));
    expect(gptRow).toContain("10% left");
    if (sameDay) expect(gptRow).toContain(`resets ${time}`);
    expect(document.querySelector('[data-palot-model-limit="low"]')).toBeTruthy();
    expect(groupOptions("Go").find((text) => text?.startsWith("Kimi"))).toContain("62% left");
    // Models without a Console limit keep their context size.
    expect(groupOptions("Anthropic")[0]).toContain("1M");
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "warning", title: "Running low on GPT" }),
    );
    view.unmount();
    render(
      <Provider store={store}>
        <Harness />
      </Provider>,
      client,
    );
    // Once per limit window, across remounts.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reads model · effort on the pill and names the provider when names collide", () => {
    const direct = model("anthropic", "sonnet", "Claude Sonnet (latest)");
    const routed = model("opencode", "sonnet", "Claude Sonnet");
    const both = [direct, routed];
    render(
      <Provider store={createStore()}>
        <ModelPopover
          session={{ ...session, model: { id: "sonnet", providerID: "anthropic" } }}
          models={both}
          catalogModels={both}
          defaultModel={null}
          providers={[
            ...providers,
            {
              id: "opencode",
              name: "OpenCode",
              integrationID: null,
              package: "o",
              disabled: false,
            },
          ]}
          preferenceScope={SCOPE}
          open={false}
          onOpenChange={vi.fn()}
          onSelectionComplete={vi.fn()}
          onSelectModel={vi.fn()}
          onSelectVariant={vi.fn()}
          onManageModels={vi.fn()}
          disabled={false}
        />
      </Provider>,
    );
    expect(screen.getByRole("button", { name: "Model: Anthropic / Claude Sonnet" })).toBeTruthy();
    cleanup();
    renderModelPopover({ sessionModel: { id: "deep", providerID: "openai", variant: "high" } });
    const pill = screen.getByRole("button", { name: "Model: Deep, effort High" });
    expect(pill.textContent).toBe("DeepHigh");
  });

  it("shows the short name on the pill and the full one in its name and list", async () => {
    const opus = model("anthropic", "claude-opus-5-5", "Claude Opus 5.5");
    render(
      <Provider store={createStore()}>
        <ModelPopover
          session={{ ...session, model: { id: opus.id, providerID: opus.providerID } }}
          models={[opus, fast]}
          catalogModels={[opus, fast]}
          defaultModel={null}
          providers={providers}
          preferenceScope={SCOPE}
          open={false}
          onOpenChange={vi.fn()}
          onSelectionComplete={vi.fn()}
          onSelectModel={vi.fn()}
          onSelectVariant={vi.fn()}
          onManageModels={vi.fn()}
          disabled={false}
        />
      </Provider>,
    );
    const pill = screen.getByRole("button", { name: "Model: Claude Opus 5.5" });
    expect(pill.querySelector("[data-palot-model-name]")?.textContent).toBe("Opus 5.5");
    // The maker's icon stands in for the brand the short name leaves out.
    const icon = pill.querySelector("[data-palot-model-icon]");
    expect(icon?.getAttribute("data-palot-model-icon")).toBe("anthropic");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("lists favorites, recent models, then every visible model by provider", async () => {
    const store = createStore();
    store.set(modelPickerUsageAtom, {
      [SCOPE]: { favorites: ["anthropic/sonnet"], recent: ["anthropic/sonnet", "openai/fast"] },
    });
    renderModelPopover({ store });
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep, effort Auto" }));
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
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Claude Sonnet1M"]);
  });

  it("shows the highlighted model's effort, or says it has none", async () => {
    renderModelPopover({ sessionModel: { id: "deep", providerID: "openai", variant: "high" } });
    await userEvent.click(screen.getByRole("button", { name: "Model: Deep, effort High" }));
    expect(effortOptions()).toEqual([
      ["AutoModel decides", "false"],
      ["LowQuick", "false"],
      ["HighThinks longer", "true"],
    ]);
    await userEvent.keyboard("fast");
    expect(await screen.findByText("This model has no effort levels.")).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: /^Effort for/ })).toBeNull();
  });

  it("stars the highlighted model and persists it per project", async () => {
    const { store } = renderModelPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Model: Deep/ }));
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Add Deep to favorites" }));
    expect(store.get(modelPickerUsageAtom)[SCOPE]?.favorites).toEqual(["openai/deep"]);
    expect(groupOptions("Favorites")).toEqual(["DeepOpenAI200K"]);
    const remove = screen.getByRole("button", { name: "Remove Deep from favorites" });
    expect(remove.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches models, remembers them as recent, and opens model settings", async () => {
    const { store, onSelectModel, onManageModels, complete } = renderModelPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Model: Deep/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^Claude Sonnet/ }));
    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledExactlyOnceWith({
        id: "sonnet",
        providerID: "anthropic",
      }),
    );
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(store.get(modelPickerUsageAtom)[SCOPE]?.recent).toEqual(["anthropic/sonnet"]);
    await userEvent.click(screen.getByRole("button", { name: /^Model: Deep/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Manage models" }));
    expect(onManageModels).toHaveBeenCalledOnce();
  });

  it("goes from search to the model list to its effort with the keyboard", async () => {
    const { onSelectModel, onSelectVariant, complete } = renderModelPopover({
      sessionModel: { id: "fast", providerID: "openai" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Model: Fast" }));
    const search = await screen.findByRole("combobox", { name: "Choose model" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    // "e" lists Deep, Legacy, then Claude Sonnet; the effort column follows the highlight.
    await userEvent.keyboard("e{ArrowDown}");
    expect(screen.getByText("This model has no effort levels.")).toBeTruthy();
    await userEvent.keyboard("{ArrowUp}");
    expect(effortOptions().map(([label]) => label)).toEqual([
      "AutoModel decides",
      "LowQuick",
      "HighThinks longer",
    ]);
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledExactlyOnceWith({ id: "deep", providerID: "openai" }),
    );
    // Picking a model with effort levels keeps the popover open and moves to them.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("option", { name: /^Auto/ })),
    );
    expect(complete).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(search);
    screen.getByRole("option", { name: /^Auto/ }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(onSelectVariant).toHaveBeenCalledExactlyOnceWith({
        id: "deep",
        providerID: "openai",
        variant: "high",
      }),
    );
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(screen.queryByRole("combobox", { name: "Choose model" })).toBeNull();
  });

  it("closes on Escape and returns focus to the text field", async () => {
    const { complete } = renderModelPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Model: Deep/ }));
    await screen.findByRole("combobox", { name: "Choose model" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Editor" })),
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
