import { ArrowLeft, ArrowRight, Eye, FileText, MessageCircleQuestion, Send } from "lucide-react";
import { useMemo } from "react";
import type { PullRequestFile } from "../../../../shared/source-control-contract";
import type { ReviewGuideStop } from "../../../lib/review-guide";
import { MarkdownContent } from "../../markdown-content";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import type { PendingReviewController } from "../code/pending-review-store";
import { GuideExcerpt, NoteMarker } from "./guide-excerpt";
import { ATTENTION_LABELS, letterStopNotes } from "./guide-model";

/**
 * One stop of the tour: what it is about, the code that carries it, and the two things a
 * reader does with it: comment on its lines for the review, or ask about it in a new task.
 */
export function GuideStop({
  stop,
  index,
  stopCount,
  files,
  pending,
  canComment,
  onStep,
  onAsk,
  onFinish,
}: {
  stop: ReviewGuideStop;
  index: number;
  stopCount: number;
  /** The change's files by path, as the Code tab has them. */
  files: ReadonlyMap<string, PullRequestFile>;
  pending: PendingReviewController;
  canComment: boolean;
  onStep(delta: 1 | -1): void;
  /** Starts a task about this stop, with a suggested question or none. */
  onAsk(question?: string): void;
  onFinish(): void;
}) {
  const { lettered, byExcerpt } = useMemo(() => letterStopNotes(stop), [stop]);
  const last = index === stopCount - 1;
  return (
    <article
      aria-labelledby="guide-stop-title"
      className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4 px-4 py-4"
    >
      <header className="flex flex-col gap-1.5">
        <p className="text-meta text-muted-foreground tabular-nums">
          Stop {index + 1} of {stopCount}
        </p>
        <h3 id="guide-stop-title" className="text-base font-medium text-foreground">
          {stop.title}
        </h3>
        {stop.summary ? (
          <MarkdownContent value={stop.summary} className="text-sm text-muted-foreground" />
        ) : null}
      </header>

      {stop.attention ? (
        // A call for the reader to make, not a fault: it reads as a note, not an alert.
        <Banner
          status="warning"
          icon={Eye}
          role="note"
          title={`Look closely · ${ATTENTION_LABELS[stop.attention.kind]}`}
        >
          <MarkdownContent value={stop.attention.note} />
        </Banner>
      ) : null}

      {stop.excerpts.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-3">
          {stop.excerpts.map((excerpt, excerptIndex) => (
            <GuideExcerpt
              key={`${excerpt.path}:${excerpt.side}:${excerpt.start}-${excerpt.end}`}
              excerpt={excerpt}
              file={files.get(excerpt.path)}
              notes={byExcerpt[excerptIndex] ?? []}
              pending={pending}
              canComment={canComment}
            />
          ))}
        </div>
      ) : null}

      {lettered.length > 0 ? (
        <section aria-label="Notes" className="flex flex-col gap-2">
          <h4 className="text-meta font-medium text-muted-foreground">Notes</h4>
          <ol className="flex flex-col gap-2.5">
            {lettered.map(({ marker, note }) => (
              <li key={marker} className="flex min-w-0 gap-2">
                <NoteMarker marker={marker} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-foreground">{note.title}</span>
                    <span className="truncate font-mono text-micro text-muted-foreground">
                      {note.path.split("/").at(-1)}:{note.line}
                    </span>
                  </p>
                  {note.body ? (
                    <MarkdownContent value={note.body} className="text-sm text-muted-foreground" />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {stop.files.length > 0 ? (
        <section aria-label="Files in this stop" className="flex flex-col gap-1.5">
          <h4 className="text-meta font-medium text-muted-foreground">
            {stop.excerpts.length > 0 ? "Also in this stop" : "Files in this stop"}
          </h4>
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-md border border-border">
            {stop.files.map((entry) => {
              const file = files.get(entry.path);
              return (
                <li key={entry.path} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
                  <FileText
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate font-mono text-meta text-foreground">
                    {entry.path}
                  </span>
                  {entry.note ? (
                    <span className="min-w-0 truncate text-meta text-muted-foreground">
                      {entry.note}
                    </span>
                  ) : null}
                  {file ? (
                    <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-diff tabular-nums">
                      <span className="text-success">+{file.additions}</span>
                      <span className="text-destructive">−{file.deletions}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-label="Questions" className="flex flex-col gap-1.5">
        {stop.questions.length > 0 ? (
          <h4 className="text-meta font-medium text-muted-foreground">Questions to ask</h4>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {stop.questions.map((question) => (
            <Button
              key={question}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full py-1 text-left whitespace-normal"
              aria-label={`Ask: ${question}`}
              onClick={() => onAsk(question)}
            >
              <MessageCircleQuestion data-icon="inline-start" aria-hidden="true" />
              {question}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => onAsk()}>
            <MessageCircleQuestion data-icon="inline-start" aria-hidden="true" />
            Ask about this stop
          </Button>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={index === 0}
          onClick={() => onStep(-1)}
        >
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Previous
        </Button>
        {last ? (
          <Button type="button" size="sm" onClick={onFinish}>
            <Send data-icon="inline-start" aria-hidden="true" />
            Finish review
          </Button>
        ) : (
          <Button type="button" size="sm" className="min-w-0" onClick={() => onStep(1)}>
            <span className="min-w-0 truncate">Next</span>
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      </footer>
    </article>
  );
}
