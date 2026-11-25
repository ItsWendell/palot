/** Native file selection, clipboard staging, and image previews. */

import path from "node:path";
import { constants, type Dirent } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import type { AttachmentUploadWriter } from "./attachment-upload";
import { parseAttachmentPaths } from "./ipc-input";
import {
  MAX_ATTACHMENT_COUNT,
  type PalotAttachmentRestore,
  type PalotFileAttachment,
  type PalotFilePickerResult,
} from "../shared/opencode-contract";

export { MAX_ATTACHMENT_COUNT };
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const STAGED_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const TEMPORARY_ROOT = path.join(os.tmpdir(), "palot-2");
const CLIPBOARD_DIRECTORY = path.join(TEMPORARY_ROOT, `clipboard-attachments-${process.pid}`);
const LEGACY_CLIPBOARD_DIRECTORY = /^clipboard-attachments-\d+$/;
/** Durable storage under userData, set at startup; without it pasted files stay in the temporary folder. */
let durableRoot: string | null = null;
/** Unreferenced durable files younger than this survive a sweep: their draft may not be saved yet. */
const DURABLE_SWEEP_GRACE_MS = 60 * 60 * 1_000;
const MAX_ATTACHMENT_URI_LENGTH = 4_096;
const MAX_RETAINED_ATTACHMENT_URIS = 10_000;

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

/**
 * Files dropped or pasted into the composer, which the preload resolved to paths. The paths come
 * from the renderer, so they are parsed as untrusted input, and then get exactly the checks and
 * upload rules picked files get. Without local file attachments nothing is parsed or read.
 */
export async function attachDroppedPaths(
  input: unknown,
  options: {
    localFileAttachments: boolean;
    prepare(select: () => Promise<PalotFilePickerResult>): Promise<PalotFilePickerResult>;
  },
): Promise<PalotFilePickerResult> {
  if (!options.localFileAttachments)
    throw new Error("This action is unavailable for the active OpenCode server");
  const paths = parseAttachmentPaths(input, { limit: MAX_ATTACHMENT_COUNT });
  return options.prepare(() => inspectPickedFiles(paths));
}

/** Transfer native-inspected selections only; failed files never retain desktop URIs. */
export async function uploadPickedAttachments(
  selected: PalotFilePickerResult,
  client: Pick<OpenCodeClient, "server" | "experimental">,
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
      const written = await client.experimental.file.write(
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

/**
 * Where pasted files are written. With durable storage configured they live under userData, so a
 * draft or stashed prompt that references them still has them after a restart; unreferenced ones
 * are swept by {@link sweepComposerAttachments}.
 */
function stagingDirectory(): string {
  return durableRoot ? path.join(durableRoot, "staged") : CLIPBOARD_DIRECTORY;
}

function stashDirectory(): string | null {
  return durableRoot ? path.join(durableRoot, "stash") : null;
}

async function ensurePrivateDirectory(directory: string): Promise<string> {
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

/** Call once at startup, after Electron has chosen the userData path. */
export function configureAttachmentStorage(userData: string): void {
  durableRoot = path.join(userData, "composer-attachments");
}

export async function stageClipboardText(text: unknown): Promise<PalotFilePickerResult> {
  if (typeof text !== "string" || !text || Buffer.byteLength(text, "utf8") > MAX_ATTACHMENT_BYTES)
    throw new Error("Pasted text must be nonempty and smaller than 20 MiB.");
  const directory = await ensurePrivateDirectory(stagingDirectory());
  const filePath = path.join(directory, `pasted-text-${randomUUID()}.txt`);
  await writeFile(filePath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return inspectPickedFiles([filePath]);
}

export async function stageClipboardImages(
  images: Array<{ mime: string; data: ArrayBuffer }>,
): Promise<PalotFilePickerResult> {
  const limited = images.slice(0, MAX_ATTACHMENT_COUNT);
  const directory = await ensurePrivateDirectory(stagingDirectory());
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
    const filePath = path.join(directory, `screenshot-${randomUUID()}.${extension}`);
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

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Stable, Nightly and Dev share the temporary root, and each keeps its staged files in a
 * directory named after its process ID. Such a directory is removed only once its process
 * has exited or it has outlived the maximum age, so starting one instance never deletes
 * another's unsent attachments.
 */
function stagedEntryExpired(entry: Dirent, modifiedAt: number, now: number): boolean {
  const old = now - modifiedAt > STAGED_ATTACHMENT_MAX_AGE_MS;
  if (entry.isFile()) return old;
  if (!entry.isDirectory()) return true;
  const pid = Number(/-(\d+)$/.exec(entry.name)?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return old;
  if (pid === process.pid) return false;
  return old || !processRunning(pid);
}

export async function cleanupStagedAttachments(
  now = Date.now(),
  root = TEMPORARY_ROOT,
): Promise<void> {
  for (const [grant, entry] of previewGrants) {
    if (now - entry.createdAt > STAGED_ATTACHMENT_MAX_AGE_MS) previewGrants.delete(grant);
  }
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(root, entry.name);
      try {
        const details = await stat(filePath);
        if (stagedEntryExpired(entry, details.mtimeMs, now)) {
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

type OwnedArea = "staged" | "stash" | "temporary";
const OWNED_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const UUID_SUFFIX = /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A file Palot wrote itself: a staged paste, a stashed copy, or a paste from an older run. */
function ownedAttachmentFile(uri: string): { area: OwnedArea; filePath: string } | null {
  let filePath: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.host) return null;
    filePath = fileURLToPath(url);
  } catch {
    return null;
  }
  if (!path.isAbsolute(filePath) || !OWNED_NAME.test(path.basename(filePath))) return null;
  const directory = path.dirname(filePath);
  if (durableRoot && directory === path.join(durableRoot, "staged"))
    return { area: "staged", filePath };
  if (durableRoot && directory === path.join(durableRoot, "stash"))
    return { area: "stash", filePath };
  if (
    directory === CLIPBOARD_DIRECTORY ||
    (path.dirname(directory) === TEMPORARY_ROOT &&
      LEGACY_CLIPBOARD_DIRECTORY.test(path.basename(directory)))
  )
    return { area: "temporary", filePath };
  return null;
}

function parseAttachmentURIs(input: unknown, limit: number): string[] {
  if (!Array.isArray(input) || input.length > limit) throw new Error("Attachment list is invalid.");
  return input.map((uri) => {
    if (typeof uri !== "string" || !uri || uri.length > MAX_ATTACHMENT_URI_LENGTH)
      throw new Error("Attachment list is invalid.");
    return uri;
  });
}

/** Copies one owned file into `directory` under a fresh name, within the attachment size limit. */
async function copyOwnedFile(source: string, directory: string): Promise<string> {
  const handle = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let data: Buffer;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > MAX_ATTACHMENT_BYTES)
      throw new Error("Attachment is not a file within the size limit.");
    data = await handle.readFile();
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachment grew past the limit.");
  } finally {
    await handle.close();
  }
  const name = path.basename(source);
  const extension = path.extname(name);
  const stem = path.basename(name, extension).replace(UUID_SUFFIX, "") || "attachment";
  const destination = path.join(directory, `${stem}-${randomUUID()}${extension}`);
  await writeFile(destination, data, { mode: 0o600, flag: "wx" });
  return destination;
}

/**
 * Gives a stashed prompt its own durable copies of the pasted files it references, in order.
 * Other URIs (picked files, uploads on a remote server) are returned unchanged. On failure every
 * copy made so far is removed, so the caller can keep the prompt where it was.
 */
export async function persistComposerAttachments(input: unknown): Promise<string[]> {
  const uris = parseAttachmentURIs(input, MAX_ATTACHMENT_COUNT);
  const stash = stashDirectory();
  if (!stash) return uris;
  const created: string[] = [];
  const result: string[] = [];
  for (const uri of uris) {
    const owned = ownedAttachmentFile(uri);
    if (!owned) {
      result.push(uri);
      continue;
    }
    try {
      const copy = await copyOwnedFile(owned.filePath, await ensurePrivateDirectory(stash));
      created.push(copy);
      result.push(pathToFileURL(copy).href);
    } catch {
      await Promise.all(created.map((file) => rm(file, { force: true })));
      throw new Error(`${path.basename(owned.filePath)}: the pasted file could not be stashed.`);
    }
  }
  return result;
}

/**
 * Brings a stashed prompt's files back into the composer, in order: stashed copies are staged
 * again (with a fresh preview), pasted files are checked to still exist, and files Palot does not
 * own are kept as they are. The stashed copies stay until {@link releaseComposerAttachments}.
 */
export async function restoreComposerAttachments(
  input: unknown,
): Promise<PalotAttachmentRestore[]> {
  const uris = parseAttachmentURIs(input, MAX_ATTACHMENT_COUNT);
  return Promise.all(
    uris.map(async (uri): Promise<PalotAttachmentRestore> => {
      const owned = ownedAttachmentFile(uri);
      if (!owned) return { status: "kept" };
      try {
        const filePath =
          owned.area === "stash"
            ? await copyOwnedFile(owned.filePath, await ensurePrivateDirectory(stagingDirectory()))
            : owned.filePath;
        if (!(await lstat(filePath)).isFile()) return { status: "missing" };
        const attachment = await inspectAttachment(filePath);
        return {
          status: "restored",
          uri: attachment.uri,
          ...(attachment.previewGrant ? { previewGrant: attachment.previewGrant } : {}),
        };
      } catch {
        return { status: "missing" };
      }
    }),
  );
}

/** Deletes the stashed copies among `input`; anything else is left alone. */
export async function releaseComposerAttachments(input: unknown): Promise<void> {
  const uris = parseAttachmentURIs(input, MAX_ATTACHMENT_COUNT);
  await Promise.all(
    uris.map(async (uri) => {
      const owned = ownedAttachmentFile(uri);
      if (owned?.area === "stash") await rm(owned.filePath, { force: true });
    }),
  );
}

/**
 * Removes durable pasted files that no saved draft or stashed prompt references any more. Files
 * younger than an hour are kept: a draft that just got one may not have been saved yet.
 */
let swept = false;

/**
 * Runs once per app launch. A second window opening later must not delete a pasted file that a
 * queued message, not yet delivered, still points at.
 */
export async function sweepComposerAttachments(input: unknown, now = Date.now()): Promise<void> {
  if (!durableRoot || swept) return;
  swept = true;
  const keep = new Set(
    parseAttachmentURIs(input, MAX_RETAINED_ATTACHMENT_URIS).flatMap(
      (uri) => ownedAttachmentFile(uri)?.filePath ?? [],
    ),
  );
  for (const directory of [path.join(durableRoot, "staged"), path.join(durableRoot, "stash")]) {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(directory, name);
        if (keep.has(filePath)) return;
        try {
          if (now - (await lstat(filePath)).mtimeMs > DURABLE_SWEEP_GRACE_MS)
            await rm(filePath, { recursive: true, force: true });
        } catch {
          // Already removed.
        }
      }),
    );
  }
}
