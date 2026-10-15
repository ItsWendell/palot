import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { ScrollAreaRoot, ScrollBar, ScrollViewport } from "../ui/scroll-area";

/** Distance from the bottom that still counts as reading the latest text. */
const FOLLOW_SLACK_PX = 24;

/**
 * A height-capped block inside the transcript with the same overlay scrollbar as the
 * transcript itself. `viewportClassName` sets the cap (e.g. `max-h-80`). With `follow`,
 * new content keeps the block pinned to its end until the reader scrolls up.
 */
export function BoundedScroll({
  children,
  className,
  viewportClassName,
  follow = false,
  label,
}: {
  children: ReactNode;
  className?: string;
  viewportClassName: string;
  follow?: boolean;
  label?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!follow || !viewport || !content || typeof ResizeObserver === "undefined") return;
    const pin = () => {
      if (atEnd.current) viewport.scrollTop = viewport.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    return () => observer.disconnect();
  }, [follow]);

  return (
    <ScrollAreaRoot
      data-slot="scroll-area"
      className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
    >
      <ScrollViewport
        ref={viewportRef}
        aria-label={label}
        className={cn("min-h-0 overflow-x-hidden overflow-y-auto outline-none", viewportClassName)}
        onScroll={(event) => {
          const element = event.currentTarget;
          atEnd.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
      >
        <div ref={contentRef}>{children}</div>
      </ScrollViewport>
      <ScrollBar />
    </ScrollAreaRoot>
  );
}
