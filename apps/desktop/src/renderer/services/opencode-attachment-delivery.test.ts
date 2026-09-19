import { describe, expect, it } from "vitest";
import { composerDraftFromMessage } from "../lib/composer-restoration";
import { mapMessage } from "./opencode-mappers";
import { attachmentPrompt } from "./opencode-attachment-delivery";

const binary = {
  uri: "file:///server/uploads/archive%20%22one%22.zip",
  name: "archive.zip",
  mime: "application/zip",
  size: 12,
};

describe("attachment delivery", () => {
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
