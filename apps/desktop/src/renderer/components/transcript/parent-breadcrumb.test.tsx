import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../../shared";
import { createRendererQueryClient } from "../../lib/query-client";
import { seedCatalog } from "../../test-utils/render-with-router";

const mocks = vi.hoisted(() => ({ openSession: vi.fn() }));

vi.mock("../../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));

import { ParentTaskBreadcrumb } from "./parent-breadcrumb";

function session(input: Partial<PalotSession> & Pick<PalotSession, "id">): PalotSession {
  return {
    parentID: null,
    projectID: "project",
    title: null,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...input,
  };
}

function renderBreadcrumb(child: PalotSession, sessions: PalotSession[], onRename = vi.fn()) {
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions });
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <ParentTaskBreadcrumb session={child} onRename={onRename} />
      </Provider>
    </QueryClientProvider>,
  );
  return { onRename };
}

afterEach(() => {
  cleanup();
  mocks.openSession.mockClear();
});

describe("ParentTaskBreadcrumb", () => {
  it("shows the parent and child agent, and navigates to the parent from the keyboard", async () => {
    const parent = session({ id: "parent", title: "Ship the release" });
    const child = session({
      id: "child",
      parentID: parent.id,
      title: "Map the timeline (@explore subagent)",
    });
    renderBreadcrumb(child, [parent, child]);

    const navigation = screen.getByRole("navigation", { name: "Task breadcrumb" });
    expect(navigation.textContent).toContain("Ship the release");
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Explore · Map the timeline",
    );

    await userEvent.tab();
    const parentCrumb = screen.getByRole("button", { name: "Open parent task: Ship the release" });
    expect(document.activeElement).toBe(parentCrumb);
    await userEvent.keyboard("{Enter}");
    expect(mocks.openSession).toHaveBeenCalledWith("parent");
  });

  it("still links to an unloaded parent and lets the current crumb start a rename", async () => {
    const child = session({ id: "child", parentID: "parent", title: "Review (@general subagent)" });
    const { onRename } = renderBreadcrumb(child, [child]);

    await userEvent.click(screen.getByRole("button", { name: "Open parent task: Parent task" }));
    expect(mocks.openSession).toHaveBeenCalledWith("parent");
    await userEvent.dblClick(screen.getByText("General · Review"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a root task", () => {
    const root = session({ id: "root", title: "Root" });
    renderBreadcrumb(root, [root]);
    expect(screen.queryByRole("navigation", { name: "Task breadcrumb" })).toBeNull();
  });
});
