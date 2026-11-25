import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";

/** Messages already written, inside the card above the text field. */
function ComposerQueue({
  className,
  "aria-label": ariaLabel = "Queued messages",
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      aria-label={ariaLabel}
      data-slot="composer-queue"
      className={cn("flex shrink-0 flex-col border-b border-border/60 px-1.5 py-1", className)}
      {...props}
    />
  );
}

const composerQueueRowVariants = cva(
  "group/queue-row grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1 text-compact outline-none focus-visible:ring-2 focus-visible:ring-ring/30 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
  {
    variants: {
      state: {
        queued: "",
        editing: "bg-muted/40 text-muted-foreground",
        blocked: "[&>svg]:text-warning",
        paused: "[&>svg]:text-warning",
      },
    },
    defaultVariants: { state: "queued" },
  },
);

const ACTION_SELECTOR = "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * One queued message: a leading icon, `ComposerQueueRowText`, `ComposerQueueRowActions` and an
 * optional `ComposerQueueRowStatus` line. The row is one tab stop; its actions show while it
 * is hovered or focused, and ←/→ move between the row and its actions.
 */
function ComposerQueueRow({
  state = "queued",
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof composerQueueRowVariants>) {
  return (
    <div
      role="group"
      tabIndex={0}
      data-slot="composer-queue-row"
      data-state={state}
      className={cn(composerQueueRowVariants({ state }), className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const row = event.currentTarget;
        const stops = [
          row,
          ...Array.from(row.querySelectorAll<HTMLElement>(ACTION_SELECTOR)).filter(
            (element) => element !== row,
          ),
        ];
        const current = stops.indexOf(document.activeElement as HTMLElement);
        if (current < 0) return;
        const next = stops[current + (event.key === "ArrowRight" ? 1 : -1)];
        if (!next) return;
        event.preventDefault();
        next.focus();
      }}
      {...props}
    />
  );
}

function ComposerQueueRowText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-queue-row-text"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  );
}

/**
 * The row's actions. Hidden with opacity (so they stay reachable) until the row is hovered or
 * focused; a child marked `data-pinned` stays visible, as the first row's "Steer now" does.
 */
function ComposerQueueRowActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-queue-row-actions"
      className={cn(
        "flex shrink-0 items-center gap-0.5 *:opacity-0 *:transition-opacity *:data-pinned:opacity-100 group-focus-within/queue-row:*:opacity-100 group-hover/queue-row:*:opacity-100 group-data-[state=editing]/queue-row:*:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

/** A second line under the text: why it waits ("Waiting for `bun test` to finish"). */
function ComposerQueueRowStatus({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="composer-queue-row-status"
      className={cn(
        "col-span-2 col-start-2 m-0 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The collapsed queue's header ("3 queued · next: …") with a chevron. Pass `aria-expanded`;
 * the chevron follows it.
 */
function ComposerQueueSummary({ className, children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-queue-summary"
      className={cn(
        "group/queue-summary flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-compact text-muted-foreground outline-none transition-colors hover:bg-(--control-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        aria-hidden="true"
        className="ms-auto transition-transform group-aria-expanded/queue-summary:rotate-180 motion-reduce:transition-none"
      />
    </button>
  );
}

export {
  ComposerQueue,
  ComposerQueueRow,
  ComposerQueueRowActions,
  ComposerQueueRowStatus,
  ComposerQueueRowText,
  ComposerQueueSummary,
};
