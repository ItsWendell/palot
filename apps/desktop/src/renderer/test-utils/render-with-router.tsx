import { RouterContextProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { routeTree } from "../routeTree.gen";
import { createRendererQueryClient } from "../lib/query-client";
import type { PalotProject, PalotSession } from "../../shared";
import { cacheProjects, cacheRootSessions, cacheSessions } from "../lib/session-catalog-query";

export function seedCatalog(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  input: { projects?: readonly PalotProject[]; sessions?: readonly PalotSession[] },
  connectionID = "disconnected",
): void {
  if (input.projects) cacheProjects(queryClient, connectionID, input.projects);
  if (input.sessions) {
    cacheSessions(queryClient, connectionID, input.sessions);
    cacheRootSessions(queryClient, connectionID, input.sessions);
  }
}

export function renderWithRouter(
  children: ReactNode,
  store: ReturnType<typeof createStore>,
  initialEntry = "/new",
  queryClient = createRendererQueryClient(),
) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { store, queryClient },
    defaultPreload: false,
  });
  return {
    router,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <RouterContextProvider router={router}>{children}</RouterContextProvider>
        </Provider>
      </QueryClientProvider>,
    ),
  };
}
