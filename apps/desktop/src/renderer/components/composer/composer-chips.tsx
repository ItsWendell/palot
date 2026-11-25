/** What the message carries besides its text: comments, attachments and uploads. */

import { ClipboardType, MessageSquare, MousePointerClick, X } from "lucide-react";
import { useState } from "react";
import type { PalotFileAttachment } from "../../../shared";
import type { PalotBrowserComment } from "../../../shared/browser-contract";
import { useMediaSource } from "../../hooks/use-media-source";
import { applyComposerTextEdit } from "../../lib/composer-draft";
import type { ReviewComment } from "../../lib/review-comments";
import { FileAttachment } from "../file-attachment";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "../ui/attachment";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { InputGroupButton } from "../ui/input-group";
import {
  forgetPastedText,
  pastedTextFor,
  type ComposerUpload,
  type PastedText,
} from "./use-composer-attachments";
import type { ComposerDraftState } from "./use-composer-draft";

function lineLabel(item: ReviewComment): string {
  const { startLine, endLine } = item.selection;
  return `${item.path}:${startLine}${endLine !== startLine ? `–${endLine}` : ""}`;
}

/**
 * Review line comments waiting to be sent, as chips beside the attachments. A chip opens in
 * place to edit the comment, send it on its own now, or remove it.
 */
export function ComposerLineComments({
  comments,
  onChange,
  onSendNow,
}: {
  comments: ReviewComment[];
  onChange(update: (current: ReviewComment[]) => ReviewComment[]): void;
  /** Sends one comment as its own message, leaving the draft alone. Resolves to success. */
  onSendNow?(comment: ReviewComment): Promise<boolean>;
}) {
  if (comments.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Pending line comments"
      className="flex shrink-0 items-center gap-1.5"
    >
      {comments.map((item) => (
        <LineCommentChip key={item.id} item={item} onChange={onChange} onSendNow={onSendNow} />
      ))}
    </div>
  );
}

function LineCommentChip({
  item,
  onChange,
  onSendNow,
}: {
  item: ReviewComment;
  onChange(update: (current: ReviewComment[]) => ReviewComment[]): void;
  onSendNow?(comment: ReviewComment): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.comment);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const where = `${item.path} line ${item.selection.startLine}`;
  const remove = () => onChange((current) => current.filter((comment) => comment.id !== item.id));
  const save = () => {
    if (!text.trim()) return;
    onChange((current) =>
      current.map((comment) =>
        comment.id === item.id ? { ...comment, comment: text.trim() } : comment,
      ),
    );
    setOpen(false);
  };
  const sendNow = async () => {
    if (!onSendNow || sending || !text.trim()) return;
    setSending(true);
    setFailed(false);
    const sent = await onSendNow({ ...item, comment: text.trim() }).catch(() => false);
    setSending(false);
    if (!sent) {
      setFailed(true);
      return;
    }
    setOpen(false);
    remove();
  };
  return (
    <Attachment size="xs" className="max-w-64 min-w-0" data-palot-line-comment={item.id}>
      <AttachmentMedia>
        <MessageSquare aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="font-mono text-code-compact">{lineLabel(item)}</AttachmentTitle>
        <AttachmentDescription title={item.comment}>{item.comment}</AttachmentDescription>
      </AttachmentContent>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setText(item.comment);
            setFailed(false);
          }
        }}
      >
        <PopoverTrigger render={<AttachmentTrigger aria-label={`Edit comment on ${where}`} />} />
        <PopoverContent side="top" align="start" className="w-80 gap-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <p className="m-0 truncate font-mono text-code-compact text-muted-foreground">
              {lineLabel(item)}
            </p>
            <Textarea
              autoFocus
              rows={3}
              aria-label={`Comment on ${where}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save();
                }
              }}
            />
            {failed ? (
              <p role="alert" className="m-0 text-meta text-destructive">
                Could not send the comment.
              </p>
            ) : null}
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={remove}>
                Remove
              </Button>
              <span className="flex-1" />
              {onSendNow ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sending || !text.trim()}
                  onClick={() => void sendNow()}
                >
                  {sending ? "Sending…" : "Send now"}
                </Button>
              ) : null}
              <Button type="submit" size="sm" disabled={!text.trim()}>
                Save
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <AttachmentActions>
        <AttachmentAction aria-label={`Remove comment on ${where}`} onClick={remove}>
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

/** A restored comment's preview may be the server-stored attached file it was sent as. */
function BrowserCommentPreview({
  preview,
  alt,
  className,
}: {
  preview: string;
  alt: string;
  className?: string;
}) {
  const { url } = useMediaSource(preview, "image/jpeg");
  return url ? <img src={url} alt={alt} className={className} /> : null;
}

/** Comments on page elements from the Palot Browser, as chips that open in place to edit. */
export function ComposerBrowserComments({
  comments,
  onChange,
}: {
  comments: PalotBrowserComment[];
  onChange(update: (current: PalotBrowserComment[]) => PalotBrowserComment[]): void;
}) {
  if (comments.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Pending browser comments"
      className="flex shrink-0 items-center gap-1.5"
    >
      {comments.map((item) => {
        const remove = () =>
          onChange((current) => current.filter((comment) => comment.id !== item.id));
        return (
          <Attachment key={item.id} size="xs" className="max-w-64 min-w-0">
            <AttachmentMedia variant={item.preview ? "image" : "icon"}>
              {item.preview ? (
                <BrowserCommentPreview preview={item.preview} alt="" />
              ) : (
                <MousePointerClick aria-hidden="true" />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.element.label}</AttachmentTitle>
              <AttachmentDescription title={item.comment}>
                {item.comment || item.url}
              </AttachmentDescription>
            </AttachmentContent>
            <Popover>
              <PopoverTrigger
                render={
                  <AttachmentTrigger aria-label={`Edit browser comment on ${item.element.label}`} />
                }
              />
              <PopoverContent side="top" align="start" className="w-80 gap-2">
                {item.preview ? (
                  <BrowserCommentPreview
                    preview={item.preview}
                    alt={`Preview of ${item.element.label}`}
                    className="max-h-32 w-full rounded border object-contain"
                  />
                ) : null}
                <p
                  className="m-0 truncate text-meta text-muted-foreground"
                  title={`${item.url} · ${item.element.selector}`}
                >
                  {item.element.label} · {item.url}
                </p>
                <Textarea
                  autoFocus
                  rows={3}
                  maxLength={8000}
                  aria-label={`Browser comment on ${item.element.label}`}
                  value={item.comment}
                  onChange={(event) =>
                    onChange((current) =>
                      current.map((comment) =>
                        comment.id === item.id
                          ? { ...comment, comment: event.target.value }
                          : comment,
                      ),
                    )
                  }
                />
                <div className="flex justify-start">
                  <Button type="button" variant="ghost" size="sm" onClick={remove}>
                    Remove
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove browser comment on ${item.element.label}`}
                onClick={remove}
              >
                <X aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        );
      })}
    </div>
  );
}

/** Files, images and long pastes. Mentions are chips in the text itself. */
export function ComposerAttachmentChips({
  contents,
  files,
  onRemoveFile,
}: {
  contents: ComposerDraftState;
  files: PalotFileAttachment[];
  onRemoveFile(uri: string): void;
}) {
  if (files.length === 0) return null;
  return (
    <AttachmentGroup
      className="palot-native-scrollbar max-h-[min(6rem,15cqh)] shrink-0 overflow-y-auto overscroll-contain px-3 py-1"
      role="group"
      aria-label="Attachments"
    >
      {files.map((file) => {
        const pasted = pastedTextFor(file.uri);
        return pasted ? (
          <PastedTextAttachment
            key={file.uri}
            pasted={pasted}
            onShow={() => showPastedText(contents, file.uri, pasted.text)}
            onRemove={() => {
              forgetPastedText(file.uri);
              onRemoveFile(file.uri);
            }}
          />
        ) : (
          <FileAttachment key={file.uri} file={file} onRemove={() => onRemoveFile(file.uri)} />
        );
      })}
    </AttachmentGroup>
  );
}

/** Puts a long paste back where the caret is, as text, and drops its attachment. */
function showPastedText(contents: ComposerDraftState, uri: string, text: string) {
  const { draft } = contents.read();
  const caret = Math.min(contents.store.get(contents.selectionAtom).end, draft.text.length);
  const inside = draft.mentions.find((mention) => mention.start < caret && caret < mention.end);
  const at = inside ? inside.end : caret;
  const writer = contents.writer();
  writer.setDraft(applyComposerTextEdit(draft, { start: at, end: at, text }));
  writer.setFiles((current) => current.filter((file) => file.uri !== uri));
  forgetPastedText(uri);
  contents.setSelection({ start: at + text.length, end: at + text.length });
}

function PastedTextAttachment({
  pasted,
  onShow,
  onRemove,
}: {
  pasted: PastedText;
  onShow(): void;
  onRemove(): void;
}) {
  const label = `Pasted text · ${pasted.lines} ${pasted.lines === 1 ? "line" : "lines"}`;
  return (
    <Attachment size="sm" className="max-w-72 bg-background/55" data-palot-pasted-text="">
      <AttachmentMedia variant="icon">
        <ClipboardType aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={pasted.text.slice(0, 200)}>{label}</AttachmentTitle>
        <AttachmentDescription>
          <button
            type="button"
            className="relative z-20 text-foreground/75 hover:text-foreground"
            onClick={onShow}
          >
            Show in text field
          </button>
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={`Remove ${label}`} onClick={onRemove}>
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

export function ComposerUploadStatus({
  upload,
  onCancel,
}: {
  upload: ComposerUpload;
  onCancel(): void;
}) {
  const { progress } = upload;
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1 text-compact text-muted-foreground">
      <span role="status" className="min-w-0 flex-1 truncate">
        {progress
          ? `Uploading ${progress.name} (${progress.index + 1}/${progress.count}) · ${Math.round((progress.loaded / Math.max(1, progress.total)) * 100)}%`
          : "Preparing attachments…"}
      </span>
      <InputGroupButton
        type="button"
        size="sm"
        onClick={onCancel}
        aria-label="Cancel attachment upload"
      >
        Cancel
      </InputGroupButton>
    </div>
  );
}
