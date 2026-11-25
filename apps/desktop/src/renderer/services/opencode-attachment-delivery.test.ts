import { describe, expect, it } from "vitest";
import { composerDraftFromMessage } from "../lib/composer-restoration";
import { mapMessage } from "./opencode-mappers";
import { attachmentPrompt } from "./opencode-attachment-delivery";
import { formatReviewComment, reviewCommentsFromMessage } from "../lib/review-comments";

const binary = {
  uri: "file:///server/uploads/archive%20%22one%22.zip",
  name: "archive.zip",
  mime: "application/zip",
  size: 12,
};

describe("attachment delivery", () => {
  it("sends browser context and a preview only to models accepting images", () => {
    const comment = {
      id: "browser",
      tabID: "tab-a",
      url: "https://example.test/",
      generation: 1,
      comment: "Fix this",
      element: { label: "button", selector: "#save", ref: "e1" },
      preview: "data:image/jpeg;base64,AA==",
    };
    const delivered = attachmentPrompt("", {
      browserComments: [comment],
      modelInput: ["text", "image"],
    });
    expect(delivered.text).toContain("Fix this");
    expect(delivered.text).toContain("browser ref @e1");
    expect(delivered.inlineFiles).toMatchObject([{ uri: comment.preview, mime: "image/jpeg" }]);
    const { preview: _preview, ...description } = comment;
    expect(delivered.metadata?.browserComments).toEqual([
      { ...description, previewFile: delivered.inlineFiles[0]?.name },
    ]);
    expect(JSON.stringify(delivered.metadata)).not.toContain("data:");
    const textOnly = attachmentPrompt("", { browserComments: [comment], modelInput: ["text"] });
    expect(textOnly.inlineFiles).toEqual([]);
    // Without an attached file, the metadata is the only place the preview survives.
    expect(textOnly.metadata?.browserComments).toEqual([comment]);
  });
  it("delivers a comment-only prompt as an explicit note with structured metadata", () => {
    const comments = [
      {
        path: "src/a b.ts",
        comment: "Handle null.",
        selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 0 },
        origin: "review" as const,
      },
    ];
    const delivered = attachmentPrompt("", { comments });
    expect(delivered.text).toBe(
      "The user made the following comment regarding lines 2 through 4 of src/a b.ts: Handle null.",
    );
    expect(delivered.metadata?.comments).toEqual(comments);
    expect(delivered.metadata?.displayText).toBe("");
    const message = mapMessage({
      id: "comment-only",
      type: "user",
      time: { created: 1 },
      text: delivered.text,
      metadata: delivered.metadata,
    });
    expect(composerDraftFromMessage(message).text).toBe("");
    expect(reviewCommentsFromMessage(message)).toMatchObject([
      { path: "src/a b.ts", comment: "Handle null." },
    ]);
  });
  it("names removed lines as the old version and restores their side", () => {
    const comments = [
      {
        path: "src/a.ts",
        comment: "Why drop this?",
        selection: { startLine: 12, startChar: 0, endLine: 12, endChar: 0 },
        side: "deletions" as const,
        origin: "review" as const,
      },
      {
        path: "src/a.ts",
        comment: "Keep these.",
        selection: { startLine: 3, startChar: 0, endLine: 5, endChar: 0 },
        side: "deletions" as const,
        origin: "review" as const,
      },
      {
        path: "src/b.ts",
        comment: "Nice.",
        selection: { startLine: 7, startChar: 0, endLine: 7, endChar: 0 },
        side: "additions" as const,
        origin: "review" as const,
      },
    ];
    const delivered = attachmentPrompt("", { comments });
    expect(delivered.text?.split("\n")).toEqual([
      "The user made the following comment regarding line 12 of src/a.ts (removed line, old version): Why drop this?",
      "The user made the following comment regarding lines 3 through 5 of src/a.ts (removed lines, old version): Keep these.",
      "The user made the following comment regarding line 7 of src/b.ts: Nice.",
    ]);
    const message = mapMessage({
      id: "sided",
      type: "user",
      time: { created: 1 },
      text: delivered.text,
      metadata: delivered.metadata,
    });
    const restored = reviewCommentsFromMessage(message);
    expect(restored?.map((comment) => comment.side)).toEqual([
      "deletions",
      "deletions",
      "additions",
    ]);
    // Resending a restored comment says the same thing.
    expect(restored?.map(formatReviewComment).join("\n")).toBe(delivered.text);
  });
  it("delivers unsupported bytes as a quoted server path while retaining display and attachment history", () => {
    const delivered = attachmentPrompt("Inspect this", { files: [binary] });
    expect(delivered.text).toBe(
      'Inspect this\nAttached file: "/server/uploads/archive \\"one\\".zip"',
    );
    expect(delivered.inlineFiles).toEqual([]);
    expect(delivered.metadata?.displayText).toBe("Inspect this");
    const message = mapMessage({
      id: "message",
      type: "user",
      time: { created: 1 },
      text: delivered.text,
      files: [],
      metadata: delivered.metadata,
    });
    expect(message.text).toBe("Inspect this");
    expect(message.files).toEqual([binary]);
    expect(composerDraftFromMessage(message).text).toContain("Inspect this");
    expect(composerDraftFromMessage(message).text).not.toContain("Attached file:");
  });

  it.each(["image/png", "application/pdf"])("uses model input capabilities for %s", (mime) => {
    const file = { ...binary, uri: "file:///server/media", mime };
    expect(attachmentPrompt("Read", { files: [file], modelInput: ["text"] }).inlineFiles).toEqual(
      [],
    );
    expect(
      attachmentPrompt("Read", { files: [file], modelInput: ["image", "pdf"] }).inlineFiles,
    ).toEqual([file]);
  });

  it("does not silently drop unsupported inline data without a server path", () => {
    expect(() =>
      attachmentPrompt("Read", { files: [{ ...binary, uri: "data:application/zip;base64,AA==" }] }),
    ).toThrow("Upload archive.zip");
  });

  it("delivers text as a server path rather than expanding it into the prompt", () => {
    const file = { ...binary, mime: "text/plain" };
    const delivered = attachmentPrompt("Read", { files: [file], modelInput: ["text"] });
    expect(delivered.inlineFiles).toEqual([]);
    expect(delivered.metadata?.attachments).toEqual([
      expect.objectContaining({ mime: "text/plain", uri: file.uri }),
    ]);
    expect(delivered.text).toContain("Attached file:");
  });

  it.each(["image/png", "application/pdf"])(
    "routes oversized %s by path even when the model supports it",
    (mime) => {
      const file = { ...binary, mime, size: 20 * 1024 * 1024 };
      expect(
        attachmentPrompt("Read", { files: [file], modelInput: ["image", "pdf"] }).inlineFiles,
      ).toEqual([file]);
      const delivered = attachmentPrompt("Read", {
        files: [{ ...file, size: file.size + 1 }],
        modelInput: ["image", "pdf"],
      });
      expect(delivered.inlineFiles).toEqual([]);
      expect(delivered.text).toContain("Attached file:");
    },
  );
});
