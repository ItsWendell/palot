import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewSessionComposerOptions } from "./composer";
import { defaultWorktreeBaseAtom, defaultWorkspaceModeAtom } from "../atoms/ui";
import { NewTask } from "./new-task";

const catalog = vi.hoisted(() => ({
  projects: [
    {
      id: "project-1",
      canonical: "/repo/one",
      name: "One",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    },
  ],
}));

const services = vi.hoisted(() => ({
  createProjectCopy: vi.fn().mockResolvedValue({ directory: "/worktrees/new" }),
  createSession: vi.fn().mockResolvedValue({
    id: "session-1",
    parentID: null,
    projectID: "project-1",
    title: null,
    agent: null,
    model: null,
    location: { directory: "/worktrees/new" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }),
  switchModel: vi.fn(),
  switchAgent: vi.fn(),
  cacheSession: vi.fn(),
}));
const creation = vi.hoisted(() => ({
  options: { approvalMode: "normal", agent: null, model: null } as NewSessionComposerOptions,
  result: undefined as unknown,
  error: undefined as unknown,
}));

vi.mock("../hooks/use-session-catalog", () => ({
  useProjectCatalog: () => catalog.projects,
  useSessionCatalog: () => [],
  useCacheSession: () => services.cacheSession,
}));

vi.mock("../hooks/use-vcs-info", () => ({
  useVcsBranches: () => ({ data: ["main", "release"] }),
  useVcsInfo: () => ({ data: { currentBranch: "release", defaultBranch: "main" } }),
}));

vi.mock("../services/palot", () => ({ palot: services }));
vi.mock("./connection-destination", () => ({ ConnectionDestination: () => null }));

vi.mock("./composer", () => ({
  Composer: ({
    contextBar,
    onCreateSession,
    onCreateSessionError,
  }: {
    contextBar?: React.ReactNode;
    onCreateSession?(options: NewSessionComposerOptions): Promise<unknown>;
    onCreateSessionError?(error: unknown): void;
  }) => (
    <div>
      <input aria-label="Draft" defaultValue="keep me" />
      <button
        type="button"
        onClick={() =>
          void onCreateSession?.(creation.options).then(
            (result) => {
              creation.result = result;
            },
            (error) => {
              creation.error = error;
            },
          )
        }
      >
        Create task
      </button>
      <button type="button" onClick={() => onCreateSessionError?.(new Error("Creation failed"))}>
        Fail creation
      </button>
      {contextBar}
    </div>
  ),
}));

beforeEach(() => {
  creation.options = { approvalMode: "normal", agent: null, model: null };
  creation.result = undefined;
  creation.error = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewTask", () => {
  it.each(["normal", "full"] as const)(
    "sets %s permissions in the creation payload before handing a session to the composer",
    async (approvalMode) => {
      creation.options = { approvalMode, agent: null, model: null };
      const created = Promise.withResolvers<Awaited<ReturnType<typeof services.createSession>>>();
      services.createSession.mockReturnValueOnce(created.promise);
      render(
        <Provider store={createStore()}>
          <NewTask projectID="project-1" />
        </Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Create task" }));
      await waitFor(() =>
        expect(services.createSession).toHaveBeenCalledExactlyOnceWith(
          "/worktrees/new",
          undefined,
          undefined,
          approvalMode === "full" ? [{ action: "*", resource: "*", effect: "allow" }] : [],
        ),
      );
      expect(creation.result).toBeUndefined();
      await act(async () =>
        created.resolve({ id: "session-1" } as Awaited<ReturnType<typeof services.createSession>>),
      );
      expect(creation.result).toMatchObject({ id: "session-1" });
    },
  );

  it("leaves model and agent selection to the server for an automatic draft", async () => {
    render(
      <Provider store={createStore()}>
        <NewTask projectID="project-1" />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.result).toMatchObject({ id: "session-1" }));
    expect(services.switchAgent).not.toHaveBeenCalled();
    expect(services.switchModel).not.toHaveBeenCalled();
  });

  it("applies the chosen agent then model before handing the task to the composer", async () => {
    const onSessionCreated = vi.fn();
    creation.options = {
      approvalMode: "normal",
      agent: "plan",
      model: { id: "deep", providerID: "openai", variant: "high" },
    };
    let finishModel!: () => void;
    services.switchModel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishModel = resolve;
        }),
    );
    render(
      <Provider store={createStore()}>
        <NewTask projectID="project-1" onSessionCreated={onSessionCreated} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(services.switchModel).toHaveBeenCalledWith({
        sessionID: "session-1",
        model: { id: "deep", providerID: "openai", variant: "high" },
      }),
    );
    expect(services.switchAgent).toHaveBeenCalledWith({ sessionID: "session-1", agent: "plan" });
    expect(services.switchAgent.mock.invocationCallOrder[0]).toBeLessThan(
      services.switchModel.mock.invocationCallOrder[0]!,
    );
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(creation.result).toBeUndefined();
    await act(async () => finishModel());
    expect(creation.result).toMatchObject({
      agent: "plan",
      model: { id: "deep", providerID: "openai", variant: "high" },
    });
    expect(onSessionCreated).toHaveBeenCalledWith("session-1");
  });

  it("does not return a prompt target after a requested model fails", async () => {
    creation.options = {
      approvalMode: "normal",
      agent: "plan",
      model: { id: "deep", providerID: "openai" },
    };
    services.switchModel.mockRejectedValueOnce(new Error("Model unavailable"));
    const onSessionCreated = vi.fn();
    render(
      <Provider store={createStore()}>
        <NewTask projectID="project-1" onSessionCreated={onSessionCreated} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.error).toEqual(new Error("Model unavailable")));
    expect(creation.result).toBeUndefined();
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(services.cacheSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "plan", model: null }),
    );
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("keep me");
    expect(screen.getByRole("alert").textContent).toContain("Model unavailable");
  });

  it("resets workspace-specific state on mode changes without remounting the draft", () => {
    const store = createStore();
    store.set(defaultWorkspaceModeAtom, "current");
    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );

    const draft = screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" });
    fireEvent.change(draft, { target: { value: "edited draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Fail creation" }));
    expect(screen.getByRole("alert").textContent).toContain("Creation failed");
    expect(screen.getByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();

    act(() => store.set(defaultWorkspaceModeAtom, "worktree"));

    expect(screen.getByRole("button", { name: "Work in: New worktree" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Source branch: main" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe(
      "edited draft",
    );
  });

  it("can default new worktrees to the current branch", () => {
    const store = createStore();
    store.set(defaultWorktreeBaseAtom, "current");

    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "Source branch: release" })).toBeTruthy();
  });

  it("creates an untouched new worktree from the repository default branch", async () => {
    render(
      <Provider store={createStore()}>
        <NewTask projectID="project-1" />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(services.createProjectCopy).toHaveBeenCalledWith("project-1", "/repo/one", "main"),
    );
  });
});
