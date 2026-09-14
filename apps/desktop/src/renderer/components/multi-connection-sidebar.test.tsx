import { createStore } from "jotai";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { inboxShelvesAtom, sidebarModeAtom } from "../atoms/ui";
import { overviewProjectFilterAtom, overviewProjectSectionsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import type { useConnectionOverview } from "../hooks/use-connection-overview";
import { projectSessionInbox } from "../lib/session-inbox";
import { renderWithRouter } from "../test-utils/render-with-router";
import { MultiConnectionSidebar } from "./multi-connection-sidebar";
import { palot } from "../services/palot";
import { SidebarProvider } from "./ui/sidebar";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  openSession: vi.fn().mockResolvedValue(undefined),
  preloadSession: vi.fn(),
  openNewTask: vi.fn().mockResolvedValue(undefined),
  vcs: vi.fn(() => new Map()),
}));
vi.mock("../hooks/use-connection-overview", () => ({ useConnectionOverview: mocks.overview }));
vi.mock("../hooks/use-navigation", () => ({ usePalotNavigation: () => mocks }));
vi.mock("../hooks/use-vcs-info", () => ({
  useOwnedVcsInfoMap: mocks.vcs,
  ownedVcsLocationKey: (value: unknown) => JSON.stringify(value),
}));

type Overview = ReturnType<typeof useConnectionOverview>;
function connection(id: string, count = 1): Overview["connections"][number] {
  const project = {
    id: "same-project",
    name: "Same project",
    canonical: "/repo",
    sandboxes: [],
    vcs: null,
    updatedAt: 1,
  };
  const sessions: PalotSession[] = Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? "same-session" : `session-${i}`,
    parentID: null,
    projectID: project.id,
    title: i === 0 ? "Same task" : `Task ${i}`,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: count - i,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }));
  return {
    profile: {
      id,
      kind: "remote",
      name: "Same server",
      urls: [`https://${id}.example`],
      credentialID: null,
      allowPlainHttp: false,
      lastSuccessfulUrl: null,
      lastConnectedAt: null,
    },
    runtime: {
      profileID: id,
      connectionID: `connection-${id}`,
      connected: true,
      phase: "connected",
    } as OpenCodeRuntimeStatus,
    phase: "ready",
    error: null,
    lastSyncedAt: 1,
    projects: [project],
    sessions,
    inbox: projectSessionInbox({
      sessions,
      projects: [project],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: { profileID: id, bootstrapThrough: null, sessions: [] },
      now: 1,
    }),
    hasMore: true,
    loadingMore: false,
    triageReady: true,
    attentionState: "ready",
  };
}
let overview: Overview;
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
  overview = {
    connections: [connection("alpha"), connection("beta")],
    includedProfileIDs: ["alpha", "beta"],
    visibleProfileIDs: null,
    setIncludedProfileIDs: vi.fn(),
    setVisibleProfileIDs: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(undefined),
    searching: false,
  };
  mocks.overview.mockImplementation(() => overview);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function renderSidebar(mode: "inbox" | "project" = "inbox", store = createStore()) {
  store.set(sidebarModeAtom, mode);
  store.set(runtimeAtom, overview.connections[0]!.runtime);
  return renderWithRouter(
    <SidebarProvider>
      <MultiConnectionSidebar searchOpen />
    </SidebarProvider>,
    store,
  );
}

describe("MultiConnectionSidebar", () => {
  it.each(["syncing", "error", "ready"] as const)(
    "only shows an all-clear when attention is ready (%s)",
    async (state) => {
      overview.connections = [connection("alpha", 0), connection("beta", 0)];
      for (const entry of overview.connections) entry.hasMore = false;
      overview.connections[1]!.attentionState = state;
      renderSidebar();
      if (state === "ready") {
        expect(await screen.findByText("Inbox is clear")).toBeTruthy();
      } else {
        const label = state === "syncing" ? "Syncing requests…" : "Request status unavailable";
        expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
        expect(screen.queryByText("Inbox is clear")).toBeNull();
      }
    },
  );

  it.each([
    { mode: "inbox" as const, section: "inbox" as const },
    { mode: "inbox" as const, section: "pinned" as const },
    { mode: "inbox" as const, section: "settled" as const },
    { mode: "inbox" as const, section: "snoozed" as const },
    { mode: "project" as const, section: "inbox" as const },
  ])(
    "restores the full menu and drag handle for $mode/$section with background ownership",
    async ({ mode, section }) => {
      const openWindow = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
      const owner = overview.connections[1]!;
      const item = owner.inbox.inbox.pop()!;
      owner.inbox[section].push({ ...item, section, pinnedAt: section === "pinned" ? 1 : null });
      const store = createStore();
      store.set(inboxShelvesAtom, { pinned: true, inbox: true, snoozed: true, settled: true });
      renderSidebar(mode, store);
      const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
      expect(row.getAttribute("data-session-drag-handle")).toBe("same-session");
      fireEvent.contextMenu(row);
      for (const name of [
        "Open in new window",
        "Fork",
        "Fork from prompt…",
        "Schedule follow-up",
        "Delete task",
      ]) {
        expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
      }
      await userEvent.click(screen.getByRole("menuitem", { name: "Open in new window" }));
      expect(openWindow).toHaveBeenCalledExactlyOnceWith("same-session", "connection-beta");
      expect(store.get(runtimeAtom)?.profileID).toBe("alpha");
      expect(mocks.openSession).not.toHaveBeenCalled();
      openWindow.mockRestore();
    },
  );

  it("keeps the full menu available but disables offline actions without falling back to local", async () => {
    const openWindow = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
    const owner = overview.connections[1]!;
    owner.runtime = { ...owner.runtime!, connected: false };
    owner.phase = "error";
    renderSidebar();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    );
    const open = await screen.findByRole("menuitem", { name: "Open in new window" });
    expect(open.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(open);
    expect(openWindow).not.toHaveBeenCalled();
    openWindow.mockRestore();
  });

  it("hydrates persisted projects on owner readiness and replacement, not registry rerenders", () => {
    const store = createStore();
    store.set(overviewProjectFilterAtom, JSON.stringify(["beta", "same-project"]));
    const owner = overview.connections[1]!;
    owner.phase = "loading";
    renderSidebar("inbox", store);
    expect(overview.loadProject).not.toHaveBeenCalled();
    const rerender = (value: string) =>
      fireEvent.change(screen.getByRole("textbox", { name: "Search across connections" }), {
        target: { value },
      });
    owner.phase = "ready";
    rerender("a");
    expect(overview.loadProject).toHaveBeenCalledExactlyOnceWith("beta", "same-project");
    overview.connections = overview.connections.map((connection) => ({
      ...connection,
      projects: [...connection.projects],
      runtime: connection.runtime ? { ...connection.runtime } : null,
    }));
    rerender("b");
    expect(overview.loadProject).toHaveBeenCalledTimes(1);
    overview.connections[1]!.runtime = {
      ...overview.connections[1]!.runtime!,
      connectionID: "replacement-beta",
    };
    rerender("c");
    expect(overview.loadProject).toHaveBeenCalledTimes(2);
    expect(overview.loadProject).toHaveBeenLastCalledWith("beta", "same-project");
    overview.connections[1]!.phase = "error";
    rerender("d");
    expect(overview.loadProject).toHaveBeenCalledTimes(2);
    overview.connections[1]!.phase = "ready";
    rerender("e");
    expect(overview.loadProject).toHaveBeenCalledTimes(3);
  });

  it("lets stale or unmonitored persisted projects escape through Clear filters without fetching", async () => {
    const store = createStore();
    store.set(overviewProjectFilterAtom, JSON.stringify(["beta", "same-project"]));
    overview.includedProfileIDs = ["alpha"];
    renderSidebar("inbox", store);
    expect(overview.loadProject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Filter tasks, 1 active" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    expect(store.get(overviewProjectFilterAtom)).toBeNull();
    expect(overview.loadProject).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Same task · Same server · alpha.example" }),
    ).toBeTruthy();
  });

  it("reuses the original toolbar and collapsible sections, with empty shelves hidden", async () => {
    const store = createStore();
    const projects = { [JSON.stringify(["beta", "same-project"])]: false };
    store.set(overviewProjectSectionsAtom, projects);
    renderSidebar("inbox", store);
    for (const name of [
      "Filter tasks",
      "Inbox view settings",
      "Add project folder",
      "Inbox options",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pinned/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Snoozed/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Inbox 2" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Collapse all sections" }));
    expect(screen.getByRole("button", { name: "Inbox 2" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeNull();
    expect(mocks.vcs).toHaveBeenLastCalledWith([]);
    expect(store.get(overviewProjectSectionsAtom)).toEqual(projects);
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Expand all sections" }));
    expect(screen.getByRole("button", { name: "Inbox 2" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(store.get(overviewProjectSectionsAtom)).toEqual(projects);
  });

  it("filters owner-qualified projects, hydrates real IDs and clears visibility without monitoring", async () => {
    overview.visibleProfileIDs = ["beta"];
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: /^Filter tasks/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Project" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("option", { name: /Same project · Same server · beta.example/ }),
    );
    expect(overview.loadProject).toHaveBeenCalledWith("beta", "same-project");
    await userEvent.keyboard("{Escape}{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /^Filter tasks/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    expect(overview.setVisibleProfileIDs).toHaveBeenCalledWith(null);
    expect(overview.setIncludedProfileIDs).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Filter tasks, 1 active" })).toBeTruthy();
  });

  it("renders settled tasks in the original compact shelf, not rich cards", async () => {
    const owner = overview.connections[1]!;
    const item = owner.inbox.inbox.pop()!;
    owner.inbox.settled.push({ ...item, section: "settled" });
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "Settled 1" }));
    const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    expect(row.closest("[data-inbox-compact-row]")).not.toBeNull();
    expect(row.closest("[data-inbox-card]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsettle task" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "inbox", sessionID: "same-session" }),
    );
  });

  it("renders rich Inbox cards with project, status, title, location fallback and owner badge", () => {
    const item = overview.connections[1]!.inbox.inbox[0]!;
    item.attention = true;
    item.attentionCount = 2;
    item.canSettle = false;
    item.session.location.directory = "/remote/checkouts/feature-work";
    renderSidebar();
    const button = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    const card = button.closest<HTMLElement>("[data-inbox-card]");
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-profile-id")).toBe("beta");
    expect(within(card!).getByText("Same project")).toBeTruthy();
    expect(within(card!).getByText("Same task")).toBeTruthy();
    expect(within(card!).getByText("Needs input · 2")).toBeTruthy();
    expect(within(card!).getByLabelText("Task needs attention")).toBeTruthy();
    expect(within(card!).getByText("feature-work").closest("[data-inbox-location]")).not.toBeNull();
    expect(within(card!).getByTitle("/remote/checkouts/feature-work")).toBeTruthy();
    expect(
      within(card!).getByRole("img", { name: "Same server · beta.example · Connected" }),
    ).toBeTruthy();
    const serverIcon = within(card!).getByRole("img", {
      name: "Same server · beta.example · Connected",
    });
    const projectLabel = within(card!).getByText("Same project");
    expect(projectLabel.parentElement?.firstElementChild).toBe(serverIcon);
    expect(within(card!).queryByText("Same server")).toBeNull();
    expect(
      within(card!).getByRole("button", {
        name: "Actions for Same task on Same server · beta.example",
      }),
    ).toBeTruthy();
  });

  it("keeps rich-card hover actions explicitly owned by the background profile", () => {
    renderSidebar();
    const card = screen
      .getByRole("button", { name: "Same task · Same server · beta.example" })
      .closest<HTMLElement>("[data-inbox-card]")!;
    fireEvent.click(within(card).getByRole("button", { name: "Settle task" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "settle", sessionID: "same-session" }),
    );
  });

  it("omits redundant local badges while retaining explicit row ownership", () => {
    overview.connections[0]!.profile = { id: "alpha", name: "Local", kind: "local" };
    renderSidebar();
    const local = screen
      .getByRole("button", { name: "Same task · Local · Local" })
      .closest<HTMLElement>("[data-inbox-card]")!;
    expect(within(local).queryByRole("img", { name: /Local · Local/ })).toBeNull();
    expect(local.getAttribute("data-profile-id")).toBe("alpha");
    expect(
      screen.getByRole("img", { name: "Same server · beta.example · Connected" }),
    ).toBeTruthy();
  });

  it("uses the original snooze choices with the clicked card owner", async () => {
    renderSidebar();
    const remote = screen
      .getByRole("button", { name: "Same task · Same server · beta.example" })
      .closest<HTMLElement>("[data-inbox-card]")!;
    await userEvent.click(within(remote).getByRole("button", { name: "Snooze task" }));
    await userEvent.click(screen.getAllByRole("menuitem")[0]!);
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "snooze",
        sessionID: "same-session",
        until: expect.any(Number),
      }),
    );
  });

  it("keeps duplicate sessions distinct and routes actions to the row's owner", async () => {
    renderSidebar();
    const alpha = screen.getByRole("button", { name: "Same task · Same server · alpha.example" });
    const beta = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    fireEvent.click(alpha);
    fireEvent.click(beta);
    expect(mocks.openSession).toHaveBeenNthCalledWith(1, "same-session", { profileID: "alpha" });
    expect(mocks.openSession).toHaveBeenNthCalledWith(2, "same-session", { profileID: "beta" });
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Same task on Same server · beta.example" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "pin", sessionID: "same-session" }),
    );
  });

  it("does not merge same-named projects and sends new tasks to their profile", () => {
    renderSidebar("project");
    expect(document.querySelector("[data-inbox-card]")).toBeNull();
    expect(document.querySelector("[data-inbox-location]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Same project")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", {
        name: "New task in Same project on Same server · beta.example",
      }),
    );
    expect(mocks.openNewTask).toHaveBeenCalledWith("same-project", "beta");
  });

  it("persists project collapse independently for duplicate IDs and restores expansion", async () => {
    const store = createStore();
    const view = renderSidebar("project", store);
    const header = (owner: string) =>
      screen.getByRole("button", {
        name: `Same project 1 · Same server · ${owner}.example`,
      });
    const task = (owner: string) =>
      screen.queryByRole("button", {
        name: `Same task · Same server · ${owner}.example`,
      });
    expect(header("alpha").getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(header("alpha"));
    expect(header("alpha").getAttribute("aria-expanded")).toBe("false");
    expect(task("alpha")).toBeNull();
    expect(task("beta")).toBeTruthy();
    view.unmount();
    // Renderer persistence hydrates at module load; remounts retain the app store.
    vi.resetModules();
    const { overviewProjectSectionsAtom: reloadedSections } = await import("../atoms/connections");
    expect(createStore().get(reloadedSections)).toEqual({
      [JSON.stringify(["alpha", "same-project"])]: false,
    });
    renderSidebar("project", store);
    expect(header("alpha").getAttribute("aria-expanded")).toBe("false");
    expect(task("alpha")).toBeNull();
    expect(header("beta").getAttribute("aria-expanded")).toBe("true");
    expect(task("beta")).toBeTruthy();
    await userEvent.click(header("alpha"));
    expect(task("alpha")).toBeTruthy();
    expect(task("beta")).toBeTruthy();
  });

  it("keeps the project new-task action outside its trigger without changing expansion", async () => {
    renderSidebar("project");
    const trigger = screen.getByRole("button", {
      name: "Same project 1 · Same server · beta.example",
    });
    const action = screen.getByRole("button", {
      name: "New task in Same project on Same server · beta.example",
    });
    expect(trigger.contains(action)).toBe(false);
    await userEvent.click(action);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(trigger);
    await userEvent.click(action);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.openNewTask).toHaveBeenCalledTimes(2);
    expect(mocks.openNewTask).toHaveBeenLastCalledWith("same-project", "beta");
  });

  it("expands and collapses only visible project sections without changing Inbox shelves", async () => {
    overview.visibleProfileIDs = ["beta"];
    const store = createStore();
    const alphaKey = JSON.stringify(["alpha", "same-project"]);
    const betaKey = JSON.stringify(["beta", "same-project"]);
    store.set(overviewProjectSectionsAtom, { [alphaKey]: false });
    const shelves = store.get(inboxShelvesAtom);
    renderSidebar("project", store);
    const trigger = screen.getByRole("button", {
      name: "Same project 1 · Same server · beta.example",
    });
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Collapse all sections" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(store.get(overviewProjectSectionsAtom)).toEqual({ [alphaKey]: false, [betaKey]: false });
    expect(store.get(inboxShelvesAtom)).toEqual(shelves);
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Expand all sections" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(store.get(overviewProjectSectionsAtom)).toEqual({ [alphaKey]: false, [betaKey]: true });
    expect(store.get(inboxShelvesAtom)).toEqual(shelves);
    expect(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeTruthy();
  });

  it("does not let collapsed projects consume the global mounted row budget", async () => {
    overview.connections = [connection("alpha", 65), connection("beta", 65)];
    renderSidebar("project");
    const rows = () => screen.getAllByRole("button", { name: /^Actions for/ });
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.endsWith("alpha.example"))).toBe(
      true,
    );
    const trigger = screen.getByRole("button", {
      name: "Same project 65 · Same server · alpha.example",
    });
    await userEvent.click(trigger);
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.endsWith("beta.example"))).toBe(
      true,
    );
    await userEvent.click(trigger);
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.endsWith("alpha.example"))).toBe(
      true,
    );
  });

  it("renames and settles a duplicate ID on its explicit owner", async () => {
    renderSidebar();
    const actionName = "Actions for Same task on Same server · beta.example";
    await userEvent.click(screen.getByRole("button", { name: actionName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
      target: { value: "Renamed remotely" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(overview.rename).toHaveBeenCalledWith("beta", "same-session", "Renamed remotely");
    await userEvent.click(screen.getByRole("button", { name: actionName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Settle" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "settle",
        sessionID: "same-session",
        through: overview.connections[1]!.inbox.inbox[0]!.activityThrough,
      }),
    );
  });

  it("keeps visibility independent from monitoring and honors a subset", async () => {
    overview.visibleProfileIDs = ["beta"];
    renderSidebar();
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · alpha.example" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Filter tasks/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Servers" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Same server · alpha.example" }),
    );
    expect(overview.setVisibleProfileIDs).toHaveBeenCalledWith(["beta", "alpha"]);
    expect(overview.setIncludedProfileIDs).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Enabled servers" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Enable Same server · beta.example" }),
    );
    expect(overview.setIncludedProfileIDs).toHaveBeenCalledWith(["alpha"]);
  });

  it("disables disconnected mutations but permits retry and task navigation", async () => {
    overview.connections[1]!.runtime = null;
    overview.connections[1]!.phase = "error";
    overview.connections[1]!.error = "Network unavailable";
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Enabled servers" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Retry Same server · beta.example" }),
    );
    expect(overview.connect).toHaveBeenCalledWith("beta");
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Same task on Same server · beta.example" }),
    );
    expect(screen.getByRole("menuitem", { name: "Pin" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("bounds mounted task rows and scopes pagination to each connection", async () => {
    overview.connections = [connection("alpha", 65), connection("beta", 65)];
    renderSidebar();
    expect(
      screen.getAllByRole("button", {
        name: /^Actions for/,
      }),
    ).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Show more tasks" }));
    expect(
      screen.getAllByRole("button", {
        name: /^Actions for/,
      }),
    ).toHaveLength(80);
    await userEvent.click(screen.getByRole("button", { name: "Inbox options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Load older tasks" }));
    expect(overview.loadMore).toHaveBeenCalledWith("beta");
  });

  it("searches the hook rather than the foreground catalog only", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox", { name: "Search across connections" }), {
      target: { value: "beta.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(overview.search).toHaveBeenCalledWith("beta.example");
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · alpha.example" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeTruthy();
  });
});
