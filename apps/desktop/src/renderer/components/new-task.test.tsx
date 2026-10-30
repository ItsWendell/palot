import { Provider, createStore } from "jotai";
import {
  act,
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewSessionComposerOptions } from "./composer";
import {
  defaultWorktreeBaseAtom,
  defaultWorkspaceModeAtom,
  projectWorkspaceModesAtom,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { worktreeBranchPrefixAtom } from "../atoms/worktree-preferences";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { approvalPresetRules } from "../lib/session-permissions";
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
  createChatSession: vi.fn(),
  getLocation: vi.fn().mockResolvedValue({
    directory: "/home/remote",
    project: { id: "home", directory: "/home/remote", canonical: "/home/remote" },
  }),
  listProjects: vi.fn().mockResolvedValue([{ id: "home", canonical: "/home/remote" }]),
  createProjectCopy: vi.fn().mockResolvedValue({ directory: "/worktrees/new" }),
  gitBranch: vi.fn().mockResolvedValue(undefined),
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
  renameSession: vi.fn(),
  cacheSession: vi.fn(),
}));
const creation = vi.hoisted(() => ({
  options: { approvalMode: "normal", agent: null, model: null } as NewSessionComposerOptions,
  result: undefined as unknown,
  error: undefined as unknown,
}));

const owner = {
  profileID: "remote",
  connectionID: "remote-connection",
  connected: true,
  phase: "connected",
} as OpenCodeRuntimeStatus;
function createDraftStore() {
  const store = createStore();
  store.set(runtimeAtom, owner);
  store.set(discoveredProfileIDsAtom, ["remote", "local"]);
  store.set(includedProfileIDsAtom, ["remote", "local"]);
  return store;
}

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
vi.mock("../hooks/use-source-control", () => ({
  sourceControl: { gitBranch: services.gitBranch },
}));
vi.mock("../services/opencode-chats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/opencode-chats")>()),
  createChatSession: services.createChatSession,
}));
vi.mock("../services/opencode-client", () => ({
  openCodeClient: () => ({
    location: { get: services.getLocation },
    project: { list: services.listProjects },
  }),
}));
vi.mock("./destination-picker", () => ({
  DestinationPicker: () => <button type="button">Task destination</button>,
}));

const defaultProject = catalog.projects[0]!;
function render(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderComponent(component, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

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
  catalog.projects.splice(0, catalog.projects.length, defaultProject);
  vi.clearAllMocks();
});

describe("NewTask", () => {
  it("names a new local worktree branch before creating its task", async () => {
    const store = createDraftStore();
    store.set(runtimeAtom, {
      ...owner,
      capabilities: { localPathActions: true },
    } as OpenCodeRuntimeStatus);
    store.set(worktreeBranchPrefixAtom, "tasks/");
    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "New worktree branch name" }), {
      target: { value: " feature " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.result).toMatchObject({ id: "session-1" }));
    expect(services.gitBranch).toHaveBeenCalledWith({
      profileID: "remote",
      directory: "/worktrees/new",
      action: "create",
      name: "tasks/feature",
    });
    expect(services.gitBranch.mock.invocationCallOrder[0]).toBeLessThan(
      services.createSession.mock.invocationCallOrder[0]!,
    );
  });

  it("retains the worktree and draft and explains recovery if branch creation fails", async () => {
    const store = createDraftStore();
    store.set(runtimeAtom, {
      ...owner,
      capabilities: { localPathActions: true },
    } as OpenCodeRuntimeStatus);
    services.gitBranch.mockRejectedValueOnce(new Error("Branch already exists"));
    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "New worktree branch name" }), {
      target: { value: "feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.error).toBeInstanceOf(Error));
    expect(screen.getByRole("alert").textContent).toContain("kept at /worktrees/new");
    expect(screen.getByRole("alert").textContent).toContain("Branch already exists");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("keep me");
    expect(services.createSession).not.toHaveBeenCalled();
  });

  it("applies sibling titles, model and approvals without navigating before a batch finishes", async () => {
    const onSessionCreated = vi.fn();
    creation.options = {
      approvalMode: "full",
      agent: "build",
      model: { providerID: "test", id: "alpha" },
      title: "Compare abc123 · prompt · Alpha",
      deferNavigation: true,
    };
    render(
      <Provider store={createDraftStore()}>
        <NewTask profileID="remote" onSessionCreated={onSessionCreated} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(creation.result).toMatchObject({
        id: "session-1",
        title: creation.options.title,
        agent: "build",
        model: creation.options.model,
      }),
    );
    expect(services.renameSession).toHaveBeenCalledWith("session-1", creation.options.title);
    expect(services.createSession.mock.calls[0]?.[3]).toEqual(approvalPresetRules("full"));
    expect(onSessionCreated).not.toHaveBeenCalled();
  });
  it("starts a chat without any project or workspace pickers and applies selections before navigation", async () => {
    catalog.projects.splice(0);
    const session = {
      parentID: null,
      title: null,
      agent: null,
      model: null,
      id: "chat-1",
      projectID: "chat-folder",
      location: { directory: "/home/remote/.palot/chats/today-chat-1" },
    };
    services.createChatSession.mockResolvedValueOnce(session);
    creation.options = {
      approvalMode: "full",
      agent: "plan",
      model: { id: "deep", providerID: "openai" },
    };
    const onProjectChange = vi.fn();
    const onSessionCreated = vi.fn();
    render(
      <Provider store={createDraftStore()}>
        <NewTask chat onProjectChange={onProjectChange} onSessionCreated={onSessionCreated} />
      </Provider>,
    );
    expect(screen.getByRole("heading", { name: "What do you want to ask?" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith("chat-1"));
    expect(services.createChatSession).toHaveBeenCalledExactlyOnceWith({
      connectionID: "remote-connection",
      permissions: approvalPresetRules("full"),
    });
    expect(services.switchAgent).toHaveBeenCalledWith({ sessionID: "chat-1", agent: "plan" });
    expect(services.switchModel).toHaveBeenCalledWith({
      sessionID: "chat-1",
      model: creation.options.model,
    });
    expect(services.switchModel.mock.invocationCallOrder[0]).toBeLessThan(
      onSessionCreated.mock.invocationCallOrder[0]!,
    );
    expect(services.createProjectCopy).not.toHaveBeenCalled();
    expect(services.createSession).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Task destination" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Work in:|Source branch:/ })).toBeNull();
  });

  it.each([
    ["inside a repository", { id: "repo", directory: "/home", canonical: "/home" }, null],
    [
      "a repository itself",
      { id: "home", directory: "/home/remote", canonical: "/home/remote" },
      [{ id: "home", canonical: "/home/remote", vcs: "git" }],
    ],
  ])("explains why chats cannot start when the server folder is %s", async (_, project, list) => {
    services.getLocation.mockResolvedValueOnce({ directory: "/home/remote", project });
    if (list) services.listProjects.mockResolvedValueOnce(list);
    render(
      <Provider store={createDraftStore()}>
        <NewTask chat />
      </Provider>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Chats need a folder outside a repository",
    );
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  });

  it("keeps a chat draft when creation fails", async () => {
    services.createChatSession.mockRejectedValueOnce(new Error("Folder unavailable"));
    const onSessionCreated = vi.fn();
    render(
      <Provider store={createDraftStore()}>
        <NewTask chat onSessionCreated={onSessionCreated} />
      </Provider>,
    );
    const draft = await screen.findByRole<HTMLInputElement>("textbox", { name: "Draft" });
    fireEvent.change(draft, { target: { value: "my question" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.error).toEqual(new Error("Folder unavailable")));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe(
      "my question",
    );
    expect(screen.getByRole("alert").textContent).toContain("Folder unavailable");
    expect(onSessionCreated).not.toHaveBeenCalled();
  });

  it("offers a quiet switch from a project task to a chat", () => {
    const onChat = vi.fn();
    render(
      <Provider store={createDraftStore()}>
        <NewTask onChat={onChat} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "…or just chat" }));
    expect(onChat).toHaveBeenCalledOnce();
  });

  it.each(["normal", "full"] as const)(
    "sets %s permissions in the creation payload before handing a session to the composer",
    async (approvalMode) => {
      creation.options = { approvalMode, agent: null, model: null };
      const created = Promise.withResolvers<Awaited<ReturnType<typeof services.createSession>>>();
      services.createSession.mockReturnValueOnce(created.promise);
      render(
        <Provider store={createDraftStore()}>
          <NewTask projectID="project-1" />
        </Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Create task" }));
      await waitFor(() =>
        expect(services.createSession).toHaveBeenCalledExactlyOnceWith(
          "/worktrees/new",
          undefined,
          "remote-connection",
          approvalPresetRules(approvalMode),
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
      <Provider store={createDraftStore()}>
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
      <Provider store={createDraftStore()}>
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
      <Provider store={createDraftStore()}>
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
    const store = createDraftStore();
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

  it("chooses the source branch and workspace from their pickers", async () => {
    const user = userEvent.setup();
    const store = createDraftStore();
    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Source branch: main" }));
    // Branch search runs on the server, so the picker keeps showing its results.
    await user.type(await screen.findByRole("combobox", { name: "Search branches" }), "rel");
    await user.click(screen.getByRole("option", { name: "release" }));
    expect(await screen.findByRole("button", { name: "Source branch: release" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Work in: New worktree" }));
    await user.click(await screen.findByRole("option", { name: /^Current checkout/ }));
    expect(await screen.findByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();
    expect(store.get(defaultWorkspaceModeAtom)).toBe("worktree");
    expect(store.get(projectWorkspaceModesAtom)[JSON.stringify(["remote", "project-1"])]).toBe(
      "current",
    );
  });

  it("remembers each project's workspace choice across project switches and remounts", async () => {
    catalog.projects.push({
      ...catalog.projects[0]!,
      id: "project-2",
      canonical: "/repo/two",
      name: "Two",
    });
    const user = userEvent.setup();
    const store = createDraftStore();
    const view = (projectID: string) => (
      <Provider store={store}>
        <NewTask projectID={projectID} />
      </Provider>
    );
    const { rerender, unmount } = render(view("project-1"));

    await user.click(screen.getByRole("button", { name: "Work in: New worktree" }));
    await user.click(await screen.findByRole("option", { name: /^Current checkout/ }));

    rerender(view("project-2"));
    expect(screen.getByRole("button", { name: "Work in: New worktree" })).toBeTruthy();
    rerender(view("project-1"));
    expect(screen.getByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();
    unmount();
    render(view("project-1"));
    expect(screen.getByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(services.createSession).toHaveBeenCalledWith(
        "/repo/one",
        undefined,
        "remote-connection",
        approvalPresetRules("normal"),
      ),
    );
    expect(services.createProjectCopy).not.toHaveBeenCalled();
  });

  it("keeps matching project IDs on different servers independent of the global default", async () => {
    const user = userEvent.setup();
    const store = createDraftStore();
    render(
      <Provider store={store}>
        <NewTask projectID="project-1" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Work in: New worktree" }));
    await user.click(await screen.findByRole("option", { name: /^Current checkout/ }));

    act(() => store.set(runtimeAtom, { ...owner, profileID: "local" }));
    expect(screen.getByRole("button", { name: "Work in: New worktree" })).toBeTruthy();
    act(() => store.set(runtimeAtom, owner));
    expect(screen.getByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();
    act(() => store.set(defaultWorkspaceModeAtom, "current"));
    act(() => store.set(defaultWorkspaceModeAtom, "worktree"));
    expect(screen.getByRole("button", { name: "Work in: Current checkout" })).toBeTruthy();
  });

  it("can default new worktrees to the current branch", () => {
    const store = createDraftStore();
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
      <Provider store={createDraftStore()}>
        <NewTask projectID="project-1" />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(services.createProjectCopy).toHaveBeenCalledWith(
        "project-1",
        "/repo/one",
        "main",
        "remote-connection",
      ),
    );
  });

  it.each(["offline", "disabled"])("never executes a draft on an %s owner", async (state) => {
    const store = createDraftStore();
    if (state === "offline") store.set(runtimeAtom, { ...owner, connected: false });
    else store.set(includedProfileIDsAtom, ["local"]);
    render(
      <Provider store={store}>
        <NewTask profileID="remote" projectID="project-1" />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(creation.error).toBeInstanceOf(Error));
    expect(services.createProjectCopy).not.toHaveBeenCalled();
    expect(services.createSession).not.toHaveBeenCalled();
  });

  it("does not use a colliding project from another focused owner", () => {
    render(
      <Provider store={createDraftStore()}>
        <NewTask profileID="local" projectID="project-1" />
      </Provider>,
    );
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  });

  it("does not replace an explicit project while its catalog is cold", () => {
    const onProjectChange = vi.fn();
    render(
      <Provider store={createDraftStore()}>
        <NewTask projectID="not-loaded" onProjectChange={onProjectChange} />
      </Provider>,
    );
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();
  });

  it("does not create a session on a new owner after a worktree completes late", async () => {
    const store = createDraftStore();
    const copy = Promise.withResolvers<{ directory: string }>();
    services.createProjectCopy.mockReturnValueOnce(copy.promise);
    render(
      <Provider store={store}>
        <NewTask profileID="remote" projectID="project-1" />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(services.createProjectCopy).toHaveBeenCalled());
    act(() =>
      store.set(runtimeAtom, { ...owner, profileID: "local", connectionID: "local-connection" }),
    );
    await act(async () => copy.resolve({ directory: "/remote-created" }));
    await waitFor(() => expect(creation.error).toBeInstanceOf(Error));
    expect(services.createSession).not.toHaveBeenCalled();
  });
});
