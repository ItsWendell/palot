import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { cn } from "../lib/cn";
import { spring } from "../lib/springs";
import { Dialog } from "./ui/dialog";
import { SurfaceBackdrop } from "./ui/surface-backdrop";

/** React's drag and CSS-animation handlers collide with motion's gesture props of the same name. */
function motionProps(props: HTMLAttributes<HTMLDivElement>) {
  const {
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...rest
  } = props;
  return rest;
}

/**
 * The command palette's modal shell. It opens with its top edge fixed where a panel at the
 * cap height, min(440px, 76dvh), would sit centered, so the search field never moves while
 * results filter down. Enter rides `spring.slow`, exit its quicker tween; Reduce Motion fades
 * only. Base UI waits for the WAAPI opacity animation before it unmounts the popup.
 */
export function CommandPaletteDialog({
  open,
  onOpenChange,
  initialFocus,
  finalFocus,
  className,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"];
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
  className?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 };
  const shown = reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={(props, state) => {
            const exiting = state.transitionStatus === "ending";
            return (
              <motion.div
                {...motionProps(props as HTMLAttributes<HTMLDivElement>)}
                data-slot="dialog-overlay"
                className="palot-command-overlay fixed inset-0 isolate z-50"
                initial={{ opacity: 0 }}
                animate={{ opacity: exiting ? 0 : 1 }}
                transition={exiting ? spring.slow.exit : spring.slow}
              />
            );
          }}
        />
        <DialogPrimitive.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          render={(props, state) => {
            const exiting = state.transitionStatus === "ending";
            return (
              <motion.div
                {...motionProps(props as HTMLAttributes<HTMLDivElement>)}
                data-slot="dialog-content"
                className={cn(
                  "palot-command-palette fixed top-[max(12dvh,calc(50dvh-220px))] left-1/2 isolate z-50 flex max-h-[min(440px,76dvh)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-popover text-sm/relaxed text-popover-foreground ring-1 ring-foreground/10 outline-none",
                  className,
                )}
                initial={hidden}
                animate={exiting ? hidden : shown}
                transition={exiting ? spring.slow.exit : spring.slow}
              />
            );
          }}
        >
          <SurfaceBackdrop tone="command" />
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
