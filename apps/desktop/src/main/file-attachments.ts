/** Native file selection, clipboard staging, and image previews. */

import path from "node:path";
import { constants } from "node:fs";
import { chmod, mkdir, open, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
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

const SUPPORTED_EXTENSIONS = new Set<string>([...IMAGE_EXTENSIONS, ...TEXT_AND_SOURCE_EXTENSIONS]);
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
  if (extension === "json") return "application/json";
  if (extension === "xml") return "application/xml";
  if (extension === "yaml" || extension === "yml") return "application/yaml";
  return "text/plain";
}

function supportsFile(filePath: string): boolean {
  const extension = fileExtension(filePath);
  if (extension) return SUPPORTED_EXTENSIONS.has(extension);
  const filename = path.basename(filePath).toLowerCase();
  return (
    SUPPORTED_EXTENSIONLESS_NAMES.has(filename) ||
    filename.startsWith(".env.") ||
    filename.startsWith("dockerfile.")
  );
}

function attachmentError(filePath: string, message: string): Error {
  return new Error(`${path.basename(filePath)}: ${message}`);
}

async function inspectAttachment(
  filePath: string,
  createPreviewGrant = true,
): Promise<PalotFileAttachment> {
  const extension = fileExtension(filePath);
  if (extension === "pdf") throw attachmentError(filePath, "PDF files are not supported.");
  if (!supportsFile(filePath)) {
    throw attachmentError(filePath, "this file type is not supported.");
  }

  let details;
  try {
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      details = await handle.stat();
    } finally {
      await handle.close();
    }
  } catch {
    throw attachmentError(filePath, "the file could not be read.");
  }
  if (!details.isFile()) throw attachmentError(filePath, "the selected item is not a file.");
  if (details.size > MAX_ATTACHMENT_BYTES) {
    throw attachmentError(filePath, "the file is larger than the 20 MiB limit.");
  }

  const attachment: PalotFileAttachment = {
    uri: pathToFileURL(filePath).href,
    name: path.basename(filePath),
    mime: mimeType(filePath),
    size: details.size,
  };
  if (
    createPreviewGrant &&
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
