import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { normalPromptHistory } from "./composer-history";
import { searchMessages } from "./message-search";
import { promptAutomation, promptAutomationLabel } from "./prompt-automation";
import { transcriptPromptLabel } from "./transcript-outline";

function user(id: string, text: string, metadata?: Record<string, unknown>): PalotMessage {
  return {
    id,
    type: "user",
    createdAt: 1,
    completedAt: 1,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [{ type: "text", text }],
    // The shape OpenCode 2.4.1's automation runner admits: an ordinary user prompt, steered.
    data: { id, type: "user", text, delivery: "steer", ...(metadata ? { metadata } : {}) },
  } as PalotMessage;
}

const opencodeRun = (late: boolean) =>
  user("msg_auto", "Check the nightly build", {
    automation: { id: "aut_1", name: "Nightly check", run: 3, dueAt: 1_700_000_000_000, late },
  });

const palotRun = user("msg_palot", "Summarize open PRs", {
  "palot.automation": {
    version: 1,
    automationID: "palot_1",
    runID: "run_9",
    scheduledFor: 1_700_000_000_000,
    trigger: "schedule",
  },
});

describe("prompt automation", () => {
  it("reads an OpenCode automation run and labels it with its name and lateness", () => {
    const automation = promptAutomation(opencodeRun(true));
    expect(automation).toEqual({
      source: "opencode",
      automationID: "aut_1",
      name: "Nightly check",
      run: 3,
      dueAt: 1_700_000_000_000,
      late: true,
    });
    expect(promptAutomationLabel(automation!)).toBe("Automation · Nightly check · ran late");
    expect(promptAutomationLabel(promptAutomation(opencodeRun(false))!)).toBe(
      "Automation · Nightly check",
    );
  });

  it("reads Palot's own runs, naming them from the automation list", () => {
    const automation = promptAutomation(palotRun);
    expect(automation).toMatchObject({ source: "palot", automationID: "palot_1", runID: "run_9" });
    expect(promptAutomationLabel(automation!, "PR digest")).toBe("Automation · PR digest");
    expect(promptAutomationLabel(automation!)).toBe("Automation");
  });

  it("leaves typed prompts and other metadata alone", () => {
    expect(promptAutomation(user("msg_you", "Hello"))).toBeNull();
    // Shell and code automations name themselves with a string; those are not user prompts.
    expect(promptAutomation(user("msg_x", "x", { automation: "Nightly" }))).toBeNull();
    expect(promptAutomation({ ...opencodeRun(false), type: "assistant" })).toBeNull();
  });

  it("keeps automation prompts out of Up-arrow history", () => {
    const history = normalPromptHistory([user("msg_you", "Mine"), opencodeRun(false), palotRun]);
    expect(history.map((entry) => entry.draft.text)).toEqual(["Mine"]);
  });

  it("attributes automation prompts in the outline and message search", () => {
    expect(transcriptPromptLabel(opencodeRun(true))).toBe(
      "Automation · Nightly check · ran late: Check the nightly build",
    );
    expect(transcriptPromptLabel(user("msg_you", "Mine"))).toBe("Mine");
    const hits = searchMessages(
      [
        {
          task: { session: { id: "ses_1", title: "Task", updatedAt: 1 } } as never,
          messages: [opencodeRun(false), user("msg_you", "nightly by hand")],
        },
      ],
      "nightly",
    );
    expect(hits.map((hit) => [hit.anchorMessageID, hit.author])).toEqual([
      ["msg_you", "user"],
      ["msg_auto", "automation"],
    ]);
  });
});
