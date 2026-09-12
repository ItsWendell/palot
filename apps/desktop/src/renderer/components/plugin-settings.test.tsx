import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotPlugin, PalotProject } from "../../shared";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { PluginSettings } from "./plugin-settings";
import { toast } from "./ui/toast";

const location = { directory: "/repo", workspaceID: "workspace-1" };
const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Example",
  sandboxes: [],
  vcs: null,
  updatedAt: null,
};
const plugins: PalotPlugin[] = [
  {
    id: "Tools",
    source: { type: "package", target: "@acme/tools@beta", version: "1.0.0", outdated: true },
    features: { server: true, rpc: true },
    state: { status: "active" },
  },
  {
    source: { type: "local", path: "/repo/broken.ts" },
    features: {},
    state: { status: "failed", error: "Could not load plugin" },
  },
  {
    id: "Terminal",
    source: { type: "builtin" },
    features: { tui: true },
    state: { status: "active" },
  },
];

function renderPlugins(inventory = plugins, refresh = vi.fn().mockResolvedValue(undefined)) {
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={createStore()}>
        <PluginSettings
          project={project}
          plugins={inventory}
          location={location}
          refresh={refresh}
        />
      </Provider>
    </QueryClientProvider>,
  );
  return refresh;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PluginSettings", () => {
  it("shows source, features and failures with missing IDs without automatic actions", async () => {
    const check = vi.spyOn(palot, "checkPlugins");
    const update = vi.spyOn(palot, "updatePlugins");
    renderPlugins();
    expect(screen.getByText("@acme/tools@beta")).toBeTruthy();
    expect(screen.getByText("1.0.0")).toBeTruthy();
    expect(screen.getByText("Server")).toBeTruthy();
    expect(screen.getByText("RPC")).toBeTruthy();
    const failed = within(screen.getByRole("group", { name: "/repo/broken.ts plugin" }));
    expect(failed.getByText("Failed")).toBeTruthy();
    await userEvent.setup().click(failed.getByText("Error details for /repo/broken.ts"));
    expect(failed.getByText("Could not load plugin")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("switch", { name: "Show built-in plugins" }));
    expect(screen.getByText("TUI")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(1);
    expect(check).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("checks on demand and disables concurrent actions until the cache-aware check completes", async () => {
    const pending = Promise.withResolvers<PalotPlugin[]>();
    const check = vi.spyOn(palot, "checkPlugins").mockReturnValue(pending.promise);
    renderPlugins();
    await userEvent.setup().click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(check).toHaveBeenCalledWith({ projectID: project.id, ...location }));
    expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Update" }).hasAttribute("disabled")).toBe(true);
    await act(async () => pending.resolve(plugins));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update" }).hasAttribute("disabled")).toBe(false),
    );
  });

  it("updates the package target and refreshes even after an error, allowing retry", async () => {
    const update = vi
      .spyOn(palot, "updatePlugins")
      .mockRejectedValueOnce(new Error("Package update failed"))
      .mockResolvedValue(undefined);
    const notice = vi.spyOn(toast, "add").mockReturnValue("notice");
    const refresh = renderPlugins();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(update).toHaveBeenCalledWith({
      projectID: project.id,
      ...location,
      targets: ["@acme/tools@beta"],
    });
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", description: "Package update failed" }),
      ),
    );
    expect(refresh).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(notice).toHaveBeenLastCalledWith({ type: "success", title: "Tools updated" });
  });

  it("shows externally running updates and prevents duplicate updates", () => {
    renderPlugins([
      { ...plugins[0]!, source: { type: "package", target: "@acme/tools@beta", updating: true } },
    ]);
    expect(screen.getByRole("button", { name: "Updating" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Check for updates" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
