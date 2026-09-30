import type { SelectedLineRange } from "@pierre/diffs";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { runtimeAtom } from "../atoms/workspace";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { composerScope } from "../lib/composer-scope";
import { canCommentOnRange, commentSelection, type ReviewComment } from "../lib/review-comments";
import { Button } from "./ui/button";

export function useReviewComments(profileID: string, sessionID?: string) {
  const runtime = useAtomValue(runtimeAtom);
  const enabled = Boolean(sessionID && runtime?.profileID === profileID);
  const [, setState] = useAtom(
    composerStateAtomFamily(composerScope(profileID, `session:${sessionID ?? ""}`)),
  );
  const add = (path: string, range: SelectedLineRange, comment: string) => {
    if (!enabled || !canCommentOnRange(range) || !comment.trim()) return;
    const item: ReviewComment = {
      id: crypto.randomUUID(),
      path,
      selection: commentSelection(range),
      comment: comment.trim(),
      side: range.side,
    };
    setState((current) =>
      current.edit
        ? { ...current, edit: { ...current.edit, comments: [...current.edit.comments, item] } }
        : { ...current, comments: [...current.comments, item] },
    );
  };
  return { enabled, add };
}

export function ReviewCommentEditor({
  path,
  range,
  onSave,
  onCancel,
}: {
  path: string;
  range: SelectedLineRange;
  onSave(comment: string): void;
  onCancel(): void;
}) {
  const [text, setText] = useState("");
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
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Add comment
        </Button>
      </div>
    </form>
  );
}
