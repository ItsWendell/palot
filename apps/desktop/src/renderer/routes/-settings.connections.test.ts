import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { rendererQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

describe("Connections settings routes", () => {
  it("loads a Connections child route without redirecting back through the parent", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/settings/connections/profiles"] }),
      context: { store: createStore(), queryClient: rendererQueryClient },
    });

    await router.load();

    expect(router.state.location.pathname).toBe("/settings/connections/profiles");
    expect(router.state.matches.every((match) => match.status === "success")).toBe(true);
  });

  it("redirects the Connections index to Profiles once", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/settings/connections"] }),
      context: { store: createStore(), queryClient: rendererQueryClient },
    });

    await router.load();

    expect(router.state.location.pathname).toBe("/settings/connections/profiles");
    expect(router.state.matches.every((match) => match.status === "success")).toBe(true);
  });
});
