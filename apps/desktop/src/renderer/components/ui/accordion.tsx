// Panel height motion adapted from Fluid Functionalism (MIT,
// github.com/mickadesign/fluid-functionalism @ bf9ece46728035afef54feef6ac67e1f413cc0b0),
// registry/default/accordion.tsx. See THIRD_PARTY_NOTICES.md.
import * as React from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { motion } from "motion/react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";
import { ChevronDownIcon } from "lucide-react";

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col overflow-hidden rounded-md border", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b data-open:bg-muted/50", className)}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between gap-6 border border-transparent p-2 text-left text-sm/relaxed font-medium transition-all outline-none hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        {/* One chevron that turns with the panel (spring.fast's 80ms); reduced motion snaps. */}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          aria-hidden="true"
          className="pointer-events-none shrink-0 transition-transform duration-80 ease-out group-aria-expanded/accordion-trigger:rotate-180 motion-reduce:transition-none"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

type PanelRenderProps = React.HTMLAttributes<HTMLDivElement> & {
  hidden?: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * The panel springs its height to a measured pixel value on spring.fast and closes on its
 * quicker exit tween; opacity runs ahead so the body dissolves rather than being sliced.
 * Height only animates when this panel toggles: when content inside it resizes (a nested
 * accordion, streamed text) the height snaps, so it never chases a child's own animation.
 * Reduced motion opens and closes instantly.
 */
function AccordionPanelMotion({
  open,
  panelProps,
  className,
  children,
}: {
  open: boolean;
  panelProps: PanelRenderProps;
  className?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const [contentHeight, setContentHeight] = React.useState<number | null>(null);
  const [previousOpen, setPreviousOpen] = React.useState(open);
  const [toggling, setToggling] = React.useState(false);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setToggling(true);
  }
  // Base UI hides a closed panel at once; keep it visible until the close finishes.
  const [exitComplete, setExitComplete] = React.useState(!open);
  if (open && exitComplete) setExitComplete(false);

  const measureRef = React.useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    innerRef.current = element;
    if (!element) return;
    if (element.offsetHeight > 0) setContentHeight(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Ignore the 0 reported while the panel is hidden.
      if (element.offsetHeight > 0) setContentHeight(element.offsetHeight);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  React.useLayoutEffect(() => {
    if (open && innerRef.current && innerRef.current.offsetHeight > 0) {
      setContentHeight(innerRef.current.offsetHeight);
    }
  }, [open]);

  const instant = reduceMotion || !toggling;
  const {
    hidden: _hidden,
    style: _style,
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...rest
  } = panelProps;

  return (
    <motion.div
      {...rest}
      hidden={!open && (exitComplete || instant)}
      initial={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      animate={{ height: open ? (contentHeight ?? "auto") : 0, opacity: open ? 1 : 0 }}
      transition={
        instant
          ? { duration: 0 }
          : open
            ? { ...spring.fast, opacity: { duration: spring.fast.exit.duration } }
            : { ...spring.fast.exit, opacity: { duration: spring.fast.exit.duration * 0.66 } }
      }
      onAnimationComplete={() => {
        setToggling(false);
        if (!open) setExitComplete(true);
      }}
    >
      <div
        ref={measureRef}
        className={cn(
          "pt-0 pb-4 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

function AccordionContent({
  className,
  panelClassName,
  children,
  ...props
}: AccordionPrimitive.Panel.Props & {
  /** Classes for the clipping panel itself; `className` styles the content inside it. */
  panelClassName?: string;
}) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      keepMounted
      className={cn("overflow-hidden px-2 text-sm/relaxed", panelClassName)}
      {...props}
      render={(panelProps, state) => (
        <AccordionPanelMotion
          open={state.open}
          panelProps={panelProps as PanelRenderProps}
          className={typeof className === "string" ? className : undefined}
        >
          {children}
        </AccordionPanelMotion>
      )}
    />
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
