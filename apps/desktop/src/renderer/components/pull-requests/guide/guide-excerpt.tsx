import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import type { PullRequestFile } from "../../../../shared/source-control-contract";
import { resolvedAppearanceAtom } from "../../../atoms/appearance";
import type { ReviewGuideExcerpt } from "../../../lib/review-guide";
import { canCommentOnRange } from "../../../lib/review-comments";
import { pierreViewerStyle, pierreViewerTheme } from "../../file-viewer-theme";
import { ReviewCommentEditor } from "../../review-comment-editor";
import type { PendingReviewController } from "../code/pending-review-store";
import {
  draftAnchorFromRange,
  isLineInFileDiff,
  parsePullRequestPatch,
  toViewerSide,
  type PendingReviewComment,
} from "../code/pull-request-code-model";
import { ReviewAnnotation } from "../code/pull-request-review-annotation";
import { sliceExcerpt, type LetteredNote } from "./guide-model";

interface ExcerptAnnotation {
  markers: LetteredNote[];
  pending: PendingReviewComment[];
}

/**
 * One excerpt of a stop, drawn by the same renderer as the Code tab from the file's patch cut
 * down to the excerpt's lines, so numbers and colors match the full diff. Selecting lines adds
 * a comment to the pending review the Code tab collects.
 */
export function GuideExcerpt({
  excerpt,
  file,
  notes,
  pending,
  canComment,
}: {
  excerpt: ReviewGuideExcerpt;
  /** The file as the Code tab has it; undefined when it is no longer in the change. */
  file: PullRequestFile | undefined;
  notes: readonly LetteredNote[];
  pending: PendingReviewController;
  canComment: boolean;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const slice = useMemo(() => (file ? sliceExcerpt(file, excerpt) : null), [excerpt, file]);
  const fileDiff = useMemo(
    () => (file && slice ? parsePullRequestPatch(file, slice.hunks) : null),
    [file, slice],
  );
  // Comments are checked against the whole file's diff, as the Code tab does.
  const fullDiff = useMemo(
    () => (file?.patch ? parsePullRequestPatch(file, file.patch) : null),
    [file],
  );

  const comments = pending.review.comments;
  const annotations = useMemo(() => {
    const groups = new Map<string, DiffLineAnnotation<ExcerptAnnotation>>();
    const at = (side: "additions" | "deletions", lineNumber: number) => {
      const key = `${side}:${lineNumber}`;
      let group = groups.get(key);
      if (!group) {
        group = { side, lineNumber, metadata: { markers: [], pending: [] } };
        groups.set(key, group);
      }
      return group.metadata;
    };
    const noteSide = excerpt.side === "new" ? "additions" : "deletions";
    for (const entry of notes) at(noteSide, entry.note.line).markers.push(entry);
    for (const comment of comments) {
      const side = toViewerSide(comment.side);
      if (comment.path !== excerpt.path || !slice?.drawn[side].has(comment.line)) continue;
      at(side, comment.line).pending.push(comment);
    }
    return [...groups.values()];
  }, [comments, excerpt.path, excerpt.side, notes, slice]);

  const commentable = canComment && fullDiff !== null;
  const options = useMemo(
    () => ({
      ...pierreViewerTheme,
      theme: appearance.codeThemePair,
      themeType: appearance.scheme,
      diffStyle: "unified" as const,
      hunkSeparators: "line-info-basic" as const,
      lineDiffType: "word" as const,
      diffIndicators: "none" as const,
      expandUnchanged: false,
      enableLineSelection: commentable,
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        if (!range || !fullDiff || !canCommentOnRange(range)) return setSelection(null);
        const anchor = draftAnchorFromRange(range);
        const inDiff =
          isLineInFileDiff(fullDiff, anchor.side, anchor.line) &&
          (anchor.startLine === undefined ||
            isLineInFileDiff(fullDiff, anchor.side, anchor.startLine));
        setSelection(inDiff ? range : null);
      },
    }),
    [appearance.codeThemePair, appearance.scheme, commentable, fullDiff],
  );

  const lines =
    excerpt.start === excerpt.end
      ? `line ${excerpt.start}`
      : `lines ${excerpt.start}–${excerpt.end}`;
  return (
    <figure
      aria-label={`Excerpt ${excerpt.path} ${lines}`}
      data-guide-excerpt=""
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      <figcaption className="flex min-w-0 items-baseline gap-2 border-b border-border px-2.5 py-1.5 text-meta">
        <span className="min-w-0 truncate font-mono text-foreground" title={excerpt.path}>
          {excerpt.path}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {excerpt.side === "old" ? "removed, " : ""}
          {lines}
        </span>
        {excerpt.caption ? (
          <span className="ml-auto min-w-0 truncate text-muted-foreground">{excerpt.caption}</span>
        ) : null}
      </figcaption>
      {fileDiff && slice ? (
        <div className="min-w-0 overflow-x-auto text-diff">
          <FileDiff<ExcerptAnnotation>
            fileDiff={fileDiff}
            options={options}
            lineAnnotations={annotations}
            selectedLines={selection}
            style={pierreViewerStyle}
            renderAnnotation={(annotation) => (
              <div className="font-sans">
                {annotation.metadata.markers.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-background px-2 py-1 text-meta">
                    {annotation.metadata.markers.map(({ marker, note }) => (
                      <span key={marker} className="inline-flex items-center gap-1.5">
                        <NoteMarker marker={marker} />
                        <span className="text-foreground">{note.title}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {annotation.metadata.pending.length > 0 ? (
                  <ReviewAnnotation
                    group={{ threads: [], pending: annotation.metadata.pending }}
                    onRemovePending={pending.removeComment}
                  />
                ) : null}
              </div>
            )}
          />
        </div>
      ) : (
        <p className="px-2.5 py-2 text-meta text-muted-foreground">
          {file
            ? "These lines are no longer in the change."
            : "This file is no longer in the change."}
        </p>
      )}
      {selection ? (
        <ReviewCommentEditor
          key={`${selection.start}:${selection.end}:${selection.side}`}
          path={excerpt.path}
          range={selection}
          onSave={(text) => {
            if (!text.trim()) return;
            pending.addComment({
              path: excerpt.path,
              ...draftAnchorFromRange(selection),
              body: text.trim(),
            });
            setSelection(null);
          }}
          onCancel={() => setSelection(null)}
        />
      ) : null}
    </figure>
  );
}

/** The letter that ties a note to its line in an excerpt. */
export function NoteMarker({ marker }: { marker: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-info/15 text-micro font-medium text-foreground tabular-nums"
    >
      {marker}
    </span>
  );
}
