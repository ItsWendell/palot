import type { PalotMessage } from "../../shared";

/**
 * The automation that sent a user message, read from the metadata the sender attached.
 * OpenCode automations (2.4) write `metadata.automation = { id, name, run, dueAt, late }` on an
 * ordinary user message; Palot's own scheduler writes `metadata["palot.automation"]`.
 */
export type PromptAutomation =
  | {
      source: "opencode";
      automationID: string;
      name: string | null;
      run: number | null;
      dueAt: number | null;
      late: boolean;
    }
  | {
      source: "palot";
      automationID: string;
      runID: string | null;
      scheduledFor: number | null;
    };

const cache = new WeakMap<PalotMessage, PromptAutomation | null>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function read(message: PalotMessage): PromptAutomation | null {
  if (message.type !== "user") return null;
  const metadata = record(record(message.data)?.metadata);
  if (!metadata) return null;
  const opencode = record(metadata.automation);
  const opencodeID = text(opencode?.id);
  if (opencode && opencodeID)
    return {
      source: "opencode",
      automationID: opencodeID,
      name: text(opencode.name),
      run: finite(opencode.run),
      dueAt: finite(opencode.dueAt),
      late: opencode.late === true,
    };
  const palot = record(metadata["palot.automation"]);
  const palotID = text(palot?.automationID);
  if (palot && palotID)
    return {
      source: "palot",
      automationID: palotID,
      runID: text(palot.runID),
      scheduledFor: finite(palot.scheduledFor),
    };
  return null;
}

/** Messages are immutable once mapped, so the result is cached per object. */
export function promptAutomation(message: PalotMessage): PromptAutomation | null {
  const cached = cache.get(message);
  if (cached !== undefined) return cached;
  const result = read(message);
  cache.set(message, result);
  return result;
}

/** "Automation · Daily triage · ran late". `name` resolves Palot's own automations, which carry only an ID. */
export function promptAutomationLabel(automation: PromptAutomation, name?: string | null): string {
  const resolved = (automation.source === "opencode" ? automation.name : null) ?? name ?? null;
  const parts = ["Automation"];
  if (resolved) parts.push(resolved);
  if (automation.source === "opencode" && automation.late) parts.push("ran late");
  return parts.join(" · ");
}
