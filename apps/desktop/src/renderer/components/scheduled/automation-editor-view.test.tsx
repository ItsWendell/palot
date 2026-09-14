import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationDraft, AutomationRecord, AutomationRun } from "../../../shared";
import { Provider, createStore } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";

vi.mock("../../hooks/use-settings-snapshot", () => ({
  useSettingsSnapshot: () => ({ data: { agents: [], catalog: { models: [] }, skills: [] } }),
}));

vi.mock("../../hooks/use-project-worktrees", () => ({
  useProjectWorktrees: () => ({ data: [] }),
}));

vi.mock("../../services/palot", () => ({
  palot: {
    previewAutomationSchedule: vi.fn().mockResolvedValue({ summary: "Daily", occurrences: [] }),
  },
}));

import { AutomationEditor } from "./automation-editor";

const draft: AutomationDraft = {
  name: "Daily review",
  status: "active",
  action: { prompt: "Review the project", agent: null, model: null, skills: [] },
  destination: {
    type: "standalone",
    projectID: "project-1",
    sourceDirectory: "/repo",
    workspace: { type: "current" },
  },
  trigger: {
    version: 1,
    type: "recurring",
    dtstart: Date.UTC(2026, 7, 27, 9),
    timezone: "UTC",
    rrule: "FREQ=DAILY;INTERVAL=1",
  },
  missedRuns: { type: "skip" },
  notifications: "background-only",
  createdFromSessionID: null,
};

function automation(input: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    ...draft,
    version: 1,
    id: "automation-1",
    profileID: "profile-1",
    createdAt: 1,
    updatedAt: 1,
    definitionVersion: 1,
    nextRunAt: null,
    lastRunAt: null,
    activeRunID: null,
    consecutiveStartFailures: 0,
    ...input,
  };
}

function run(input: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationID: "automation-1",
    profileID: "profile-1",
    definitionVersion: 1,
    trigger: "scheduled",
    scheduledFor: 1,
    state: "succeeded",
    rootSessionID: "session-1",
    inboxID: null,
    worktreeDirectory: null,
    sessionCursors: {},
    attention: null,
    summary: "Finished",
    error: null,
    startedAt: 1,
    completedAt: 2,
    executionStartedAt: 1,
    executionCompletedAt: 2,
    readAt: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...input,
  };
}

function renderEditor(input: {
  automation?: AutomationRecord;
  runs?: AutomationRun[];
  selectedRunID?: string;
  remote?: boolean;
  initialDraft?: AutomationDraft;
}) {
  const onRunAction = vi.fn();
  const store = createStore();
  if (input.remote)
    store.set(runtimeAtom, {
      profileID: "remote",
      connectionID: "remote",
      connected: true,
      capabilities: { localPathActions: false },
    } as never);
  render(
    <Provider store={store}>
      <AutomationEditor
        automation={input.automation ?? automation()}
        initialDraft={input.initialDraft ?? draft}
        projects={[]}
        sessions={[]}
        runs={input.runs ?? []}
        selectedRunID={input.selectedRunID}
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onAction={vi.fn().mockResolvedValue(undefined)}
        onRunAction={onRunAction}
      />
    </Provider>,
  );
  return { onRunAction };
}

afterEach(cleanup);

describe("AutomationEditor run navigation", () => {
  it.each(["standalone", "session"] as const)(
    "explains %s continuity without promising remote file memory",
    (destination) => {
      renderEditor({
        remote: true,
        initialDraft:
          destination === "session"
            ? { ...draft, destination: { type: "session", sessionID: "session-1" } }
            : draft,
      });
      const memory = screen.queryByText(
        /Standalone runs on this server do not share a memory file/,
      );
      if (destination === "standalone") expect(memory).toBeTruthy();
      else expect(memory).toBeNull();
    },
  );
  it("keeps a sessionless setup failure clickable and exposes its resolution", async () => {
    const setupRun = run({
      state: "needs-attention",
      rootSessionID: null,
      attention: {
        type: "configuration",
        sessionID: null,
        requestID: null,
        message: "The target task is unavailable.",
      },
      error: { code: "configuration", message: "The target task is unavailable." },
    });
    const { onRunAction } = renderEditor({ runs: [setupRun], selectedRunID: setupRun.id });

    const row = screen.getByRole("button", { name: /Setup required/i });
    expect((row as HTMLButtonElement).disabled).toBe(false);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("The target task is unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix setup" })).toBeTruthy();
    await userEvent.click(row);
    expect(onRunAction).toHaveBeenCalledWith(setupRun, "open");
  });

  it("replaces Test now with Open current run while an automation is active", async () => {
    const activeRun = run({ id: "active-run", state: "running" });
    const { onRunAction } = renderEditor({
      automation: automation({ activeRunID: activeRun.id }),
      runs: [activeRun],
    });

    const openButtons = screen.getAllByRole("button", { name: "Open current run" });
    await userEvent.click(openButtons.at(-1)!);
    expect(onRunAction).toHaveBeenCalledWith(activeRun, "open");
  });
});
