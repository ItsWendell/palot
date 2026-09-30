import type { SessionStatsInfo } from "@opencode/client";
import type { PalotProject } from "../../../shared";
import { createStore } from "jotai";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../../atoms/workspace";
import { usageToolDetailsOpenAtom } from "../../atoms/ui";
import { createRendererQueryClient } from "../../lib/query-client";
import { previousUsageDateRange, usageDateRange } from "../../lib/session-stats-range";
import { palot } from "../../services/palot";
import { renderWithRouter, seedCatalog } from "../../test-utils/render-with-router";
import { UsagePage } from "./usage-page";

vi.mock("./usage-activity-chart", () => ({
  UsageActivityChart: () => <div aria-label="Daily OpenCode steps" />,
}));

const stats: SessionStatsInfo = {
  range: { from: new Date(2026, 7, 1).getTime(), to: new Date(2026, 7, 31).getTime() },
  sessions: 12,
  subagents: 3,
  prompts: 48,
  steps: 120,
  tokens: {
    input: 1_000,
    output: 500,
    reasoning: 250,
    cache: { read: 2_000, write: 100 },
  },
  cost: 12.34,
  tools: { mode: "summary", totals: { calls: 20, succeeded: 18, failed: 1, unfinished: 1 } },
  activeDays: 9,
  streak: 4,
  activity: [{ date: "2026-08-01", steps: 4 }],
  models: [
    {
      model: { providerID: "openai", id: "gpt-5" },
      steps: 100,
      tokens: {
        input: 800,
        output: 400,
        reasoning: 200,
        cache: { read: 1_800, write: 90 },
      },
      cost: 10,
    },
  ],
};

const detailStats: SessionStatsInfo = {
  ...stats,
  tools: {
    mode: "detail",
    totals:
      stats.tools.mode === "summary"
        ? stats.tools.totals
        : { calls: 0, succeeded: 0, failed: 0, unfinished: 0 },
    usage: [{ name: "read", calls: 10, succeeded: 9, failed: 1, unfinished: 0, durationP50: 24 }],
  },
};

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Palot",
  sandboxes: [],
  vcs: null,
  updatedAt: 1,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function connectedStore() {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return store;
}

describe("UsagePage", () => {
  it("renders aggregate usage and sends an explicit stable range", async () => {
    const sessionStats = vi
      .spyOn(palot, "sessionStats")
      .mockImplementation((input) =>
        Promise.resolve(input.tools === "detail" ? detailStats : stats),
      );
    vi.spyOn(palot, "listModels").mockResolvedValue({
      models: [],
      defaultModel: null,
      providers: [],
      errors: [],
    });
    const store = connectedStore();

    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project] }, "connection");
    renderWithRouter(<UsagePage />, store, "/usage?days=30&projectID=project-1", queryClient);

    expect(await screen.findByText("$12.34")).toBeTruthy();
    expect(screen.getAllByText("gpt-5").length).toBeGreaterThan(0);
    expect(screen.getByText("Token composition")).toBeTruthy();
    expect(screen.getByText("Input", { exact: true })).toBeTruthy();
    expect(screen.getByText("Output", { exact: true })).toBeTruthy();
    expect(screen.getByText("Reasoning", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("Cache read", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Providers")).toBeTruthy();
    expect(screen.getAllByText("openai").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Daily OpenCode steps")).toBeTruthy();
    const toolDetails = screen.getByRole("button", { name: "Show details" });
    expect(toolDetails.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toolDetails);
    expect(toolDetails.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("Tool details loaded for 1 tool.")).toBeTruthy();
    expect(screen.getByText("read")).toBeTruthy();
    expect(sessionStats).toHaveBeenCalledWith(
      expect.objectContaining({ tools: "detail", project: "project-1" }),
      expect.any(AbortSignal),
      "connection",
    );
    expect(sessionStats).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(Number),
        to: expect.any(Number),
        timezone: expect.any(String),
        tools: "summary",
        project: "project-1",
      }),
      expect.any(AbortSignal),
      "connection",
    );

    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(await screen.findByText("$12.34")).toBeTruthy();
  });

  it("labels retained results while a new usage scope loads", async () => {
    let resolveNext: ((value: SessionStatsInfo) => void) | undefined;
    vi.spyOn(palot, "sessionStats")
      .mockResolvedValueOnce(stats)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve;
          }),
      );
    const store = connectedStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project] }, "connection");
    renderWithRouter(<UsagePage />, store, "/usage?days=30&projectID=project-1", queryClient);

    expect(await screen.findByText("$12.34")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(
      await screen.findByText("Showing the previous selection while this usage scope updates."),
    ).toBeTruthy();

    resolveNext?.(stats);
    await waitFor(() =>
      expect(
        screen.queryByText("Showing the previous selection while this usage scope updates."),
      ).toBeNull(),
    );
  });

  it("loads the selected project's previous calendar period only when comparison is enabled", async () => {
    const prior = { ...stats, cost: 8, prompts: 24, steps: 60 };
    const expected = previousUsageDateRange(usageDateRange(7));
    const sessionStats = vi
      .spyOn(palot, "sessionStats")
      .mockImplementation((input) => Promise.resolve(input.to === expected.to ? prior : stats));
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project] }, "connection");
    renderWithRouter(
      <UsagePage />,
      connectedStore(),
      "/usage?days=7&projectID=project-1",
      queryClient,
    );

    expect(await screen.findByText("$12.34")).toBeTruthy();
    expect(sessionStats).toHaveBeenCalledTimes(1);
    const compare = screen.getByRole("button", { name: "Compare periods" });
    expect(compare.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(compare);

    await waitFor(() => expect(sessionStats).toHaveBeenCalledTimes(2));
    expect(sessionStats).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expected.from,
        to: expected.to,
        timezone: expected.timezone,
        tools: "summary",
        project: "project-1",
      }),
      expect.any(AbortSignal),
      "connection",
    );
    expect(compare.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("region", { name: "Period comparison" })).toBeTruthy();
    expect(await screen.findByText("+54% vs previous")).toBeTruthy();
    await userEvent.click(compare);
    expect(screen.queryByRole("region", { name: "Period comparison" })).toBeNull();
  });

  it("refreshes open tool details and invalidates closed details for the next expansion", async () => {
    const sessionStats = vi
      .spyOn(palot, "sessionStats")
      .mockImplementation((input) =>
        Promise.resolve(input.tools === "detail" ? detailStats : stats),
      );
    const store = connectedStore();
    store.set(usageToolDetailsOpenAtom, false);
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project] }, "connection");
    renderWithRouter(<UsagePage />, store, "/usage?days=7", queryClient);

    await screen.findByText("$12.34");
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    await screen.findByText("Tool details loaded for 1 tool.");
    expect(sessionStats.mock.calls.filter(([input]) => input.tools === "detail")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() =>
      expect(sessionStats.mock.calls.filter(([input]) => input.tools === "detail")).toHaveLength(2),
    );
    await userEvent.click(screen.getByRole("button", { name: "Hide details" }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await userEvent.click(screen.getByRole("button", { name: "Show details" }));
    await waitFor(() =>
      expect(sessionStats.mock.calls.filter(([input]) => input.tools === "detail")).toHaveLength(3),
    );
  });

  it("shows a reconnect prompt instead of loading indefinitely for an uncached comparison", async () => {
    vi.spyOn(palot, "sessionStats").mockResolvedValue(stats);
    const store = connectedStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { projects: [project] }, "connection");
    renderWithRouter(<UsagePage />, store, "/usage?days=7", queryClient);

    await screen.findByText("$12.34");
    await userEvent.click(screen.getByRole("button", { name: "Compare periods" }));
    await screen.findByRole("region", { name: "Period comparison" });
    act(() => store.set(runtimeAtom, { ...store.get(runtimeAtom)!, connected: false }));
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));

    expect(await screen.findByText("Reconnect OpenCode to load the previous period.")).toBeTruthy();
  });
});
