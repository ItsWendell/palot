/** Native file selection, clipboard staging, and image previews. */

import path from "node:path";
import { constants } from "node:fs";
import { chmod, mkdir, open, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import type { AttachmentUploadWriter } from "./attachment-upload";
import type { PalotFileAttachment, PalotFilePickerResult } from "../shared/opencode-contract";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 20;
const STAGED_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const TEMPORARY_ROOT = path.join(os.tmpdir(), "palot-2");
const CLIPBOARD_DIRECTORY = path.join(TEMPORARY_ROOT, `clipboard-attachments-${process.pid}`);

const previewGrants = new Map<
  string,
  { filePath: string; createdAt: number; device: number; inode: number }
>();
// Only objects produced by native inspection can be uploaded. Never trust a renderer URI.
const uploadSources = new WeakMap<
  PalotFileAttachment,
  {
    filePath: string;
    device: number;
    inode: number;
    size: number;
    modified: number;
  }
>();

const IMAGE_EXTENSIONS = ["gif", "jpeg", "jpg", "png", "webp"];
const TEXT_AND_SOURCE_EXTENSIONS = [
  "astro",
  "bash",
  "c",
  "cc",
  "cfg",
  "clj",
  "cljs",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cxx",
  "dart",
  "env",
  "erl",
  "ex",
  "exs",
  "fish",
  "go",
  "graphql",
  "gql",
  "h",
  "hcl",
  "hpp",
  "hrl",
  "htm",
  "html",
  "hxx",
  "ini",
  "ipynb",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "log",
  "lua",
  "md",
  "mdx",
  "mjs",
  "php",
  "plist",
  "proto",
  "properties",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svg",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "tf",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
] as const;

const SUPPORTED_EXTENSIONLESS_NAMES = new Set([
  ".editorconfig",
  ".env",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "readme",
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ATTACHMENT_DIALOG_FILTERS = [
  { name: "All files", extensions: ["*"] },
  {
    name: "Supported images, text, and source files",
    extensions: [...IMAGE_EXTENSIONS, ...TEXT_AND_SOURCE_EXTENSIONS],
  },
  { name: "Images", extensions: IMAGE_EXTENSIONS },
  { name: "Text and source", extensions: [...TEXT_AND_SOURCE_EXTENSIONS] },
];

function fileExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function mimeType(filePath: string): string {
  const extension = fileExtension(filePath);
  if (IMAGE_MIME_TYPES[extension]) return IMAGE_MIME_TYPES[extension];
  if (extension === "pdf") return "application/pdf";
  const filename = path.basename(filePath).toLowerCase();
  if (
    TEXT_AND_SOURCE_EXTENSIONS.some((value) => value === extension) ||
    SUPPORTED_EXTENSIONLESS_NAMES.has(filename) ||
    filename.startsWith(".env.") ||
    filename.startsWith("dockerfile.")
  )
    return "text/plain";
  return "application/octet-stream";
}

function attachmentError(filePath: string, message: string): Error {
  return new Error(`${path.basename(filePath)}: ${message}`);
}

async function inspectAttachment(
  filePath: string,
  createPreviewGrant = true,
): Promise<PalotFileAttachment> {
  let details;
  try {
    const handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      details = await handle.stat();
    } finally {
      await handle.close();
    }
  } catch {
    throw attachmentError(filePath, "the file could not be read.");
  }
  if (!details.isFile()) throw attachmentError(filePath, "the selected item is not a file.");

  const attachment: PalotFileAttachment = {
    uri: pathToFileURL(filePath).href,
    name: path.basename(filePath),
    mime: mimeType(filePath),
    size: details.size,
  };
  uploadSources.set(attachment, {
    filePath,
    device: details.dev,
    inode: details.ino,
    size: details.size,
    modified: details.mtimeMs,
  });
  if (
    createPreviewGrant &&
    details.size <= MAX_ATTACHMENT_BYTES &&
    attachment.mime.startsWith("image/") &&
    attachment.mime !== "image/svg+xml"
  ) {
    const previewGrant = randomUUID();
    previewGrants.set(previewGrant, {
      filePath,
      createdAt: Date.now(),
      device: details.dev,
      inode: details.ino,
    });
    attachment.previewGrant = previewGrant;
  }
  return attachment;
}

export async function inspectPickedFiles(filePaths: string[]): Promise<PalotFilePickerResult> {
  const limited = filePaths.slice(0, MAX_ATTACHMENT_COUNT);
  const inspected = await Promise.all(
    limited.map(async (filePath) => {
      try {
        return { file: await inspectAttachment(filePath), error: null };
      } catch (error) {
        return {
          file: null,
          error:
            error instanceof Error ? error.message : `${path.basename(filePath)}: invalid file.`,
        };
      }
    }),
  );
  const errors = inspected.flatMap((item) => (item.error ? [item.error] : []));
  if (filePaths.length > MAX_ATTACHMENT_COUNT) {
    errors.push(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`);
  }
  return {
    files: inspected.flatMap((item) => (item.file ? [item.file] : [])),
    errors,
  };
}

/** Transfer native-inspected selections only; failed files never retain desktop URIs. */
export async function uploadPickedAttachments(
  selected: PalotFilePickerResult,
  client: Pick<OpenCodeClient, "server" | "file">,
  scope: {
    signal: AbortSignal;
    validate(): void;
    write?: AttachmentUploadWriter;
    onProgress?(progress: {
      name: string;
      loaded: number;
      total: number;
      index: number;
      count: number;
    }): void;
  },
): Promise<PalotFilePickerResult> {
  const validate = () => {
    scope.signal.throwIfAborted();
    scope.validate();
  };
  validate();
  if (!selected.files.length) return selected;
  const info = await client.server.info({ signal: scope.signal });
  validate();
  const temporary = info.paths.tmp;
  const windows = /^[a-z]:[\\/]/i.test(temporary);
  const serverPath = windows ? path.win32 : path.posix;
  if (
    !serverPath.isAbsolute(temporary) ||
    (!windows && temporary.includes("\\")) ||
    temporary.includes("\0")
  ) {
    throw new Error("OpenCode returned an invalid temporary directory.");
  }
  const files: PalotFileAttachment[] = [];
  const errors = [...selected.errors];
  const batch = selected.files.slice(0, MAX_ATTACHMENT_COUNT);
  for (const [index, attachment] of batch.entries()) {
    validate();
    // The official client only accepts buffered Uint8Array payloads. Keep remote
    // buffering bounded until it exposes streaming writes; local paths need no upload.
    if (!scope.write && attachment.size != null && attachment.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${attachment.name}: remote uploads larger than 20 MiB are not supported yet.`);
      continue;
    }
    try {
      const source = uploadSources.get(attachment);
      if (!source) throw new Error("Attachment was not selected natively.");
      const handle = await open(
        source.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let payload: Buffer;
      try {
        const matches = (details: Awaited<ReturnType<typeof handle.stat>>) =>
          details.isFile() &&
          details.dev === source.device &&
          details.ino === source.inode &&
          details.size === source.size &&
          details.mtimeMs === source.modified;
        if (!matches(await handle.stat())) throw new Error("Selected attachment changed.");
        if (scope.write) {
          const name = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
          const destination = serverPath.join(temporary, `palot-${randomUUID()}-${name}`);
          async function* chunks() {
            let position = 0;
            while (position < source!.size) {
              validate();
              const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, source!.size - position));
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
              if (!bytesRead) throw new Error("Selected attachment changed.");
              position += bytesRead;
              yield buffer.subarray(0, bytesRead);
            }
            if (!matches(await handle.stat())) throw new Error("Selected attachment changed.");
          }
          const uploaded = await scope.write({
            path: destination,
            size: source.size,
            chunks: chunks(),
            signal: scope.signal,
            validate,
            onProgress: (loaded) =>
              scope.onProgress?.({
                name: attachment.name,
                loaded,
                total: source.size,
                index,
                count: batch.length,
              }),
          });
          validate();
          if (!matches(await handle.stat())) throw new Error("Selected attachment changed.");
          if (serverPath.normalize(uploaded) !== destination)
            throw new Error("Unexpected upload path.");
          files.push({ ...attachment, uri: pathToFileURL(uploaded, { windows }).href });
          continue;
        }
        if (source.size > MAX_ATTACHMENT_BYTES) throw new Error("Attachment requires streaming.");
        // Read at most the inspected size plus one byte, even if the file grows concurrently.
        const buffer = Buffer.alloc(source.size + 1);
        let length = 0;
        while (length < buffer.length) {
          validate();
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length !== source.size || !matches(await handle.stat()))
          throw new Error("Selected attachment changed.");
        payload = buffer.subarray(0, length);
      } finally {
        await handle.close();
      }
      validate();
      const name = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
      const destination = serverPath.join(temporary, `palot-${randomUUID()}-${name}`);
      const written = await client.file.write(
        { path: destination, payload },
        { signal: scope.signal },
      );
      validate();
      if (serverPath.normalize(written.data.path) !== destination)
        throw new Error("Unexpected upload path.");
      files.push({ ...attachment, uri: pathToFileURL(written.data.path, { windows }).href });
    } catch {
      validate();
      errors.push(
        `${attachment.name}: the file could not be uploaded to OpenCode. Select it again and retry.`,
      );
    }
  }
  if (selected.files.length > MAX_ATTACHMENT_COUNT)
    errors.push(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`);
  return { files, errors };
}

export async function stageClipboardImages(
  images: Array<{ mime: string; data: ArrayBuffer }>,
): Promise<PalotFilePickerResult> {
  const limited = images.slice(0, MAX_ATTACHMENT_COUNT);
  await mkdir(TEMPORARY_ROOT, { recursive: true, mode: 0o700 });
  await chmod(TEMPORARY_ROOT, 0o700);
  await mkdir(CLIPBOARD_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(CLIPBOARD_DIRECTORY, 0o700);
  const errors: string[] = [];
  const paths: string[] = [];

  for (const [index, image] of limited.entries()) {
    const extension = CLIPBOARD_IMAGE_EXTENSIONS[image.mime];
    if (!extension) {
      errors.push(`Pasted image ${index + 1}: this image type is not supported.`);
      continue;
    }
    if (image.data.byteLength > MAX_ATTACHMENT_BYTES) {
      errors.push(`Pasted image ${index + 1}: the image is larger than the 20 MiB limit.`);
      continue;
    }
    if (image.data.byteLength === 0) {
      errors.push(`Pasted image ${index + 1}: the image is empty.`);
      continue;
    }
    const filePath = path.join(CLIPBOARD_DIRECTORY, `screenshot-${randomUUID()}.${extension}`);
    await writeFile(filePath, new Uint8Array(image.data), { mode: 0o600, flag: "wx" });
    paths.push(filePath);
  }
  if (images.length > MAX_ATTACHMENT_COUNT) {
    errors.push(`Attach up to ${MAX_ATTACHMENT_COUNT} files at a time.`);
  }

  const inspected = await inspectPickedFiles(paths);
  return { files: inspected.files, errors: [...errors, ...inspected.errors] };
}

export async function readAttachmentPreview(
  grant: string,
): Promise<{ mime: string; data: ArrayBuffer } | null> {
  const entry = previewGrants.get(grant);
  if (!entry) throw new Error("Attachment preview grant is invalid or expired.");
  if (Date.now() - entry.createdAt > STAGED_ATTACHMENT_MAX_AGE_MS) {
    previewGrants.delete(grant);
    throw new Error("Attachment preview grant is invalid or expired.");
  }
  const filePath = entry.filePath;
  const mime = mimeType(filePath);
  if (!mime.startsWith("image/")) return null;
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.size > MAX_ATTACHMENT_BYTES ||
      details.dev !== entry.device ||
      details.ino !== entry.inode
    ) {
      throw new Error("Attachment preview grant no longer matches the selected file.");
    }
    const data = await handle.readFile();
    return { mime, data: Uint8Array.from(data).buffer };
  } finally {
    await handle?.close();
  }
}

export async function cleanupStagedAttachments(now = Date.now()): Promise<void> {
  for (const [grant, entry] of previewGrants) {
    if (now - entry.createdAt > STAGED_ATTACHMENT_MAX_AGE_MS) previewGrants.delete(grant);
  }
  let entries;
  try {
    entries = await readdir(TEMPORARY_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(TEMPORARY_ROOT, entry.name);
      try {
        const details = await stat(filePath);
        if (!entry.isFile() || now - details.mtimeMs > STAGED_ATTACHMENT_MAX_AGE_MS) {
          await rm(filePath, { recursive: true, force: true });
        }
      } catch {
        // A concurrent cleanup or OS action already removed the entry.
      }
    }),
  );
}

export async function shutdownAttachmentStorage(): Promise<void> {
  previewGrants.clear();
  await rm(CLIPBOARD_DIRECTORY, { recursive: true, force: true });
  await rmdir(TEMPORARY_ROOT).catch(() => undefined);
}
