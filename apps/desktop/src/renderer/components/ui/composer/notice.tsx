import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

const composerNoticeVariants = cva(
  "mb-1.5 flex min-h-9 min-w-0 items-center gap-2 rounded-lg border px-3 py-1 text-compact text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      // The tone washes the strip like Banner does; only the icon carries it at full strength.
      tone: {
        info: "border-[color-mix(in_oklch,var(--info)_28%,var(--border))] bg-[color-mix(in_oklch,var(--info)_8%,transparent)] [&>svg]:text-info",
        warning:
          "border-[color-mix(in_oklch,var(--warning)_28%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] [&>svg]:text-warning",
        destructive:
          "border-[color-mix(in_oklch,var(--destructive)_28%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,transparent)] [&>svg]:text-destructive",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

/**
 * The one condition line above the card (connection lost, workspace missing, usage limit,
 * context nearly full). Compose an icon, `ComposerNoticeText`, at most one action and
 * `ComposerNoticeMore`. Keep it mounted and toggle `open` so it can animate out.
 */
function ComposerNotice({
  open = true,
  tone = "info",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof composerNoticeVariants> & { open?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="composer-notice"
          className="min-w-0 overflow-hidden"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{
            opacity: 0,
            height: 0,
            transition: reduceMotion
              ? { height: { duration: 0 }, opacity: spring.moderate.exit }
              : spring.moderate.exit,
          }}
          transition={reduceMotion ? { height: { duration: 0 } } : spring.moderate}
        >
          <div
            role="status"
            data-slot="composer-notice"
            data-tone={tone}
            className={cn(composerNoticeVariants({ tone }), className)}
            {...props}
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ComposerNoticeText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-notice-text"
      className={cn("min-w-0 flex-1 truncate", className)}
      {...props}
    />
  );
}

/** The notice's one action. */
function ComposerNoticeAction({
  variant = "outline",
  size = "xs",
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="composer-notice-action"
      variant={variant}
      size={size}
      className={cn("shrink-0 text-meta!", className)}
      {...props}
    />
  );
}

/** "+1": more conditions wait behind this one. Pressing it shows the next. */
function ComposerNoticeMore({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-notice-more"
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-meta text-muted-foreground tabular-nums outline-none transition-colors hover:bg-(--control-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

export {
  ComposerNotice,
  ComposerNoticeAction,
  ComposerNoticeMore,
  ComposerNoticeText,
  composerNoticeVariants,
};
