/**
 * Context-window projection based on the last measured assistant step.
 *
 * The window matches OpenCode's own measure (`estimatePrompt` in core `session/compaction.ts`):
 * what the provider reported for the latest request (uncached input, cache reads, cache writes)
 * plus that step's output and reasoning, which join the history the next request replays.
 */

import type { ModelRef, SessionMessageInfo, TokenUsageInfo } from "@opencode/client";
import type { PalotMessage, PalotModel } from "../../shared";

export interface ContextBreakdown {
  /** Prompt tokens served from the provider's cache. */
  cached: number;
  /** Prompt tokens the provider processed fresh, including those it wrote to its cache. */
  uncached: number;
  /** Output and reasoning from the step, which the next request carries. */
  output: number;
}

export interface ContextUsage {
  total: number;
  limit: number | null;
  percentage: number | null;
  breakdown: ContextBreakdown;
  messageID: string;
  model: ModelRef | null;
  /** When the measured step finished (or started, while it streams). */
  updatedAt: number;
  /** A completed compaction followed the measured step; the next reply re-measures the window. */
  compacted: boolean;
}

export type ContextStatus = "unavailable" | "normal" | "warning" | "critical";

export const CONTEXT_WARNING_PERCENT = 70;
export const CONTEXT_CRITICAL_PERCENT = 90;
/** Compact-before-send applies from this window size (mirrors t3code's resume compaction). */
export const COMPACT_SUGGESTION_MIN_TOKENS = 100_000;
/** Idle time after which a provider prompt cache has likely expired (Anthropic's longest TTL is 1h). */
export const COMPACT_SUGGESTION_IDLE_MS = 60 * 60_000;

const NUMBER = new Intl.NumberFormat(undefined);

export function sumTokens(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function promptTokens(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.cache.read + tokens.cache.write;
}

/** Same rule as OpenCode's `hasMeasuredPrompt`: a non-failed assistant step that reported a prompt. */
function measuredStep(message: PalotMessage): message is PalotMessage & { tokens: TokenUsageInfo } {
  return (
    message.type === "assistant" &&
    message.finish !== "error" &&
    message.tokens !== null &&
    promptTokens(message.tokens) > 0
  );
}

function completedCompaction(message: PalotMessage): boolean {
  return (
    message.type === "compaction" &&
    message.content.some((part) => part.type === "compaction" && part.status === "completed")
  );
}

export function findContextModel(
  models: readonly PalotModel[],
  ref: ModelRef | null | undefined,
): PalotModel | null {
  if (!ref) return null;
  return (
    models.find(
      (model) =>
        model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id),
    ) ?? null
  );
}

/** True only when the catalog prices every token at zero; missing pricing is not free. */
export function isFreeModel(model: Pick<PalotModel, "cost"> | null): boolean {
  const tiers = model?.cost;
  return Boolean(
    tiers?.length &&
    tiers.every(
      (tier) =>
        tier.input === 0 && tier.output === 0 && tier.cacheRead === 0 && tier.cacheWrite === 0,
    ),
  );
}

export function contextBreakdown(tokens: TokenUsageInfo): ContextBreakdown {
  return {
    cached: tokens.cache.read,
    uncached: tokens.input + tokens.cache.write,
    output: tokens.output + tokens.reasoning,
  };
}

export function getContextUsage(
  messages: readonly PalotMessage[],
  models: readonly PalotModel[],
): ContextUsage | null {
  let compacted = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (completedCompaction(message)) compacted = true;
    if (!measuredStep(message)) continue;
    const total = sumTokens(message.tokens);
    const limit = findContextModel(models, message.model)?.contextLimit || null;
    return {
      total,
      limit,
      percentage: limit ? Math.round((total / limit) * 100) : null,
      breakdown: contextBreakdown(message.tokens),
      messageID: message.id,
      model: message.model,
      updatedAt: message.completedAt ?? message.createdAt,
      compacted,
    };
  }
  return null;
}

export function contextStatus(percentage: number | null | undefined): ContextStatus {
  if (percentage === null || percentage === undefined) return "unavailable";
  if (percentage >= CONTEXT_CRITICAL_PERCENT) return "critical";
  if (percentage >= CONTEXT_WARNING_PERCENT) return "warning";
  return "normal";
}

/** "627k", "1M", "1.2M", "950". */
export function formatTokenCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000, abs < 10_000 ? 1 : 0)}k`;
  return NUMBER.format(value);
}

function trim(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatTokenExact(value: number): string {
  return NUMBER.format(value);
}

/** USD with sub-cent precision when the amount needs it. */
export function formatUsd(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export interface ContextWording {
  /** "Context window: 45% used (55% left)" or "Context window: 85% full". */
  summary: string;
  /** "627k / 1M tokens used", or "627k tokens used" without a known window. */
  detail: string;
}

export function describeContextUsage(usage: ContextUsage): ContextWording {
  if (usage.percentage === null || usage.limit === null) {
    return {
      summary: "Context window size unknown",
      detail: `${formatTokenCount(usage.total)} tokens used`,
    };
  }
  const percent = usage.percentage;
  return {
    summary:
      percent >= CONTEXT_WARNING_PERCENT
        ? `Context window: ${percent}% full`
        : `Context window: ${percent}% used (${Math.max(0, 100 - percent)}% left)`,
    detail: `${formatTokenCount(usage.total)} / ${formatTokenCount(usage.limit)} tokens used`,
  };
}

/** "Updated just now", "Updated 2m ago", "Updated 3h ago", "Updated Oct 3". */
export function formatUpdated(timestamp: number, now = Date.now()): string {
  return `Updated ${formatAgo(timestamp, now)}`;
}

export function formatAgo(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

/** The latest time an assistant step ran, which is when the provider last read the prompt cache. */
export function lastAssistantActivityAt(messages: readonly PalotMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "assistant") return message.completedAt ?? message.createdAt;
  }
  return null;
}

export interface CompactSuggestionInput {
  usage: ContextUsage | null;
  lastActivityAt: number | null;
  now: number;
  enabled: boolean;
}

/**
 * Tokens to summarize before the next send, or null. Suggested when the window holds at least
 * 100k tokens and the task has been idle long enough that the prompt cache has likely expired,
 * so the next turn would re-read the whole window uncached.
 */
export function compactSuggestionTokens(input: CompactSuggestionInput): number | null {
  const { usage, lastActivityAt } = input;
  if (!input.enabled || !usage || usage.compacted || lastActivityAt === null) return null;
  if (usage.total < COMPACT_SUGGESTION_MIN_TOKENS) return null;
  return input.now - lastActivityAt >= COMPACT_SUGGESTION_IDLE_MS ? usage.total : null;
}

/** When a suggestion would start applying, for scheduling a re-check; null if it never will. */
export function compactSuggestionDueAt(input: Omit<CompactSuggestionInput, "now">): number | null {
  const { usage, lastActivityAt } = input;
  if (!input.enabled || !usage || usage.compacted || lastActivityAt === null) return null;
  if (usage.total < COMPACT_SUGGESTION_MIN_TOKENS) return null;
  return lastActivityAt + COMPACT_SUGGESTION_IDLE_MS;
}

export interface CompactionRecord {
  messageID: string;
  at: number;
  reason: "auto" | "manual" | null;
  status: "running" | "completed" | "failed";
  /** Window at the last measured step before the compaction. */
  before: number | null;
  /** Window at the first measured step after it; null until the next reply. */
  after: number | null;
  /** Compaction request cost, when OpenCode reported it. */
  cost: number | null;
  error: string | null;
}

export function compactionHistory(messages: readonly PalotMessage[]): CompactionRecord[] {
  const records: CompactionRecord[] = [];
  let lastWindow: number | null = null;
  const awaitingAfter: CompactionRecord[] = [];
  for (const message of messages) {
    if (measuredStep(message)) {
      lastWindow = sumTokens(message.tokens);
      for (const record of awaitingAfter.splice(0)) record.after = lastWindow;
      continue;
    }
    if (message.type !== "compaction") continue;
    const part = message.content.find((candidate) => candidate.type === "compaction");
    const status =
      part?.status === "completed" || part?.status === "failed" ? part.status : "running";
    const record: CompactionRecord = {
      messageID: message.id,
      at: message.createdAt,
      reason: part?.reason ?? null,
      status,
      before: lastWindow,
      after: null,
      cost: part?.cost ?? null,
      error: part?.error ?? null,
    };
    records.push(record);
    if (status === "completed") awaitingAfter.push(record);
  }
  return records;
}

export function compactionRunning(messages: readonly PalotMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "compaction") continue;
    return message.completedAt === null;
  }
  return false;
}

export function lastCompletedCompactionAt(messages: readonly PalotMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && completedCompaction(message)) return message.completedAt ?? message.createdAt;
  }
  return null;
}

/**
 * Text of the messages a summary compaction kept verbatim. OpenCode 2.1 stores only a
 * `metadata.keepID` reference; context history and legacy compactions carry the text here.
 */
export function compactionRecent(message: { metadata?: Record<string, unknown> }): string {
  const recent = message.metadata?.recent;
  return typeof recent === "string" ? recent : "";
}

/** Rough token count for text the model reads: about four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ContextEntry {
  id: string;
  role: string;
  /** A compaction checkpoint: the summary that stands in for earlier history. */
  summary: boolean;
  preview: string;
  tokens: number;
}

/** The model in effect before `index`: the latest switch or assistant step that names one. */
function modelBefore(
  messages: readonly SessionMessageInfo[] | undefined,
  index: number | undefined,
): ModelRef | null {
  if (!messages || index === undefined) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message?.type === "model-switched" || message?.type === "assistant") return message.model;
  }
  return null;
}

/** "Switched to gpt-5 (high)", or "Switched variant to high" when only the variant changed. */
export function describeModelSwitch(model: ModelRef, previous: ModelRef | null): string {
  if (previous && previous.id === model.id && previous.providerID === model.providerID) {
    return `Switched variant to ${model.variant ?? "Auto"}`;
  }
  return `Switched to ${model.id}${model.variant ? ` (${model.variant})` : ""}`;
}

/**
 * Readable rows for `session.context`, the messages OpenCode retains for the next model call.
 * Matches `Array.map`'s callback so model switches can compare with the preceding model.
 */
export function describeContextEntry(
  message: SessionMessageInfo,
  index?: number,
  messages?: readonly SessionMessageInfo[],
): ContextEntry {
  const base = { id: message.id, summary: false };
  switch (message.type) {
    case "user": {
      const files = message.files?.length ?? 0;
      const suffix = files ? ` (+${files} attachment${files === 1 ? "" : "s"})` : "";
      return {
        ...base,
        role: "User",
        preview: preview(message.text) + suffix,
        tokens: estimateTokens(message.text),
      };
    }
    case "assistant": {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const tools = message.content.filter((part) => part.type === "tool").map((part) => part.name);
      const toolSummary = tools.length ? `Used ${unique(tools).join(", ")}` : "";
      const measured = message.tokens ? message.tokens.output + message.tokens.reasoning : null;
      return {
        ...base,
        role: "Assistant",
        preview: preview(text) || toolSummary || "No text",
        tokens: measured ?? estimateTokens(JSON.stringify(message.content)),
      };
    }
    case "compaction": {
      // Context history folds the messages kept verbatim (`metadata.keepID`) into `metadata.recent`.
      const text =
        message.status === "failed" ? "" : [message.summary, compactionRecent(message)].join("\n");
      return {
        ...base,
        role: "Compaction",
        summary: message.status === "completed",
        preview:
          message.status === "failed"
            ? `Failed: ${message.error.message}`
            : preview(message.summary) || "Summarizing earlier history",
        tokens: estimateTokens(text),
      };
    }
    case "synthetic":
    case "system":
      return {
        ...base,
        role: message.type === "system" ? "System" : "Palot",
        preview: preview(message.description || message.text),
        tokens: estimateTokens(message.text),
      };
    case "skill":
      return {
        ...base,
        role: "Skill",
        preview: message.name,
        tokens: estimateTokens(message.text),
      };
    case "shell":
      return {
        ...base,
        role: "Shell",
        preview: message.command,
        tokens: estimateTokens(message.command + (message.output?.output ?? "")),
      };
    case "agent-switched":
      return { ...base, role: "Agent", preview: `Switched to ${message.agent}`, tokens: 0 };
    case "model-switched":
      return {
        ...base,
        role: "Model",
        preview: describeModelSwitch(
          message.model,
          message.previous ?? modelBefore(messages, index),
        ),
        tokens: 0,
      };
    case "location-switched":
      return { ...base, role: "Location", preview: "Moved to another location", tokens: 0 };
    case "idle":
      return { ...base, role: "Turn end", preview: message.outcome, tokens: 0 };
  }
}

export interface InstructionEntryView {
  key: string;
  title: string;
  /** Who attached it: Palot for its own `palot.*` keys, otherwise an OpenCode API client. */
  source: "Palot" | "API";
  /** A file the entry points at, when it names one. */
  path: string | null;
  preview: string;
  /** What OpenCode renders for the model. */
  text: string;
}

const ABSOLUTE_PATH = /(?:^|[\s:(`'"])((?:~|\/)[^\s`'")]+|[A-Za-z]:\\[^\s`'")]+)/;

export function describeInstructionEntry(entry: {
  key: string;
  value: unknown;
}): InstructionEntryView {
  const text = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value, null, 2);
  const record =
    entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)
      ? (entry.value as Record<string, unknown>)
      : null;
  const fieldPath = ["path", "file", "filePath"]
    .map((field) => record?.[field])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const path =
    fieldPath ?? (typeof entry.value === "string" ? ABSOLUTE_PATH.exec(text)?.[1] : null);
  const source = entry.key.startsWith("palot.") ? "Palot" : "API";
  const name = entry.key
    .replace(/^palot\./, "")
    .replaceAll(/[._-]+/g, " ")
    .trim();
  return {
    key: entry.key,
    title: name ? name.charAt(0).toUpperCase() + name.slice(1) : entry.key,
    source,
    path: path ?? null,
    preview: proseExcerpt(text, 240) || preview(text, 240),
    text,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** First meaningful line of text, without markdown heading markers, capped for a one-line row. */
export function preview(text: string, max = 160): string {
  const line =
    text
      .split("\n")
      .map((value) => value.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Body text without headings, collapsed to one line and capped. */
function proseExcerpt(text: string, max: number): string {
  const body = text
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"))
    .join(" ");
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}
