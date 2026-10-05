import type { PalotFileAttachment } from "../../shared";
import type { PromptInput } from "../../shared";
import { formatReviewComment } from "../lib/review-comments";
import { browserCommentPreviewName, formatBrowserComment } from "../lib/browser-comments";

export interface AttachmentDeliveryInput {
  files?: PalotFileAttachment[];
  modelInput?: readonly string[];
  comments?: PromptInput["comments"];
  browserComments?: PromptInput["browserComments"];
}

const images = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

/** The server retains attachments, but only forwards supported media to the model. */
export function attachmentPrompt(
  text: string,
  { files = [], modelInput, comments = [], browserComments = [] }: AttachmentDeliveryInput,
) {
  const inlineFiles: PalotFileAttachment[] = [];
  for (const comment of browserComments) {
    if (comment.preview && (modelInput === undefined || modelInput.includes("image")))
      inlineFiles.push({
        uri: comment.preview,
        name: browserCommentPreviewName(comment),
        mime: "image/jpeg",
        size: Math.floor(comment.preview.length * 0.75),
      });
  }
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
      ...comments.map(formatReviewComment),
      ...browserComments.map(formatBrowserComment),
    ]
      .filter(Boolean)
      .join("\n"),
    ...(attachments.length || comments.length || browserComments.length
      ? {
          metadata: {
            displayText: text,
            comments,
            ...(browserComments.length
              ? {
                  browserComments: browserComments.map((comment) => ({
                    ...comment,
                    element: { ...comment.element },
                  })),
                }
              : {}),
            attachments,
            ...(attachments.length ? { palotAttachmentPaths: true } : {}),
          },
        }
      : {}),
  };
}
