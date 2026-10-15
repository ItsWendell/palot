"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";
import { Button } from "@/components/ui/button";
import { SurfaceBackdrop, type SurfaceBackdropTone } from "@/components/ui/surface-backdrop";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/** React's drag and CSS-animation handlers collide with motion's gesture props of the same name. */
function dialogMotionProps(props: React.HTMLAttributes<HTMLDivElement>) {
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
 * The backdrop fades on spring.slow and leaves on its quicker exit. Base UI waits for the
 * opacity animation (WAAPI) before it unmounts.
 */
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/80 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      render={(renderProps, state) => {
        const exiting = state.transitionStatus === "ending";
        return (
          <motion.div
            {...dialogMotionProps(renderProps as React.HTMLAttributes<HTMLDivElement>)}
            initial={{ opacity: 0 }}
            animate={{ opacity: exiting ? 0 : 1 }}
            transition={exiting ? spring.slow.exit : spring.slow}
          />
        );
      }}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  surfaceTone = "popover",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  overlayClassName?: string;
  surfaceTone?: SurfaceBackdropTone;
}) {
  const reduceMotion = useReducedMotion();
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 };
  const shown = reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 };
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 isolate z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm/relaxed text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm",
          className,
        )}
        // Enter rides spring.slow, exit its quicker tween; Reduce Motion fades only.
        render={(renderProps, state) => {
          const exiting = state.transitionStatus === "ending";
          return (
            <motion.div
              {...dialogMotionProps(renderProps as React.HTMLAttributes<HTMLDivElement>)}
              initial={hidden}
              animate={exiting ? hidden : shown}
              transition={exiting ? spring.slow.exit : spring.slow}
            />
          );
        }}
        {...props}
      >
        <SurfaceBackdrop tone={surfaceTone} />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
