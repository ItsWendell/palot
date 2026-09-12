import type { SessionTransferData } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { sessionTransferToMarkdown } from "./session-markdown";

describe("sessionTransferToMarkdown", () => {
  it("copies ordered user and assistant text with attachment names", () => {
    const transfer = {
      info: { id: "session-1", title: "Investigate", location: { directory: "/repo" } },
      messages: [
        {
          id: "user-1",
          type: "user",
          time: { created: 1 },
          text: "Check this",
          files: [
            {
              name: "trace.txt",
              mime: "text/plain",
              data: "data:text/plain;base64,QQ==",
              source: { type: "file", path: "/trace.txt" },
            },
          ],
        },
        {
          id: "assistant-1",
          type: "assistant",
          time: { created: 2, streamed: 3, completed: 4 },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          content: [
            { type: "reasoning", text: "private reasoning" },
            { type: "text", text: "First paragraph." },
            {
              type: "tool",
              id: "tool-1",
              name: "read",
              state: {
                status: "completed",
                input: {},
                content: [{ type: "text", text: "secret tool output" }],
              },
              time: { created: 2, completed: 3 },
            },
            { type: "text", text: "Second paragraph." },
          ],
        },
      ],
    } as unknown as SessionTransferData;

    const markdown = sessionTransferToMarkdown(transfer);
    expect(markdown).toContain("# Investigate\n\nTask ID: session-1");
    expect(markdown).toContain("## You\n\nCheck this\n\nAttachments:\n- trace.txt");
    expect(markdown).toContain("## Assistant\n\nFirst paragraph.\n\nSecond paragraph.");
    expect(markdown).not.toContain("private reasoning");
    expect(markdown).not.toContain("secret tool output");
    expect(markdown).not.toContain("data:text/plain");
  });

  it("omits unsupported records and labels empty user text", () => {
    const transfer = {
      info: { id: "session-2", location: { directory: "/repo" } },
      messages: [
        { id: "user-1", type: "user", time: { created: 1 }, text: "" },
        { id: "system-1", type: "system", time: { created: 2 }, text: "hidden" },
      ],
    } as unknown as SessionTransferData;
    expect(sessionTransferToMarkdown(transfer)).toBe(
      "# OpenCode task\n\nTask ID: session-2\n\n## You\n\n_(No text)_\n",
    );
  });
});
