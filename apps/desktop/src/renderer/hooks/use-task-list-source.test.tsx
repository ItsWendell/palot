import { act, cleanup, waitFor, within } from "@testing-library/react";
import { createStore } from "jotai";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { flushScheduledPersistedValues } from "../atoms/persisted";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { composerDraftAtomFamily } from "../atoms/ui";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { setRowRenderProbe } from "../components/task-list/debug";
import { TaskList } from "../components/task-list/task-list";
import { TooltipProvider } from "../components/ui/tooltip";
import { emptyComposerDraft } from "../lib/composer-draft";
import { composerScope } from "../lib/composer-scope";
import { createRendererQueryClient } from "../lib/query-client";
import { taskID } from "../lib/task-list/source/ids";
import type { TaskListDataSource } from "../lib/task-list/source/data-source";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { useTaskListSource } from "./use-task-list-source";

afterEach(() => {
  cleanup();
  setRowRenderProbe(null);
  vi.restoreAllMocks();
  flushScheduledPersistedValues();
  localStorage.clear();
});

const task = (id: string, title: string): PalotSession => ({
  id,
  parentID: null,
  projectID: "project",
  title,
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 2,
  idleAt: 2,
  viewedAt: 2,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

function focusedServer() {
  const store = createStore();
  store.set(runtimeAtom, {
    profileID: "profile",
    connectionID: "connection",
    connected: true,
    phase: "connected",
  } as OpenCodeRuntimeStatus);
  store.set(phaseAtom, "ready");
  store.set(sessionTriageSnapshotAtom, {
    profileID: "profile",
    bootstrapThrough: null,
    sessions: [],
  });
  const queryClient = createRendererQueryClient();
  seedCatalog(
    queryClient,
    {
      projects: [
        {
          id: "project",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [task("one", "Fix login"), task("two", "Write docs")],
    },
    "connection",
  );
  return { store, queryClient };
}

it("lists the focused server's tasks and routes settle through its triage", async () => {
  const { store, queryClient } = focusedServer();
  const dispatch = vi.spyOn(palot, "dispatchSessionTriage").mockResolvedValue({
    profileID: "profile",
    bootstrapThrough: null,
    sessions: [],
  });
  let source: TaskListDataSource | null = null;
  let renders = 0;
  function Host() {
    source = useTaskListSource();
    renders += 1;
    return <List source={source} />;
  }
  function List({ source }: { source: TaskListDataSource }) {
    const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
    return (
      <ul>
        {snapshot.tasks.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    );
  }
  const view = renderWithRouter(<Host />, store, "/new", queryClient);
  await waitFor(() => expect(view.getByText("Fix login")).toBeTruthy());
  expect(view.getByText("Write docs")).toBeTruthy();
  const snapshot = source!.getSnapshot();
  expect(snapshot.projects.map((item) => item.name)).toEqual(["Palot"]);
  expect(snapshot.servers).toEqual([
    { id: "profile", name: "OpenCode", online: true, lastSeenAt: null },
  ]);
  // Settled renders stop: the host does not loop on its own updates.
  const settledRenders = renders;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(renders).toBe(settledRenders);

  await act(async () => {
    await source!.actions.settle([taskID("profile", "one")]);
  });
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: "settle", profileID: "profile", sessionID: "one" }),
  );
});

const SourceContext = createContext<TaskListDataSource | null>(null);

it("marks a task holding an unsent draft, flipping only when the draft empties or fills", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  const { store, queryClient } = focusedServer();
  let hostRenders = 0;
  const rowRenders = new Map<string, number>();
  setRowRenderProbe((id) => rowRenders.set(id, (rowRenders.get(id) ?? 0) + 1));
  // As in the app: the provider re-renders with the catalog, the list below it does not.
  function Host({ children }: { children: ReactNode }) {
    const source = useTaskListSource();
    hostRenders += 1;
    return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
  }
  function List() {
    return (
      <TooltipProvider>
        <TaskList source={useContext(SourceContext)!} />
      </TooltipProvider>
    );
  }
  const view = renderWithRouter(
    <Host>
      <List />
    </Host>,
    store,
    "/new",
    queryClient,
  );
  const one = taskID("profile", "one");
  const row = () => view.container.querySelector<HTMLElement>(`[data-palot-task-row='${one}']`)!;
  await waitFor(() => expect(row()).toBeTruthy());
  const marked = () => within(row()).queryByRole("img", { name: "Unsent draft" }) !== null;
  expect(marked()).toBe(false);

  const scope = composerScope("profile", "session:one");
  const draftAtom = composerDraftAtomFamily(scope);
  const stateAtom = composerStateAtomFamily(scope);
  const type = (text: string) => act(() => store.set(draftAtom, { ...emptyComposerDraft(), text }));

  type("F");
  expect(marked()).toBe(true);
  expect(row().getAttribute("aria-label")).toContain("Unsent draft");

  // More characters change nothing the list shows: no provider or row renders.
  const settledHost = hostRenders;
  rowRenders.clear();
  for (const text of ["Fi", "Fix", "Fix ", "Fix the", "Fix the login"]) type(text);
  expect(hostRenders).toBe(settledHost);
  expect(rowRenders.size).toBe(0);
  expect(marked()).toBe(true);

  // Cleared: the mark goes.
  type("   ");
  expect(marked()).toBe(false);

  // Only an attachment counts too, and sending it clears the mark.
  act(() =>
    store.set(stateAtom, (state) => ({
      ...state,
      files: [{ uri: "file:///repo/shot.png", name: "shot.png", mime: "image/png", size: 10 }],
    })),
  );
  expect(marked()).toBe(true);
  act(() => store.set(stateAtom, (state) => ({ ...state, files: [] })));
  expect(marked()).toBe(false);

  // Other tasks never re-rendered for this task's draft.
  expect(rowRenders.has(taskID("profile", "two"))).toBe(false);
});
