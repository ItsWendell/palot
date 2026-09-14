import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test-utils/render-with-router";
import { SidebarProvider } from "./ui/sidebar";
import { WorkspaceSidebar } from "./workspace-sidebar";
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
  it("keeps one sidebar shell while switching mode-specific content", async () => {
    const store = createStore();

    renderWithRouter(
      <SidebarProvider>
        <WorkspaceSidebar open onNewSession={vi.fn()} onSearchTasks={vi.fn()} />
      </SidebarProvider>,
      store,
    );

    const shell = document.querySelector("[data-sidebar-mode]");
    expect(shell).toBeTruthy();
    const viewButtons = screen
      .getByRole("group", { name: "Sidebar view" })
      .querySelectorAll("button");
    expect(viewButtons[0]?.getAttribute("aria-label")).toContain("Show inbox");
    expect(screen.getByRole("button", { name: "Show inbox" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Filter tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inbox options" })).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="sidebar-header"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="sidebar-footer"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Show projects" }));

    expect(document.querySelector("[data-sidebar-mode]")).toBe(shell);
    expect(screen.getByRole("button", { name: "Show projects" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.querySelectorAll('[data-slot="sidebar-header"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="sidebar-footer"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Show inbox" }));

    expect(document.querySelector("[data-sidebar-mode]")).toBe(shell);
    expect(screen.getByRole("button", { name: "Filter tasks" })).toBeTruthy();
  });

  it("opens project utilities from the local Palot runtime menu", async () => {
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
      <SidebarProvider>
        <WorkspaceSidebar open onNewSession={vi.fn()} onSearchTasks={vi.fn()} />
      </SidebarProvider>,
      store,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Palot menu" }));
    expect(await screen.findByText("OpenCode 0.0.0-beta-19425 · Disconnected")).toBeTruthy();
    const serverMenu = screen.getByRole("menuitem", { name: "Servers" });
    expect(listProfiles).not.toHaveBeenCalled();
    serverMenu.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Local OpenCode Enabled" }),
    ).toBeTruthy();
    const remote = screen.getByRole("menuitemcheckbox", { name: "Remote workstation Disabled" });
    const before = router.state.location.href;
    await userEvent.click(remote);
    expect(store.get(includedProfileIDsAtom)).toEqual(["local", "remote"]);
    expect(router.state.location.href).toBe(before);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Local OpenCode Enabled" }));
    expect(store.get(includedProfileIDsAtom)).toEqual(["remote"]);
    expect(router.state.location.href).toBe(before);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Open Palot menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Usage" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/usage"));

    await userEvent.click(screen.getByRole("button", { name: "Open Palot menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Worktrees" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/worktrees"));
  });
});
