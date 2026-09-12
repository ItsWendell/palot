import { Provider, createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { sessionCatalogInfo } from "../lib/session-catalog-query";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { usePalotNavigation } from "./use-navigation";

const child: PalotSession = {
  id: "child-1",
  parentID: "parent-1",
  projectID: "project-1",
  title: "Explore",
  agent: "explore",
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 2,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function NavigationHarness() {
  const { openSession, openUsage } = usePalotNavigation();
  return (
    <>
      <button onClick={() => void openSession(child.id)}>Open child</button>
      <button onClick={() => void openUsage({ days: 90, projectID: "project-1" })}>
        Open usage
      </button>
    </>
  );
}

describe("usePalotNavigation", () => {
  afterEach(cleanup);
  it("loads an unlisted child session through the destination route", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    });
    const getSession = vi.spyOn(palot, "getSession").mockResolvedValue(child);
    const { queryClient, router } = renderWithRouter(
      <Provider store={store}>
        <NavigationHarness />
      </Provider>,
      store,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open child" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${child.id}`));
    expect(getSession).toHaveBeenCalledWith(child.id);
    expect(sessionCatalogInfo(queryClient, "connection").map((session) => session.id)).toContain(
      child.id,
    );
  });

  it("navigates to a listed session without reloading it", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    });
    const getSession = vi.spyOn(palot, "getSession");
    const { queryClient, router } = renderWithRouter(
      <Provider store={store}>
        <NavigationHarness />
      </Provider>,
      store,
    );
    seedCatalog(queryClient, { sessions: [child] }, "connection");

    await userEvent.click(screen.getByRole("button", { name: "Open child" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${child.id}`));
    expect(getSession).not.toHaveBeenCalled();
  });

  it("opens a scoped usage window", async () => {
    const store = createStore();
    const { router } = renderWithRouter(<NavigationHarness />, store);

    await userEvent.click(screen.getByRole("button", { name: "Open usage" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/usage"));
    expect(router.state.location.search).toEqual({ days: 90, projectID: "project-1" });
  });
});
