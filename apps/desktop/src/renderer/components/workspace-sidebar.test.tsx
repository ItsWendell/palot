import { createStore } from "jotai";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test-utils/render-with-router";
import { SidebarProvider } from "./ui/sidebar";
import { NavigationRail } from "./navigation-rail";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { TaskListSourceProvider } from "./task-list-host";
import { runtimeAtom } from "../atoms/workspace";
import { includedProfileIDsAtom } from "../atoms/connections";
import { palot } from "../services/palot";

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceSidebar", () => {
  it("shows the task list with search, View and one footer, beside the rail", async () => {
    const store = createStore();
    const onSearchTasks = vi.fn();

    renderWithRouter(
      <TaskListSourceProvider>
        <SidebarProvider>
          {/* The workspace mounts the rail beside the task column, not inside it. */}
          <NavigationRail navigationOpen onNavigationOpenChange={vi.fn()} />
          <WorkspaceSidebar open onSearchTasks={onSearchTasks} />
        </SidebarProvider>
      </TaskListSourceProvider>,
      store,
    );

    const shell = screen.getByLabelText("Tasks", { selector: "[data-sidebar-presentation]" });
    expect(shell.querySelector("[data-navigation-rail]")).toBeNull();
    expect(shell.querySelector("[data-slot='task-list']")).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Palot" });
    expect(
      within(rail).getByRole("button", { name: "Show tasks" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(shell).getByRole("button", { name: "View" })).toBeTruthy();
    expect(within(shell).queryByRole("textbox")).toBeNull();
    expect(document.querySelectorAll('[data-slot="sidebar-footer"]')).toHaveLength(1);

    const search = within(shell).getByRole("button", { name: "Search tasks" });
    await userEvent.click(search);
    expect(onSearchTasks).toHaveBeenCalledExactlyOnceWith(search);
  });

  it("keeps server controls in the Palot menu and destinations on the rail", async () => {
    const listProfiles = vi.spyOn(palot, "listOpenCodeProfiles").mockResolvedValue({
      activeProfileID: "local",
      profiles: [
        { id: "local", kind: "local", name: "Local OpenCode" },
        {
          id: "remote",
          kind: "remote",
          name: "Remote workstation",
          urls: ["https://host"],
          credentialID: null,
          allowPlainHttp: false,
          lastSuccessfulUrl: null,
          lastConnectedAt: null,
        },
      ],
    });
    const store = createStore();
    store.set(includedProfileIDsAtom, ["local"]);
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      phase: "stopped",
      connected: false,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const { router } = renderWithRouter(
      <TaskListSourceProvider>
        <SidebarProvider>
          <NavigationRail navigationOpen onNavigationOpenChange={vi.fn()} />
          <WorkspaceSidebar open onSearchTasks={vi.fn()} />
        </SidebarProvider>
      </TaskListSourceProvider>,
      store,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Palot menu" }));
    expect(await screen.findByText("OpenCode 0.0.0-beta-19425 · Disconnected")).toBeTruthy();
    const serverMenu = screen.getByRole("menuitem", { name: "Servers" });
    expect(listProfiles).not.toHaveBeenCalled();
    serverMenu.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Local OpenCode Offline" }),
    ).toBeTruthy();
    const remote = screen.getByRole("menuitemcheckbox", { name: "Remote workstation Disabled" });
    const before = router.state.location.href;
    await userEvent.click(remote);
    expect(store.get(includedProfileIDsAtom)).toEqual(["local", "remote"]);
    expect(router.state.location.href).toBe(before);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Local OpenCode Offline" }));
    expect(store.get(includedProfileIDsAtom)).toEqual(["remote"]);
    expect(router.state.location.href).toBe(before);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Open Palot menu" }));
    expect(screen.getByRole("menuitem", { name: "About" })).toBeTruthy();
    for (const moved of ["Usage", "Worktrees", "Settings"])
      expect(screen.queryByRole("menuitem", { name: moved })).toBeNull();
    await userEvent.keyboard("{Escape}");

    const rail = screen.getByRole("navigation", { name: "Palot" });
    await userEvent.click(within(rail).getByRole("button", { name: "Usage" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/usage"));
    expect(within(rail).getByRole("button", { name: "Usage" }).getAttribute("aria-current")).toBe(
      "page",
    );

    await userEvent.click(within(rail).getByRole("button", { name: "Worktrees" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/worktrees"));
  });
});
