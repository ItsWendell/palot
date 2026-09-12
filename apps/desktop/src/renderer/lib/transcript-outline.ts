import type { PalotMessage } from "../../shared";

export type TranscriptPromptAnchor = {
  messageID: string;
  turnID: string;
  /** Index in SessionTranscriptProjection.rows, not presentationRows. */
  rowIndex: number;
  label: string;
};

export type TranscriptPrompt = Pick<TranscriptPromptAnchor, "messageID" | "label">;

const labels = new WeakMap<PalotMessage, string>();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedText(text: string): string {
  // Stop once the preview is full, even for very large submitted context.
  let result = "";
  let space = false;
  for (const character of text) {
    if (/\s/.test(character)) {
      space = result.length > 0;
      continue;
    }
    if (space) result += " ";
    space = false;
    if (result.length + character.length > 240) break;
    result += character;
    if (result.length >= 240) break;
  }
  return result.trimEnd();
}

/** User objects are immutable; assistant deltas never re-read prompt text. */
export function transcriptPromptLabel(message: PalotMessage): string {
  const cached = labels.get(message);
  if (cached !== undefined) return cached;
  const metadata = record(record(message.data).metadata);
  const displayText =
    typeof metadata.displayText === "string" ? boundedText(metadata.displayText) : "";
  let label = displayText || boundedText(message.text ?? "");
  if (!label) {
    const names = message.files?.map((file) => file.name).filter(Boolean) ?? [];
    label = names.length ? boundedText(names.join(", ")) : "Prompt";
    if (message.files?.length && !names.length) label = "Attachment";
  }
  labels.set(message, label);
  return label;
}
