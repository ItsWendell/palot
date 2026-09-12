import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../shared";
import type { TurnActivityGroup } from "../lib/turn-projection";
import { createRendererQueryClient } from "../lib/query-client";
import { seedCatalog } from "../test-utils/render-with-router";

const mocks = vi.hoisted(() => ({ openSession: vi.fn() }));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));

import { SubagentResponse } from "./subagent-activity";

describe("SubagentResponse", () => {
  it("reveals the full response and opens the child task", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const message: PalotMessage = {
      id: "subagent-response",
      type: "synthetic",
      createdAt: 10_000,
      completedAt: 10_000,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: {},
    };
    const child: PalotSession = {
      id: "child-1",
      parentID: "parent",
      projectID: "project",
      title: "Map the sidebar (@explore subagent)",
      agent: "explore",
      model: null,
      location: { directory: "/repo" },
      createdAt: 5_000,
      updatedAt: 10_000,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [child] });
    const group: TurnActivityGroup = {
      id: "subagent-response",
      kind: "subagent",
      title: "Map the sidebar",
      status: "completed",
      entries: [
        {
          message,
          index: 0,
          part: {
            type: "subagent-response",
            id: "subagent-response",
            name: "Map the sidebar",
            text: "**Finding**\n\nUse sparse metadata.",
            status: "completed",
            data: { childID: "child-1", agent: "Explore", state: "completed" },
          },
        },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <SubagentResponse group={group} />
        </Provider>
      </QueryClientProvider>,
    );

    const trigger = screen.getByRole("button", { name: /Explore returned Map the sidebar/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("5s").getAttribute("title")).toBe("Returned after 5s");
    expect(screen.queryByText("Use sparse metadata.")).toBeNull();

    await user.click(trigger);

    expect(screen.getByText("Use sparse metadata.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Explore subagent" }));
    expect(mocks.openSession).toHaveBeenCalledWith("child-1");
  });
});
