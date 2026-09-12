import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import type { ModelRef } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotAgent, PalotModel, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { rememberSelection, selectionMemoriesAtom, selectionScope } from "../lib/selection-memory";
import { useComposerSelection } from "./use-composer-selection";

const services = vi.hoisted(() => ({ switchModel: vi.fn(), switchAgent: vi.fn(), cache: vi.fn() }));
vi.mock("../services/palot", () => ({ palot: services }));
vi.mock("./use-session-catalog", () => ({ useCacheSession: () => services.cache }));

const models: PalotModel[] = ["one", "two"].map((providerID) => ({
  id: "reasoner",
  modelID: "reasoner",
  providerID,
  name: providerID,
  variants: ["low", "high"],
  family: null,
  inputLimit: null,
  contextLimit: 100_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
}));
const agents: PalotAgent[] = ["a", "b"].map((id) => ({
  id,
  name: id,
  description: null,
  hidden: false,
  mode: "primary",
  color: null,
  steps: null,
  model: { id: "reasoner", providerID: id === "a" ? "one" : "two", variant: "low" },
  permissions: [],
}));
const session: PalotSession = {
  id: "task",
  projectID: "project",
  parentID: null,
  title: null,
  agent: "a",
  model: { id: "reasoner", providerID: "one", variant: "low" },
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const runtime = {
  connectionID: "connection-1",
  profileID: "profile-1",
  contractVersion: "test",
  phase: "connected" as const,
  connected: true,
  binaryPath: "opencode2",
  version: "test",
  pid: 1,
  managed: true,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};

function setup(
  draft = false,
  store = createStore(),
  options: { projectDefault?: ModelRef | null } = {},
) {
  if (!store.get(runtimeAtom)) store.set(runtimeAtom, runtime);
  const props = { session, draft, catalogsReady: true };
  const hook = renderHook(
    (input: typeof props) =>
      useComposerSelection({
        ...input,
        draftScope: input.draft ? "new:project" : input.session.id,
        agents,
        models,
        projectDefault: options.projectDefault ?? null,
        catalogDefault: models[0]!,
      }),
    {
      initialProps: props,
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
  return {
    ...hook,
    store,
    props,
    sync() {
      hook.rerender({ ...props, session: services.cache.mock.lastCall?.[0] ?? session });
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  services.switchModel.mockReset();
  services.switchAgent.mockReset();
  services.cache.mockReset();
});
afterEach(cleanup);

describe("composer selection ownership", () => {
  it("does not pin or remember the displayed global default for an untouched new task", () => {
    const hook = setup(true);
    expect(hook.result.current.session.model).toEqual({ id: "reasoner", providerID: "one" });
    expect(hook.result.current.creationModel).toBeNull();
    expect(hook.result.current.blocked).toBe(false);
    act(() => hook.result.current.rememberCreated());
    expect(hook.store.get(selectionMemoriesAtom)).toEqual({});
    expect(services.switchModel).not.toHaveBeenCalled();
  });

  it("applies an explicit project model and variant instead of leaving selection automatic", () => {
    const hook = setup(true, createStore(), {
      projectDefault: { id: "reasoner", providerID: "two", variant: "high" },
    });
    expect(hook.result.current.creationModel).toEqual({
      id: "reasoner",
      providerID: "two",
      variant: "high",
    });
  });

  it("applies explicitly chosen and remembered models even without an explicit agent", async () => {
    const hook = setup(true);
    await act(async () =>
      hook.result.current.selectVariant({ id: "reasoner", providerID: "two", variant: "high" }),
    );
    expect(hook.result.current.creationModel).toEqual({
      id: "reasoner",
      providerID: "two",
      variant: "high",
    });
    act(() => hook.result.current.rememberCreated());
    hook.unmount();
    const reopened = setup(true, hook.store);
    expect(reopened.result.current.session.agent).toBeNull();
    expect(reopened.result.current.creationModel).toEqual({
      id: "reasoner",
      providerID: "two",
      variant: "high",
    });
  });

  it("does not mutate the server or preferences when an existing session opens", () => {
    const store = createStore();
    const memory = {
      [selectionScope("profile-1", "project")]: rememberSelection(undefined, "b", {
        id: "reasoner",
        providerID: "two",
        variant: "high",
      }),
    };
    store.set(selectionMemoriesAtom, memory);
    const hook = setup(false, store);
    expect(hook.result.current.session).toBe(session);
    expect(hook.store.get(selectionMemoriesAtom)).toEqual(memory);
    expect(services.switchModel).not.toHaveBeenCalled();
    expect(services.switchAgent).not.toHaveBeenCalled();
    expect(services.cache).not.toHaveBeenCalled();
  });

  it("ignores an unavailable remembered agent without changing persisted memory", () => {
    const store = createStore();
    const memory = {
      [selectionScope("profile-1", "project")]: rememberSelection(undefined, "removed-agent", {
        id: "reasoner",
        providerID: "two",
        variant: "high",
      }),
    };
    store.set(selectionMemoriesAtom, memory);
    const hook = setup(true, store);
    expect(hook.result.current.session).toMatchObject({
      agent: null,
      model: { id: "reasoner", providerID: "one" },
    });
    expect(store.get(selectionMemoriesAtom)).toEqual(memory);
  });

  it("restores A's reasoning after A → B → A without carrying A's model into B", async () => {
    const hook = setup();
    await act(async () =>
      hook.result.current.selectVariant({ id: "reasoner", providerID: "one", variant: "high" }),
    );
    hook.sync();
    await act(async () => hook.result.current.selectAgent(agents[1]!));
    expect(services.switchModel).toHaveBeenLastCalledWith({
      sessionID: "task",
      model: { id: "reasoner", providerID: "two", variant: "low" },
    });
    hook.sync();
    await act(async () => hook.result.current.selectAgent(agents[0]!));
    expect(services.switchModel).toHaveBeenLastCalledWith({
      sessionID: "task",
      model: { id: "reasoner", providerID: "one", variant: "high" },
    });
  });

  it("remembers reasoning separately for identical model IDs on different providers, including Auto", async () => {
    const hook = setup();
    await act(async () =>
      hook.result.current.selectVariant({ id: "reasoner", providerID: "one", variant: "high" }),
    );
    hook.sync();
    await act(async () => hook.result.current.selectModel({ id: "reasoner", providerID: "two" }));
    expect(services.switchModel).toHaveBeenLastCalledWith({
      sessionID: "task",
      model: { id: "reasoner", providerID: "two" },
    });
    hook.sync();
    await act(async () => hook.result.current.selectModel({ id: "reasoner", providerID: "one" }));
    expect(services.switchModel).toHaveBeenLastCalledWith({
      sessionID: "task",
      model: { id: "reasoner", providerID: "one", variant: "high" },
    });
    hook.sync();
    await act(async () => hook.result.current.selectVariant({ id: "reasoner", providerID: "one" }));
    hook.sync();
    await act(async () => hook.result.current.selectAgent(agents[1]!));
    hook.sync();
    await act(async () => hook.result.current.selectAgent(agents[0]!));
    expect(services.switchModel).toHaveBeenLastCalledWith({
      sessionID: "task",
      model: { id: "reasoner", providerID: "one" },
    });
  });

  it("retains successful memory on failure and keeps the actual partial agent state", async () => {
    const hook = setup();
    await act(async () =>
      hook.result.current.selectVariant({ id: "reasoner", providerID: "one", variant: "high" }),
    );
    const saved = hook.store.get(selectionMemoriesAtom);
    services.switchModel.mockRejectedValueOnce(new Error("No model"));
    await act(async () => {
      await expect(
        hook.result.current.selectModel({ id: "reasoner", providerID: "two" }),
      ).rejects.toThrow("No model");
    });
    expect(hook.store.get(selectionMemoriesAtom)).toEqual(saved);
    services.switchModel.mockRejectedValueOnce(new Error("No target model"));
    await act(async () => {
      await expect(hook.result.current.selectAgent(agents[1]!)).rejects.toThrow("No target model");
    });
    expect(services.cache).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "b", model: session.model }),
    );
    expect(hook.result.current.blocked).toBe(true);
    const memory = hook.store.get(selectionMemoriesAtom)[selectionScope("profile-1", "project")];
    expect(memory?.agent).toBe("b");
    expect(memory?.agents['"b"']).toBeUndefined();
    hook.sync();
    await act(async () => hook.result.current.selectModel({ id: "reasoner", providerID: "two" }));
    expect(hook.result.current.blocked).toBe(false);
  });

  it("does not dispatch the second switch on a different profile after an async agent selection", async () => {
    const hook = setup();
    let finish!: () => void;
    services.switchAgent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let action!: Promise<void>;
    act(() => {
      action = hook.result.current.selectAgent(agents[1]!);
    });
    act(() =>
      hook.store.set(runtimeAtom, {
        ...runtime,
        profileID: "profile-2",
        connectionID: "connection-2",
      }),
    );
    await act(async () => {
      finish();
      await expect(action).rejects.toThrow("connection changed");
    });
    expect(services.switchModel).not.toHaveBeenCalled();
    expect(
      hook.store.get(selectionMemoriesAtom)[selectionScope("profile-2", "project")],
    ).toBeUndefined();
  });

  it("reopens remembered drafts across connection restarts but isolates profiles and waits for catalogs", async () => {
    const live = setup();
    await act(async () => live.result.current.selectAgent(agents[1]!));
    live.sync();
    await act(async () =>
      live.result.current.selectVariant({ id: "reasoner", providerID: "two", variant: "high" }),
    );
    live.unmount();
    live.store.set(runtimeAtom, { ...runtime, connectionID: "restarted" });
    const draft = setup(true, live.store);
    expect(draft.result.current.session).toMatchObject({
      agent: "b",
      model: { providerID: "two", id: "reasoner", variant: "high" },
    });
    draft.rerender({ ...draft.props, catalogsReady: false });
    expect(draft.result.current.blocked).toBe(true);
    await act(async () => {
      await expect(draft.result.current.selectModel(models[0]!)).rejects.toThrow("load");
    });
    draft.rerender(draft.props);
    expect(draft.result.current.blocked).toBe(false);
    act(() =>
      live.store.set(runtimeAtom, { ...runtime, profileID: "profile-2", connectionID: "other" }),
    );
    expect(draft.result.current.session).toMatchObject({
      agent: null,
      model: { providerID: "one" },
    });
  });

  it("keeps draft choices local until successful creation and restores them between draft agents", async () => {
    const hook = setup(true);
    await act(async () => hook.result.current.selectAgent(agents[0]!));
    await act(async () =>
      hook.result.current.selectVariant({ id: "reasoner", providerID: "one", variant: "high" }),
    );
    await act(async () => hook.result.current.selectAgent(agents[1]!));
    await act(async () => hook.result.current.selectAgent(agents[0]!));
    expect(hook.result.current.session.model?.variant).toBe("high");
    expect(hook.store.get(selectionMemoriesAtom)).toEqual({});
    expect(services.switchAgent).not.toHaveBeenCalled();
    expect(services.switchModel).not.toHaveBeenCalled();
    act(() => hook.result.current.rememberCreated());
    expect(
      hook.store.get(selectionMemoriesAtom)[selectionScope("profile-1", "project")]?.agent,
    ).toBe("a");
  });
});
