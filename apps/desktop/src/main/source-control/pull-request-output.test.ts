// @vitest-environment node
import type { OpenCodeEvent } from "@opencode/client";
import { expect, it } from "vitest";
import { pullRequestOutput } from "./pull-request-output";

it("reads settled text tool and shell output, not failed or partial results", () => {
  const text = "https://github.com/acme/web/pull/7";
  const event = {
    type: "session.tool.success",
    data: {
      sessionID: "task",
      content: [
        { type: "text", text },
        { type: "image", data: "ignored" },
      ],
    },
  } as unknown as OpenCodeEvent;
  expect(pullRequestOutput(event)).toEqual({ sessionID: "task", text });
  for (const type of ["session.tool.progress", "session.tool.failed", "session.text.ended"])
    expect(pullRequestOutput({ ...event, type } as OpenCodeEvent)).toBeNull();
  expect(
    pullRequestOutput({
      type: "session.shell.ended",
      data: { sessionID: "task", output: { output: text } },
    } as OpenCodeEvent),
  ).toEqual({ sessionID: "task", text });
});
