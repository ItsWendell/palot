import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { SurfaceBackdrop } from "@/components/ui/surface-backdrop";
import { cn } from "@/lib/cn";

/** What the card is doing; parts restyle from it (`group-data-[mode=shell]/composer:`). */
export type ComposerMode = "message" | "shell" | "launcher" | "request";

/**
 * The bordered card. Its border never changes on focus, so typing never flashes it; paint
 * is contained so its contents repaint without the transcript behind it.
 */
function Composer({
  mode = "message",
  disabled = false,
  dragOver = false,
  className,
  render,
  ref,
  children,
  ...props
}: useRender.ComponentProps<"div"> & {
  mode?: ComposerMode;
  disabled?: boolean;
  dragOver?: boolean;
}) {
  return useRender({
    defaultTagName: "div",
    render,
    ref,
    props: mergeProps<"div">(
      {
        className: cn(
          "palot-composer group/composer @container/composer relative isolate flex min-w-0 flex-col overflow-hidden border [contain:paint]",
          // Paint containment clips outer shadows, so the drop ring sits inside the border.
          "data-[drag-over]:border-ring data-[drag-over]:inset-ring-2 data-[drag-over]:inset-ring-ring/30",
          "data-[disabled]:*:data-[slot=composer-input-area]:opacity-60",
          className,
        ),
        children: (
          <>
            <SurfaceBackdrop tone="composer" />
            {children}
          </>
        ),
      },
      props,
    ),
    state: { slot: "composer", mode, disabled, dragOver },
    stateAttributesMapping: {
      mode: (value) => ({ "data-mode": value }),
      disabled: (value) => (value ? { "data-disabled": "" } : null),
      dragOver: (value) => (value ? { "data-drag-over": "" } : null),
    },
  });
}

/**
 * The chips above the text (attachments, comments, uploads): one row that scrolls
 * sideways when it runs out of room, with its cut edges faded.
 */
function ComposerHeader({ className, style, onScroll, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });
  const update = React.useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const end = element.scrollWidth - element.clientWidth - element.scrollLeft;
    setEdges((current) => {
      const next = { start: element.scrollLeft > 1, end: end > 1 };
      return current.start === next.start && current.end === next.end ? current : next;
    });
  }, []);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  });
  const fade = "1.5rem";
  const maskImage =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? "transparent" : "black"}, black ${fade}, black calc(100% - ${fade}), ${edges.end ? "transparent" : "black"})`
      : undefined;
  return (
    <div
      ref={ref}
      role="group"
      data-slot="composer-header"
      data-scroll-start={edges.start || undefined}
      data-scroll-end={edges.end || undefined}
      className={cn(
        "flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none] *:shrink-0 [&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={{ maskImage, WebkitMaskImage: maskImage, ...style }}
      onScroll={(event) => {
        onScroll?.(event);
        update();
      }}
      {...props}
    />
  );
}

/** Holds the text field (the editor is the caller's) and styles its placeholder and shell mode. */
function ComposerInputArea({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-input-area"
      className={cn(
        "relative min-w-0 px-5 pt-3 pb-1 text-sm transition-opacity",
        "[&_[data-placeholder]]:before:text-(--placeholder-foreground) [&_textarea::placeholder]:text-(--placeholder-foreground)",
        "group-data-[mode=shell]/composer:font-mono group-data-[mode=shell]/composer:text-code",
        className,
      )}
      {...props}
    />
  );
}

/** One inline error about the message being written, under the text. Never a stack of rows. */
function ComposerError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      data-slot="composer-error"
      className={cn(
        "m-0 flex min-w-0 items-center gap-1.5 px-5 pb-1 text-meta text-destructive [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export { Composer, ComposerError, ComposerHeader, ComposerInputArea };
