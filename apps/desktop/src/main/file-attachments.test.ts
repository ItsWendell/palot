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
  test.each(["json", "xml", "yaml", "yml"])(
    "normalizes %s source attachment MIME types",
    async (extension) => {
      const directory = await temporaryDirectory();
      const file = path.join(directory, `source.${extension}`);
      await writeFile(file, "source content");
      const result = await inspectPickedFiles([file]);
      expect(result.errors).toEqual([]);
      expect(result.files[0]).toMatchObject({ mime: "text/plain", size: 14 });
    },
  );
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

  test("accepts PDF and oversized files by path without buffering their contents", async () => {
    const directory = await temporaryDirectory();
    const pdf = path.join(directory, "paper.pdf");
    const binary = path.join(directory, "archive.zip");
    const large = path.join(directory, "large.txt");
    await Promise.all([writeFile(pdf, "pdf"), writeFile(binary, "zip")]);
    const largeHandle = await open(large, "w");
    await largeHandle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await largeHandle.close();

    const result = await inspectPickedFiles([pdf, binary, large]);

    expect(result.files).toEqual([
      { uri: pathToFileURL(pdf).href, name: "paper.pdf", mime: "application/pdf", size: 3 },
      {
        uri: pathToFileURL(binary).href,
        name: "archive.zip",
        mime: "application/octet-stream",
        size: 3,
      },
      {
        uri: pathToFileURL(large).href,
        name: "large.txt",
        mime: "text/plain",
        size: MAX_ATTACHMENT_BYTES + 1,
      },
    ]);
    expect(result.errors).toEqual([]);
  });

  test("does not create a buffered preview grant for oversized images", async () => {
    const directory = await temporaryDirectory();
    const image = path.join(directory, "large.png");
    const handle = await open(image, "w");
    await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await handle.close();
    const result = await inspectPickedFiles([image]);
    expect(result.errors).toEqual([]);
    expect(result.files[0]).toMatchObject({ mime: "image/png", size: MAX_ATTACHMENT_BYTES + 1 });
    expect(result.files[0]?.previewGrant).toBeUndefined();
  });

  test("rejects directories and symlinks for arbitrary attachment types", async () => {
    const directory = await temporaryDirectory();
    const binary = path.join(directory, "archive.zip");
    const link = path.join(directory, "linked.zip");
    await writeFile(binary, "zip");
    await symlink(binary, link);
    const result = await inspectPickedFiles([directory, link]);
    expect(result.files).toEqual([]);
    expect(result.errors).toHaveLength(2);
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
