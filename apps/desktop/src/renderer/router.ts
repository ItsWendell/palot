import { createHashHistory, createRouter } from "@tanstack/react-router";
import { createStore } from "jotai";
import { routeTree } from "./routeTree.gen";
import { rendererQueryClient } from "./lib/query-client";
import { RenderErrorRecovery } from "./components/render-error-boundary";

export const rendererStore = createStore();

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { store: rendererStore, queryClient: rendererQueryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 30_000,
  // Loader data lives in the query cache, so the router need not keep left matches. Keeping
  // them also leaks: an aborted match's abort reason holds the navigation before it, so every
  // cached match roots the whole navigation history (router-core 1.171, about 9 KB a switch).
  defaultGcTime: 0,
  defaultPendingMs: 150,
  defaultPendingMinMs: 150,
  defaultErrorComponent: RenderErrorRecovery,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
