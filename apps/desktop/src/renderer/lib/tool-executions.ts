import type { JsonValue, PalotMessageContent } from "../../shared";
import { pythonShellPresentation } from "./shell-script-presentation";
import { terminalOutput, type TerminalTextRun } from "./terminal-output";
import {
  createStreamingPatchDocument,
  streamingPatchInputFromJson,
  type StreamingPatchDocument,
} from "./streaming-patch-input";

export type ToolExecutionStatus = "pending" | "running" | "complete" | "error";

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
  background: boolean;
}

export interface ExecuteExecution extends ToolExecutionBase {
  kind: "execute";
  code: string;
  calls: Array<{
    tool: string;
    title: string;
    status: "running" | "completed" | "error";
    args: string[];
  }>;
  output: string | null;
  runtimeError: boolean;
}

export interface ImageGenerationExecution extends ToolExecutionBase {
  kind: "image-generation";
  operation: "generate" | "edit";
  referenceCount: number;
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
  "query",
  "url",
  "filePath",
  "path",
  "pattern",
  "name",
  "id",
  "command",
] as const;
const IMAGE_GENERATION_TOOL_NAMES = new Set([
  "create_image",
  "create_images",
  "edit_image",
  "edit_images",
  "generate_image",
  "generate_images",
  "image_gen",
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
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1)}…`;
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
    const prefix = `data:${mime};base64,`;
    if (uri.slice(0, prefix.length).toLowerCase() !== prefix) return [];
    return [{ uri, mime, name: string(value.name) }];
  });
}

function errorMessage(state: RecordValue): string | null {
  const error = record(state.error);
  return string(error.message) ?? string(state.error);
}

function status(value: JsonValue | undefined): ToolExecutionStatus {
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
      status: status(state.status),
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
  return `[Earlier output truncated]\n${value.slice(-MAX_VISIBLE_TERMINAL_OUTPUT)}`;
}

function executeCalls(value: JsonValue | undefined): ExecuteExecution["calls"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const call = record(item);
    const tool = string(call.tool) ?? string(call.name);
    if (!tool || !["running", "completed", "error"].includes(string(call.status) ?? "")) return [];
    const summary = genericSummary(record(call.input));
    return [
      {
        tool,
        title: readableToolName(tool),
        status: call.status as ExecuteExecution["calls"][number]["status"],
        args: [...(summary.label ? [summary.label] : []), ...summary.args],
      },
    ];
  });
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
    const structured = [value.state.structured, part.providerResultState, part.providerState]
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
    return {
      ...value.value,
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
      exitCode: number(value.metadata.exit),
      truncated: boolean(value.metadata.truncated),
      timedOut: boolean(value.metadata.timeout),
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
        string(value.input.task_id),
      background:
        boolean(value.metadata.background) ||
        boolean(value.input.background) ||
        (value.value.status === "complete" && string(value.metadata.status) === "running"),
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
    };
  }
  const code = string(value.input.code);
  if (name === "execute" || code !== null) {
    const metadata = { ...record(value.state.structured), ...value.metadata };
    return {
      ...value.value,
      kind: "execute",
      code: code ?? "",
      calls: executeCalls(metadata.toolCalls),
      output: visibleOutput,
      runtimeError: boolean(metadata.error),
    };
  }
  const summary = genericSummary(value.input);
  return {
    ...value.value,
    kind: "generic",
    title: readableToolName(value.value.name),
    label: summary.label,
    args: summary.args,
  };
}
