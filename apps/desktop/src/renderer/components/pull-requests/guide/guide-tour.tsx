import { ChevronLeft, ChevronRight, ListOrdered, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  pullRequestKey,
  type PullRequestDetail,
  type PullRequestFiles,
} from "../../../../shared/source-control-contract";
import { cn } from "../../../lib/cn";
import type { ReviewGuide, ReviewGuideStop } from "../../../lib/review-guide";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { usePendingReview } from "../code/pending-review-store";
import { PendingCommentsTray, PullRequestReviewPopover } from "../code/pull-request-review-popover";
import { stepStop, stopSubline } from "./guide-model";
import { GuideStop } from "./guide-stop";

/** Where the reader is in each guide, for as long as the app is open. */
const positions = new Map<string, number>();

/** Keys that step through the tour; arrows match reading direction, j and k match lists. */
function stepFor(event: KeyboardEvent): 1 | -1 | 0 {
  if (event.defaultPrevented || event.isComposing) return 0;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return 0;
  const delta =
    event.key === "ArrowRight" || event.key === "j"
      ? 1
      : event.key === "ArrowLeft" || event.key === "k"
        ? -1
        : 0;
  if (delta === 0) return 0;
  const target = event.target instanceof Element ? event.target : null;
  if (target) {
    if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"))
      return 0;
    // Tabs, menus, popovers and dialogs keep their own arrow keys.
    if (target.closest('[role="tablist"], [role="menu"], [role="listbox"], [role="dialog"]'))
      return 0;
    // Arrows scroll a long line in an excerpt sideways.
    if (event.key.startsWith("Arrow") && target.closest("[data-guide-excerpt]")) return 0;
  }
  return delta;
}

/**
 * The guide as a tour: a rail of stops beside the stop being read, with ←/→ (or j/k) to move
 * through it. Line comments join the pending review the Code tab collects, and the last
 * stop's Finish review opens the same review popover.
 */
export function GuideTour({
  pullRequest,
  guide,
  files,
  banner,
  onAsk,
}: {
  pullRequest: PullRequestDetail;
  guide: ReviewGuide;
  files: PullRequestFiles | undefined;
  /** The stale, running, or failed notice above the stop. */
  banner: ReactNode;
  onAsk(stop: ReviewGuideStop, index: number, question?: string): void;
}) {
  const progressKey = `${pullRequestKey(pullRequest)}:${guide.generatedAt}`;
  const stopCount = guide.stops.length;
  const [stored, setStored] = useState(() => positions.get(progressKey) ?? 0);
  const position = Math.max(Math.min(stored, stopCount - 1), 0);
  const stop = guide.stops[position] ?? null;
  const pending = usePendingReview(pullRequestKey(pullRequest));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fileMap = useMemo(
    () => new Map((files?.files ?? []).map((file) => [file.path, file])),
    [files],
  );

  const goTo = useCallback(
    (next: number) => {
      positions.set(progressKey, next);
      setStored(next);
      setRailOpen(false);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [progressKey],
  );
  const step = useCallback(
    (delta: 1 | -1) => goTo(stepStop(position, delta, stopCount)),
    [goTo, position, stopCount],
  );

  // A pending comment opens the stop whose excerpt shows its line, when one does.
  const revealComment = (path: string, line: number, side: "LEFT" | "RIGHT") => {
    const index = guide.stops.findIndex((candidate) =>
      candidate.excerpts.some(
        (excerpt) =>
          excerpt.path === path &&
          (excerpt.side === "old") === (side === "LEFT") &&
          excerpt.start <= line &&
          line <= excerpt.end,
      ),
    );
    if (index >= 0) goTo(index);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = stepFor(event);
      if (delta === 0) return;
      event.preventDefault();
      step(delta);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [step]);

  const commitOid = files?.headOid ?? pullRequest.headOid;
  return (
    <div className="@container/pr-guide flex h-full min-h-[28rem] flex-1 flex-col bg-background">
      <div className="@container/pr-code flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Button
          type="button"
          variant={railOpen ? "secondary" : "ghost"}
          size="icon-sm"
          className="@min-[46rem]/pr-guide:hidden"
          aria-label={railOpen ? "Hide stops" : "Show stops"}
          aria-pressed={railOpen}
          onClick={() => setRailOpen((value) => !value)}
        >
          <ListOrdered aria-hidden="true" />
        </Button>
        <NavButton
          label="Previous stop"
          keys="ArrowLeft k"
          hint="← or K"
          disabled={position === 0}
          onClick={() => step(-1)}
        >
          <ChevronLeft />
        </NavButton>
        <NavButton
          label="Next stop"
          keys="ArrowRight j"
          hint="→ or J"
          disabled={position >= stopCount - 1}
          onClick={() => step(1)}
        >
          <ChevronRight />
        </NavButton>
        <span className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
          Stop {position + 1} of {stopCount}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <PendingCommentsTray pending={pending} onReveal={revealComment} />
          <PullRequestReviewPopover
            pullRequest={pullRequest}
            commitOid={commitOid}
            pending={pending}
            open={reviewOpen}
            onOpenChange={setReviewOpen}
          />
        </div>
      </div>
      <div className="relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden @min-[46rem]/pr-guide:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          aria-label="Guide stops"
          className={cn(
            "absolute inset-0 z-10 min-h-0 flex-col border-r border-border bg-background @min-[46rem]/pr-guide:static @min-[46rem]/pr-guide:z-auto @min-[46rem]/pr-guide:flex",
            railOpen ? "flex" : "hidden",
          )}
        >
          <div className="flex h-8 shrink-0 items-center border-b border-border px-2 text-meta text-muted-foreground">
            <span className="tabular-nums">
              {stopCount} {stopCount === 1 ? "stop" : "stops"}
            </span>
            {guide.model ? <span className="ml-1 truncate">· {guide.model}</span> : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto @min-[46rem]/pr-guide:hidden"
              aria-label="Close stops"
              onClick={() => setRailOpen(false)}
            >
              <X />
            </Button>
          </div>
          <ol className="palot-native-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
            {guide.stops.map((candidate, index) => (
              <li key={`${index}:${candidate.title}`}>
                <button
                  type="button"
                  aria-current={index === position ? "step" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    index === position ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                  )}
                  onClick={() => goTo(index)}
                >
                  <span
                    className={cn(
                      "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-micro tabular-nums",
                      index === position
                        ? "border-foreground/40 text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm text-foreground">
                      <span className="sr-only">Stop {index + 1}: </span>
                      {candidate.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
                      {candidate.attention ? (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-warning"
                          title="Look closely"
                        />
                      ) : null}
                      {candidate.attention ? <span className="sr-only">Look closely, </span> : null}
                      {stopSubline(candidate)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
        <div
          ref={scrollRef}
          className="palot-native-scrollbar min-h-0 min-w-0 overflow-y-auto bg-background"
        >
          {banner ? <div className="mx-auto max-w-4xl px-4 pt-4">{banner}</div> : null}
          {stop ? (
            <GuideStop
              key={position}
              stop={stop}
              index={position}
              stopCount={stopCount}
              files={fileMap}
              pending={pending}
              canComment={Boolean(files)}
              onStep={step}
              onAsk={(question) => onAsk(stop, position, question)}
              onFinish={() => setReviewOpen(true)}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">This guide has no stops.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NavButton({
  label,
  keys,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  keys: string;
  hint: string;
  disabled: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-keyshortcuts={keys}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label} ({hint})
      </TooltipContent>
    </Tooltip>
  );
}
