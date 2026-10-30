import { createStore } from "jotai";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { projectTranscriptTurns } from "../lib/turn-projection";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { createRendererQueryClient } from "../lib/query-client";
import { TimelineBoundary } from "./thread";
import { UsageLimitActions } from "./usage-limit-actions";
import { toast } from "./ui/toast";

function message(retryAfterMs: number | null = 3_600_000): PalotMessage {
  return {
    id: "failure",
    type: "assistant",
    createdAt: Date.now() - 100,
    completedAt: Date.now(),
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: "error",
    content: [],
    data: {
      error: {
        type: "provider.quota",
        message: "Usage limit reached",
        ...(retryAfterMs === null ? {} : { retryAfterMs }),
      },
    },
  };
}

function store() {
  const value = createStore();
  value.set(selectedSessionIDAtom, "task-one");
  value.set(runtimeAtom, {
    connectionID: "one",
    profileID: "profile-one",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "2.2.0",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return value;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("UsageLimitActions", () => {
  it("snoozes through the reset watermark after saving one continuation, and retries snoozing without scheduling twice", async () => {
    const source = message();
    const queryClient = createRendererQueryClient();
    seedCatalog(
      queryClient,
      {
        sessions: [
          {
            id: "task-one",
            parentID: null,
            projectID: "project",
            title: "Quota task",
            agent: null,
            model: null,
            location: { directory: "/repo" },
            createdAt: 1,
            updatedAt: 10,
            idleAt: 10,
            archivedAt: null,
            cost: null,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ],
      },
      "one",
    );
    const schedule = vi
      .spyOn(palot, "dispatchAutomation")
      .mockResolvedValue({ profileID: "profile-one", automations: [], runs: [] });
    const triage = vi
      .spyOn(palot, "dispatchSessionTriage")
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ profileID: "profile-one", bootstrapThrough: null, sessions: [] });
    const notify = vi.spyOn(toast, "add");
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithRouter(<UsageLimitActions message={source} />, store(), "/new", queryClient);
    await userEvent.click(screen.getByRole("button", { name: "Snooze until reset" }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Continuation scheduled, but could not snooze task" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Snooze until reset" }));
    await waitFor(() => expect(triage).toHaveBeenCalledTimes(2));
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(triage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "snooze",
        profileID: "profile-one",
        sessionID: "task-one",
        until: source.completedAt! + 3_600_000,
        through: { sessionID: "task-one", updatedAt: 10 },
      }),
    );
  });
  it("schedules the failed task once, a minute after reset, through the existing dispatch", async () => {
    const source = message();
    const group = projectTranscriptTurns([source])[0]!.activity.find(
      (item) => item.kind === "boundary",
    )!;
    const dispatch = vi
      .spyOn(palot, "dispatchAutomation")
      .mockResolvedValue({ profileID: "profile-one", automations: [], runs: [] });
    const notify = vi.spyOn(toast, "add");
    renderWithRouter(<TimelineBoundary group={group} />, store());
    await userEvent.click(screen.getByRole("button", { name: "Continue when it resets" }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: "create",
        profileID: "profile-one",
        draft: {
          name: "Continue after usage limit",
          status: "active",
          action: {
            prompt: "Continue where you left off; the usage limit has reset.",
            agent: null,
            model: null,
            skills: [],
          },
          destination: { type: "session", sessionID: "task-one" },
          trigger: {
            version: 1,
            type: "once",
            at: source.completedAt! + 3_600_000 + 60_000,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          missedRuns: { type: "catch-up-once", maxAgeMs: 86_400_000 },
          notifications: "background-only",
          createdFromSessionID: "task-one",
        },
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        actionProps: expect.objectContaining({
          children: "Scheduled",
          onClick: expect.any(Function),
        }),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Continuation scheduled" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows a continuation saved earlier as scheduled after returning to the task", async () => {
    const source = message();
    const at = source.completedAt! + 3_600_000 + 60_000;
    vi.spyOn(palot, "loadAutomations").mockResolvedValue({
      profileID: "profile-one",
      automations: [
        {
          id: "aut_1",
          status: "active",
          destination: { type: "session", sessionID: "task-one" },
          trigger: { version: 1, type: "once", at, timezone: "UTC" },
        } as never,
      ],
      runs: [],
    });
    const dispatch = vi.spyOn(palot, "dispatchAutomation");
    renderWithRouter(<UsageLimitActions message={source} />, store());
    const button = await screen.findByRole("button", { name: "Continuation scheduled" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([null, 0])("offers only View usage when reset is unknown or past (%s)", (retry) => {
    renderWithRouter(<UsageLimitActions message={message(retry)} />, store());
    expect(screen.queryByRole("button", { name: "Continue when it resets" })).toBeNull();
    expect(screen.getByRole("button", { name: "View usage" })).toBeTruthy();
  });

  it("does not render actions for an unrelated failure, even outside a router", () => {
    render(
      <UsageLimitActions message={{ ...message(), data: { error: { type: "provider.error" } } }} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("navigates to Usage even when the reset time is unknown", async () => {
    const { router } = renderWithRouter(<UsageLimitActions message={message(null)} />, store());
    await userEvent.click(screen.getByRole("button", { name: "View usage" }));
    await waitFor(() => expect(router.history.location.pathname).toBe("/usage"));
  });

  it("keeps scheduling available after a failed create", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dispatch = vi.spyOn(palot, "dispatchAutomation").mockRejectedValue(new Error("Offline"));
    renderWithRouter(<UsageLimitActions message={message()} />, store());
    fireEvent.click(screen.getByRole("button", { name: "Continue when it resets" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Continue when it resets" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
