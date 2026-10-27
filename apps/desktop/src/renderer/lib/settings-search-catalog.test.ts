import { createRouter } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { routeTree } from "../routeTree.gen";
import { createRendererQueryClient } from "./query-client";
import { createStore } from "jotai";
import { SETTINGS_SEARCH_CATALOG } from "./settings-search-catalog";

it("only links setting search results to registered settings routes", () => {
  const router = createRouter({
    routeTree,
    context: { store: createStore(), queryClient: createRendererQueryClient() },
  });
  for (const setting of SETTINGS_SEARCH_CATALOG) {
    expect(router.routesByPath, setting.title).toHaveProperty(setting.route);
  }
});
