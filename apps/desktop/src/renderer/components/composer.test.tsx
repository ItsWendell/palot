import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type {
  PalotApi,
  PalotFileAttachment,
  PalotMessage,
  PalotModel,
  PalotSession,
  PromptReceipt,
} from "../../shared";
import {
  autoBackgroundOnSteerAtom,
  defaultDeliveryAtom,
  defaultModelsAtom,
  modelPickerPreferencesAtom,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { selectionMemoriesAtom } from "../lib/selection-memory";
import { modelProjectPreferenceKey } from "../lib/model-preferences";
import type { OpenCodeClient } from "@opencode/client";
import { createRendererQueryClient } from "../lib/query-client";
import type { PendingRequestView } from "../lib/view-models";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { Composer } from "./composer";

const session: PalotSession = {
  id: "session-composer",
  parentID: null,
  projectID: "project-1",
  title: "Composer test",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function bridge(overrides: Record<string, unknown>): PalotApi {
  return {
    runtimeStatus: vi.fn(),
    onOpenCodeEvents: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as PalotApi;
}

function client(overrides: Record<string, unknown> = {}): OpenCodeClient {
  return {
    model: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ data: [] }) },
    agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
    plugin: { awaitActivation: vi.fn().mockResolvedValue(undefined) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
    file: { find: vi.fn().mockResolvedValue({ data: [] }) },
    session: {},
    ...overrides,
  } as unknown as OpenCodeClient;
}

function renderComposer(composer: ReactElement, store = createStore(), profileID = "test-profile") {
  store.set(runtimeAtom, {
    connectionID: "test",
    profileID,
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: "/usr/local/bin/opencode2",
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>{composer}</Provider>
    </QueryClientProvider>,
  );
}

function pendingSteer(id: string, createdAt: number): PendingRequestView {
  return {
    id,
    type: "input",
    title: "Steering",
    detail: "Change course",
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    delivery: "steer",
    createdAt,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  setOpenCodeClientForTest(client());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("Composer discovery", () => {
  it("passes confirmed draft approvals into creation and resets the next draft to Defaults", async () => {
    const createSession = vi.fn().mockResolvedValue(session);
    const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue({
      id: "message-permissions",
      sessionID: session.id,
      type: "user",
      delivery: "steer",
      createdAt: 3,
    });
    renderComposer(
      <Composer
        session={{ ...session, id: "new:project-1" }}
        messages={[]}
        isWorking={false}
        onCreateSession={createSession}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Approvals: Defaults" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Full access/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Enable Full access" }));
    await screen.findByRole("button", { name: "Approvals: Full access" });
    await userEvent.type(
      screen.getByRole("textbox", { name: "Message Palot" }),
      "Inspect the project",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: "full" })),
    );
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Approvals: Defaults" })).toBeTruthy();
  });

  it("does not memoize away external session permission updates", () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const wrap = (value: PalotSession) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Composer session={value} messages={[]} isWorking={false} />
        </Provider>
      </QueryClientProvider>
    );
    const view = render(wrap(session));
    expect(screen.getByRole("button", { name: "Approvals: Defaults" })).toBeTruthy();
    view.rerender(
      wrap({ ...session, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
    );
    expect(screen.getByRole("button", { name: "Approvals: Full access" })).toBeTruthy();
    view.rerender(
      wrap({ ...session, permissions: [{ action: "edit", resource: "*", effect: "deny" }] }),
    );
    expect(screen.getByRole("button", { name: "Approvals: Custom" })).toBeTruthy();
  });

  it("shows hydrated canonical default reasoning as selected Auto without changing the session", async () => {
    const model: PalotModel = {
      id: "reasoner",
      modelID: "reasoner",
      providerID: "openai",
      name: "Reasoner",
      family: null,
      variants: ["low", "high"],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [model],
      defaultModel: model,
      providers: [],
      errors: [],
    });
    const switchModel = vi.spyOn(palot, "switchModel");
    const hydratedSession = {
      ...session,
      model: { id: "reasoner", providerID: "openai", variant: "default" },
    };
    renderComposer(<Composer session={hydratedSession} messages={[]} isWorking={false} />);
    const trigger = await screen.findByRole("button", { name: "Model: Reasoner" });
    expect(trigger.getAttribute("aria-description")).toBe("Reasoning: Auto");
    expect(screen.queryByRole("button", { name: /^Reasoning:/ })).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Auto", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "High", pressed: false })).toBeTruthy();
    expect(hydratedSession.model.variant).toBe("default");
    expect(switchModel).not.toHaveBeenCalled();
  });

  it("creates an untouched task without pinning or remembering the displayed global model", async () => {
    const globalModel: PalotModel = {
      id: "global",
      modelID: "global",
      providerID: "openai",
      name: "Global model",
      family: null,
      variants: [],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [globalModel],
      defaultModel: globalModel,
      providers: [],
      errors: [],
    });
    const createSession = vi.fn().mockResolvedValue({
      ...session,
      agent: "custom-default",
      model: { id: "agent-model", providerID: "custom", variant: "high" },
    });
    const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue({
      id: "msg-auto",
      sessionID: session.id,
      type: "user",
      delivery: "steer",
      createdAt: 3,
    });
    const store = createStore();
    renderComposer(
      <Composer
        session={{ ...session, id: "new:project-1" }}
        messages={[]}
        isWorking={false}
        onCreateSession={createSession}
      />,
      store,
    );
    await screen.findByRole("button", { name: "Model: Global model" });
    await userEvent.type(
      screen.getByRole("textbox", { name: "Message Palot" }),
      "Use the server defaults{Enter}",
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(createSession).toHaveBeenCalledWith({
      approvalMode: "normal",
      agent: null,
      model: null,
    });
    expect(store.get(selectionMemoriesAtom)).toEqual({});
  });

  it("waits for the agent catalog and passes a chosen draft agent, model, and reasoning to creation", async () => {
    const model: PalotModel = {
      id: "reasoner",
      modelID: "reasoner",
      providerID: "openai",
      name: "Reasoner",
      family: null,
      variants: ["low", "high"],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [model],
      defaultModel: model,
      providers: [],
      errors: [],
    });
    let finishAgents!: (value: unknown) => void;
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });
    setOpenCodeClientForTest(
      client({
        agent: {
          list: vi.fn(
            () =>
              new Promise((resolve) => {
                finishAgents = resolve;
              }),
          ),
        },
      }),
    );
    const createSession = vi.fn().mockResolvedValue(null);
    renderComposer(
      <Composer
        session={{ ...session, id: "new:project-1" }}
        messages={[]}
        isWorking={false}
        onCreateSession={createSession}
      />,
    );
    await screen.findByRole("button", { name: "Model: Reasoner" });
    const input = screen.getByRole("textbox", { name: "Message Palot" });
    await userEvent.type(input, "Plan the change{Enter}");
    expect(createSession).not.toHaveBeenCalled();
    await act(async () =>
      finishAgents({
        data: [
          {
            id: "plan",
            name: "Plan",
            mode: "primary",
            hidden: false,
            permissions: [],
            model: { id: "reasoner", providerID: "openai", variant: "low" },
          },
        ],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Agent: Default agent" }));
    await userEvent.click(await screen.findByRole("option", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Model: Reasoner" }));
    await userEvent.click(screen.getByRole("button", { name: "High" }));
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    expect(createSession).toHaveBeenCalledWith({
      approvalMode: "normal",
      agent: "plan",
      model: { id: "reasoner", providerID: "openai", variant: "high" },
    });
  });

  it("keeps an existing task's unavailable model explicit", async () => {
    renderComposer(
      <Composer
        session={{ ...session, model: { id: "retired", providerID: "openai" } }}
        messages={[]}
        isWorking={false}
      />,
    );
    expect(await screen.findByRole("button", { name: "Model: retired, unavailable" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Model: retired, unavailable" }));
    expect(
      screen.getByText(
        "This task's selected model is no longer available. Choose another model to continue.",
      ),
    ).toBeTruthy();
  });

  it("does not recompute the model selector while typing a draft", async () => {
    let modelNameReads = 0;
    const model: PalotModel = {
      id: "fast",
      modelID: "fast",
      providerID: "openai",
      name: "Fast",
      family: null,
      variants: [],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    Object.defineProperty(model, "name", {
      configurable: true,
      get() {
        modelNameReads += 1;
        return "Fast";
      },
    });
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [model],
      defaultModel: model,
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          integrationID: null,
          package: "openai",
          disabled: false,
        },
      ],
      errors: [],
    });

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);
    await screen.findByRole("button", { name: "Model: Fast" });
    modelNameReads = 0;

    fireEvent.change(screen.getByRole("textbox", { name: "Message Palot" }), {
      target: { value: "Typing should stay local" },
    });

    expect(modelNameReads).toBe(0);
  });

  it("does not carry a draft model override into a different task identity", async () => {
    const models: PalotModel[] = [
      {
        id: "fast",
        modelID: "fast",
        providerID: "openai",
        name: "Fast",
        family: null,
        variants: [],
        inputLimit: null,
        contextLimit: 100_000,
        outputLimit: 10_000,
        releasedAt: 0,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        status: "active",
      },
      {
        id: "deep",
        modelID: "deep",
        providerID: "openai",
        name: "Deep",
        family: null,
        variants: [],
        inputLimit: null,
        contextLimit: 100_000,
        outputLimit: 10_000,
        releasedAt: 0,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        status: "active",
      },
    ];
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "test",
      profileID: "test-profile",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: "/usr/local/bin/opencode2",
      version: "test",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    store.set(defaultModelsAtom, {
      [modelProjectPreferenceKey("test-profile", "project-1")]: {
        id: "fast",
        providerID: "openai",
      },
      [modelProjectPreferenceKey("test-profile", "project-2")]: {
        id: "fast",
        providerID: "openai",
      },
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models,
      defaultModel: models[0]!,
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          integrationID: null,
          package: "openai",
          disabled: false,
        },
      ],
      errors: [],
    });
    const queryClient = createRendererQueryClient();
    const renderTree = (nextSession: PalotSession) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <Composer
            session={nextSession}
            messages={[]}
            isWorking={false}
            onCreateSession={vi.fn()}
          />
        </Provider>
      </QueryClientProvider>
    );
    const firstSession = { ...session, id: "new:project-1" };
    const view = render(renderTree(firstSession));

    await userEvent.click(await screen.findByRole("button", { name: "Model: Fast" }));
    await userEvent.click(screen.getByRole("option", { name: /Deep/ }));
    expect(screen.getByRole("button", { name: "Model: Deep" })).toBeTruthy();

    view.rerender(
      renderTree({
        ...session,
        id: "new:project-2",
        projectID: "project-2",
        location: { directory: "/other-workspace" },
      }),
    );

    expect(await screen.findByRole("button", { name: "Model: Fast" })).toBeTruthy();
  });

  it("changes draft reasoning without overwriting the explicit project default", async () => {
    const model: PalotModel = {
      id: "reasoner",
      modelID: "reasoner",
      providerID: "openai",
      name: "Reasoner",
      family: null,
      variants: ["low", "high"],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    const store = createStore();
    store.set(defaultModelsAtom, {
      [modelProjectPreferenceKey("test-profile", session.projectID)]: {
        id: model.id,
        providerID: model.providerID,
        variant: "low",
      },
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client());
    const listModels = vi.spyOn(palot, "listModels");
    listModels.mockResolvedValue({
      models: [model],
      defaultModel: model,
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          integrationID: null,
          package: "openai",
          disabled: false,
        },
      ],
      errors: [],
    });

    renderComposer(
      <Composer
        session={{
          ...session,
          id: "new:project-1",
          location: { directory: "/model-preference-workspace" },
        }}
        messages={[]}
        isWorking={false}
        onCreateSession={vi.fn()}
      />,
      store,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Model: Reasoner" }));
    await userEvent.click(screen.getByRole("button", { name: "High" }));

    expect(
      store.get(defaultModelsAtom)[modelProjectPreferenceKey("test-profile", session.projectID)],
    ).toEqual({
      id: "reasoner",
      providerID: "openai",
      variant: "low",
    });
    expect(
      screen.getByRole("button", { name: "Model: Reasoner" }).getAttribute("aria-description"),
    ).toBe("Reasoning: High");
  });

  it("uses project visibility and order preferences in the model picker", async () => {
    const models: PalotModel[] = ["fast", "balanced", "deep"].map((id) => ({
      id,
      modelID: id,
      providerID: "openai",
      name: id[0]!.toUpperCase() + id.slice(1),
      family: null,
      variants: [],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    }));
    const store = createStore();
    store.set(modelPickerPreferencesAtom, {
      [modelProjectPreferenceKey("test-profile", session.projectID)]: {
        hidden: ["openai/fast"],
        order: ["openai/deep", "openai/balanced", "openai/fast"],
      },
    });
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models,
      defaultModel: models[0]!,
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          integrationID: null,
          package: "openai",
          disabled: false,
        },
      ],
      errors: [],
    });

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />, store);
    await userEvent.click(await screen.findByRole("button", { name: "Model: Fast" }));

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([expect.stringContaining("Deep"), expect.stringContaining("Balanced")]);
    expect(screen.queryByRole("option", { name: /Fast/ })).toBeNull();
  });

  it.each([
    { profileID: "server-a", model: "deep", hidden: "Fast" },
    { profileID: "server-b", model: "fast", hidden: "Deep" },
  ])(
    "uses only $profileID model defaults and visibility for a shared project ID",
    async ({ profileID, model, hidden }) => {
      const models: PalotModel[] = ["fast", "deep"].map((id) => ({
        id,
        modelID: id,
        providerID: "openai",
        name: id === "fast" ? "Fast" : "Deep",
        family: null,
        variants: [],
        inputLimit: null,
        contextLimit: 100_000,
        outputLimit: 10_000,
        releasedAt: 0,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        status: "active",
      }));
      const store = createStore();
      store.set(defaultModelsAtom, {
        [modelProjectPreferenceKey("server-a", session.projectID)]: {
          id: "deep",
          providerID: "openai",
        },
        [modelProjectPreferenceKey("server-b", session.projectID)]: {
          id: "fast",
          providerID: "openai",
        },
      });
      store.set(modelPickerPreferencesAtom, {
        [modelProjectPreferenceKey("server-a", session.projectID)]: {
          hidden: ["openai/fast"],
          order: ["openai/deep"],
        },
        [modelProjectPreferenceKey("server-b", session.projectID)]: {
          hidden: ["openai/deep"],
          order: ["openai/fast"],
        },
      });
      vi.spyOn(palot, "listModels").mockResolvedValue({
        models,
        defaultModel: models[0]!,
        providers: [],
        errors: [],
      });
      renderComposer(
        <Composer
          session={{ ...session, id: "new:project-1" }}
          messages={[]}
          isWorking={false}
          onCreateSession={vi.fn()}
        />,
        store,
        profileID,
      );
      const name = model === "fast" ? "Fast" : "Deep";
      await userEvent.click(await screen.findByRole("button", { name: `Model: ${name}` }));
      expect(screen.getByRole("option", { name: new RegExp(name) })).toBeTruthy();
      expect(screen.queryByRole("option", { name: new RegExp(hidden) })).toBeNull();
    },
  );

  it.each([
    { providerID: "openai", hiddenProviderID: "openai", expectedID: "deep", expectedName: "Deep" },
    {
      providerID: "connection-openai",
      hiddenProviderID: "connection-openai",
      expectedID: "deep",
      expectedName: "Deep",
    },
    {
      providerID: "company-openai",
      hiddenProviderID: "openai",
      expectedID: null,
      expectedName: "Fast",
    },
  ])(
    "shows $expectedName on $providerID when hidden preferences belong to $hiddenProviderID",
    async ({ providerID, hiddenProviderID, expectedID, expectedName }) => {
      const models: PalotModel[] = ["fast", "deep"].map((id) => ({
        id,
        modelID: id,
        providerID,
        canonicalProviderID: "openai",
        name: id[0]!.toUpperCase() + id.slice(1),
        family: null,
        variants: [],
        inputLimit: null,
        contextLimit: 100_000,
        outputLimit: 10_000,
        releasedAt: 0,
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        status: "active",
      }));
      const store = createStore();
      store.set(modelPickerPreferencesAtom, {
        [modelProjectPreferenceKey("test-profile", session.projectID)]: {
          hidden: [`${hiddenProviderID}/fast`],
          order: [`${hiddenProviderID}/deep`, `${hiddenProviderID}/fast`],
        },
      });
      vi.spyOn(palot, "listModels").mockResolvedValue({
        models,
        defaultModel: models[0]!,
        providers: [],
        errors: [],
      });
      const createSession = vi.fn().mockResolvedValue(null);

      renderComposer(
        <Composer
          session={{ ...session, id: "new:project-1" }}
          messages={[]}
          isWorking={false}
          onCreateSession={createSession}
        />,
        store,
      );

      expect(await screen.findByRole("button", { name: `Model: ${expectedName}` })).toBeTruthy();
      await userEvent.type(screen.getByRole("textbox", { name: "Message Palot" }), "Start here");
      await userEvent.keyboard("{Enter}");

      expect(createSession).toHaveBeenCalledWith({
        approvalMode: "normal",
        agent: null,
        model: expectedID ? { id: expectedID, providerID } : null,
      });
    },
  );

  it("selects and runs a native slash command", async () => {
    const user = userEvent.setup();
    const runCommand = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(
      client({
        command: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                name: "review",
                description: "Review current changes",
              },
            ],
          }),
        },
        session: { command: runCommand },
      }),
    );

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "/rev");
    await user.click(await screen.findByRole("option", { name: /\/review/i }));
    expect(input.value).toBe("/review ");

    await user.type(input, "auth");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(runCommand).toHaveBeenCalledWith(
        {
          sessionID: session.id,
          command: "review",
          text: "/review auth",
          delivery: "steer",
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("loads primary agents on demand and switches the task agent", async () => {
    const user = userEvent.setup();
    const switchAgent = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });
    setOpenCodeClientForTest(
      client({
        plugin: { awaitActivation: vi.fn().mockResolvedValue(undefined) },
        agent: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: "build",
                name: "Build",
                mode: "primary",
                hidden: false,
                permissions: [],
              },
              {
                id: "explore",
                name: "Explore",
                mode: "subagent",
                hidden: false,
                permissions: [],
              },
            ],
          }),
        },
        session: { switchAgent, switchModel: vi.fn().mockResolvedValue(undefined) },
      }),
    );
    const model: PalotModel = {
      id: "fast",
      modelID: "fast",
      providerID: "openai",
      name: "Fast",
      family: null,
      variants: [],
      inputLimit: null,
      contextLimit: 100_000,
      outputLimit: 10_000,
      releasedAt: 0,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      status: "active",
    };
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [model],
      defaultModel: model,
      providers: [],
      errors: [],
    });

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const agentSelector = screen.getByRole("button", { name: "Agent: Default agent" });
    await user.click(agentSelector);
    const buildOption = await screen.findByRole("option", { name: "Build" });
    expect(screen.queryByRole("option", { name: "Explore" })).toBeNull();
    await user.click(buildOption);

    expect(switchAgent).toHaveBeenCalledWith({ sessionID: session.id, agent: "build" });
  });

  it("searches and inserts a workspace file reference", async () => {
    const user = userEvent.setup();
    const findWorkspaceFiles = vi.fn().mockResolvedValue({
      location: {
        directory: "/workspace",
        project: { id: "project", directory: "/workspace", canonical: "/workspace" },
      },
      data: [
        { path: "src/auth.ts", type: "file" },
        { path: "test/auth.test.ts", type: "file" },
      ],
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ file: { find: findWorkspaceFiles } }));

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "Check @auth");
    await waitFor(() =>
      expect(findWorkspaceFiles).toHaveBeenCalledWith(
        {
          location: { directory: "/workspace" },
          query: "auth",
          type: "file",
          limit: 20,
        },
        expect.anything(),
      ),
    );
    await user.click(await screen.findByRole("option", { name: /@auth\.ts.*src\/auth\.ts/i }));

    expect(input.value).toBe("Check @src/auth.ts ");
  });

  it("scopes the active discovery index to the current query", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(
      client({
        command: {
          list: vi.fn().mockResolvedValue({
            data: [
              { name: "alpha", description: "Alpha", subtask: false },
              { name: "beta", description: "Beta", subtask: false },
              { name: "bravo", description: "Bravo", subtask: false },
            ],
          }),
        },
      }),
    );
    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "/");
    await screen.findByRole("option", { name: /\/alpha/i });
    const bravo = screen.getByRole("option", { name: /\/bravo/i });
    fireEvent.mouseEnter(bravo);
    expect(bravo.getAttribute("aria-selected")).toBe("true");

    await user.type(input, "b");

    expect(screen.getByRole("option", { name: /\/beta/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("suggests and executes the built-in /compact command", async () => {
    const user = userEvent.setup();
    const compact = vi.fn().mockResolvedValue({ id: "compaction-1", type: "compaction" });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(
      client({
        session: { compact },
      }),
    );

    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "/comp");
    await user.click(await screen.findByRole("option", { name: /\/compact/i }));
    expect(input.value).toBe("/compact ");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(compact).toHaveBeenCalledWith({ sessionID: session.id }));
    expect(input.value).toBe("");
  });

  it("stages /undo without committing and restores the reverted prompt", async () => {
    const user = userEvent.setup();
    vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
    vi.spyOn(palot, "waitForSessionIdle").mockResolvedValue(undefined);
    const stage = vi.fn().mockResolvedValue({ messageID: "message-user" });
    const commit = vi.fn();
    const prompt = vi.fn().mockResolvedValue({
      id: "message-resubmitted",
      sessionID: session.id,
      type: "user",
      delivery: null,
      timeCreated: 3,
    });
    const get = vi.fn().mockResolvedValue({
      id: session.id,
      projectID: session.projectID,
      cost: 0,
      tokens: session.tokens,
      time: { created: 1, updated: 2 },
      location: session.location,
      revert: { messageID: "message-user" },
    });
    const message: PalotMessage = {
      id: "message-user",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text: "Original prompt $skill-1",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      files: [],
      skillReferences: [
        {
          id: "skill-1",
          mention: { start: 16, end: 24, text: "$skill-1" },
          text: "Pinned skill content",
        },
      ],
      content: [],
      data: null,
    };
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { get, prompt, revert: { stage, commit } } }));

    renderComposer(<Composer session={session} messages={[message]} isWorking={false} />);

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "/und");
    await user.click(await screen.findByRole("option", { name: /\/undo/i }));
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(stage).toHaveBeenCalledWith({
        sessionID: session.id,
        messageID: message.id,
        files: true,
      }),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(input.value).toBe("Original prompt $skill-1");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Original prompt $skill-1",
          skills: [
            {
              id: "skill-1",
              mention: { start: 16, end: 24, text: "$skill-1" },
              text: "Pinned skill content",
            },
          ],
        }),
        expect.anything(),
      ),
    );
  });

  it("stages the next boundary for /redo before clearing the final revert", async () => {
    const user = userEvent.setup();
    vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
    vi.spyOn(palot, "waitForSessionIdle").mockResolvedValue(undefined);
    const stage = vi.fn().mockResolvedValue({ messageID: "message-two" });
    const clear = vi.fn();
    const get = vi.fn().mockResolvedValue({
      id: session.id,
      projectID: session.projectID,
      cost: 0,
      tokens: session.tokens,
      time: { created: 1, updated: 2 },
      location: session.location,
      revert: { messageID: "message-two" },
    });
    const messages: PalotMessage[] = ["First prompt", "Second prompt"].map((text, index) => ({
      id: `message-${index === 0 ? "one" : "two"}`,
      type: "user",
      createdAt: index + 1,
      completedAt: index + 1,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      files: [],
      content: [],
      data: null,
    }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { get, revert: { stage, clear } } }));

    renderComposer(
      <Composer
        session={{ ...session, revert: { messageID: "message-one" } }}
        messages={messages}
        isWorking={false}
      />,
    );

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "/red");
    await user.click(await screen.findByRole("option", { name: /\/redo/i }));
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(stage).toHaveBeenCalledWith({
        sessionID: session.id,
        messageID: "message-two",
        files: true,
      }),
    );
    expect(clear).not.toHaveBeenCalled();
    expect(input.value).toBe("Second prompt");
  });

  it.each([
    { command: "undo", revert: undefined, target: "message-two" },
    { command: "redo", revert: { messageID: "message-one" }, target: "message-two" },
    { command: "redo", revert: { messageID: "message-two" }, target: undefined },
  ])(
    "waits for interrupt and idle before /$command with boundary $revert",
    async ({ command, revert, target }) => {
      const interrupted = Promise.withResolvers<void>();
      const idle = Promise.withResolvers<void>();
      const interrupt = vi.spyOn(palot, "interrupt").mockReturnValue(interrupted.promise);
      const wait = vi.spyOn(palot, "waitForSessionIdle").mockReturnValue(idle.promise);
      const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(null);
      const clear = vi.spyOn(palot, "clearSessionRevert").mockResolvedValue(null);
      const messages: PalotMessage[] = ["one", "two"].map((id) => ({
        id: `message-${id}`,
        type: "user",
        createdAt: 1,
        completedAt: 1,
        text: `Prompt ${id}`,
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        files: [],
        content: [],
        data: null,
      }));
      // The server barrier is required even if the renderer still thinks the session is idle.
      renderComposer(
        <Composer session={{ ...session, revert }} messages={messages} isWorking={false} />,
      );
      const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
      fireEvent.change(input, { target: { value: `/${command}` } });
      await userEvent.click(
        await screen.findByRole("option", { name: new RegExp(`/${command}`, "i") }),
      );
      fireEvent.keyDown(input, { key: "Enter" });
      expect(interrupt).toHaveBeenCalledExactlyOnceWith(session.id, "test");
      expect(wait).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();

      await act(async () => interrupted.resolve());
      expect(wait).toHaveBeenCalledExactlyOnceWith(session.id, "test");
      expect(stage).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      expect(input.value).toBe(`/${command} `);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(interrupt).toHaveBeenCalledTimes(1);

      await act(async () => idle.resolve());
      if (target) {
        expect(stage).toHaveBeenCalledExactlyOnceWith(
          { sessionID: session.id, messageID: target },
          "test",
        );
        expect(clear).not.toHaveBeenCalled();
      } else {
        expect(clear).toHaveBeenCalledExactlyOnceWith(session.id, "test");
        expect(stage).not.toHaveBeenCalled();
      }
      expect(input.value).toBe(target ? "Prompt two" : "");
    },
  );

  it.each(["success", "failure"])(
    "keeps a switched task independent when /undo finishes with %s",
    async (outcome) => {
      const idle = Promise.withResolvers<void>();
      vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
      const wait = vi.spyOn(palot, "waitForSessionIdle").mockReturnValue(idle.promise);
      const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(null);
      const message: PalotMessage = {
        id: "message-one",
        type: "user",
        createdAt: 1,
        completedAt: 1,
        text: "Original prompt",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        files: [
          { uri: "file:///workspace/undo.txt", name: "undo.txt", mime: "text/plain", size: null },
        ],
        content: [],
        data: null,
      };
      const store = createStore();
      const queryClient = createRendererQueryClient();
      store.set(runtimeAtom, {
        connectionID: "test",
        profileID: "test-profile",
        contractVersion: "test",
        phase: "connected",
        connected: true,
        binaryPath: "/usr/local/bin/opencode2",
        version: "test",
        pid: 1,
        managed: true,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      });
      const view = (nextSession: PalotSession) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <Composer
              session={nextSession}
              messages={nextSession.id === session.id ? [message] : []}
              isWorking
            />
          </Provider>
        </QueryClientProvider>
      );
      const mounted = render(view(session));
      const input = () =>
        screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
      fireEvent.change(input(), { target: { value: "/undo" } });
      await userEvent.click(await screen.findByRole("option", { name: /\/undo/i }));
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
      const origin = store.get(runtimeAtom)!;
      act(() =>
        store.set(runtimeAtom, { ...origin, connectionID: "other", profileID: "other-profile" }),
      );
      mounted.rerender(view({ ...session, id: "other-undo-task" }));
      fireEvent.change(input(), { target: { value: "Other task draft" } });
      await act(async () => {
        if (outcome === "success") idle.resolve();
        else idle.reject(new Error("Old task wait failed"));
      });
      expect(input().value).toBe("Other task draft");
      expect(screen.queryByText("Old task wait failed")).toBeNull();
      expect(screen.queryByRole("button", { name: "Remove undo.txt" })).toBeNull();
      act(() => store.set(runtimeAtom, origin));
      mounted.rerender(view(session));
      expect(input().value).toBe(outcome === "success" ? "Original prompt" : "/undo ");
      if (outcome === "success") {
        expect(stage).toHaveBeenCalledExactlyOnceWith(
          {
            sessionID: session.id,
            messageID: message.id,
          },
          "test",
        );
        expect(screen.getByRole("button", { name: "Remove undo.txt" })).toBeTruthy();
      } else {
        expect(stage).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["undo", "redo"])(
    "keeps the draft and stops /%s when waiting for idle fails",
    async (command) => {
      vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
      const idle = Promise.withResolvers<void>();
      const wait = vi.spyOn(palot, "waitForSessionIdle").mockReturnValue(idle.promise);
      const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(null);
      const clear = vi.spyOn(palot, "clearSessionRevert").mockResolvedValue(null);
      const message: PalotMessage = {
        id: "message-one",
        type: "user",
        createdAt: 1,
        completedAt: 1,
        text: "Original prompt",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        files: [],
        content: [],
        data: null,
      };
      renderComposer(
        <Composer
          session={{
            ...session,
            revert: command === "redo" ? { messageID: message.id } : undefined,
          }}
          messages={[message]}
          isWorking
        />,
      );
      const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
      fireEvent.change(input, { target: { value: `/${command}` } });
      await userEvent.click(
        await screen.findByRole("option", { name: new RegExp(`/${command}`, "i") }),
      );
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
      await act(async () => idle.reject(new Error("Idle wait failed")));
      expect(stage).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      expect(input.value).toBe(`/${command} `);
      expect(screen.getByText("Idle wait failed")).toBeTruthy();
    },
  );
});

describe("Composer text entry", () => {
  it("keeps multiline and IME input in the draft until an explicit send", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "message-multiline",
      sessionID: session.id,
      type: "user" as const,
      timeCreated: 10_000,
    });
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });
    setOpenCodeClientForTest(client({ session: { prompt } }));
    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);

    const input = screen.getByRole("textbox", { name: "Message Palot" }) as HTMLTextAreaElement;
    await userEvent.type(input, "First line{Shift>}{Enter}{/Shift}Second line");
    expect(input.value).toBe("First line\nSecond line");
    expect(prompt).not.toHaveBeenCalled();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "First line\nSecond line 日本語" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.compositionEnd(input);
    expect(prompt).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ text: "First line\nSecond line 日本語" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
});

describe("Composer steering", () => {
  it("queues with Enter by default while a task is running", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "message-queue",
      sessionID: session.id,
      type: "user" as const,
      delivery: "queue" as const,
      timeCreated: 10_000,
    });
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });
    setOpenCodeClientForTest(client({ session: { prompt } }));

    renderComposer(<Composer session={session} messages={[]} isWorking />);

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Run this next" } });
    expect(screen.getByRole("button", { name: "Choose message delivery" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ delivery: "queue", text: "Run this next" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("changes the busy submit action from the delivery menu", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });

    renderComposer(<Composer session={session} messages={[]} isWorking />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message Palot" }), {
      target: { value: "Change course" },
    });
    expect(screen.getByRole("button", { name: "Queue message after current turn" })).toBeTruthy();
    expect(screen.getByText("Queue", { exact: true })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Choose message delivery" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Steer current turn/i }));

    expect(screen.getByRole("button", { name: "Steer current turn" })).toBeTruthy();
    expect(screen.getByText("Steer", { exact: true })).toBeTruthy();
  });

  it("steers directly with Cmd or Ctrl Enter while queue is selected", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "message-steer",
      sessionID: session.id,
      type: "user" as const,
      delivery: "steer" as const,
      timeCreated: 10_000,
    });
    Object.defineProperty(window, "palot", { configurable: true, value: bridge({}) });
    setOpenCodeClientForTest(client({ session: { prompt } }));

    renderComposer(<Composer session={session} messages={[]} isWorking />);

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Correct course" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ delivery: "steer", text: "Correct course" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("sends an opted-in steer immediately and backgrounds a blocking subagent after five seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const events: string[] = [];
    const liveMessages: PalotMessage[] = [];
    const pendingInputs: PendingRequestView[] = [];
    const background = vi.fn(async () => {
      events.push("background");
    });
    const prompt = vi.fn(async () => {
      events.push("prompt");
      pendingInputs.push(pendingSteer("message-1", 10_000));
      liveMessages.push({
        id: "message-1",
        type: "user",
        createdAt: 10_000,
        delivery: "steer",
        completedAt: 10_000,
        text: "Change course",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        content: [],
        data: null,
      });
      return {
        id: "message-1",
        sessionID: session.id,
        type: "user" as const,
        delivery: "steer" as const,
        timeCreated: 10_000,
      };
    });
    const store = createStore();
    store.set(defaultDeliveryAtom, "steer");
    store.set(autoBackgroundOnSteerAtom, true);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { background, prompt } }));

    renderComposer(
      <Composer
        session={session}
        messages={liveMessages}
        isWorking
        pendingInputs={pendingInputs}
        backgroundWork={[
          {
            kind: "subagent",
            id: "child-1",
            agent: "Explore",
            description: "Map the timeline",
            startedAt: 1_000,
            fallbackStatus: "running",
            background: false,
          },
        ]}
      />,
      store,
    );

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Change course" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => undefined);

    expect(prompt).toHaveBeenCalledOnce();
    expect(events).toEqual(["prompt"]);
    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(background).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(events).toEqual(["prompt", "background"]);
    expect(background).toHaveBeenCalledWith({ sessionID: session.id });
  });

  it("offers the background action while a steer remains in the inbox for five seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const liveMessages: PalotMessage[] = [];
    const pendingInputs: PendingRequestView[] = [];
    const background = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.fn(async () => {
      pendingInputs.push(pendingSteer("message-1", 10_000));
      liveMessages.push({
        id: "message-1",
        type: "user",
        createdAt: 10_000,
        delivery: "steer",
        promotedAt: 10_001,
        completedAt: 10_000,
        text: "Change course",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        content: [],
        data: null,
      });
      return {
        id: "message-1",
        sessionID: session.id,
        type: "user" as const,
        delivery: "steer" as const,
        timeCreated: 10_000,
      };
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { background, prompt } }));

    const store = createStore();
    store.set(defaultDeliveryAtom, "steer");
    renderComposer(
      <Composer
        session={session}
        messages={liveMessages}
        isWorking
        pendingInputs={pendingInputs}
        backgroundWork={[
          {
            kind: "shell",
            id: "shell-1",
            command: "bun run test",
            startedAt: 1_000,
            background: false,
          },
        ]}
      />,
      store,
    );

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Change course" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(
      screen.queryByRole("button", {
        name: "Send blocking work to background so the message can steer this turn",
      }),
    ).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Send blocking work to background so the message can steer this turn",
      }),
    );
    await act(async () => undefined);
    expect(background).toHaveBeenCalledWith({ sessionID: session.id });
  });

  it("does not offer to background work after the steer leaves the inbox", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const background = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.fn().mockResolvedValue({
      id: "message-1",
      sessionID: session.id,
      type: "user" as const,
      delivery: "steer" as const,
      timeCreated: 10_000,
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { background, prompt } }));

    const store = createStore();
    store.set(defaultDeliveryAtom, "steer");
    renderComposer(
      <Composer
        session={session}
        messages={[]}
        isWorking
        backgroundWork={[
          {
            kind: "shell",
            id: "shell-1",
            command: "bun run test",
            startedAt: 1_000,
            background: false,
          },
        ]}
      />,
      store,
    );

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Change course" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(
      screen.queryByRole("button", { name: /background .* so the message can steer this turn/i }),
    ).toBeNull();
    expect(background).not.toHaveBeenCalled();
  });

  it("shows a retry prompt when delayed automatic backgrounding fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const liveMessages: PalotMessage[] = [];
    const pendingInputs: PendingRequestView[] = [];
    const background = vi.fn().mockRejectedValue(new Error("No background capacity"));
    const prompt = vi.fn(async () => {
      pendingInputs.push(pendingSteer("message-1", 10_000));
      liveMessages.push({
        id: "message-1",
        type: "user",
        createdAt: 10_000,
        delivery: "steer",
        completedAt: 10_000,
        text: "Change course",
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        content: [],
        data: null,
      });
      return {
        id: "message-1",
        sessionID: session.id,
        type: "user" as const,
        delivery: "steer" as const,
        timeCreated: 10_000,
      };
    });
    const store = createStore();
    store.set(defaultDeliveryAtom, "steer");
    store.set(autoBackgroundOnSteerAtom, true);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { background, prompt } }));

    renderComposer(
      <Composer
        session={session}
        messages={liveMessages}
        isWorking
        pendingInputs={pendingInputs}
        backgroundWork={[
          {
            kind: "subagent",
            id: "child-1",
            agent: "Explore",
            description: "Map the timeline",
            startedAt: 1_000,
            fallbackStatus: "running",
            background: false,
          },
        ]}
      />,
      store,
    );

    const input = screen.getByRole("textbox", { name: "Message Palot" });
    fireEvent.change(input, { target: { value: "Change course" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(prompt).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        /The subagent 'Map the timeline' is blocking your message from steering this turn/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Could not background the blocking work: No background capacity/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry sending blocking work to background" }),
    ).toBeTruthy();
  });
  it("interrupts a working task from the stop control", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { interrupt } }));

    renderComposer(<Composer session={session} messages={[]} isWorking />);
    await userEvent.click(screen.getByRole("button", { name: "Stop task" }));

    await waitFor(() => expect(interrupt).toHaveBeenCalledWith({ sessionID: session.id }));
  });
});

describe("Composer pending inputs", () => {
  const receipt: PromptReceipt = {
    id: "msg-sent",
    sessionID: session.id,
    type: "user",
    delivery: "queue",
    createdAt: 3,
  };
  const originalFile: PalotFileAttachment = {
    uri: "file:///workspace/original.txt",
    name: "original.txt",
    mime: "text/plain",
    size: 10,
  };
  const queuedFile: PalotFileAttachment = {
    uri: "file:///workspace/queued.txt",
    name: "queued.txt",
    mime: "text/plain",
    size: 20,
  };
  const queuedMessage: PalotMessage = {
    id: "msg-editable",
    type: "user",
    createdAt: 2,
    completedAt: 2,
    text: "Queued draft",
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    files: [queuedFile],
    content: [],
    data: null,
    delivery: "queue",
  };

  function draftHarness() {
    const store = createStore();
    const cancel = vi.spyOn(palot, "updatePending").mockResolvedValue(undefined);
    const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(receipt);
    vi.spyOn(palot, "pickFiles").mockResolvedValue({ files: [originalFile], errors: [] });
    const mount = (nextSession = session, profileID = "test-profile") =>
      renderComposer(
        <Composer
          key={nextSession.id}
          session={nextSession}
          messages={[queuedMessage]}
          isWorking
          pendingInputs={
            nextSession.id === session.id
              ? [
                  {
                    ...pendingSteer(queuedMessage.id, 2),
                    delivery: "queue",
                    detail: queuedMessage.text!,
                  },
                ]
              : []
          }
        />,
        store,
        profileID,
      );
    return { mount, cancel, send, store };
  }

  function input() {
    return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
  }

  async function writeOriginalDraft() {
    fireEvent.change(input(), { target: { value: "Original unsent draft" } });
    await userEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
  }

  async function editQueuedDraft() {
    await userEvent.click(screen.getByRole("button", { name: "More pending message actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cancel and edit" }));
  }

  it.each(["queue", "steer"] as const)(
    "cancels /undo's undelivered %s target before restoring its draft and attachments",
    async (delivery) => {
      const { cancel, store } = draftHarness();
      const result = Promise.withResolvers<void>();
      cancel.mockReturnValue(result.promise);
      const interrupt = vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
      const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(null);
      const first = renderComposer(
        <Composer
          session={session}
          messages={[queuedMessage]}
          isWorking
          pendingInputs={[{ ...pendingSteer(queuedMessage.id, 2), delivery }]}
        />,
        store,
      );
      fireEvent.change(input(), { target: { value: "/undo" } });
      await userEvent.click(await screen.findByRole("option", { name: /\/undo/i }));
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(cancel).toHaveBeenCalledExactlyOnceWith({
        sessionID: session.id,
        inputID: queuedMessage.id,
        action: "cancel",
      });
      expect(input().value).toBe("/undo ");
      expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
      expect(screen.queryByText(/Resubmitting adds it to the end/)).toBeNull();
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(cancel).toHaveBeenCalledTimes(1);
      // New typing remains the independent original draft when cancellation finishes elsewhere.
      await writeOriginalDraft();
      first.unmount();
      const other = renderComposer(
        <Composer
          session={{ ...session, id: "other-undo-task" }}
          messages={[]}
          isWorking={false}
        />,
        store,
      );
      fireEvent.change(input(), { target: { value: "Other task draft" } });
      await act(async () => result.resolve());
      expect(input().value).toBe("Other task draft");
      expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
      other.unmount();
      renderComposer(<Composer session={session} messages={[queuedMessage]} isWorking />, store);
      expect(input().value).toBe("Queued draft");
      expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
      expect(
        screen.getByText(delivery === "queue" ? "Queue" : "Steer", { exact: true }),
      ).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
      expect(input().value).toBe("Original unsent draft");
      expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
      expect(interrupt).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to interrupt or revert if /undo's queued target was already admitted", async () => {
    const { mount, cancel } = draftHarness();
    const result = Promise.withResolvers<void>();
    cancel.mockReturnValue(result.promise);
    const interrupt = vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
    const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(null);
    mount();
    fireEvent.change(input(), { target: { value: "/undo" } });
    await userEvent.click(await screen.findByRole("option", { name: /\/undo/i }));
    fireEvent.keyDown(input(), { key: "Enter" });
    await writeOriginalDraft();
    await act(async () => result.reject(new Error("Already admitted")));
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
    expect(screen.getByText("Already admitted")).toBeTruthy();
    expect(interrupt).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("keeps an unsent draft and its attachments when switching tasks and remounting", async () => {
    const { mount } = draftHarness();
    const first = mount();
    await writeOriginalDraft();
    first.unmount();
    const other = mount({ ...session, id: "other-draft-task" });
    expect(input().value).toBe("");
    expect(screen.queryByRole("button", { name: "Remove original.txt" })).toBeNull();
    fireEvent.change(input(), { target: { value: "Other task draft" } });
    other.unmount();
    const returned = mount();
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    returned.unmount();
    mount({ ...session, id: "other-draft-task" });
    expect(input().value).toBe("Other task draft");
  });

  it("isolates duplicate session IDs across profiles, including original and edited attachments", async () => {
    const { mount } = draftHarness();
    const first = mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    fireEvent.change(input(), { target: { value: "First profile edit" } });
    first.unmount();
    const other = mount(session, "other-profile");
    expect(input().value).toBe("");
    expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove original.txt" })).toBeNull();
    fireEvent.change(input(), { target: { value: "Other profile draft" } });
    other.unmount();
    const returned = mount();
    expect(input().value).toBe("First profile edit");
    expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    returned.unmount();
    mount(session, "other-profile");
    expect(input().value).toBe("Other profile draft");
  });

  it.each([false, true])(
    "keeps a late submission in its original profile with editing=%s",
    async (editing) => {
      const { mount, send } = draftHarness();
      const result = Promise.withResolvers<PromptReceipt>();
      send.mockReturnValue(result.promise);
      const first = mount();
      await writeOriginalDraft();
      if (editing) await editQueuedDraft();
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      first.unmount();
      const other = mount(session, "other-profile");
      expect(input().value).toBe("");
      await writeOriginalDraft();
      await editQueuedDraft();
      fireEvent.change(input(), { target: { value: "Other profile edit" } });
      await act(async () => result.resolve(receipt));
      expect(input().value).toBe("Other profile edit");
      expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
      expect(input().value).toBe("Original unsent draft");
      expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
      other.unmount();
      mount();
      expect(input().value).toBe(editing ? "Original unsent draft" : "");
    },
  );

  it("retains a canceled-message edit across task switches, then restores the original on discard", async () => {
    const { mount, cancel } = draftHarness();
    const first = mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    fireEvent.change(input(), { target: { value: "Revised queued draft" } });
    first.unmount();
    const other = mount({ ...session, id: "other-edit-task" });
    expect(input().value).toBe("");
    other.unmount();
    mount();
    expect(input().value).toBe("Revised queued draft");
    expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("restores the original draft after resubmitting an edit while unmounted", async () => {
    const { mount, send } = draftHarness();
    const result = Promise.withResolvers<PromptReceipt>();
    send.mockReturnValue(result.promise);
    const first = mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    fireEvent.change(input(), { target: { value: "Revised queued draft" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: session.id,
        text: "Revised queued draft",
        files: [queuedFile],
        delivery: "queue",
      }),
    );
    first.unmount();
    const waiting = mount();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    waiting.unmount();
    await act(async () => result.resolve(receipt));
    mount();
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(screen.queryByText(/Resubmitting adds it to the end/)).toBeNull();
  });

  it("keeps a failed edited submission and its original draft across remount, then retries", async () => {
    const { mount, send } = draftHarness();
    const result = Promise.withResolvers<PromptReceipt>();
    send.mockReturnValueOnce(result.promise);
    const first = mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    fireEvent.change(input(), { target: { value: "Edited before sending" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => result.reject(new Error("Send failed")));
    mount();
    expect(input().value).toBe("Edited before sending");
    expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(input().value).toBe("Original unsent draft"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
  });

  it.each([
    { outcome: "success", editing: false },
    { outcome: "failure", editing: false },
    { outcome: "success", editing: true },
    { outcome: "failure", editing: true },
  ])(
    "does not overwrite newer typing after send $outcome with editing=$editing",
    async ({ outcome, editing }) => {
      const { mount, send } = draftHarness();
      const result = Promise.withResolvers<PromptReceipt>();
      send.mockReturnValue(result.promise);
      const first = mount();
      await writeOriginalDraft();
      if (editing) await editQueuedDraft();
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      first.unmount();
      mount();
      fireEvent.change(input(), { target: { value: "Newer draft while sending" } });
      await act(async () => {
        if (outcome === "success") result.resolve(receipt);
        else result.reject(new Error("Send failed"));
      });
      expect(input().value).toBe("Newer draft while sending");
      if (editing) {
        expect(screen.getByRole("button", { name: "Remove queued.txt" })).toBeTruthy();
        await userEvent.click(
          screen.getByRole("button", { name: "Discard edit and restore draft" }),
        );
        expect(input().value).toBe("Original unsent draft");
      }
      expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    },
  );

  it.each(["success", "failure"])(
    "retains the normal draft until send %s is known",
    async (outcome) => {
      const { mount, send } = draftHarness();
      const result = Promise.withResolvers<PromptReceipt>();
      send.mockReturnValue(result.promise);
      const first = mount();
      await writeOriginalDraft();
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(input().value).toBe("Original unsent draft");
      first.unmount();
      await act(async () => {
        if (outcome === "success") result.resolve(receipt);
        else result.reject(new Error("Send failed"));
      });
      mount();
      expect(input().value).toBe(outcome === "success" ? "" : "Original unsent draft");
      expect(Boolean(screen.queryByRole("button", { name: "Remove original.txt" }))).toBe(
        outcome === "failure",
      );
    },
  );

  it("does not overwrite the original draft when an edit is discarded during a failed send", async () => {
    const { mount, send } = draftHarness();
    const result = Promise.withResolvers<PromptReceipt>();
    send.mockReturnValue(result.promise);
    mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
    fireEvent.change(input(), { target: { value: "Updated original draft" } });
    await act(async () => result.reject(new Error("Send failed")));
    expect(input().value).toBe("Updated original draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove queued.txt" })).toBeNull();
  });

  it("keeps typing done during cancellation and finishes opening the edit after remount", async () => {
    const { mount, cancel } = draftHarness();
    const result = Promise.withResolvers<void>();
    cancel.mockReturnValue(result.promise);
    const first = mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    first.unmount();
    mount();
    fireEvent.change(input(), { target: { value: "Typed while canceling" } });
    await act(async () => result.resolve());
    expect(input().value).toBe("Queued draft");
    await userEvent.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
    expect(input().value).toBe("Typed while canceling");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves the draft and attachments alone when canceling the pending input fails", async () => {
    const { mount, cancel } = draftHarness();
    cancel.mockRejectedValue(new Error("Already admitted"));
    mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    expect(input().value).toBe("Original unsent draft");
    expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
    expect(screen.queryByText(/Resubmitting adds it to the end/)).toBeNull();
  });

  it("renders queued and steering inputs in a sibling rail above the input body", () => {
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    const detail = "Run the complete desktop verification suite after the current turn finishes";

    renderComposer(
      <Composer
        session={session}
        messages={[]}
        isWorking
        pendingInputs={[
          {
            id: "msg-pending",
            type: "input",
            title: "Pending input",
            detail,
            resources: [],
            savePatterns: [],
            questions: [],
            fields: [],
            delivery: "queue",
          },
          {
            id: "msg-steering",
            type: "input",
            title: "Pending input",
            detail: "Adjust the current approach",
            resources: [],
            savePatterns: [],
            questions: [],
            fields: [],
            delivery: "steer",
          },
        ]}
      />,
    );

    const pending = screen.getByRole("region", { name: `Pending message actions: ${detail}` });
    const rail = screen.getByRole("region", { name: "Pending messages" });
    const inputGroup = input().closest('[data-slot="input-group"]');
    expect(rail.contains(pending)).toBe(true);
    expect(pending.closest('[data-slot="input-group"]')).toBeNull();
    expect(rail.nextElementSibling?.contains(inputGroup)).toBe(true);
    expect(
      within(rail)
        .getAllByRole("region")
        .map((row) => row.getAttribute("data-palot-request-id")),
    ).toEqual(["msg-pending", "msg-steering"]);
    expect(screen.getByText(detail).className).toContain("truncate");
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText("Steering")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Steer next" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "More pending message actions" })).toHaveLength(2);
  });

  it.each(["success", "failure"])(
    "cancels directly without discarding the row or draft before server %s",
    async (outcome) => {
      const { mount, cancel } = draftHarness();
      const result = Promise.withResolvers<void>();
      cancel.mockReturnValue(result.promise);
      mount();
      await writeOriginalDraft();
      const button = screen.getByRole<HTMLButtonElement>("button", {
        name: "Cancel pending message",
      });
      await userEvent.click(button);
      expect(cancel).toHaveBeenCalledExactlyOnceWith({
        sessionID: session.id,
        inputID: queuedMessage.id,
        action: "cancel",
      });
      expect(button.disabled).toBe(true);
      expect(screen.getByText("Queued draft")).toBeTruthy();
      expect(input().value).toBe("Original unsent draft");
      await act(async () => {
        if (outcome === "success") result.resolve();
        else result.reject(new Error("Already admitted"));
      });
      // Inbox reconciliation, not the click handler, owns removing the row.
      expect(screen.getByText("Queued draft")).toBeTruthy();
      expect(button.disabled).toBe(false);
      expect(input().value).toBe("Original unsent draft");
      expect(screen.getByRole("button", { name: "Remove original.txt" })).toBeTruthy();
      expect(screen.queryByText(/Resubmitting adds it to the end/)).toBeNull();
    },
  );

  it.each([
    { initial: "queue", action: "Turn off queueing", next: "steer" },
    { initial: "steer", action: "Turn on queueing", next: "queue" },
  ] as const)(
    "$action changes future sends without changing queued inputs",
    async ({ initial, action, next }) => {
      const { mount, cancel, send, store } = draftHarness();
      store.set(defaultDeliveryAtom, initial);
      mount();
      await userEvent.click(screen.getByRole("button", { name: "More pending message actions" }));
      await userEvent.click(screen.getByRole("menuitem", { name: action }));
      expect(store.get(defaultDeliveryAtom)).toBe(next);
      expect(cancel).not.toHaveBeenCalled();
      expect(screen.getByText("Queued")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Steer next" })).toBeTruthy();
      fireEvent.change(input(), { target: { value: "Next follow-up" } });
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({ text: "Next follow-up", delivery: next }),
        ),
      );
    },
  );

  it("does not change a canceled-message edit's delivery when the queue default changes", async () => {
    const { mount, cancel, send, store } = draftHarness();
    store.set(defaultDeliveryAtom, "queue");
    mount();
    await writeOriginalDraft();
    await editQueuedDraft();
    await userEvent.click(screen.getByRole("button", { name: "More pending message actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Turn off queueing" }));
    expect(store.get(defaultDeliveryAtom)).toBe("steer");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Queue message after current turn" })).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Queued draft", delivery: "queue" }),
      ),
    );
    await waitFor(() => expect(input().value).toBe("Original unsent draft"));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: "Original unsent draft", delivery: "steer" }),
      ),
    );
  });

  it.each([
    { files: [queuedFile], label: "queued.txt" },
    { files: [queuedFile, originalFile], label: "queued.txt (+1 more)" },
  ])("labels and edits an attachment-only pending message: $label", async ({ files, label }) => {
    const cancel = vi.spyOn(palot, "updatePending").mockResolvedValue(undefined);
    renderComposer(
      <Composer
        session={session}
        messages={[{ ...queuedMessage, text: null, files }]}
        isWorking
        pendingInputs={[{ ...pendingSteer(queuedMessage.id, 2), detail: " ", delivery: "queue" }]}
      />,
    );
    const row = screen.getByRole("region", { name: `Pending message actions: ${label}` });
    expect(within(row).getByText(label)).toBeTruthy();
    await editQueuedDraft();
    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      sessionID: session.id,
      inputID: queuedMessage.id,
      action: "cancel",
    });
    expect(input().value).toBe("");
    for (const file of files)
      expect(screen.getByRole("button", { name: `Remove ${file.name}` })).toBeTruthy();
  });

  it("does not reserve a rail when there are no pending inputs", () => {
    renderComposer(<Composer session={session} messages={[]} isWorking={false} />);
    expect(screen.queryByRole("region", { name: "Pending messages" })).toBeNull();
    expect(input()).toBeTruthy();
  });

  it("cancels a pending message into the composer and preserves the previous draft", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const message: PalotMessage = {
      id: "msg-pending",
      type: "user",
      createdAt: 2,
      completedAt: 2,
      text: "Pending message to revise",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      files: [],
      content: [],
      data: null,
      delivery: "queue",
    };
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });
    setOpenCodeClientForTest(client({ session: { inbox: { cancel } } }));

    renderComposer(
      <Composer
        session={session}
        messages={[message]}
        isWorking
        pendingInputs={[
          {
            id: message.id,
            type: "input",
            title: "Pending input",
            detail: message.text ?? undefined,
            resources: [],
            savePatterns: [],
            questions: [],
            fields: [],
            delivery: "queue",
          },
        ]}
      />,
    );

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message Palot" });
    await user.type(input, "Existing composer draft");
    await user.click(screen.getByRole("button", { name: "More pending message actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Cancel and edit" }));

    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ sessionID: session.id, inboxID: message.id }),
    );
    expect(input.value).toBe("Pending message to revise");
    expect(screen.getByText(/Resubmitting adds it to the end/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Discard edit and restore draft" }));
    expect(input.value).toBe("Existing composer draft");
  });
});

describe("Composer blocking requests", () => {
  it("hides unrelated composer controls while keeping Stop available for a blocking request", async () => {
    const interrupt = vi.spyOn(palot, "interrupt").mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({}),
    });

    renderComposer(
      <Composer
        session={session}
        messages={[]}
        isWorking
        requestBody={<section aria-label="Blocking question">Choose an approach</section>}
        pendingInputs={[pendingSteer("msg-waiting", 2)]}
      />,
    );

    expect(screen.getByRole("region", { name: "Blocking question" })).toBeTruthy();
    const rail = screen.getByRole("region", { name: "Pending messages" });
    const question = screen.getByRole("region", { name: "Blocking question" });
    expect(rail.closest('[data-slot="input-group"]')).toBeNull();
    expect(rail.nextElementSibling?.contains(question)).toBe(true);
    expect(question.closest('[data-slot="input-group"]')).toBeTruthy();
    expect(within(rail).getByRole("button", { name: "Run after current turn" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message Palot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Agent:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Approvals: Defaults" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Context tab" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(interrupt).toHaveBeenCalledWith(session.id);
  });
});
