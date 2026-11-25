import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSystemEntry } from "@opencode/client";
import type { PalotComposerCatalog, PalotProject, PalotSession } from "../../../shared";
import { workbenchStateAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { openCodeKeys } from "../../lib/opencode-query";
import { savePromptStash } from "../../lib/prompt-stash";
import { createRendererQueryClient } from "../../lib/query-client";
import { workbenchScopeKey } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { CLOSED_LAUNCHER, type LauncherState } from "./launcher-state";
import {
  FILE_SEARCH_DEBOUNCE_MS,
  launcherTasks,
  useLauncherData,
  type LauncherDataInput,
} from "./use-launcher-data";

vi.mock("../../services/palot", () => ({
  palot: {
    loadComposerCatalog: vi.fn(),
    findWorkspaceFiles: vi.fn(),
    loadSettings: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.localStorage.clear();
});

const location = { directory: "/repo" };
const CONNECTION = "connection";

const catalog: PalotComposerCatalog = {
  commands: [
    { name: "compact", description: "Free context", agent: null, model: null, subtask: false },
  ],
  skills: [
    {
      id: "palot-design",
      name: "Palot design",
      description: null,
      location: "/skills",
      slash: false,
      autoinvoke: false,
    },
  ],
  errors: [],
};

function open(patch: Partial<Extract<LauncherState, { status: "open" }>> = {}): LauncherState {
  return {
    status: "open",
    dismissedTrigger: null,
    source: { type: "plus", via: "button" },
    category: null,
    query: "",
    highlight: null,
    keptDraft: null,
    ...patch,
  };
}

function setup(state: LauncherState, options: { seed?: boolean } = {}) {
  const store = createStore();
  const queryClient = createRendererQueryClient();
  store.set(runtimeAtom, {
    connectionID: CONNECTION,
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: "/test/opencode2",
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  if (options.seed !== false) {
    // What the composer's mount-time prefetch leaves in the cache.
    queryClient.setQueryData(openCodeKeys.composerCatalog(CONNECTION, location), catalog);
    for (const capability of ["agents", "references"] as const) {
      queryClient.setQueryData(
        openCodeKeys.settingsSnapshot(CONNECTION, {
          ...location,
          projectID: "project",
          capabilities: [capability],
        }),
        {
          location,
          agents:
            capability === "agents"
              ? [
                  {
                    id: "explore",
                    name: "Explore",
                    description: "Read-only search",
                    mode: "subagent",
                    hidden: false,
                    color: null,
                    steps: null,
                    model: null,
                    permissions: [],
                  },
                ]
              : undefined,
          references: capability === "references" ? [] : undefined,
          errors: [],
        },
      );
    }
  }
  const base: Omit<LauncherDataInput, "state"> = {
    location,
    projectID: "project",
    sessionID: "ses_current",
    newTask: false,
    stashScope: "scope",
    session: null,
  };
  const hook = renderHook(
    (props: { state: LauncherState }) => useLauncherData({ ...base, ...props }),
    {
      initialProps: { state },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );
  return { ...hook, store, queryClient };
}

const titles = (result: { current: ReturnType<typeof useLauncherData> }) =>
  result.current.view.items.map((item) => item.title);

describe("useLauncherData", () => {
  it("lists prefetched catalogs on open without a request", () => {
    const hook = setup(CLOSED_LAUNCHER);
    hook.rerender({ state: open({ category: "commands" }) });
    expect(titles(hook.result)).toEqual(["/compact"]);
    hook.rerender({ state: open({ category: "skills" }) });
    expect(titles(hook.result)).toEqual(["$palot-design"]);
    expect(palot.loadComposerCatalog).not.toHaveBeenCalled();
    expect(palot.loadSettings).not.toHaveBeenCalled();
  });

  it("loads a catalog the prefetch has not delivered, showing it as loading", async () => {
    const pending = Promise.withResolvers<PalotComposerCatalog>();
    vi.mocked(palot.loadComposerCatalog).mockReturnValue(pending.promise);
    vi.mocked(palot.loadSettings).mockReturnValue(new Promise(() => {}));
    const hook = setup(open({ category: "commands" }), { seed: false });
    expect(hook.result.current.view).toMatchObject({ loading: true, empty: null, items: [] });
    await act(async () => pending.resolve(catalog));
    await waitFor(() => expect(titles(hook.result)).toEqual(["/compact"]));
    expect(palot.loadComposerCatalog).toHaveBeenCalledTimes(1);
  });

  it("debounces file search, keeps older rows unpickable while it loads, and cancels superseded searches", async () => {
    const searches: {
      query: string;
      signal?: AbortSignal;
      resolve(value: FileSystemEntry[]): void;
    }[] = [];
    vi.mocked(palot.findWorkspaceFiles).mockImplementation((input, signal) => {
      const deferred = Promise.withResolvers<FileSystemEntry[]>();
      searches.push({ query: input.query, signal, resolve: deferred.resolve });
      return deferred.promise;
    });
    const trigger = (query: string) =>
      open({
        source: { type: "trigger", trigger: { char: "@", from: 0, to: query.length + 1 } },
        category: "mention",
        query,
      });
    const hook = setup(trigger(""));
    await waitFor(() => expect(searches).toHaveLength(1));
    // Other kinds show while the search runs.
    expect(titles(hook.result)).toEqual(["@explore"]);
    expect(hook.result.current.view.loading).toBe(true);
    await act(async () => searches[0]!.resolve([{ path: "src/main.ts", type: "file" }]));
    await waitFor(() => expect(titles(hook.result)).toEqual(["@explore", "main.ts"]));
    expect(hook.result.current.view.items[1]!.disabled).toBeUndefined();

    hook.rerender({ state: trigger("m") });
    hook.rerender({ state: trigger("ma") });
    // The older rows stay listed but cannot be picked until the new result lands.
    expect(hook.result.current.view.items.find((item) => item.title === "main.ts")?.disabled).toBe(
      true,
    );
    expect(searches).toHaveLength(1);
    await waitFor(() => expect(searches).toHaveLength(2), {
      timeout: FILE_SEARCH_DEBOUNCE_MS * 10,
    });
    expect(searches[1]!.query).toBe("ma");

    hook.rerender({ state: trigger("mai") });
    await waitFor(() => expect(searches).toHaveLength(3), {
      timeout: FILE_SEARCH_DEBOUNCE_MS * 10,
    });
    expect(searches[1]!.signal?.aborted).toBe(true);
    await act(async () => searches[2]!.resolve([{ path: "src/main.ts", type: "file" }]));
    await waitFor(() =>
      expect(
        hook.result.current.view.items.find((item) => item.title === "main.ts")?.disabled,
      ).toBeUndefined(),
    );
    expect(hook.result.current.view.loading).toBe(false);
  });

  it("reads open files, the stash and tasks only while open", () => {
    savePromptStash("scope", [
      {
        id: "stash-1",
        createdAt: Date.now() - 60_000,
        draft: { text: "Saved idea", mentions: [], command: null },
        files: [],
      },
    ]);
    const hook = setup(CLOSED_LAUNCHER);
    hook.store.set(workbenchStateAtom, {
      version: 1,
      scopes: {
        [workbenchScopeKey({ profileID: "profile", sessionID: "ses_current" })]: {
          right: {
            tabs: [
              {
                id: "tab",
                pinned: false,
                kind: "file",
                resource: { profileID: "profile", location, path: "src/open.ts" },
              },
            ],
            activeTabID: "tab",
            requestedOpen: true,
          },
          bottom: { tabs: [], activeTabID: null, requestedOpen: false },
          updatedAt: 1,
        },
      },
    });
    expect(hook.result.current.sources).toMatchObject({ openFiles: [], stash: [] });
    hook.rerender({ state: open() });
    expect(hook.result.current.sources.openFiles).toEqual(["src/open.ts"]);
    expect(hook.result.current.sources.stash.map((entry) => entry.id)).toEqual(["stash-1"]);
    const suggested = hook.result.current.view.sections.find(
      (section) => section.label === "Suggested",
    );
    expect(suggested?.items.map((item) => item.title)).toEqual(["open.ts", "Saved idea"]);
  });
});

describe("launcherTasks", () => {
  it("lists root tasks newest first with their project, excluding self, children, archives and invalid IDs", () => {
    const project: PalotProject = {
      id: "project",
      name: "Palot",
      canonical: "/repo",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    };
    const task = (
      letter: string,
      updatedAt: number,
      extra: Partial<PalotSession> = {},
    ): PalotSession => ({
      id: `ses_${letter.repeat(26)}`,
      parentID: null,
      projectID: "project",
      title: `Task ${letter}`,
      agent: null,
      model: null,
      location: { directory: "/repo" },
      createdAt: 1,
      updatedAt,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      ...extra,
    });
    const tasks = [
      task("a", 2),
      task("b", 3),
      task("c", 4, { parentID: "parent" }),
      task("d", 5, { archivedAt: 1 }),
      task("e", 10),
      task("f", 6, { id: "invalid" }),
    ];
    expect(
      launcherTasks(tasks, [project], tasks[4]!.id).map(({ title, project }) => [title, project]),
    ).toEqual([
      ["Task b", "Palot"],
      ["Task a", "Palot"],
    ]);
  });
});
