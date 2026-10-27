import type { PermissionRequest } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { permissionPreview, permissionTitle } from "./permission-presentation";
import { pendingRequestViews } from "./view-models";

const request: PermissionRequest = {
  id: "p",
  sessionID: "s",
  action: "edit",
  resources: ["a.ts"],
  source: { type: "tool", messageID: "m", id: "t" },
};
describe("permission previews", () => {
  it("resolves the exact tool source and lets request metadata override tool metadata", () => {
    const messages: PalotMessage[] = [
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
          { type: "tool", id: "wrong", state: { input: { command: "wrong" } } },
          {
            type: "tool",
            id: "t",
            state: {
              status: "running",
              input: { path: "src/a.ts" },
              metadata: { diff: "tool diff" },
            },
          },
        ],
      },
    ];
    expect(
      permissionPreview({ ...request, metadata: { diff: "request diff" } }, messages),
    ).toMatchObject({ file: "src/a.ts", patch: "request diff" });
  });
  it("degrades safely without source history and bounds untrusted previews", () => {
    expect(permissionPreview({ ...request, action: "shell" }, []).text).toBe("a.ts");
    const result = permissionPreview({ ...request, metadata: { diff: "x".repeat(30_000) } }, []);
    expect(result.text).toHaveLength(24_000);
    expect(result.truncated).toBe(true);
    expect(result.patch).toBeUndefined();
  });

  it("names Palot's scheduling tools and lists what will be scheduled", () => {
    expect(permissionTitle("palot_schedule_task")).toBe("Schedule a task");
    expect(permissionTitle("palot_read_task")).toBe("Palot: read task");
    expect(permissionTitle("shell")).toBe("shell");
    const preview = permissionPreview(
      {
        id: "p",
        sessionID: "s",
        action: "palot_schedule_task",
        resources: ["*"],
        metadata: {
          input: {
            name: "Check CI",
            at: "2026-10-27T09:00",
            rrule: "FREQ=DAILY",
            prompt: "Check the CI run.",
          },
        },
      },
      [],
    );
    expect(preview.label).toBe("Details");
    expect(preview.subject).toBe("Check CI");
    // Updates and deletes name the scheduled task by ID; the card resolves its name.
    expect(
      permissionPreview(
        {
          id: "p",
          sessionID: "s",
          action: "palot_delete_automation",
          resources: ["*"],
          metadata: { input: { automationId: "aut_1" } },
        },
        [],
      ),
    ).toMatchObject({ automationID: "aut_1" });
    // The card offers "Always allow for this project" with OpenCode's save pattern.
    const [view] = pendingRequestViews({
      permissions: [
        { id: "p", sessionID: "s", action: "palot_schedule_task", resources: ["*"], save: ["*"] },
      ],
      forms: [],
      inbox: [],
    } as never);
    expect(view).toMatchObject({ savePatterns: ["*"] });
    expect(preview.text).toBe(
      "Name: Check CI\nWhen: 2026-10-27T09:00\nRepeats: FREQ=DAILY\nRuns in: This task\nPrompt: Check the CI run.",
    );
  });
});
