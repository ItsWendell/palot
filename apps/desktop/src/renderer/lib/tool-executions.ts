import type { JsonValue, PalotMessageContent } from "../../shared";
import { mediaRef } from "./media-refs";
import { pythonShellPresentation } from "./shell-script-presentation";
import { terminalOutput, type TerminalTextRun } from "./terminal-output";
import {
  createStreamingPatchDocument,
  streamingPatchInputFromJson,
  type StreamingPatchDocument,
} from "./streaming-patch-input";
import { cutTail, truncateEnd } from "../../shared/text-cut";
import { machinesInPaths } from "../../shared/machine-path";

export type ToolExecutionStatus = "pending" | "running" | "complete" | "error" | "interrupted";

/** The error OpenCode's shell tool reports when its command was cancelled (OpenCode `toolStopped`). */
const SHELL_COMMAND_CANCELLED = "Command cancelled";

/**
 * Whether a tool call was stopped rather than failed. OpenCode settles a tool that was stopped
 * mid-run (an interrupted turn or restart) as an error of type `aborted`, and its shell tool
 * reports a cancelled command as a plain error, "Command cancelled", with no structured type
 * (`unknown`), so that one matches on the exact message as OpenCode's own rule does. Either is the
 * user's or the runtime's stop, not a tool failure. A shell command its timeout or a kill ended
 * (see `shellStopReason`) is stopped too, whatever its exit code.
 */
export function toolStateInterrupted(state: unknown): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = state as { status?: unknown; error?: unknown; metadata?: unknown };
  if (
    (value.status === "completed" || value.status === "error") &&
    shellStopReason(value.metadata) !== null
  )
    return true;
  return toolStateCancelled(value);
}

/**
 * Why a shell command was stopped rather than ending on its own, from the result metadata
 * OpenCode writes (`ShellResult.metadata`): `timeout: true` when its timeout stopped it, `killed`
 * (`true`, or the reason as text) when it was killed, e.g. by the user or the process daemon.
 */
export function shellStopReason(metadata: unknown): "timeout" | "killed" | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const { timeout, killed } = metadata as { timeout?: unknown; killed?: unknown };
  if (timeout === true) return "timeout";
  if (killed === true || (typeof killed === "string" && killed !== "")) return "killed";
  return null;
}

function toolStateCancelled(value: { status?: unknown; error?: unknown }): boolean {
  if (value.status !== "error") return false;
  const error = value.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const { type, message } = error as { type?: unknown; message?: unknown };
  return type === "aborted" || message === SHELL_COMMAND_CANCELLED;
}

/** A call stopped before the model finished writing any of its input did nothing; it never shows. */
export function toolStoppedBeforeInput(state: unknown): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (!toolStateCancelled(state as { status?: unknown; error?: unknown })) return false;
  const input = (state as { input?: unknown }).input;
  if (input === undefined || input === null) return true;
  if (typeof input === "string") return input.trim() === "";
  return typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0;
}

export interface ToolFileDiff {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

interface ToolExecutionBase {
  id: string;
  name: string;
  status: ToolExecutionStatus;
  startedAt: number | null;
  error: string | null;
  rawInput: JsonValue | undefined;
  rawOutput: string | null;
  durationMs: number | null;
  images: ToolImage[];
}

export interface ToolImage {
  /** A `data:` URL, or a `media:<hash>` reference to bytes the server stores. */
  uri: string;
  mime: string;
  name: string | null;
}

export interface ReadExecution extends ToolExecutionBase {
  kind: "read";
  path: string;
  range: { start: number; end: number } | null;
  lines: Array<{ number: number; text: string }>;
  entries: string[];
  truncated: boolean;
}

export interface ListExecution extends ToolExecutionBase {
  kind: "list";
  path: string;
  entries: string[];
}

export interface SearchExecution extends ToolExecutionBase {
  kind: "search";
  engine: "grep" | "glob" | "ripgrep" | "ast-grep";
  query: string;
  scope: string | null;
  count: number | null;
  matches: Array<{ file: string; line: number | null; text: string }>;
  files: string[];
  truncated: boolean;
  command: string | null;
}

export interface WebSearchExecution extends ToolExecutionBase {
  kind: "web-search";
  query: string;
  provider: string | null;
  results: Array<{
    url: string;
    title: string;
    content: string | null;
    publishedAt: number | null;
  }>;
}

export interface WebFetchExecution extends ToolExecutionBase {
  kind: "web-fetch";
  url: string;
  format: "markdown" | "text" | "html";
  output: string | null;
}

export interface ShellExecution extends ToolExecutionBase {
  kind: "shell";
  command: string;
  scriptPresentation?: ReturnType<typeof pythonShellPresentation>;
  workdir: string | null;
  sourceOutput: string | null;
  output: string | null;
  terminal: TerminalTextRun[] | null;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
  /** Killed rather than ending on its own or by its timeout. */
  killed: boolean;
}

export interface FileChangeExecution extends ToolExecutionBase {
  kind: "file-change";
  operation: "edit" | "write" | "patch";
  path: string | null;
  content: string | null;
  files: ToolFileDiff[];
  targetFiles: string[];
  patchDocument: StreamingPatchDocument | null;
  inputStreaming: boolean;
}

export interface SkillExecution extends ToolExecutionBase {
  kind: "skill";
  skill: string;
  directory: string | null;
}

export interface SubagentExecution extends ToolExecutionBase {
  kind: "subagent";
  agent: string;
  description: string;
  prompt: string | null;
  sessionID: string | null;
  /** The call returned while the child runs on, so the parent does not wait for it. */
  background: boolean;
  /** The model asked for the background (`input.background`, OpenCode 2.2.7 and earlier). */
  requestedBackground: boolean;
  /**
   * The call returned at once with the child still running and no background flag: OpenCode's
   * always-background launch (after 2.2.7), or a 2.2.7 call the user moved to the background.
   */
  launchOnly: boolean;
}

export interface ExecuteExecution extends ToolExecutionBase {
  kind: "execute";
  code: string;
  calls: Array<{
    tool: string;
    title: string;
    status: "running" | "completed" | "error";
    args: string[];
    /** The call's input as the script passed it. */
    input: JsonValue | undefined;
  }>;
  output: string | null;
  runtimeError: boolean;
  /**
   * The script outlived OpenCode's foreground wait and went on as a background job
   * (`metadata.jobID`); a later Code Mode notice carries its result.
   */
  background: {
    jobID: string;
    /** How the job ended once its notice is in (`completed`, `failed`, …); null while it runs. */
    state: string | null;
  } | null;
}

export interface ImageGenerationExecution extends ToolExecutionBase {
  kind: "image-generation";
  operation: "generate" | "edit";
  referenceCount: number;
  /** The call only started a background job (OpenCode's `image_generate`); a later notice has the image. */
  background: boolean;
}

export interface GenericExecution extends ToolExecutionBase {
  kind: "generic";
  title: string;
  label: string | null;
  args: string[];
}

export type ToolExecutionView =
  | ReadExecution
  | ListExecution
  | SearchExecution
  | WebFetchExecution
  | WebSearchExecution
  | ShellExecution
  | FileChangeExecution
  | SkillExecution
  | SubagentExecution
  | ExecuteExecution
  | ImageGenerationExecution
  | GenericExecution;

const projectedToolExecutions = new WeakMap<object, Map<number, ToolExecutionView>>();
const inputPatchDocuments = new WeakMap<object, StreamingPatchDocument>();

type RecordValue = Record<string, JsonValue>;
const MAX_VISIBLE_TERMINAL_OUTPUT = 256_000;
const READ_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const GENERIC_LABEL_KEYS = [
  "description",
  "prompt",
  "query",
  "url",
  "filePath",
  "path",
  "pattern",
  "name",
  "id",
  "command",
  "title",
  "directory",
] as const;
const IMAGE_GENERATION_TOOL_NAMES = new Set([
  "create_image",
  "create_images",
  "edit_image",
  "edit_images",
  "generate_image",
  "generate_images",
  "experimental_image_generate",
  "image_gen",
  "image_generate",
  "image_generation",
  "image_generator",
  "image_to_image",
  "imagegen",
  "render_image",
  "render_images",
  "text_to_image",
]);
const IMAGE_REFERENCE_KEYS = [
  "image",
  "image_path",
  "image_paths",
  "images",
  "input_image",
  "input_image_path",
  "input_image_paths",
  "input_images",
  "reference_image",
  "reference_image_path",
  "reference_image_paths",
  "reference_images",
  "referenced_image_paths",
] as const;

function record(value: JsonValue | undefined): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function string(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: JsonValue | undefined): boolean {
  return value === true;
}

export function formatToolDetailValue(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function compactText(value: string, maximum = 96): string {
  return truncateEnd(value.replace(/\s+/g, " ").trim(), maximum);
}

function genericScalar(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return compactText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const strings = value.filter((item): item is string => typeof item === "string");
    if (strings.length === value.length) return compactText(strings.slice(0, 2).join(", "));
    return `${value.length} items`;
  }
  return null;
}

export function readableToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:/\\-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Tool";
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (["api", "http", "https", "id", "mcp", "sql", "url"].includes(lower)) {
        return lower.toUpperCase();
      }
      return index === 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : lower;
    })
    .join(" ");
}

/** Palot's own agent tools, called directly (`palot_x`) or through code mode (`palot.x`). */
function palotTool(name: string): string | null {
  const match = name.match(/^palot[._](\w+)$/);
  return match ? match[1]! : null;
}

const PALOT_TOOL_TITLES: Record<string, string> = {
  schedule_task: "Schedule task",
  list_automations: "List scheduled tasks",
  update_automation: "Change scheduled task",
  delete_automation: "Delete scheduled task",
  list_tasks: "List tasks",
  read_task: "Read task",
  wait_tasks: "Wait for tasks",
  settle_task: "Settle task",
  snooze_task: "Snooze task",
  pin_task: "Pin task",
  archive_task: "Archive task",
  link_pull_request: "Link pull request",
  watch_pull_request: "Watch pull request",
  unwatch_pull_request: "Stop watching pull request",
  create_pull_request: "Create pull request",
};

/** OpenCode's experimental artifact tools, called directly or through Code Mode. */
const ARTIFACT_TOOL_TITLES: Record<string, string> = {
  create: "Publish artifact",
  read: "Read artifact",
  update: "Update artifact",
  delete: "Delete artifact",
};

/** OpenCode's own session tools: `opencode.session.rename`/`.move` in Code Mode from 2.4.0. */
const SESSION_TOOL_TITLES: Record<string, string> = {
  rename: "Rename task",
  move: "Move task",
  interrupt: "Stop task",
};

function artifactToolTitle(name: string): string | null {
  const match = name.match(/^opencode[._]artifact_(create|read|update|delete)$/);
  if (match) return ARTIFACT_TOOL_TITLES[match[1]!]!;
  const session = name.match(/^(?:opencode[._])?session[._](rename|move|interrupt)$/);
  return session ? SESSION_TOOL_TITLES[session[1]!]! : null;
}

/** What a Palot tool call is doing, in the terms Palot's sidebar and Scheduled page use. */
function palotSummary(tool: string, input: RecordValue): { label: string | null; args: string[] } {
  const value = (key: string) => genericScalar(input[key]);
  if (
    [
      "link_pull_request",
      "watch_pull_request",
      "unwatch_pull_request",
      "create_pull_request",
    ].includes(tool)
  )
    return {
      label: value("title") ?? value("url") ?? "current branch",
      args: [
        ...(value("base") ? [`into ${value("base")}`] : []),
        ...(value("taskId") ? [value("taskId")!] : []),
      ],
    };
  if (tool === "schedule_task") {
    const repeats = value("rrule");
    return {
      label: value("name"),
      args: [
        ...(value("at") ? [`at ${value("at")!.replace("T", " ")}`] : []),
        ...(repeats ? [`repeats ${repeats}`] : []),
        ...(input.target === "new_task" ? ["as a new task"] : []),
      ],
    };
  }
  if (tool === "update_automation" || tool === "delete_automation") {
    const changes = ["name", "prompt", "at", "rrule", "timezone", "status"].filter(
      (key) => input[key] !== undefined,
    );
    return {
      label: value("name") ?? value("automationId"),
      args: tool === "update_automation" && changes.length ? [`changes ${changes.join(", ")}`] : [],
    };
  }
  if (
    tool === "settle_task" ||
    tool === "snooze_task" ||
    tool === "pin_task" ||
    tool === "archive_task"
  ) {
    // Each tool's title names the change; the label notes a reversal or the snooze time.
    const detail =
      tool === "settle_task" && input.settled === false
        ? "back to Inbox"
        : tool === "pin_task" && input.pinned === false
          ? "unpin"
          : tool === "archive_task" && input.archived === false
            ? "restore"
            : tool === "snooze_task" && value("until")
              ? `until ${value("until")!.replace("T", " ")}`
              : null;
    return { label: detail, args: value("taskId") ? [value("taskId")!] : [] };
  }
  if (tool === "wait_tasks") {
    const ids = Array.isArray(input.taskIds) ? input.taskIds.length : 0;
    return { label: ids ? `${ids} task${ids === 1 ? "" : "s"}` : null, args: [] };
  }
  if (tool === "list_tasks")
    return { label: value("search"), args: value("status") === "running" ? ["running"] : [] };
  if (tool === "read_task") return { label: value("taskId") ?? "this task", args: [] };
  return { label: null, args: [] };
}

function genericSummary(input: RecordValue) {
  const labelKey = GENERIC_LABEL_KEYS.find((key) => genericScalar(input[key]) !== null);
  const label = labelKey ? genericScalar(input[labelKey]) : null;
  const skipped = new Set<string>(labelKey ? [labelKey] : []);
  const args = Object.entries(input)
    .filter(([key]) => !skipped.has(key))
    .flatMap(([key, value]) => {
      const scalar = genericScalar(value);
      return scalar === null ? [] : [`${key}=${scalar}`];
    })
    .slice(0, 3);
  return { label, args };
}

function imageGenerationToolName(name: string): string {
  return (
    name
      .toLowerCase()
      .split(/[.:/\\]/)
      .at(-1)
      ?.replaceAll("-", "_") ?? ""
  );
}

function isImageGenerationTool(name: string): boolean {
  return IMAGE_GENERATION_TOOL_NAMES.has(imageGenerationToolName(name));
}

function imageReferenceCount(input: RecordValue): number {
  return IMAGE_REFERENCE_KEYS.reduce((count, key) => {
    const value = input[key];
    if (typeof value === "string") return count + (value.trim() ? 1 : 0);
    if (Array.isArray(value)) return count + value.filter((item) => item !== null).length;
    return count;
  }, 0);
}

function textContent(state: RecordValue): string[] {
  const content = state.content;
  if (Array.isArray(content)) {
    const text = content.flatMap((item) => {
      const value = record(item);
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    });
    if (text.length > 0) return text;
  }
  return typeof state.output === "string" ? [state.output] : [];
}

function imageContent(state: RecordValue): ToolImage[] {
  const content = state.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    const value = record(item);
    const uri = string(value.uri);
    const mime = string(value.mime)?.toLowerCase() ?? null;
    if (!uri || !mime || !READ_IMAGE_MIME_TYPES.has(mime)) return [];
    if (mediaRef(uri)) return [{ uri, mime, name: string(value.name) }];
    const prefix = `data:${mime};base64,`;
    if (uri.slice(0, prefix.length).toLowerCase() !== prefix) return [];
    return [{ uri, mime, name: string(value.name) }];
  });
}

function errorMessage(state: RecordValue): string | null {
  const error = record(state.error);
  return string(error.message) ?? string(state.error);
}

function status(state: RecordValue): ToolExecutionStatus {
  const value = state.status;
  if (toolStateInterrupted(state)) return "interrupted";
  if (value === "completed" || value === "complete") return "complete";
  if (value === "running" || value === "streaming") return "running";
  if (value === "error") return "error";
  return "pending";
}

function base(part: PalotMessageContent, index: number) {
  const state = record(part.state);
  const input = state.input;
  const output = textContent(state);
  return {
    state,
    input: record(input),
    metadata: record(state.metadata),
    output,
    value: {
      id: part.id ?? `tool-${index}`,
      name: part.name ?? string(state.name) ?? "tool",
      status: status(state),
      startedAt: part.time?.ran ?? part.time?.created ?? null,
      error: errorMessage(state),
      rawInput: input,
      rawOutput: output.length > 0 ? output.join("\n") : null,
      images: imageContent(state),
      durationMs:
        part.time?.completed !== undefined
          ? Math.max(0, part.time.completed - (part.time.ran ?? part.time.created))
          : null,
    } satisfies ToolExecutionBase,
  };
}

function normalizeStatus(value: JsonValue | undefined, type: JsonValue | undefined) {
  if (value === "added" || value === "deleted" || value === "modified") return value;
  if (type === "add") return "added";
  if (type === "delete") return "deleted";
  return "modified";
}

function normalizeFileDiff(value: JsonValue): ToolFileDiff | null {
  const data = record(value);
  const file =
    string(data.file) ?? string(data.relativePath) ?? string(data.filePath) ?? string(data.path);
  if (!file) return null;
  const patch = string(data.patch) ?? string(data.diff);
  const before = string(data.before);
  const after = string(data.after);
  if (!patch && before === null && after === null) return null;
  return {
    file,
    ...(patch ? { patch } : {}),
    ...(before !== null ? { before } : {}),
    ...(after !== null ? { after } : {}),
    additions: number(data.additions) ?? 0,
    deletions: number(data.deletions) ?? 0,
    status: normalizeStatus(data.status, data.type),
  };
}

export function normalizeToolFileDiffs(metadata: JsonValue | undefined): ToolFileDiff[] {
  const data = record(metadata);
  const files = Array.isArray(data.files) ? data.files : data.filediff ? [data.filediff] : [];
  return files.flatMap((file) => {
    const normalized = normalizeFileDiff(file);
    return normalized ? [normalized] : [];
  });
}

export function parsePatchTargetFiles(patch: string): string[] {
  return createStreamingPatchDocument(patch).targetFiles;
}

function inputFileTargets(input: RecordValue) {
  const direct = string(input.path) ?? string(input.filePath) ?? string(input.file);
  const structured = Array.isArray(input.files)
    ? input.files.flatMap((value) => {
        const file = record(value);
        const path = string(file.file) ?? string(file.path) ?? string(file.filePath);
        return path ? [path] : [];
      })
    : [];
  return [...(direct ? [direct] : []), ...structured];
}

function inputPatchDocument(state: RecordValue): StreamingPatchDocument | null {
  const stream = streamingPatchInputFromJson(state.inputStream)?.document;
  if (state.status === "streaming" && stream) return stream;
  const input = record(state.input);
  const text =
    string(input.patchText) ??
    string(input.patch) ??
    string(input.diff) ??
    (typeof state.input === "string" && state.input.trimStart().startsWith("*** Begin Patch")
      ? state.input
      : null);
  if (text === null) return stream ?? null;
  const key = state.input && typeof state.input === "object" ? state.input : state;
  const cached = inputPatchDocuments.get(key);
  if (cached) return cached;
  const document = stream?.text === text ? stream : createStreamingPatchDocument(text);
  inputPatchDocuments.set(key, document);
  return document;
}

function parseGrepOutput(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "No matches found" && !/^Found \d+ matches$/.test(lines[0] ?? "")) return [];
  const matches: Array<{ file: string; line: number | null; text: string }> = [];
  let file = "";
  for (const line of lines.slice(1)) {
    if (line && !line.startsWith(" ") && line.endsWith(":")) {
      file = line.slice(0, -1);
      continue;
    }
    const match = line.match(/^  Line (\d+): (.*)$/);
    if (file && match) matches.push({ file, line: Number(match[1]), text: match[2] ?? "" });
  }
  return matches;
}

function parseGlobOutput(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        Boolean(line) && line !== "No files found" && !line.startsWith("(Results are truncated:"),
    );
}

function webSearchResult(value: JsonValue): WebSearchExecution["results"][number] | null {
  const data = record(value);
  const url = string(data.url);
  if (!url || !/^https?:\/\//.test(url)) return null;
  const published = record(data.time).published ?? data.publishedAt ?? data.published;
  const publishedAt =
    typeof published === "number" && Number.isFinite(published)
      ? published
      : typeof published === "string" && Number.isFinite(Date.parse(published))
        ? Date.parse(published)
        : null;
  return {
    url,
    title: string(data.title) ?? url,
    content: string(data.content) ?? string(data.snippet) ?? string(data.description),
    publishedAt,
  };
}

function structuredWebSearchResults(value: JsonValue | undefined): WebSearchExecution["results"] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const result = webSearchResult(item);
      return result ? [result] : structuredWebSearchResults(item);
    });
  }
  const data = record(value);
  for (const key of ["results", "sources", "content"]) {
    if (data[key] === undefined) continue;
    const results = structuredWebSearchResults(data[key]);
    if (results.length > 0) return results;
  }
  const result = webSearchResult(value ?? null);
  return result ? [result] : [];
}

function parseWebSearchOutput(value: string): WebSearchExecution["results"] {
  const results: WebSearchExecution["results"] = [];
  let current: WebSearchExecution["results"][number] | null = null;
  const finish = () => {
    if (!current) return;
    current.content = current.content?.trim() || null;
    results.push(current);
    current = null;
  };
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^## \[(.+)]\((https?:\/\/[^)]+)\)$/);
    if (heading) {
      finish();
      current = { url: heading[2]!, title: heading[1]!, content: null, publishedAt: null };
      continue;
    }
    if (!current) continue;
    const published = line.match(/^Published: (.+)$/);
    if (published) {
      const timestamp = Date.parse(published[1]!);
      current.publishedAt = Number.isFinite(timestamp) ? timestamp : null;
      continue;
    }
    if (line || current.content) current.content = `${current.content ?? ""}${line}\n`;
  }
  finish();
  return results;
}

function parseReadOutput(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const file = lines[0]?.match(/^Read file (.+), lines (\d+)-(\d+)$/);
  if (file) {
    return {
      range: { start: Number(file[2]), end: Number(file[3]) },
      lines: lines.slice(1).flatMap((line) => {
        const match = line.match(/^(\d+): ?(.*)$/);
        return match ? [{ number: Number(match[1]), text: match[2] ?? "" }] : [];
      }),
      entries: [],
    };
  }
  const directory = lines[0]?.match(/^Read directory .+, entries \d+-\d+$/);
  return {
    range: null,
    lines: [],
    entries: directory
      ? lines.slice(1).filter((line) => line && !line.startsWith("[Output truncated."))
      : [],
  };
}

function tokenize(command: string): string[] | null {
  if (/[|;&`\n]|\$\(|\$\{/.test(command)) return null;
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      if (character === quote) quote = null;
      else if (character === "\\" && quote === '"' && command[index + 1])
        current += command[++index];
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    if (character === "\\" && command[index + 1]) current += command[++index];
    else current += character;
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

export type ShellCommandClassification =
  | { kind: "shell" }
  | {
      kind: "search";
      engine: "ripgrep" | "ast-grep";
      query: string;
      scope: string | null;
    };

function executable(value: string): string {
  return value.replaceAll("\\", "/").split("/").at(-1) ?? value;
}

export function classifyShellCommand(command: string): ShellCommandClassification {
  const tokens = tokenize(command);
  if (!tokens || tokens.length === 0) return { kind: "shell" };
  let offset = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[offset] ?? "")) offset += 1;
  if (tokens[offset] === "command") offset += 1;
  let name = executable(tokens[offset] ?? "");
  if ((name === "bun" || name === "npx") && tokens[offset + 1] === "x") {
    offset += 2;
    name = executable(tokens[offset] ?? "");
  }
  if (name === "rg" || name === "ripgrep") {
    const args = tokens.slice(offset + 1);
    const consumed = new Set<number>();
    const optionsWithValues = new Set([
      "-g",
      "--glob",
      "-t",
      "--type",
      "-T",
      "--type-not",
      "-A",
      "--after-context",
      "-B",
      "--before-context",
      "-C",
      "--context",
      "-m",
      "--max-count",
      "--max-depth",
      "--sort",
      "--sortr",
    ]);
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index] ?? "";
      if (!argument.startsWith("-")) continue;
      consumed.add(index);
      if (optionsWithValues.has(argument) && args[index + 1] !== undefined) consumed.add(index + 1);
    }
    const values = args.filter((arg, index) => !consumed.has(index) && !arg.startsWith("-"));
    const query = values[0];
    if (!query) return { kind: "shell" };
    return { kind: "search", engine: "ripgrep", query, scope: values[1] ?? null };
  }
  if (name === "ast-grep" || name === "sg") {
    const args = tokens.slice(offset + 1);
    const patternIndex = args.findIndex((arg) => arg === "-p" || arg === "--pattern");
    const query = patternIndex >= 0 ? args[patternIndex + 1] : null;
    if (!query) return { kind: "shell" };
    const consumed = new Set([patternIndex, patternIndex + 1]);
    const optionValues = new Set(["-l", "--lang", "--color"]);
    for (let index = 0; index < args.length; index += 1) {
      if (optionValues.has(args[index] ?? "")) {
        consumed.add(index);
        consumed.add(index + 1);
      }
    }
    const scope = args.find((arg, index) => !consumed.has(index) && !arg.startsWith("-")) ?? null;
    return { kind: "search", engine: "ast-grep", query, scope };
  }
  return { kind: "shell" };
}

function parseShellSearchOutput(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^(.+?):(\d+)(?::\d+)?: ?(.*)$/);
      return match ? [{ file: match[1]!, line: Number(match[2]), text: match[3] ?? "" }] : [];
    });
}

function lazyTerminalOutput(value: string | null) {
  let cached: ReturnType<typeof terminalOutput> | undefined;
  return () => (cached ??= terminalOutput(value));
}

function visibleShellOutput(state: RecordValue, metadata: RecordValue): string | null {
  const final = textContent(state)[0] ?? string(state.output);
  if (final !== null) return final;
  const value = string(metadata.output);
  if (value === null || value.length <= MAX_VISIBLE_TERMINAL_OUTPUT) return value;
  return `[Earlier output truncated]\n${cutTail(value, MAX_VISIBLE_TERMINAL_OUTPUT)}`;
}

function executeCalls(value: JsonValue | undefined): ExecuteExecution["calls"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const call = record(item);
    const tool = string(call.tool) ?? string(call.name);
    if (!tool || !["running", "completed", "error"].includes(string(call.status) ?? "")) return [];
    const palot = palotTool(tool);
    const summary = palot
      ? palotSummary(palot, record(call.input))
      : genericSummary(record(call.input));
    return [
      {
        tool,
        title: palot
          ? (PALOT_TOOL_TITLES[palot] ?? readableToolName(palot))
          : (artifactToolTitle(tool) ?? readableToolName(tool)),
        status: call.status as ExecuteExecution["calls"][number]["status"],
        args: [...(summary.label ? [summary.label] : []), ...summary.args],
        input: call.input,
      },
    ];
  });
}

/** Code Mode's own catalog lookup (`search(…)`) finds tools; it is not work on the project. */
const EXECUTE_INTERNAL_CALLS = new Set(["search"]);
/** Artifact calls render as artifact cards from the script's own row, matched to its result. */
const EXECUTE_ARTIFACT_CALL = /^opencode[._]artifact_(create|read|update|delete)$/;
const nestedExecuteParts = new WeakMap<object, Map<number, PalotMessageContent[]>>();
const scriptCallOrigins = new WeakMap<object, ScriptCallOrigin>();

/** The Code Mode script a flattened call came from. */
export interface ScriptCallOrigin {
  /** The script's tool part, holding its source and result. */
  script: PalotMessageContent;
  index: number;
  /** Where the call sits among the script's calls. */
  position: number;
}

/** The script a call part came from, when it is one of a Code Mode script's flattened calls. */
export function scriptCallOrigin(part: PalotMessageContent): ScriptCallOrigin | null {
  return scriptCallOrigins.get(part as object) ?? null;
}

/**
 * The calls a Code Mode script made, as tool parts of their own, so they render, group and count
 * like the same calls made directly (shell command, read, edit, search). OpenCode records only
 * each call's tool, status and input, so the parts carry no output, exit code or diff; a read's
 * image comes from the script's result, where OpenCode attaches it. A script whose only call is
 * to a tool without a view of its own keeps that call's row, with the script's output. Empty when
 * the script made no call Palot recognises otherwise (pure computation, or several such calls);
 * such a script stays one row.
 */
export function executeNestedParts(
  part: PalotMessageContent,
  index: number,
): PalotMessageContent[] {
  const execution = projectToolExecution(part, index);
  if (execution.kind !== "execute" || execution.name.toLowerCase() !== "execute") return [];
  const key = part as object;
  let byIndex = nestedExecuteParts.get(key);
  if (!byIndex) {
    byIndex = new Map();
    nestedExecuteParts.set(key, byIndex);
  }
  const cached = byIndex.get(index);
  if (cached) return cached;
  const state = record(part.state);
  const files = Array.isArray(state.content)
    ? state.content.map(record).filter((item) => item.type === "file")
    : [];
  const settled = nestedCallSettlement(execution);
  const changes = scriptFileChanges(state.metadata);
  const claimed = new Set<number>();
  const parts = execution.calls.flatMap((call, position): PalotMessageContent[] => {
    if (EXECUTE_INTERNAL_CALLS.has(call.tool) || EXECUTE_ARTIFACT_CALL.test(call.tool)) return [];
    const input = record(call.input);
    const status = call.status === "running" && settled ? settled : call.status;
    const path = call.tool === "read" ? string(input.path) : null;
    const image = path ? files.find((file) => string(file.name) === baseName(path)) : undefined;
    const changed = FILE_CHANGE_TOOLS.has(call.tool.toLowerCase())
      ? claimFileChanges(changes, claimed, fileChangeTargets(input))
      : [];
    const nested: PalotMessageContent = {
      type: "tool",
      id: `${execution.id}:call-${position}`,
      name: call.tool,
      state: {
        status: status === "interrupted" ? "error" : status,
        input: call.input ?? {},
        ...(image ? { content: [image] } : {}),
        ...(changed.length > 0 ? { metadata: { files: changed } } : {}),
        // The stopped rule (`toolStateInterrupted`) reads an aborted error as a stop.
        ...(status === "interrupted"
          ? { error: { type: "aborted", message: "The script stopped" } }
          : {}),
      },
    };
    scriptCallOrigins.set(nested as object, { script: part, index, position });
    return [nested];
  });
  // Changes no call of the script claims, such as `Bun.write`, show as file-change rows of their
  // own after its calls.
  changes.forEach((change, order) => {
    if (claimed.has(order)) return;
    const nested: PalotMessageContent = {
      type: "tool",
      id: `${execution.id}:file-${order}`,
      name: "patch",
      state: {
        // The change is made by the time OpenCode lists it.
        status: "completed",
        input: { path: string(change.file) ?? "" },
        metadata: { files: [change] },
      },
    };
    scriptCallOrigins.set(nested as object, {
      script: part,
      index,
      position: execution.calls.length + order,
    });
    parts.push(nested);
  });
  const recognised = parts.some((nested) => projectToolExecution(nested, index).kind !== "generic");
  // One call to a tool without a view of its own (OpenCode 2.4 stores a direct call as a
  // one-call script, #65193): the call keeps its row, with the script's output as its result.
  let result = recognised ? parts : [];
  const single = !recognised && parts.length === 1 ? parts[0]! : null;
  if (single) {
    const kept: PalotMessageContent = execution.output
      ? {
          ...single,
          state: { ...record(single.state), content: [{ type: "text", text: execution.output }] },
        }
      : single;
    scriptCallOrigins.set(kept as object, scriptCallOrigin(single)!);
    result = [kept];
  }
  byIndex.set(index, result);
  return result;
}

const FILE_CHANGE_TOOLS = new Set(["edit", "write", "patch", "apply_patch"]);

/**
 * The files a Code Mode script changed, in order (OpenCode 2.4.0, #65002/#65247). Read from the
 * call's own metadata only: its `structured.files` are the script's attachments. Each entry is
 * `{ file, status, additions?, deletions?, patch? }`; past 50 files or 200 KB of patch text an
 * entry keeps only its counts, and the turn diff stands in for it.
 */
function scriptFileChanges(metadata: JsonValue | undefined): RecordValue[] {
  const files = record(metadata).files;
  if (!Array.isArray(files)) return [];
  return files.map(record).filter((file) => string(file.file) !== null);
}

function fileChangeTargets(input: RecordValue): string[] {
  const patch = string(input.patchText) ?? string(input.patch);
  return [...inputFileTargets(input), ...(patch ? parsePatchTargetFiles(patch) : [])];
}

/** The script's changes to `targets` that no earlier call claimed, one per target file. */
function claimFileChanges(
  changes: readonly RecordValue[],
  claimed: Set<number>,
  targets: readonly string[],
): RecordValue[] {
  return targets.flatMap((target) => {
    const found = changes.findIndex(
      (change, order) => !claimed.has(order) && sameFilePath(string(change.file)!, target),
    );
    if (found < 0) return [];
    claimed.add(found);
    return [changes[found]!];
  });
}

/** Whether two paths name one file: a call can name it relative or absolute. */
export function sameFilePath(left: string, right: string): boolean {
  const a = normalizedFilePath(left);
  const b = normalizedFilePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizedFilePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * What a call still marked running became once its script ended: OpenCode stops reporting a
 * script's calls when it ends or moves to the background. Null while the script, in the
 * foreground or the background, still runs.
 */
function nestedCallSettlement(execution: ExecuteExecution): "completed" | "interrupted" | null {
  if (execution.background) {
    const state = execution.background.state;
    if (state === null) return null;
    return state === "cancelled" || state === "interrupted" ? "interrupted" : "completed";
  }
  if (execution.status === "running" || execution.status === "pending") return null;
  // A script that ended with a call in flight abandoned it.
  return execution.status === "complete" && !execution.runtimeError ? "completed" : "interrupted";
}

/**
 * A failed script whose calls already show where it failed: its own failed row says how the
 * script ended, but counts as no further failure.
 */
export function executeFailureShownByCalls(part: PalotMessageContent, index: number): boolean {
  const execution = projectToolExecution(part, index);
  if (execution.kind !== "execute") return false;
  return executeNestedParts(part, index).some(
    (call) => projectToolExecution(call, index).status === "error",
  );
}

/**
 * Whether a script whose calls show as rows keeps a row of its own: to say it failed, stopped or
 * went to the background, or to hold its artifact cards. A script that ran to the end stays out
 * of view; its calls' rows offer its source and result.
 */
export function executeKeepsOwnRow(part: PalotMessageContent, index: number): boolean {
  const execution = projectToolExecution(part, index);
  if (execution.kind !== "execute") return true;
  if (executeNestedParts(part, index).length === 0) return true;
  return (
    execution.status === "error" ||
    execution.status === "interrupted" ||
    execution.runtimeError ||
    execution.background !== null ||
    execution.calls.some((call) => EXECUTE_ARTIFACT_CALL.test(call.tool))
  );
}

/**
 * How a subagent call relates to its child. OpenCode 2.2.7 runs a call in the foreground unless
 * `input.background` is set; later releases drop the flag and every call returns at once with
 * `metadata.status: "running"`.
 */
function subagentReturn(
  input: RecordValue,
  metadata: RecordValue,
  status: ToolExecutionStatus,
): Pick<SubagentExecution, "background" | "requestedBackground" | "launchOnly"> {
  const requestedBackground = boolean(metadata.background) || boolean(input.background);
  const returnedRunning = status === "complete" && string(metadata.status) === "running";
  return {
    background: requestedBackground || returnedRunning,
    requestedBackground,
    launchOnly: returnedRunning && !requestedBackground && !("background" in input),
  };
}

/**
 * The OpenCode machines a call worked on: a `devbox:/…` path in its input (read, write, edit,
 * search scope), a shell `workdir` there, or patch targets on one. Empty for this server's files.
 */
export function toolExecutionMachines(view: ToolExecutionView): string[] {
  const input = record(view.rawInput);
  return machinesInPaths([
    string(input.workdir),
    string(input.path),
    string(input.filePath),
    ...(view.kind === "file-change" ? view.targetFiles : []),
  ]);
}

export function projectToolExecution(part: PalotMessageContent, index: number): ToolExecutionView {
  const key = part as object;
  let byIndex = projectedToolExecutions.get(key);
  if (!byIndex) {
    byIndex = new Map();
    projectedToolExecutions.set(key, byIndex);
  }
  const cached = byIndex.get(index);
  if (cached) return cached;
  const projected = projectToolExecutionUncached(part, index);
  byIndex.set(index, projected);
  return projected;
}

function projectToolExecutionUncached(part: PalotMessageContent, index: number): ToolExecutionView {
  const value = base(part, index);
  const name = value.value.name.toLowerCase();
  const visibleOutput = value.output[0] ?? null;
  if (name === "read") {
    const parsed = parseReadOutput(visibleOutput ?? "");
    return {
      ...value.value,
      kind: "read",
      path: string(value.input.path) ?? string(value.input.filePath) ?? "Unknown path",
      range: parsed.range,
      lines: parsed.lines,
      entries: parsed.entries,
      truncated: boolean(value.metadata.truncated),
    };
  }
  if (name === "list") {
    return {
      ...value.value,
      kind: "list",
      path: string(value.input.path) ?? "/",
      entries: parseGlobOutput(visibleOutput ?? ""),
    };
  }
  if (name === "grep" || name === "glob") {
    const isGrep = name === "grep";
    return {
      ...value.value,
      kind: "search",
      engine: isGrep ? "grep" : "glob",
      query: string(value.input.pattern) ?? "",
      scope: string(value.input.path),
      count: number(isGrep ? value.metadata.matches : value.metadata.count),
      matches: isGrep ? parseGrepOutput(visibleOutput ?? "") : [],
      files: isGrep ? [] : parseGlobOutput(visibleOutput ?? ""),
      truncated: boolean(value.metadata.truncated),
      command: null,
    };
  }
  if (name === "websearch" || name === "web_search" || name === "web_search_preview") {
    const structured = [value.state.structured, part.native]
      .flatMap(structuredWebSearchResults)
      .filter(
        (result, index, results) => results.findIndex((item) => item.url === result.url) === index,
      );
    const parsed = parseWebSearchOutput(visibleOutput ?? "");
    return {
      ...value.value,
      rawOutput: visibleOutput,
      kind: "web-search",
      query:
        string(value.input.query) ??
        string(value.input.search_query) ??
        string(record(value.input.action).query) ??
        "",
      provider: string(value.metadata.provider),
      results: structured.length > 0 ? structured : parsed,
    };
  }
  if (name === "webfetch") {
    const format = value.input.format;
    return {
      ...value.value,
      kind: "web-fetch",
      url: string(value.input.url) ?? "Unknown URL",
      format: format === "text" || format === "html" ? format : "markdown",
      output: visibleOutput,
    };
  }
  if (name === "shell" || name === "local_shell") {
    const command = string(value.input.command) ?? "";
    const rawOutput = visibleShellOutput(value.state, value.metadata);
    const classification = classifyShellCommand(command);
    if (classification.kind === "search" && !boolean(value.metadata.standalone)) {
      const output = terminalOutput(rawOutput);
      const matches = parseShellSearchOutput(output.output ?? "");
      return {
        ...value.value,
        rawOutput: output.output,
        kind: "search",
        engine: classification.engine,
        query: classification.query,
        scope: classification.scope,
        count: matches.length || null,
        matches,
        files: [...new Set(matches.map((match) => match.file))],
        truncated: boolean(value.metadata.truncated),
        command,
      };
    }
    const output = lazyTerminalOutput(rawOutput);
    const exitCode = number(value.metadata.exit);
    return {
      ...value.value,
      // OpenCode completes the shell tool whatever the command's exit code; a non-zero exit
      // is a failed command for the reader (and for failure counts).
      status:
        value.value.status === "complete" && exitCode !== null && exitCode !== 0
          ? "error"
          : value.value.status,
      kind: "shell",
      command,
      scriptPresentation: pythonShellPresentation(command),
      workdir: string(value.input.workdir),
      sourceOutput: rawOutput,
      get rawOutput() {
        return output().output;
      },
      get output() {
        return output().output;
      },
      get terminal() {
        return output().terminal;
      },
      exitCode,
      truncated: boolean(value.metadata.truncated),
      timedOut: shellStopReason(value.metadata) === "timeout",
      killed: shellStopReason(value.metadata) === "killed",
    };
  }
  if (name === "edit" || name === "write" || name === "patch" || name === "apply_patch") {
    const operation = name === "apply_patch" ? "patch" : name;
    const files = normalizeToolFileDiffs(value.state.metadata);
    const patchDocument = operation === "patch" ? inputPatchDocument(value.state) : null;
    const targetFiles = [
      ...files.map((file) => file.file),
      ...inputFileTargets(value.input),
      ...(patchDocument?.targetFiles ?? []),
    ].filter((file, index, values) => values.indexOf(file) === index);
    return {
      ...value.value,
      kind: "file-change",
      operation,
      path: string(value.input.path) ?? string(value.input.filePath),
      content: string(value.input.content),
      files,
      targetFiles,
      patchDocument,
      inputStreaming: value.state.status === "streaming",
    };
  }
  if (name === "skill") {
    const structured = record(value.state.structured);
    return {
      ...value.value,
      kind: "skill",
      skill:
        string(structured.name) ??
        string(value.metadata.name) ??
        string(value.input.id) ??
        string(value.input.name) ??
        "skill",
      directory:
        string(structured.directory) ??
        string(value.metadata.directory) ??
        string(value.metadata.dir),
    };
  }
  if (name === "task" || name === "subagent") {
    return {
      ...value.value,
      kind: "subagent",
      agent:
        string(value.input.subagent_type) ??
        string(value.input.agent) ??
        string(value.input.type) ??
        "general",
      description: string(value.input.description) ?? string(value.state.title) ?? "Delegated task",
      prompt: string(value.input.prompt),
      sessionID:
        string(value.metadata.sessionId) ??
        string(value.metadata.sessionID) ??
        string(value.metadata.task_id) ??
        string(value.input.task_id) ??
        // A continued subagent names its session only in the input until the call finishes. A failed
        // continuation can name an unrelated session, such as the parent, so it gets no link.
        (value.value.status === "error" ? null : string(value.input.sessionID)),
      ...subagentReturn(value.input, value.metadata, value.value.status),
    };
  }
  if (isImageGenerationTool(name)) {
    const toolName = imageGenerationToolName(name);
    const referenceCount = imageReferenceCount(value.input);
    return {
      ...value.value,
      kind: "image-generation",
      operation:
        referenceCount > 0 ||
        value.input.mask !== undefined ||
        value.input.mask_path !== undefined ||
        toolName.includes("edit") ||
        toolName === "image_to_image"
          ? "edit"
          : "generate",
      referenceCount,
      background:
        value.value.status === "complete" &&
        value.value.images.length === 0 &&
        string(value.metadata.jobID) !== null,
    };
  }
  const code = string(value.input.code);
  if (name === "execute" || code !== null) {
    const metadata = { ...record(value.state.structured), ...value.metadata };
    const jobID = string(metadata.jobID);
    return {
      ...value.value,
      kind: "execute",
      code: code ?? "",
      calls: executeCalls(metadata.toolCalls),
      output: visibleOutput,
      runtimeError: boolean(metadata.error),
      background: jobID ? { jobID, state: string(metadata.backgroundState) } : null,
    };
  }
  const palot = palotTool(name);
  const summary = palot ? palotSummary(palot, value.input) : genericSummary(value.input);
  return {
    ...value.value,
    kind: "generic",
    title: palot
      ? (PALOT_TOOL_TITLES[palot] ?? readableToolName(palot))
      : (artifactToolTitle(value.value.name) ?? readableToolName(value.value.name)),
    label: summary.label,
    args: summary.args,
  };
}
