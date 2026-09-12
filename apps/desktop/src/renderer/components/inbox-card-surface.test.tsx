import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxSessionView } from "../lib/session-inbox";
import { InboxCardSurface } from "./inbox-card-surface";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InboxCardSurface", () => {
  it.each([
    { attentionCount: 1, runningSince: null, workingLabel: "Working", status: "Needs input" },
    {
      attentionCount: 3,
      runningSince: 60_000,
      workingLabel: "Working for 1m 00s",
      status: "Needs input · 3",
    },
  ])(
    "prioritizes $status over an active run",
    ({ attentionCount, runningSince, workingLabel, status }) => {
      vi.useFakeTimers();
      vi.setSystemTime(120_000);
      const item: InboxSessionView = {
        session: {
          id: "task-1",
          parentID: null,
          projectID: "project-1",
          title: "Review changes",
          agent: null,
          model: null,
          location: { directory: "/repo" },
          createdAt: 1,
          updatedAt: 1,
          archivedAt: null,
          cost: null,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        project: null,
        projectName: "Palot",
        section: "inbox",
        attention: false,
        attentionCount: 0,
        running: true,
        runningSince,
        failed: false,
        canSettle: false,
        pinnedAt: null,
        snoozedUntil: null,
        activityThrough: { updatedAt: 1, sessionID: "task-1" },
      };
      const { rerender } = render(
        <InboxCardSurface item={item} selected={false} buttonProps={{}} />,
      );
      expect(screen.getByTitle(workingLabel)).toBeTruthy();

      rerender(
        <InboxCardSurface
          item={{ ...item, attention: true, attentionCount }}
          selected={false}
          buttonProps={{}}
        />,
      );
      expect(screen.getByText(status)).toBeTruthy();
      expect(screen.getByLabelText("Task needs attention")).toBeTruthy();
      expect(screen.queryByTitle(workingLabel)).toBeNull();
      expect(
        screen.getByRole("button", { name: `Open Review changes, Palot, ${status}` }),
      ).toBeTruthy();

      rerender(<InboxCardSurface item={item} selected={false} buttonProps={{}} />);
      expect(screen.getByTitle(workingLabel)).toBeTruthy();
      expect(screen.queryByText(status)).toBeNull();
    },
  );
});
