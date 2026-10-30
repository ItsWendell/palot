/**
 * One parser and resolver for file references in the transcript: Markdown links,
 * inline code paths, and tool-call targets.
 *
 * Runs in the sandboxed renderer, so it must not touch Node globals such as `process`.
 */

import type { LocationRef } from "@opencode/client";
import type { PalotMessage } from "../../shared";

export interface FileReference {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
}

export type FileReferenceSource = "code" | "href";

export interface ParseFileReferenceOptions {
  source: FileReferenceSource;
  /** `~` is the server's home. Link it only when the connection is local. */
  allowHome?: boolean;
}

const WORKSPACE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "db",
  "docx",
  "env",
  "epub",
  "fish",
  "gif",
  "go",
  "gql",
  "graphql",
  "gz",
  "h",
  "hpp",
  "html",
  "java",
  "jar",
  "jpeg",
  "jpg",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "lock",
  "md",
  "mdx",
  "mp3",
  "mp4",
  "ogg",
  "odp",
  "ods",
  "odt",
  "opus",
  "pdf",
  "png",
  "pptx",
  "py",
  "rb",
  "rs",
  "rtf",
  "scss",
  "sh",
  "sql",
  "sqlite",
  "sqlite3",
  "swift",
  "tar",
  "tgz",
  "toml",
  "ts",
  "tsx",
  "txt",
  "wav",
  "webm",
  "webp",
  "xml",
  "xlsx",
  "yaml",
  "yml",
  "zsh",
  "zip",
]);

/** Long extensions a bare name may still use when it carries a line suffix. */
const LONG_EXTENSION_ALLOWLIST = new Set([
  "dockerfile",
  "gitignore",
  "graphql",
  "ipynb",
  "jsonc",
  "kotlin",
  "makefile",
  "markdown",
  "scala",
  "swift",
  "svelte",
]);

/** Identifiers that look like `name.ext` but are code, e.g. `console.log`. */
const IDENTIFIER_STEMS = new Set([
  "array",
  "console",
  "document",
  "globalthis",
  "json",
  "math",
  "module",
  "number",
  "object",
  "process",
  "promise",
  "props",
  "react",
  "self",
  "state",
  "string",
  "this",
  "window",
]);

const POSIX_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/workspace/",
  "/workspaces/",
];

const KNOWN_EXTENSIONLESS_FILES = new Set([
  "dockerfile",
  "makefile",
  "gnumakefile",
  "justfile",
  "gemfile",
  "procfile",
  "brewfile",
  "caddyfile",
  "vagrantfile",
  "jenkinsfile",
  "license",
  "licence",
  "copying",
  "notice",
  "readme",
  "changelog",
]);

const DRIVE_PATH = /^[A-Za-z]:\//;
const NON_FILE_SCHEME = /^(?:https?|mailto|tel|data|javascript|ftp|ws|wss|blob|about):/i;

interface LineSuffix {
  line: number;
  column?: number;
  endLine?: number;
}

const positive = (value: string | undefined) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

function lineSuffix(
  line: string | undefined,
  column?: string,
  endLine?: string,
): LineSuffix | null {
  const start = positive(line);
  if (!start) return null;
  const end = positive(endLine);
  const col = positive(column);
  return {
    line: start,
    ...(col ? { column: col } : {}),
    ...(end && end > start ? { endLine: end } : {}),
  };
}

/** Splits a trailing line/column/range suffix off a path. */
function splitLineSuffix(value: string): { path: string; suffix: LineSuffix | null } {
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => LineSuffix | null]> = [
    // `path (line 12)`, `path line 12`, `path lines 12-20`, `path L12`
    [/\s+\(?lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)?$/i, (m) => lineSuffix(m[1], undefined, m[2])],
    [/\s+L(\d+)$/, (m) => lineSuffix(m[1])],
    // `#L12`, `#L12C3`, `#L12-L20`, `#L12C3-L20C4`
    [/#L(\d+)(?:C(\d+))?(?:[-–]L?(\d+)(?:C\d+)?)?$/i, (m) => lineSuffix(m[1], m[2], m[3])],
    // `path(12,3)` and `path(12)`
    [/(?<=[^\s(])\((\d+)(?:,\s*(\d+))?\)$/, (m) => lineSuffix(m[1], m[2])],
    // `:L12`
    [/:L(\d+)$/, (m) => lineSuffix(m[1])],
    // `:12`, `:12:3`, `:12-20`, `:12:3-20:4`
    [
      /(?<!^[A-Za-z]):(\d+)(?::(\d+))?(?:[-–](\d+)(?::\d+)?)?$/,
      (m) => lineSuffix(m[1], m[2], m[3]),
    ],
  ];
  for (const [pattern, read] of patterns) {
    const match = value.match(pattern);
    if (!match || match.index === undefined) continue;
    const suffix = read(match);
    if (!suffix) continue;
    return { path: value.slice(0, match.index), suffix };
  }
  return { path: value, suffix: null };
}

function trimTrailingPunctuation(value: string): string {
  let result = value;
  for (;;) {
    const before = result;
    result = result.replace(/[.,;:!?]+$/, "");
    if (result.endsWith(")") && count(result, ")") > count(result, "("))
      result = result.slice(0, -1);
    if (result.endsWith("]") && count(result, "]") > count(result, "["))
      result = result.slice(0, -1);
    if (result === before) return result;
  }
}

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

function safeDecode(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Command words that start shell snippets rather than file names. */
const COMMAND_WORDS = new Set([
  "awk",
  "bun",
  "bunx",
  "cargo",
  "cat",
  "cd",
  "chmod",
  "code",
  "cp",
  "curl",
  "deno",
  "docker",
  "echo",
  "gh",
  "git",
  "go",
  "grep",
  "jest",
  "less",
  "ls",
  "make",
  "mkdir",
  "mv",
  "node",
  "npm",
  "npx",
  "open",
  "pip",
  "pnpm",
  "python",
  "python3",
  "rg",
  "rm",
  "sed",
  "sudo",
  "tail",
  "touch",
  "tsc",
  "vi",
  "vim",
  "vitest",
  "vp",
  "yarn",
]);

/**
 * Rejects commands and code in inline code, such as `npm test src/x.ts`, while keeping
 * names with spaces (`My File.md`, `C:/Program Files/repo/a.ts`). Expects `/` separators.
 */
function looksLikeCommandOrCode(value: string): boolean {
  if (/[{}<>"'`;=|&*$]/.test(value)) return true;
  if (value.includes(",")) return true;
  if (!/\s/.test(value)) return false;
  if (/\s\s/.test(value)) return true;
  const tokens = value.split(/\s+/);
  if (tokens.some((token) => token.startsWith("-"))) return true;
  const first = tokens[0] ?? "";
  if (COMMAND_WORDS.has(first)) return true;
  // `run tests src/a.ts`: a lowercase verb followed by arguments.
  if (tokens.length > 2 && /^[a-z]+$/.test(first)) return true;
  // More than one complete file name means a list of paths, not one path.
  return tokens.filter((token) => /\.[A-Za-z0-9]{1,15}$/.test(token)).length > 1;
}

function likelyWorkspaceFile(path: string, hasLine: boolean): boolean {
  if (!path || path.endsWith("/") || path.startsWith("//")) return false;
  if (POSIX_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (DRIVE_PATH.test(path)) return true;
  if (path.startsWith("~/")) return path.length > 2;

  const name = path.split("/").at(-1) ?? "";
  if (name === "." || name === "..") return false;
  if (KNOWN_EXTENSIONLESS_FILES.has(name.toLowerCase())) return true;
  const match = name.match(/^(.*)\.([A-Za-z0-9+_-]{1,15})$/);
  if (!match) return false;
  const stem = match[1] ?? "";
  const extension = match[2] ?? "";
  if (/^\d+$/.test(extension)) return false;
  if (path.includes("/")) return true;

  // Bare names: Codex-style filter so `this.state` or `foo.toString` stay code.
  if (/[a-z]/.test(extension) && /[A-Z]/.test(extension)) return false;
  const lower = extension.toLowerCase();
  if (WORKSPACE_FILE_EXTENSIONS.has(lower)) return true;
  if (!hasLine || IDENTIFIER_STEMS.has(stem.toLowerCase())) return false;
  return lower.length <= 4 || LONG_EXTENSION_ALLOWLIST.has(lower);
}

/** Parses a Markdown href or inline code span into a workspace file reference. */
export function parseFileReference(
  raw: string | undefined,
  options: ParseFileReferenceOptions,
): FileReference | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (options.source === "code") {
    if (value.startsWith("@")) value = value.slice(1);
    value = trimTrailingPunctuation(value);
  }
  if (!value || [...value].some((character) => character.charCodeAt(0) < 32)) return null;
  if (NON_FILE_SCHEME.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^file:\/\//i.test(value)) return null;
  // A URL anywhere in the text (`run https://example.com`) means it is not a path.
  if (!/^file:\/\//i.test(value) && /[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;

  // Hrefs and file URLs are percent-encoded; decode the path only after the query,
  // line suffix, and fragment are split off so `%23` and `%3F` stay in the name.
  const decoded = options.source === "href" || /^file:\/\//i.test(value);
  let queryLine: number | undefined;
  if (/^file:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    // A remote host is a UNC share; never treat it as a workspace file.
    if (url.host && url.host !== "localhost") return null;
    queryLine = positive(url.searchParams.get("start") ?? "");
    value = url.pathname + url.hash;
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  } else if (options.source === "href") {
    const queryIndex = value.indexOf("?");
    if (queryIndex >= 0) {
      queryLine = positive(new URLSearchParams(value.slice(queryIndex + 1)).get("start") ?? "");
      const hash = value.indexOf("#", queryIndex);
      value = value.slice(0, queryIndex) + (hash >= 0 ? value.slice(hash) : "");
    }
  }

  const { path: withoutSuffix, suffix } = splitLineSuffix(value);
  let path = withoutSuffix;
  // Other fragments (`README.md#install`) point into the document, not at a line.
  if (decoded && path.includes("#")) path = path.slice(0, path.indexOf("#"));
  if (decoded) path = safeDecode(path);
  path = path.replaceAll("\\", "/");
  if (options.source === "code") {
    path = trimTrailingPunctuation(path);
    if (looksLikeCommandOrCode(path)) return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !DRIVE_PATH.test(path)) return null;
  if (path.startsWith("//")) return null;
  if ((path === "~" || path.startsWith("~/")) && !options.allowHome) return null;
  if (path.startsWith("~") && !path.startsWith("~/")) return null;
  if (!likelyWorkspaceFile(path, Boolean(suffix))) return null;

  const line = suffix?.line ?? queryLine;
  return {
    path,
    ...(line ? { line } : {}),
    ...(suffix?.column ? { column: suffix.column } : {}),
    ...(suffix?.endLine ? { endLine: suffix.endLine } : {}),
  };
}

export function fileReferenceLabel(reference: FileReference): string {
  if (!reference.line) return reference.path;
  return reference.endLine
    ? `${reference.path} (lines ${reference.line}-${reference.endLine})`
    : `${reference.path} (line ${reference.line})`;
}

// Paths

export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Collapses `.`/`..` segments and separators. Relative paths keep leading `..`. */
export function normalizeFilePath(path: string): string {
  const value = path.replaceAll("\\", "/");
  const prefix = DRIVE_PATH.exec(value)?.[0] ?? (value.startsWith("/") ? "/" : "");
  const segments: string[] = [];
  for (const segment of value.slice(prefix.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") segments.pop();
      else if (!prefix) segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  return prefix + segments.join("/") || prefix || ".";
}

export function joinFilePath(base: string, path: string): string {
  return isAbsoluteFilePath(path) ? normalizeFilePath(path) : normalizeFilePath(`${base}/${path}`);
}

function samePrefix(root: string, path: string): boolean {
  // Windows drive paths compare case-insensitively.
  return DRIVE_PATH.test(root)
    ? path.toLowerCase().startsWith(root.toLowerCase())
    : path.startsWith(root);
}

/**
 * Converts a server path to one relative to `root`. Returns `""` for the root itself
 * and null for anything outside it. Paths containing `..` are rejected unnormalized.
 */
export function workspaceRelativePath(root: string, path: string): string | null {
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  const entry = path.replaceAll("\\", "/");
  if (!entry || entry.includes("\0") || entry.split("/").includes("..")) return null;
  let relative: string | null;
  if (isAbsoluteFilePath(entry)) {
    const prefix = base === "/" ? "/" : `${base}/`;
    if (entry === base || (DRIVE_PATH.test(base) && entry.toLowerCase() === base.toLowerCase())) {
      relative = "";
    } else {
      relative = samePrefix(prefix, entry) ? entry.slice(prefix.length) : null;
    }
  } else {
    relative = entry;
  }
  if (relative === null || relative.startsWith("/") || relative.includes(":")) return null;
  return relative
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

export function fileUrl(absolutePath: string, line?: number): string {
  const path = absolutePath.startsWith("/") ? absolutePath : `/${absolutePath}`;
  const encoded = encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F");
  return `file://${encoded}${line ? `#L${line}` : ""}`;
}

/** A `file://` href for copy/drag, or undefined when the path cannot be made absolute. */
export function fileReferenceHref(
  reference: Pick<FileReference, "path" | "line">,
  directory: string | undefined,
): string | undefined {
  const path = reference.path.replaceAll("\\", "/");
  if (path.startsWith("~")) return undefined;
  if (isAbsoluteFilePath(path)) return fileUrl(normalizeFilePath(path), reference.line);
  if (!directory) return undefined;
  return fileUrl(joinFilePath(directory, path), reference.line);
}

// Locations

export interface FileReferenceLocation {
  location: LocationRef;
  /** The location relative to its project root, as reported by OpenCode. */
  subpath?: string;
}

/** The project root implied by OpenCode's session subpath, or null when not trustworthy. */
export function projectRootFromSubpath(directory: string, subpath: string | undefined) {
  if (subpath === undefined) return null;
  const root = normalizeFilePath(directory);
  const relative = normalizeFilePath(subpath);
  if (relative === ".") return root;
  if (isAbsoluteFilePath(relative) || relative.split("/").includes("..")) return null;
  const suffix = `/${relative}`;
  const matches = DRIVE_PATH.test(root)
    ? root.toLowerCase().endsWith(suffix.toLowerCase())
    : root.endsWith(suffix);
  if (!matches) return null;
  return root.slice(0, -suffix.length) || "/";
}

/**
 * Bases to try in order: each location's directory, then its project root. Pass the
 * location a message was written in first and the session's current location after it.
 */
export function fileReferenceBases(...locations: FileReferenceLocation[]): LocationRef[] {
  const bases: LocationRef[] = [];
  const add = (location: LocationRef, directory: string) => {
    const key = comparablePath(directory);
    if (bases.some((base) => comparablePath(base.directory) === key)) return;
    bases.push({ ...location, directory });
  };
  for (const entry of locations) {
    const directory = normalizeFilePath(entry.location.directory);
    add(entry.location, directory);
    const root = projectRootFromSubpath(directory, entry.subpath);
    if (root) add(entry.location, root);
  }
  return bases;
}

/** Windows drive paths compare case-insensitively; POSIX paths exactly. */
function comparablePath(path: string): string {
  return DRIVE_PATH.test(path) ? path.toLowerCase() : path;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function locationOf(value: unknown, subpathValue: unknown): FileReferenceLocation | null {
  const record = recordOf(value);
  if (typeof record.directory !== "string" || !record.directory) return null;
  return {
    location: {
      directory: record.directory,
      ...(typeof record.workspaceID === "string" ? { workspaceID: record.workspaceID } : {}),
    } as LocationRef,
    ...(typeof subpathValue === "string" ? { subpath: subpathValue } : {}),
  };
}

/**
 * The location that was current when `messageID` was written. Sessions can move;
 * relative paths in older messages belong to the location they were written in.
 */
export function locationAtMessage(
  messages: readonly Pick<PalotMessage, "id" | "type" | "createdAt" | "data">[],
  messageID: string | undefined,
  current: FileReferenceLocation,
): FileReferenceLocation {
  if (!messageID) return current;
  const target = messages.find((message) => message.id === messageID);
  const switches = messages
    .filter((message) => message.type === "location-switched")
    .toSorted((left, right) => left.createdAt - right.createdAt);
  if (!target || switches.length === 0) return current;
  const first = recordOf(switches[0]?.data);
  const previous = recordOf(first.previous);
  let result = locationOf(previous.location, previous.subpath) ?? current;
  for (const message of switches) {
    if (message.createdAt > target.createdAt) break;
    const data = recordOf(message.data);
    result = locationOf(data.location, data.subpath) ?? result;
  }
  return result;
}

// Resolution

export interface FileReferenceIO {
  /** Re-reads the file. Resolves false when it does not exist; throws on other failures. */
  read(location: LocationRef, path: string): Promise<boolean>;
  /** Fuzzy server search; paths are relative to `location`. */
  find(location: LocationRef, query: string): Promise<string[]>;
}

export type FileReferenceResolution =
  | { kind: "open"; location: LocationRef; path: string }
  | { kind: "choose"; location: LocationRef; query: string; candidates: string[] }
  | { kind: "outside"; absolutePath: string | null }
  | { kind: "missing"; absolutePath: string | null };

interface Candidate {
  location: LocationRef;
  path: string;
}

/** Every base containing `absolute`, narrowest first. */
function containingCandidates(bases: LocationRef[], absolute: string): Candidate[] {
  return bases
    .flatMap((location) => {
      const path = workspaceRelativePath(location.directory, absolute);
      return path ? [{ location, path }] : [];
    })
    .toSorted((left, right) => right.location.directory.length - left.location.directory.length);
}

class Aborted extends Error {}

function check(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Aborted();
}

export function isFileReferenceAbort(error: unknown): boolean {
  return error instanceof Aborted;
}

/**
 * Reads `absolute` through the narrowest base that contains it, falling back to wider
 * ones: the server checks containment after resolving symlinks, so a link inside the
 * task folder may only be readable through the wider base. Returns where the read worked.
 */
async function readThroughBases(
  bases: LocationRef[],
  absolute: string,
  io: FileReferenceIO,
  errors: unknown[],
  signal?: AbortSignal,
): Promise<Candidate | null> {
  for (const candidate of containingCandidates(bases, absolute)) {
    let exists = false;
    try {
      exists = await io.read(candidate.location, candidate.path);
    } catch (error) {
      errors.push(error);
    }
    check(signal);
    if (exists) return candidate;
  }
  return null;
}

/** Opens a picker choice through the same verified read path as a resolved click. */
export async function readFileTarget(
  bases: LocationRef[],
  location: LocationRef,
  path: string,
  io: FileReferenceIO,
  signal?: AbortSignal,
): Promise<{ location: LocationRef; path: string } | null> {
  const errors: unknown[] = [];
  const candidate = await readThroughBases(
    bases.some((base) => base.directory === location.directory) ? bases : [...bases, location],
    joinFilePath(location.directory, path),
    io,
    errors,
    signal,
  );
  if (!candidate && errors.length > 0) throw errors[0];
  return candidate;
}

/**
 * Resolves a reference with existence checks:
 * 1. the literal path under each base in order (message location, its project root,
 *    then the session's current location and root),
 * 2. a server search filtered to exact or `/<path>` suffix matches.
 * The literal path is tried first, which also covers files the search index skips.
 */
export async function resolveFileReference(
  path: string,
  bases: LocationRef[],
  io: FileReferenceIO,
  signal?: AbortSignal,
): Promise<FileReferenceResolution> {
  if (bases.length === 0) return { kind: "missing", absolutePath: null };
  const value = path.replaceAll("\\", "/");
  if (value.startsWith("~")) return { kind: "outside", absolutePath: value };

  const tried = new Set<string>();
  const errors: unknown[] = [];
  let firstTried: string | null = null;
  const tryAbsolute = async (absolute: string) => {
    const key = comparablePath(absolute);
    if (tried.has(key)) return null;
    tried.add(key);
    firstTried ??= absolute;
    return readThroughBases(bases, absolute, io, errors, signal);
  };
  const finish = (absolutePath: string | null): FileReferenceResolution => {
    // A failed request is not evidence that the file is missing.
    if (errors.length > 0) throw errors[0];
    return { kind: "missing", absolutePath };
  };

  if (isAbsoluteFilePath(value)) {
    const absolute = normalizeFilePath(value);
    if (containingCandidates(bases, absolute).length === 0) {
      return { kind: "outside", absolutePath: absolute };
    }
    const found = await tryAbsolute(absolute);
    return found ? { kind: "open", ...found } : finish(absolute);
  }

  let escaped: string | null = null;
  for (const base of bases) {
    const absolute = joinFilePath(base.directory, value);
    if (containingCandidates(bases, absolute).length === 0) {
      escaped ??= absolute;
      continue;
    }
    const found = await tryAbsolute(absolute);
    if (found) return { kind: "open", ...found };
  }

  const query = normalizeFilePath(value).replace(/^(?:\.\.\/)+/, "");
  const searchBase = bases.at(-1)!;
  if (query && query !== "." && query !== "..") {
    const results = await io.find(searchBase, query);
    check(signal);
    const insensitive = DRIVE_PATH.test(searchBase.directory);
    const fold = (text: string) => (insensitive ? text.toLowerCase() : text);
    const target = fold(query);
    const seen = new Set<string>();
    // Keep the server's spelling; compare case-insensitively on Windows drives.
    const matches = results
      .map((result) => normalizeFilePath(result))
      .filter((result) => {
        const folded = fold(result);
        if (seen.has(folded) || (folded !== target && !folded.endsWith(`/${target}`))) {
          return false;
        }
        seen.add(folded);
        return true;
      });
    if (matches.length > 1) {
      return { kind: "choose", location: searchBase, query, candidates: matches };
    }
    const match = matches[0];
    if (match) {
      const found = await tryAbsolute(joinFilePath(searchBase.directory, match));
      if (found) return { kind: "open", ...found };
    }
  }

  if (escaped && tried.size === 0) return { kind: "outside", absolutePath: escaped };
  return finish(firstTried ?? escaped);
}
