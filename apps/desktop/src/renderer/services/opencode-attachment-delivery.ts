import type { PalotFileAttachment } from "../../shared";

export interface AttachmentDeliveryInput {
  files?: PalotFileAttachment[];
  modelInput?: readonly string[];
}

const images = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

/** The server retains attachments, but only forwards supported media to the model. */
export function attachmentPrompt(
  text: string,
  { files = [], modelInput }: AttachmentDeliveryInput,
) {
  const inlineFiles: PalotFileAttachment[] = [];
  const attachments = files.flatMap((file) => {
    if (
      file.mime === "application/x-directory" ||
      ((file.size == null || file.size <= MAX_INLINE_BYTES) &&
        ((images.has(file.mime) && (modelInput === undefined || modelInput.includes("image"))) ||
          (file.mime === "application/pdf" &&
            (modelInput === undefined || modelInput.includes("pdf")))))
    ) {
      inlineFiles.push(file);
      return [];
    }
    const uri = new URL(file.uri);
    if (uri.protocol !== "file:") {
      throw new Error(
        `Upload ${file.name} to the server before sending it to a model that cannot read this attachment directly.`,
      );
    }
    const decoded = decodeURIComponent(uri.pathname);
    const path = uri.hostname
      ? `//${uri.hostname}${decoded}`
      : decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
    return [{ name: file.name, mime: file.mime, path, uri: file.uri, size: file.size }];
  });
  return {
    inlineFiles,
    text: [
      text,
      ...attachments.map((attachment) => `Attached file: ${JSON.stringify(attachment.path)}`),
    ]
      .filter(Boolean)
      .join("\n"),
    ...(attachments.length
      ? { metadata: { displayText: text, comments: [], attachments, palotAttachmentPaths: true } }
      : {}),
  };
}
