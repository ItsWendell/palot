import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../../shared";
import type { TurnActivityGroup } from "../../lib/turn-projection";
import {
  COMPACTION_SLOW_HINT_MS,
  CompactionBoundary,
  CompactionTranscriptContext,
  type CompactionTranscriptActions,
} from "./compaction-row";

function compaction(
  part: Omit<PalotMessageContent, "type">,
  status: TurnActivityGroup["status"],
): TurnActivityGroup {
  const content: PalotMessageContent = { type: "compaction", id: "compaction-1", ...part };
  const message: PalotMessage = {
    id: "compaction-1",
    type: "compaction",
    createdAt: 1,
    completedAt: status === "running" ? null : 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [content],
    data: null,
  };
  return {
    id: "compaction-1",
    kind: "compaction",
    title: "Compacting context",
    status,
    entries: [{ message, part: content, index: 0 }],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CompactionBoundary", () => {
  it("names automatic and manual compaction differently once done", () => {
    const view = render(
      <CompactionBoundary
        group={compaction({ status: "completed", reason: "auto" }, "completed")}
      />,
    );
    expect(screen.getByText("Context automatically compacted")).toBeTruthy();
    view.rerender(
      <CompactionBoundary
        group={compaction({ status: "completed", reason: "manual" }, "completed")}
      />,
    );
    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.queryByText("Context automatically compacted")).toBeNull();
  });

  it("adds a duration hint after ten seconds of compacting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    render(
      <CompactionBoundary
        group={compaction(
          { status: "running", reason: "auto", time: { created: Date.now() - 4_000 } },
          "running",
        )}
      />,
    );

    expect(screen.getByText("Compacting context")).toBeTruthy();
    expect(screen.queryByText(/This can take a few minutes/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(COMPACTION_SLOW_HINT_MS - 4_001);
    });
    expect(screen.queryByText(/This can take a few minutes/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("· This can take a few minutes")).toBeTruthy();
  });

  it("shows the hint immediately when an already long compaction hydrates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    render(
      <CompactionBoundary
        group={compaction({ status: "running", time: { created: Date.now() - 60_000 } }, "running")}
      />,
    );
    expect(screen.getByText("· This can take a few minutes")).toBeTruthy();
  });

  it("folds approximate before and after context tokens into the detail", async () => {
    const user = userEvent.setup();
    const result = render(
      <CompactionBoundary
        group={compaction(
          {
            status: "completed",
            reason: "auto",
            text: "Summary",
            recent: "x".repeat(400),
            tokens: {
              input: 90_000,
              output: 2_000,
              reasoning: 0,
              cache: { read: 30_000, write: 0 },
            },
          },
          "completed",
        )}
      />,
    );
    const boundary = within(result.container);
    const row = result.container.querySelector('[data-palot-compaction="compaction-1"]');
    expect(row?.getAttribute("data-palot-compaction-reason")).toBe("auto");
    expect(boundary.queryByText(/→/)).toBeNull();

    await user.click(boundary.getByRole("button", { name: "Context automatically compacted" }));

    // Without measured steps around it, the row estimates from the compaction request.
    expect(boundary.getByText("Context: about 120k → 2.1k tokens")).toBeTruthy();
  });

  it("prefers the measured context windows around the compaction", async () => {
    const user = userEvent.setup();
    render(
      <CompactionTranscriptContext.Provider
        value={{
          retryableCompactionID: null,
          retry: () => Promise.resolve(),
          windows: new Map([["compaction-1", { before: 152_000, after: 18_400 }]]),
        }}
      >
        <CompactionBoundary
          group={compaction(
            { status: "completed", reason: "manual", text: "Summary" },
            "completed",
          )}
        />
      </CompactionTranscriptContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Context compacted" }));
    expect(screen.getByText("Context: 152k → 18k tokens")).toBeTruthy();
  });

  it("offers retry only for the transcript's retryable failure", async () => {
    const user = userEvent.setup();
    const retry = vi.fn(() => Promise.resolve());
    const group = compaction({ status: "failed", error: "Context is too large" }, "failed");
    const renderWith = (actions: CompactionTranscriptActions | null) => (
      <CompactionTranscriptContext.Provider value={actions}>
        <CompactionBoundary group={group} />
      </CompactionTranscriptContext.Provider>
    );
    const view = render(renderWith(null));
    expect(screen.getByRole("button", { name: "Context compaction failed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry compaction" })).toBeNull();

    view.rerender(renderWith({ retryableCompactionID: "older", retry }));
    expect(screen.queryByRole("button", { name: "Retry compaction" })).toBeNull();

    view.rerender(renderWith({ retryableCompactionID: "compaction-1", retry }));
    await user.click(screen.getByRole("button", { name: "Retry compaction" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
