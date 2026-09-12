import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { Route } from "./welcome";

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openNewTask: vi.fn(), openSession: vi.fn() }),
}));
vi.mock("../hooks/use-settings-snapshot", () => ({
  useSettingsSnapshot: () => ({ data: undefined, refetch: vi.fn() }),
}));

const runtime: OpenCodeRuntimeStatus = {
  connectionID: "origin",
  profileID: "origin-profile",
  contractVersion: "test",
  phase: "error",
  connected: false,
  binaryPath: null,
  version: null,
  pid: null,
  managed: false,
  lastConnectedAt: null,
  error: null,
  versionMismatch: null,
};
const session: PalotSession = {
  id: "created-task",
  parentID: null,
  projectID: "project",
  title: "Created task",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("welcome project creation ownership", () => {
  it("offers local release setup on the initial step without checking releases or changing the service", async () => {
    const store = createStore();
    store.set(runtimeAtom, { ...runtime, source: "shared-service" });
    const releaseStatus = vi.spyOn(palot, "openCodeReleaseStatus").mockResolvedValue({
      channel: "stable",
      bundledVersion: "2.0.2",
      preparedVersion: null,
      checkedAt: null,
      offer: null,
    });
    const check = vi.spyOn(palot, "checkOpenCodeRelease");
    const connect = vi.spyOn(palot, "connectOpenCode");
    const Welcome = Route.options.component!;
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={store}>
          <Welcome />
        </Provider>
      </QueryClientProvider>,
    );
    expect(releaseStatus).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "OpenCode release settings" })),
    );
    expect(screen.getByRole("combobox", { name: "Preferred channel" })).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => store.set(runtimeAtom, { ...runtime, source: "network-server" }));
    expect(screen.queryByRole("button", { name: "OpenCode release settings" })).toBeNull();
  });

  it.each(["picker", "creation", "unmount", "unchanged"] as const)(
    "preserves the original cache and guards late UI after %s",
    async (change) => {
      const store = createStore();
      store.set(runtimeAtom, runtime);
      const queryClient = createRendererQueryClient();
      const directory = Promise.withResolvers<string | null>();
      const created = Promise.withResolvers<PalotSession | null>();
      vi.spyOn(palot, "pickDirectory").mockReturnValue(directory.promise);
      const create = vi.spyOn(palot, "createSession").mockReturnValue(created.promise);
      const Welcome = Route.options.component!;
      const view = render(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <Welcome />
          </Provider>
        </QueryClientProvider>,
      );
      const switchFocus = () =>
        act(() =>
          store.set(runtimeAtom, {
            ...runtime,
            connectionID: "other",
            profileID: "other-profile",
          }),
        );
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Add project folder" }));
      if (change === "picker") switchFocus();
      await act(async () => directory.resolve("/repo"));
      expect(create).toHaveBeenCalledWith("/repo", undefined, "origin");
      if (change === "creation") switchFocus();
      if (change === "unmount") view.unmount();
      await act(async () => created.resolve(session));

      expect(openCodeReconciler(queryClient).session("origin", session.id)?.id).toBe(session.id);
      expect(openCodeReconciler(queryClient).session("other", session.id)).toBeNull();
      if (change !== "unmount") {
        expect(
          screen.getByLabelText(change === "unchanged" ? "Step 3 of 3" : "Step 2 of 3"),
        ).toBeTruthy();
      }
    },
  );
});
