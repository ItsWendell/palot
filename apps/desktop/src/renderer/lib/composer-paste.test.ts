import { describe, expect, it } from "vitest";
import {
  LONG_PASTE_BYTES,
  LONG_PASTE_LINES,
  composerFileSources,
  composerPasteAction,
  lineCount,
  type ComposerPasteContext,
  type ComposerPasteInput,
} from "./composer-paste";

const prompt: ComposerPasteContext = { plain: false, attachments: true, selectedText: null };
const input = (value: Partial<ComposerPasteInput>): ComposerPasteInput => ({
  text: "",
  files: [],
  fragment: "",
  html: "",
  ...value,
});
const image = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
const archive = new File([new Uint8Array([1])], "notes.zip", { type: "application/zip" });

describe("composer paste rules", () => {
  it("attaches image data and files from a file manager, whatever text comes with them", () => {
    expect(composerPasteAction(input({ files: [image] }), prompt)).toEqual({
      kind: "attach-files",
      files: [image],
    });
    expect(composerPasteAction(input({ files: [archive], text: "notes.zip" }), prompt)).toEqual({
      kind: "attach-files",
      files: [archive],
    });
  });

  it("pastes the text of a Word copy, which also carries a picture of it", () => {
    const html =
      '<html><head><style>p{margin:0}</style></head><body><!--StartFragment--><p class="MsoNormal">Quarterly notes</p><!--EndFragment--></body></html>';
    expect(
      composerPasteAction(input({ files: [image], text: "Quarterly notes", html }), prompt),
    ).toEqual({ kind: "text", text: "Quarterly notes" });
  });

  it("attaches a copied image whose HTML is only the <img>", () => {
    const html = '<meta charset="utf-8"><img src="https://example.com/a.png" alt="">&nbsp;';
    expect(composerPasteAction(input({ files: [image], html }), prompt).kind).toBe("attach-files");
    expect(
      composerPasteAction(
        input({ files: [image], text: "https://example.com/a.png", html }),
        prompt,
      ).kind,
    ).toBe("attach-files");
    expect(composerPasteAction(input({ files: [image], text: "shot.png" }), prompt).kind).toBe(
      "attach-files",
    );
  });

  it("turns text of 32 KB or more, or more than 400 lines, into a pasted-text attachment", () => {
    const long = "x".repeat(LONG_PASTE_BYTES);
    expect(composerPasteAction(input({ text: long }), prompt)).toEqual({
      kind: "attach-text",
      text: long,
      lines: 1,
    });
    // Multi-byte text crosses the limit in bytes before it does in characters.
    const wide = "é".repeat(LONG_PASTE_BYTES / 2);
    expect(composerPasteAction(input({ text: wide }), prompt).kind).toBe("attach-text");
    const lines = Array.from({ length: LONG_PASTE_LINES + 1 }, (_, index) => `${index}`).join("\n");
    expect(composerPasteAction(input({ text: lines }), prompt)).toMatchObject({
      kind: "attach-text",
      lines: LONG_PASTE_LINES + 1,
    });
    const atLimit = Array.from({ length: LONG_PASTE_LINES }, () => "line").join("\n");
    expect(composerPasteAction(input({ text: atLimit }), prompt).kind).toBe("text");
  });

  it("pastes as plain text inline with Mod+Shift+V, and in shell mode, regardless", () => {
    const long = "x".repeat(LONG_PASTE_BYTES);
    for (const context of [
      { ...prompt, plain: true },
      { ...prompt, attachments: false },
    ]) {
      expect(composerPasteAction(input({ text: long, files: [image] }), context)).toEqual({
        kind: "text",
        text: long,
      });
      expect(composerPasteAction(input({ files: [image] }), context)).toEqual({ kind: "none" });
    }
  });

  it("makes a Markdown link of a URL pasted over selected text", () => {
    const url = "https://example.com/docs?a=1";
    expect(
      composerPasteAction(input({ text: url }), { ...prompt, selectedText: "the docs" }),
    ).toEqual({ kind: "link", text: `[the docs](${url})` });
    // Without a selection, over a selection with a line break, or for text that is not a URL.
    expect(composerPasteAction(input({ text: url }), prompt)).toEqual({ kind: "text", text: url });
    expect(
      composerPasteAction(input({ text: url }), { ...prompt, selectedText: "two\nlines" }).kind,
    ).toBe("text");
    expect(
      composerPasteAction(input({ text: "not a url" }), { ...prompt, selectedText: "x" }).kind,
    ).toBe("text");
  });

  it("keeps the composer's own copies with their chips, up to a bound", () => {
    expect(composerPasteAction(input({ text: "a", fragment: "{}" }), prompt)).toEqual({
      kind: "fragment",
      value: "{}",
    });
    expect(
      composerPasteAction(input({ text: "a", fragment: "x".repeat(200_001) }), prompt).kind,
    ).toBe("text");
  });

  it("pastes everything else as plain text and nothing at all for rich content alone", () => {
    expect(composerPasteAction(input({ text: "hello\nworld" }), prompt)).toEqual({
      kind: "text",
      text: "hello\nworld",
    });
    expect(composerPasteAction(input({}), prompt)).toEqual({ kind: "none" });
  });

  it("attaches files with a path by path, images without one by bytes, and names the rest", () => {
    const onDisk = new File([new Uint8Array([1])], "diagram.png", { type: "image/png" });
    const folder = new File([], "src", { type: "" });
    const paths = new Map([
      [onDisk, "/home/me/diagram.png"],
      [archive, "/home/me/notes.zip"],
      [folder, "/home/me/src"],
    ]);
    const pathFor = (file: File) => paths.get(file) ?? "";
    const pageBuilt = new File([new Uint8Array([1])], "page.zip", { type: "application/zip" });

    expect(composerFileSources([image, onDisk, archive, folder, pageBuilt], pathFor, 20)).toEqual({
      byPath: [onDisk, archive, folder],
      overLimit: [],
      images: [image],
      unsupported: [pageBuilt],
    });
    // Beyond the limit, files with a path are held back; pasted images still stage.
    expect(composerFileSources([onDisk, image, archive, folder], pathFor, 2)).toEqual({
      byPath: [onDisk, archive],
      overLimit: [folder],
      images: [image],
      unsupported: [],
    });
  });

  it("counts lines the way an editor shows them", () => {
    expect(lineCount("one")).toBe(1);
    expect(lineCount("one\ntwo")).toBe(2);
    expect(lineCount("one\ntwo\n")).toBe(2);
  });
});
