import { describe, expect, it } from "vitest";
import { mapMessage } from "../services/opencode-mappers";
import { composerDraftFromMessage, composerFilesFromMessage } from "./composer-restoration";
import type { SessionMessageInfo } from "@opencode/client";

function message(extra: Record<string, unknown> = {}) {
  return mapMessage({
    id: "prompt-1",
    type: "user",
    text: "Original full prompt",
    time: { created: 1 },
    ...extra,
  } as SessionMessageInfo);
}

describe("composer restoration", () => {
  it("restores display text and review comments as an editable text block", () => {
    const draft = composerDraftFromMessage(
      message({
        metadata: {
          displayText: "Fix @a.ts",
          comments: [
            {
              path: "a.ts",
              comment: "Handle null.",
              selection: { startLine: 2, endLine: 4, startChar: 0, endChar: 1 },
              origin: "review",
            },
          ],
        },
        files: [
          {
            name: "a.ts",
            mime: "text/plain",
            source: { type: "uri", uri: "file:///repo/a.ts" },
            mention: { text: "@a.ts", start: 4, end: 9 },
          },
        ],
      }),
    );
    expect(draft.text).toBe(
      "Fix @a.ts\n\nRestored file comments:\na.ts (lines 2–4):\nHandle null.",
    );
    expect(draft.mentions).toMatchObject([{ kind: "file", value: "a.ts", start: 4, end: 9 }]);
    expect(draft.command).toBeNull();
  });
  it("preserves full original text when presentation metadata is malformed", () => {
    expect(
      composerDraftFromMessage(
        message({
          metadata: {
            displayText: "Short",
            comments: [{ path: "x", comment: "test", selection: { startLine: -1 } }],
          },
        }),
      ).text,
    ).toBe("Original full prompt");
  });
  it.each([
    { startLine: 4, endLine: 2, startChar: 0, endChar: 0 },
    { startLine: 2, endLine: 2, startChar: 8, endChar: 3 },
  ])("falls back to the original text for reversed comment ranges: %j", (selection) => {
    expect(
      composerDraftFromMessage(
        message({
          metadata: {
            displayText: "Short",
            comments: [{ path: "a.ts", comment: "Fix it", selection }],
          },
        }),
      ).text,
    ).toBe("Original full prompt");
  });
  it("restores portable bytes but never local grants or unknown remote URLs", () => {
    const source = message({
      files: [
        { name: "inline.png", mime: "image/png", source: { type: "inline" }, data: "aGVsbG8=" },
        {
          name: "local.png",
          mime: "image/png",
          source: { type: "uri", uri: "file:///tmp/expired.png" },
          previewGrant: "expired",
        },
        {
          name: "remote.png",
          mime: "image/png",
          source: { type: "uri", uri: "https://private.example/image" },
        },
      ],
    });
    expect(composerFilesFromMessage(source)).toEqual({
      files: [
        {
          name: "inline.png",
          mime: "image/png",
          uri: "data:image/png;base64,aGVsbG8=",
          size: null,
        },
      ],
      omitted: ["local.png", "remote.png"],
    });
    expect(composerDraftFromMessage(source).text).toContain(
      "Attachments not restored (reattach before sending):\n- local.png\n- remote.png",
    );
  });
});
