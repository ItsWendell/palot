import { mkdtemp, open, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  inspectPickedFiles,
  MAX_ATTACHMENT_BYTES,
  readAttachmentPreview,
  stageClipboardImages,
} from "./file-attachments";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "palot-attachments-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("file attachments", () => {
  test("accepts supported source and image files", async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, "example.ts");
    const image = path.join(directory, "screen.png");
    await Promise.all([writeFile(source, "export {}\n"), writeFile(image, "image")]);

    const result = await inspectPickedFiles([source, image]);

    expect(result.errors).toEqual([]);
    expect(result.files).toEqual([
      {
        uri: pathToFileURL(source).href,
        name: "example.ts",
        mime: "text/plain",
        size: 10,
      },
      {
        uri: pathToFileURL(image).href,
        previewGrant: expect.any(String),
        name: "screen.png",
        mime: "image/png",
        size: 5,
      },
    ]);
  });

  test("returns clear PDF, unsupported type, and size errors", async () => {
    const directory = await temporaryDirectory();
    const pdf = path.join(directory, "paper.pdf");
    const binary = path.join(directory, "archive.zip");
    const large = path.join(directory, "large.txt");
    await Promise.all([writeFile(pdf, "pdf"), writeFile(binary, "zip")]);
    const largeHandle = await open(large, "w");
    await largeHandle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await largeHandle.close();

    const result = await inspectPickedFiles([pdf, binary, large]);

    expect(result.files).toEqual([]);
    expect(result.errors).toEqual([
      "paper.pdf: PDF files are not supported.",
      "archive.zip: this file type is not supported.",
      "large.txt: the file is larger than the 20 MiB limit.",
    ]);
  });

  test("stages pasted screenshots as validated image attachments", async () => {
    const result = await stageClipboardImages([
      { mime: "image/png", data: Uint8Array.from([1, 2, 3]).buffer },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ mime: "image/png", size: 3 });
    expect(result.files[0]?.name).toMatch(/^screenshot-.*\.png$/);

    expect(result.files[0]?.previewGrant).toEqual(expect.any(String));
    const preview = await readAttachmentPreview(result.files[0]!.previewGrant!);
    expect(preview?.mime).toBe("image/png");
    expect(new Uint8Array(preview!.data)).toEqual(Uint8Array.from([1, 2, 3]));
    const stagedPath = new URL(result.files[0]!.uri);
    expect((await stat(stagedPath)).mode & 0o777).toBe(0o600);
    expect((await stat(new URL(".", stagedPath))).mode & 0o777).toBe(0o700);
  });

  test("does not accept renderer-provided file URIs as preview grants", async () => {
    const directory = await temporaryDirectory();
    const image = path.join(directory, "known.png");
    await writeFile(image, "private");

    await expect(readAttachmentPreview(pathToFileURL(image).href)).rejects.toThrow(
      "Attachment preview grant is invalid or expired",
    );
  });

  test("rejects a selected preview file replaced by a symlink", async () => {
    const directory = await temporaryDirectory();
    const image = path.join(directory, "known.png");
    const replacement = path.join(directory, "replacement.png");
    await Promise.all([writeFile(image, "original"), writeFile(replacement, "private")]);
    const result = await inspectPickedFiles([image]);
    const grant = result.files[0]!.previewGrant!;
    await rm(image);
    await symlink(replacement, image);

    await expect(readAttachmentPreview(grant)).rejects.toThrow();
  });

  test("rejects unsupported pasted image formats", async () => {
    const result = await stageClipboardImages([
      { mime: "image/tiff", data: Uint8Array.from([1]).buffer },
    ]);

    expect(result.files).toEqual([]);
    expect(result.errors).toEqual(["Pasted image 1: this image type is not supported."]);
  });
});
