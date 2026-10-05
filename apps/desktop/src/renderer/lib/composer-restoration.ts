import type { PalotFileAttachment, PalotMessage } from "../../shared";
import { normalizeComposerDraft, type ComposerDraft } from "./composer-draft";
import { reviewCommentsFromMessage } from "./review-comments";
import { isBrowserCommentPreview } from "./browser-comments";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function presentationText(message: PalotMessage): string {
  const metadata = record(record(message.data).metadata);
  return reviewCommentsFromMessage(message) !== null
    ? String(metadata.displayText)
    : (message.text ?? "");
}

/** Embedded bytes are portable. Historical local paths/grants and remote URLs are not. */
export function composerFilesFromMessage(message: PalotMessage): {
  files: PalotFileAttachment[];
  omitted: string[];
} {
  const raw = record(message.data);
  const metadata = record(raw.metadata);
  const referenced =
    metadata.palotAttachmentPaths === true && Array.isArray(metadata.attachments)
      ? metadata.attachments
      : [];
  const sources = Array.isArray(raw.files) ? [...raw.files, ...referenced] : (message.files ?? []);
  const files: PalotFileAttachment[] = [];
  const omitted: string[] = [];
  for (const [index, item] of sources.entries()) {
    const file = record(item);
    if (file.mention) continue;
    const name = typeof file.name === "string" ? file.name : `Attachment ${index + 1}`;
    if (isBrowserCommentPreview(name, message)) continue;
    const mime = typeof file.mime === "string" ? file.mime : "application/octet-stream";
    const source = record(file.source);
    const uri = typeof source.uri === "string" ? source.uri : file.uri;
    const embedded =
      typeof file.data === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) &&
      file.data.length > 0 &&
      file.data.length <= 28_000_000 &&
      /^[\w.+-]+\/[\w.+-]+$/.test(mime)
        ? `data:${mime};base64,${file.data}`
        : uri;
    if (
      typeof embedded === "string" &&
      embedded.length <= 28_000_000 &&
      /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(embedded)
    ) {
      files.push({ uri: embedded, name, mime, size: null });
    } else omitted.push(name);
  }
  return { files, omitted };
}

export function composerDraftFromMessage(message: PalotMessage): ComposerDraft {
  const { omitted } = composerFilesFromMessage(message);
  const text =
    presentationText(message) +
    (omitted.length
      ? `\n\nAttachments not restored (reattach before sending):\n${omitted.map((name) => `- ${name}`).join("\n")}`
      : "");
  return normalizeComposerDraft({
    text,
    mentions: [
      ...(message.fileReferences ?? []).map((reference, index) => ({
        localID: `restore-file-${index}`,
        kind: "file" as const,
        value: reference.mention.text.replace(/^@/, ""),
        ...reference.mention,
      })),
      ...(message.skillReferences ?? []).map((reference, index) => ({
        localID: `restore-skill-${index}`,
        kind: "skill" as const,
        value: reference.id,
        ...reference.mention,
        ...(reference.text ? { attachmentText: reference.text } : {}),
      })),
    ],
    command: null,
  });
}
