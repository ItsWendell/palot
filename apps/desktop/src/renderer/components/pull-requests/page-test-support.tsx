import { createStore } from "jotai";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../../shared";
import { runtimeAtom, selectedSessionIDAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import { renderWithRouter, seedCatalog } from "../../test-utils/render-with-router";
import { PullRequestsPage } from "./pull-requests-page";

export const project: PalotProject = {
  id: "project-web",
  canonical: "/code/web",
  name: "web",
  sandboxes: [],
  vcs: "git",
  updatedAt: 1,
};

export const task: PalotSession = {
  id: "task-1",
  parentID: null,
  projectID: project.id,
  title: "Fix login",
  agent: null,
  model: null,
  location: { directory: project.canonical },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

/** Renders the review screen at `/pull-requests`, optionally with `?pr=` selected. */
export function renderPullRequestsPage(
  options: {
    pr?: string;
    selectedSessionID?: string | null;
    store?: ReturnType<typeof createStore>;
  } = {},
) {
  const store = options.store ?? createStore();
  store.set(runtimeAtom, {
    profileID: "profile",
    connectionID: "connection",
    connected: true,
    phase: "connected",
  } as OpenCodeRuntimeStatus);
  store.set(selectedSessionIDAtom, options.selectedSessionID ?? null);
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { projects: [project], sessions: [task] }, "connection");
  return {
    store,
    ...renderWithRouter(
      <PullRequestsPage />,
      store,
      options.pr ? `/pull-requests?pr=${options.pr}` : "/pull-requests",
      queryClient,
    ),
  };
}
