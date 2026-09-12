import type { SessionTransferData } from "@opencode/client";

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function attachmentLabel(file: { name?: string; mime: string }, index: number): string {
  return singleLine(file.name ?? "") || `Attachment ${index + 1} (${singleLine(file.mime)})`;
}

export function sessionTransferToMarkdown(transfer: SessionTransferData): string {
  const lines = [
    `# ${singleLine(transfer.info.title ?? "") || "OpenCode task"}`,
    "",
    `Task ID: ${transfer.info.id}`,
  ];

  for (const message of transfer.messages) {
    if (message.type === "user") {
      lines.push("", "## You", "", message.text.trim() || "_(No text)_");
      if (message.files?.length) {
        lines.push("", "Attachments:");
        message.files.forEach((file, index) => lines.push(`- ${attachmentLabel(file, index)}`));
      }
      continue;
    }
    if (message.type !== "assistant") continue;
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text) lines.push("", "## Assistant", "", text);
  }

  return `${lines.join("\n").trim()}\n`;
}
