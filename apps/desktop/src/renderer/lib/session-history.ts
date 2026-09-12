import type { PalotMessage } from "../../shared";

export function userPromptHistory(messages: readonly PalotMessage[]) {
  return messages.filter((message) => message.type === "user" && !message.optimistic);
}

export function promptHistoryLabel(message: PalotMessage): string {
  return (
    message.text?.trim() || message.files?.map((file) => file.name).join(", ") || "Attached context"
  );
}

export function adjacentPromptID(
  ids: readonly string[],
  currentID: string | null,
  direction: "previous" | "next",
) {
  const index = currentID ? ids.indexOf(currentID) : ids.length;
  if (index < 0) return null;
  return ids[index + (direction === "previous" ? -1 : 1)] ?? null;
}
