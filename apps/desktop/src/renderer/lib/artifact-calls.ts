/**
 * OpenCode's experimental artifact tools (2.2.4+, `experimental.artifacts`). With Code Mode on,
 * the agent calls `tools.opencode.artifact_*` inside `execute`; otherwise the direct tools are
 * `opencode_artifact_*`. OpenCode stores neither call's structured result on the tool part, so
 * this reads the artifact from what the part keeps: the call's input, the direct tools' fixed
 * summary line, or the JSON a Code Mode program returned. The project's artifact list supplies
 * the current title, URL, and update time when it is available.
 */
import type { ArtifactInfo } from "@opencode/client";
import type { JsonValue, PalotMessageContent } from "../../shared";

export type ArtifactOperation = "create" | "read" | "update" | "delete";

export interface ArtifactCall {
  /** Stable within its tool part. */
  key: string;
  operation: ArtifactOperation;
  status: "running" | "complete" | "error";
  id: string | null;
  title: string | null;
  url: string | null;
  entry: string | null;
  provider: string | null;
  updatedAt: number | null;
  error: string | null;
  /** When the tool part finished; the project list must be at least this new. */
  settledAt: number | null;
}

export interface ArtifactToolProjection {
  calls: ArtifactCall[];
  /** Every call in the part is an artifact call, so its generic tool row adds nothing. */
  only: boolean;
}

type RecordValue = Record<string, JsonValue>;
type Found = Pick<ArtifactCall, "id" | "title" | "url" | "entry" | "provider" | "updatedAt">;

const TOOL = /^opencode[._]artifact_(create|read|update|delete)$/;
const ID = /^art_[0-9A-Za-z]{1,64}$/;
const MAX_PARSED_OUTPUT = 512_000;
const MAX_VISITED = 256;
const projections = new WeakMap<object, Map<number, ArtifactToolProjection | null>>();

function record(value: JsonValue | undefined): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function string(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function artifactID(value: JsonValue | undefined): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function operation(name: string | null): ArtifactOperation | null {
  const match = name ? TOOL.exec(name) : null;
  return match ? (match[1] as ArtifactOperation) : null;
}

function text(state: RecordValue): string | null {
  const content = Array.isArray(state.content) ? state.content : [];
  for (const item of content) {
    const part = record(item);
    if (part.type === "text" && typeof part.text === "string") return part.text;
  }
  return string(state.output);
}

/** The entry OpenCode chooses when the call names none: index.html, index.md, or the only file. */
function inputEntry(input: RecordValue): string | null {
  const entry = string(input.entry)?.trim();
  if (entry) return entry.replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  const files = Object.keys(record(input.files));
  if (files.includes("index.html")) return "index.html";
  if (files.includes("index.md")) return "index.md";
  return files.length === 1 ? files[0]! : null;
}

function info(value: RecordValue): Found | null {
  const id = artifactID(value.id);
  const title = string(value.title);
  const url = string(value.url);
  if (!id || title === null || url === null) return null;
  const updated = record(value.time).updated;
  return {
    id,
    title,
    url,
    entry: string(value.entry),
    provider: string(value.provider),
    updatedAt: typeof updated === "number" && Number.isFinite(updated) ? updated : null,
  };
}

/** Artifact records anywhere in a returned value, such as `{ info, files }` or an array. */
function returnedArtifacts(output: string | null): Found[] {
  if (!output || output.length > MAX_PARSED_OUTPUT) return [];
  let value: JsonValue;
  try {
    value = JSON.parse(output) as JsonValue;
  } catch {
    return [];
  }
  const found = new Map<string, Found>();
  const pending: Array<{ value: JsonValue; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_VISITED) {
    const next = pending.shift()!;
    visited++;
    if (!next.value || typeof next.value !== "object" || next.depth > 4) continue;
    const items = Array.isArray(next.value) ? next.value : Object.values(next.value);
    if (!Array.isArray(next.value)) {
      const artifact = info(next.value as RecordValue);
      if (artifact?.id && !found.has(artifact.id)) found.set(artifact.id, artifact);
      if (artifact) continue;
    }
    for (const item of items) pending.push({ value: item, depth: next.depth + 1 });
  }
  return [...found.values()];
}

/** The fixed summary lines of the direct tools; Code Mode returns the structured value instead. */
function summary(op: ArtifactOperation, output: string | null): Partial<Found> {
  const line = output?.trim() ?? "";
  if (op === "create") {
    const match = /^Published ([\s\S]*) \((art_[0-9A-Za-z]+) via ([^)]+)\): (\S+)$/.exec(line);
    return match ? { title: match[1], id: match[2], provider: match[3], url: match[4] } : {};
  }
  if (op === "update") {
    const match = /^Updated ([\s\S]*) \((art_[0-9A-Za-z]+)\): (\S+)$/.exec(line);
    return match ? { title: match[1], id: match[2], url: match[3] } : {};
  }
  if (op === "read") {
    const match = /^([\s\S]*) \((art_[0-9A-Za-z]+) · \d+ files?\)$/.exec(line);
    return match ? { title: match[1], id: match[2] } : {};
  }
  const match = /^Deleted (art_[0-9A-Za-z]+)$/.exec(line);
  return match ? { id: match[1] } : {};
}

function call(
  key: string,
  op: ArtifactOperation,
  status: ArtifactCall["status"],
  input: RecordValue,
  found: Partial<Found>,
  error: string | null,
): ArtifactCall {
  return {
    key,
    operation: op,
    status,
    id: found.id ?? artifactID(input.id),
    title: found.title ?? (string(input.title)?.trim() || null),
    url: found.url ?? null,
    entry: found.entry ?? (op === "create" || op === "update" ? inputEntry(input) : null),
    provider: found.provider ?? (op === "create" ? string(input.provider) : null),
    updatedAt: found.updatedAt ?? null,
    error,
    settledAt: null,
  };
}

function partStatus(value: JsonValue | undefined): ArtifactCall["status"] {
  if (value === "completed") return "complete";
  if (value === "error") return "error";
  return "running";
}

function project(part: PalotMessageContent, index: number): ArtifactToolProjection | null {
  if (part.type !== "tool") return null;
  const state = record(part.state);
  const name = part.name ?? string(state.name);
  const status = partStatus(state.status);
  const input = record(state.input);
  const output = text(state);
  const failure = string(record(state.error).message) ?? string(state.error);
  const direct = operation(name);
  const key = part.id ?? `tool-${index}`;
  if (direct) {
    const structured =
      info(record(state.structured)) ?? info(record(record(state.structured).info));
    const found = structured ?? (status === "complete" ? summary(direct, output) : {});
    return {
      calls: [call(key, direct, status, input, found, status === "error" ? failure : null)],
      only: true,
    };
  }
  if (name !== "execute" && typeof input.code !== "string") return null;
  const metadata = { ...record(state.structured), ...record(state.metadata) };
  const rows = Array.isArray(metadata.toolCalls) ? metadata.toolCalls.map(record) : [];
  const artifactRows = rows.flatMap((row, position) => {
    const op = operation(string(row.tool) ?? string(row.name));
    return op ? [{ row, op, position }] : [];
  });
  if (artifactRows.length === 0) return null;
  const returned = returnedArtifacts(status === "complete" ? output : null);
  const claimed = new Set<string>();
  const creates = artifactRows.filter((item) => item.op === "create").length;
  const runtimeError = metadata.error === true || status === "error";
  const calls = artifactRows.map(({ row, op, position }) => {
    const callInput = record(row.input);
    const callStatus =
      row.status === "completed"
        ? "complete"
        : row.status === "error" || status !== "running"
          ? "error"
          : "running";
    let found: Found | undefined;
    const id = artifactID(callInput.id);
    if (id) found = returned.find((artifact) => artifact.id === id);
    else if (op === "create") {
      const title = string(callInput.title)?.trim();
      const open = returned.filter((artifact) => !claimed.has(artifact.id!));
      found =
        open.find((artifact) => artifact.title === title) ??
        (creates === 1 && open.length === 1 ? open[0] : undefined);
    }
    if (found?.id) claimed.add(found.id);
    return call(
      `${key}:${position}`,
      op,
      callStatus,
      callInput,
      found ?? {},
      callStatus === "error" ? (runtimeError ? (failure ?? output) : null) : null,
    );
  });
  return { calls, only: rows.length === artifactRows.length };
}

export function projectArtifactCalls(
  part: PalotMessageContent,
  index: number,
): ArtifactToolProjection | null {
  let byIndex = projections.get(part);
  if (!byIndex) {
    byIndex = new Map();
    projections.set(part, byIndex);
  }
  if (byIndex.has(index)) return byIndex.get(index)!;
  const projected = project(part, index);
  const settledAt = part.time?.completed ?? null;
  const result =
    projected && settledAt !== null
      ? { ...projected, calls: projected.calls.map((call) => ({ ...call, settledAt })) }
      : projected;
  byIndex.set(index, result);
  return result;
}

/**
 * The current record for a call: by ID anywhere in the project, or, before the ID is known, the
 * task's newest artifact with the published title.
 */
export function matchArtifact(
  call: Pick<ArtifactCall, "id" | "title" | "operation">,
  artifacts: readonly ArtifactInfo[] | undefined,
  sessionID: string | undefined,
): ArtifactInfo | undefined {
  if (!artifacts) return undefined;
  if (call.id) return artifacts.find((artifact) => artifact.id === call.id);
  if (call.operation !== "create" || !call.title || !sessionID) return undefined;
  // The list is newest update first, so a repeated title resolves to the latest artifact.
  return artifacts.find(
    (artifact) => artifact.sessionID === sessionID && artifact.title === call.title,
  );
}

/** A short, user-facing name for what the entry file is. */
export function artifactKind(entry: string | null | undefined): string {
  const extension = entry?.split("/").at(-1)?.split(".").at(-1)?.toLowerCase();
  if (!entry || !extension || extension === entry.toLowerCase()) return "Artifact";
  if (extension === "html" || extension === "htm") return "HTML";
  if (extension === "md" || extension === "markdown") return "Markdown";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) return "Image";
  return extension.toUpperCase();
}

/** How Palot can open an artifact URL: OpenCode-hosted, a provider's web page, or not at all. */
export function artifactDestination(
  url: string | null | undefined,
): { kind: "hosted" } | { kind: "web"; url: string } | null {
  if (!url) return null;
  // The local provider serves from the OpenCode API itself; only main may attach its credential.
  if (/^\/api\/experimental\/artifacts\/art_[0-9A-Za-z]{1,64}\/view\//.test(url))
    return { kind: "hosted" };
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    return null;
  return { kind: "web", url: parsed.href };
}
