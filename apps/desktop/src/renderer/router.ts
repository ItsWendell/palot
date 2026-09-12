import { createHashHistory, createRouter } from "@tanstack/react-router";
import { createStore } from "jotai";
import { routeTree } from "./routeTree.gen";
import { rendererQueryClient } from "./lib/query-client";

export const rendererStore = createStore();

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { store: rendererStore, queryClient: rendererQueryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 30_000,
  defaultPendingMs: 150,
  defaultPendingMinMs: 150,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
