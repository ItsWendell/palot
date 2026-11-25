import * as React from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";

import { ScrollFadeArea } from "@/components/ui/scroll-fade-area";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";
import { useComposerDock, useControllableState } from "./dock";

type ComposerPanelProps = Omit<
  React.ComponentProps<"div">,
  "onAnimationStart" | "onDrag" | "onDragEnd" | "onDragStart"
> & {
  open?: boolean;
  defaultOpen?: boolean;
  /** Called with `false` when Escape is pressed inside the panel. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * The slot that grows from the card's top edge (launcher, request or a tab's panel). It holds
 * one keyed child: its content is in the DOM on the first frame, only height and opacity
 * animate, and a child with a new `key` cross-fades in while the height follows, without
 * collapsing. Under reduced motion the height changes at once and only the fades remain.
 */
function ComposerPanel({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComposerPanelProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <ComposerPanelFrame key="composer-panel" onClose={() => setOpen(false)} {...props}>
          {children}
        </ComposerPanelFrame>
      ) : null}
    </AnimatePresence>
  );
}

function ComposerPanelFrame({
  id,
  role = "region",
  className,
  children,
  onClose,
  onKeyDown,
  ...props
}: Omit<ComposerPanelProps, "open" | "defaultOpen" | "onOpenChange"> & { onClose: () => void }) {
  const dock = useComposerDock();
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    setHeight(inner.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const child = React.Children.toArray(children).find(React.isValidElement) ?? null;
  const contentKey = child?.key ?? "content";
  return (
    <motion.div
      id={id ?? dock?.panelId}
      role={role}
      data-slot="composer-panel"
      data-state={present ? "open" : "closed"}
      data-open={present ? "" : undefined}
      // A closing panel takes no input and leaves the accessibility tree.
      inert={!present}
      className={cn("relative z-10 shrink-0 overflow-hidden border-b border-border/60", className)}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: height ?? "auto", opacity: 1 }}
      exit={{
        height: 0,
        opacity: 0,
        transition: reduceMotion
          ? { height: { duration: 0 }, opacity: spring.moderate.exit }
          : spring.moderate.exit,
      }}
      transition={{
        height: reduceMotion ? { duration: 0 } : spring.moderate,
        opacity: spring.moderate,
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      {...(props as Omit<React.ComponentProps<typeof motion.div>, "children">)}
    >
      <div
        ref={innerRef}
        data-slot="composer-panel-content"
        className="relative flex max-h-[var(--composer-panel-max-height,min(24rem,48vh))] flex-col"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <ComposerPanelContent key={contentKey}>{child}</ComposerPanelContent>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * One keyed child of the panel. While it fades out for the next one it takes no input and
 * leaves the accessibility tree, so a click meant for what is leaving cannot reach it.
 */
function ComposerPanelContent({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div
      className="flex min-h-0 w-full flex-col"
      data-state={present ? "open" : "closed"}
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: spring.fast.exit }}
      transition={spring.moderate}
    >
      {children}
    </motion.div>
  );
}

/** Scrolling content inside the panel, faded at the cut edges. The panel caps the height. */
function ComposerPanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <ScrollFadeArea
      data-slot="composer-panel-body"
      containerClassName="flex min-h-0 flex-col"
      className={cn("palot-native-scrollbar h-auto min-h-0 shrink", className)}
      {...props}
    />
  );
}

export { ComposerPanel, ComposerPanelBody };
