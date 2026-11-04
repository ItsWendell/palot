import type { SelectedLineRange } from "@pierre/diffs";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { composerDirectSendAtomFamily, composerStateAtomFamily } from "../atoms/composer-state";
import { composerScope } from "../lib/composer-scope";
import { matchesShortcut, type ShortcutKeys } from "../lib/keyboard-shortcuts";
import { canCommentOnRange, commentSelection, type ReviewComment } from "../lib/review-comments";
import { Button } from "./ui/button";
import { ShortcutKbd } from "./ui/kbd";

const SEND_KEYS: ShortcutKeys = ["Mod", "Enter"];

export function useReviewComments(
  profileID: string,
  sessionID?: string,
  allowInactiveConnection = false,
) {
  const runtime = useAtomValue(runtimeAtom);
  const enabled = Boolean(
    sessionID && (allowInactiveConnection || runtime?.profileID === profileID),
  );
  const scope = composerScope(profileID, `session:${sessionID ?? ""}`);
  const [state, setState] = useAtom(composerStateAtomFamily(scope));
  // Present while the task's composer is open; it owns the model, agent and delivery choice.
  const sender = useAtomValue(composerDirectSendAtomFamily(scope));
  const item = (path: string, range: SelectedLineRange, comment: string): ReviewComment => ({
    id: crypto.randomUUID(),
    path,
    selection: commentSelection(range),
    comment: comment.trim(),
    side: range.side,
  });
  const add = (path: string, range: SelectedLineRange, comment: string) => {
    if (!enabled || !canCommentOnRange(range) || !comment.trim()) return;
    const added = item(path, range, comment);
    setState((current) =>
      current.edit
        ? { ...current, edit: { ...current.edit, comments: [...current.edit.comments, added] } }
        : { ...current, comments: [...current.comments, added] },
    );
  };
  /** Sends just this comment now; the draft and other queued comments stay in the composer. */
  const send =
    enabled && sender
      ? (path: string, range: SelectedLineRange, comment: string) =>
          canCommentOnRange(range) && comment.trim()
            ? sender(item(path, range, comment))
            : Promise.resolve(false)
      : undefined;
  return { enabled, add, send, comments: state.edit ? state.edit.comments : state.comments };
}

export function ReviewCommentEditor({
  path,
  range,
  onSave,
  onSend,
  onCancel,
}: {
  path: string;
  range: SelectedLineRange;
  onSave(comment: string): void;
  /** Sends the comment on its own instead of adding it to the composer. Resolves to success. */
  onSend?(comment: string): Promise<boolean>;
  onCancel(): void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    if (!onSend || sending || !text.trim()) return;
    setSending(true);
    setFailed(false);
    const sent = await onSend(text).catch(() => false);
    setSending(false);
    // On success the caller closes the editor; on failure the comment stays for a retry.
    if (!sent) setFailed(true);
  };
  const first = Math.min(range.start, range.end);
  const last = Math.max(range.start, range.end);
  return (
    <form
      aria-label={`Comment on ${path}`}
      className="shrink-0 space-y-2 border-t border-border bg-background p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onSave(text);
      }}
    >
      <label className="block text-meta text-muted-foreground" htmlFor="review-comment-text">
        {path} · {first === last ? `line ${first}` : `lines ${first}–${last}`}
      </label>
      <textarea
        id="review-comment-text"
        aria-label="Line comment"
        className="w-full resize-y rounded-md border border-border bg-card p-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        rows={2}
        value={text}
        readOnly={sending}
        aria-describedby={failed ? "review-comment-error" : undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!onSend || !matchesShortcut(event.nativeEvent, SEND_KEYS)) return;
          event.preventDefault();
          void send();
        }}
      />
      {failed ? (
        <p id="review-comment-error" role="alert" className="text-meta text-destructive">
          Couldn't send. Your comment is still here. Try again.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        {onSend ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send now"}
            <ShortcutKbd keys={SEND_KEYS} />
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!text.trim() || sending}>
          Add comment
        </Button>
      </div>
    </form>
  );
}
