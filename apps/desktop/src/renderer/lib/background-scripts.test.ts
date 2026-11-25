import type { JobCodeMode } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { recordScriptJobEvent, runningScriptJobs, scriptJobTitle } from "./background-scripts";

function job(id: string, status: JobCodeMode["status"] = "running"): JobCodeMode {
  return {
    kind: "codemode",
    id,
    sessionID: "root",
    status,
    title: "Code Mode script",
    time: { started: 1 },
  };
}

describe("runningScriptJobs", () => {
  it("keeps a script that started while the list loaded and drops one that ended", () => {
    let events = recordScriptJobEvent(new Map(), job("cm_new"), 150);
    events = recordScriptJobEvent(events, job("cm_old", "completed"), 160);
    // The list was asked for at 100, before cm_new started, and answered with cm_old running.
    const list = { jobs: [job("cm_old")], requestedAt: 100 };
    expect(runningScriptJobs(list, events).map((item) => item.id)).toEqual(["cm_new"]);
    // Before the list answers, events alone count.
    expect(runningScriptJobs(undefined, events).map((item) => item.id)).toEqual(["cm_new"]);
  });

  it("trusts a later list over an older running event, and never revives an ended job", () => {
    const events = recordScriptJobEvent(new Map(), job("cm_1"), 50);
    // Asked for after the event; the job is gone, so it ended without an event reaching us.
    expect(runningScriptJobs({ jobs: [], requestedAt: 100 }, events)).toEqual([]);
    const ended = recordScriptJobEvent(new Map(), job("cm_1", "cancelled"), 10);
    expect(recordScriptJobEvent(ended, job("cm_1"), 20)).toBe(ended);
  });
});

describe("scriptJobTitle", () => {
  it("names the script by its calls", () => {
    const messages = [
      {
        id: "m",
        type: "assistant",
        createdAt: 1,
        completedAt: null,
        text: null,
        agent: null,
        model: null,
        tokens: null,
        finish: null,
        data: {},
        content: [
          {
            type: "tool",
            id: "t",
            name: "execute",
            state: {
              status: "completed",
              input: { code: "…" },
              metadata: {
                jobID: "cm_1",
                toolCalls: [
                  { tool: "search", status: "completed", input: { query: "shell" } },
                  { tool: "shell", status: "running", input: { command: "./slow.sh" } },
                  { tool: "read", status: "completed", input: { path: "a.ts" } },
                ],
              },
            },
          },
        ],
      },
    ] as PalotMessage[];
    expect(scriptJobTitle("cm_1", messages)).toBe("Shell ./slow.sh and 1 more call");
    expect(scriptJobTitle("cm_2", messages)).toBeNull();
  });
});
