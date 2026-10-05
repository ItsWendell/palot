import type { PalotMessage } from "../../shared";
import type { PalotBrowserComment } from "../../shared/browser-contract";

export function isBrowserComment(value: unknown): value is PalotBrowserComment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PalotBrowserComment>;
  const element = item.element;
  return (
    typeof item.id === "string" &&
    item.id.length <= 128 &&
    typeof item.comment === "string" &&
    item.comment.length <= 8000 &&
    typeof item.tabID === "string" &&
    item.tabID.length <= 128 &&
    typeof item.url === "string" &&
    item.url.length <= 16384 &&
    Number.isSafeInteger(item.generation) &&
    item.generation! >= 0 &&
    !!element &&
    typeof element.label === "string" &&
    element.label.length <= 200 &&
    typeof element.selector === "string" &&
    element.selector.length <= 2000 &&
    [element.ref, element.text, element.name, element.role, item.bindingID].every(
      (value) => value === undefined || (typeof value === "string" && value.length <= 256),
    ) &&
    (item.preview === undefined ||
      (typeof item.preview === "string" &&
        item.preview.length <= 262144 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.preview)))
  );
}

/** A reference cannot survive a renderer reload, a restored message, or a fork. */
export function durableBrowserComment(item: PalotBrowserComment): PalotBrowserComment {
  const { bindingID: _bindingID, element, ...comment } = item;
  const { ref: _ref, ...description } = element;
  return { ...comment, element: description };
}

export function browserCommentPreviewName(comment: Pick<PalotBrowserComment, "id">): string {
  return `Browser element preview ${comment.id}.jpg`;
}

/** Preview bytes belong to their comment, not to the independent attachment list. */
export function isBrowserCommentPreview(name: string | undefined, message: PalotMessage): boolean {
  return browserCommentsFromMessage(message).some(
    (comment) => !!comment.preview && browserCommentPreviewName(comment) === name,
  );
}

export function retainedComposerFiles(message: PalotMessage) {
  return (message.files ?? []).filter((file) => !isBrowserCommentPreview(file.name, message));
}

export function liveBrowserComments(
  comments: PalotBrowserComment[],
  bindingID: string | null | undefined,
  tabs: readonly { id: string; generation: number; url: string }[],
): PalotBrowserComment[] {
  return comments.map((comment) =>
    bindingID &&
    comment.bindingID === bindingID &&
    tabs.some(
      (tab) =>
        tab.id === comment.tabID &&
        tab.generation === comment.generation &&
        tab.url === comment.url,
    )
      ? comment
      : durableBrowserComment(comment),
  );
}

export function formatBrowserComment(comment: PalotBrowserComment): string {
  const { element } = comment;
  const details = [
    element.role ? `role ${JSON.stringify(element.role)}` : null,
    element.name ? `accessible name ${JSON.stringify(element.name)}` : null,
    element.text ? `page text ${JSON.stringify(element.text)}` : null,
    element.selector
      ? `selector ${JSON.stringify(element.selector)} (>>> enters a shadow root)`
      : null,
    element.ref ? `browser ref @${element.ref}, valid only until this document changes` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return `The user commented on the ${JSON.stringify(element.label)} element in browser tab ${JSON.stringify(comment.tabID)} at ${JSON.stringify(comment.url)}${details ? ` (${details})` : ""}: ${comment.comment}`;
}

export function browserCommentsFromMessage(message: PalotMessage): PalotBrowserComment[] {
  const data = message.data;
  const metadata = data && typeof data === "object" && !Array.isArray(data) ? data.metadata : null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const comments = (metadata as Record<string, unknown>).browserComments;
  return Array.isArray(comments)
    ? comments.filter(isBrowserComment).map(durableBrowserComment)
    : [];
}
