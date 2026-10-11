// Adapted from Fluid Functionalism (MIT, github.com/mickadesign/fluid-functionalism @
// bf9ece46728035afef54feef6ac67e1f413cc0b0), registry/default/fluid-hover-highlight.tsx.
// Palot changes: `motion/react`, Palot's reduced-motion signal, and a themeable fill.
// See THIRD_PARTY_NOTICES.md.
import { AnimatePresence, motion, type Transition } from "motion/react";
import type { ItemRect, UseFluidHoverReturn } from "../../hooks/use-fluid-hover";
import { useReducedMotion } from "../../hooks/use-reduced-motion";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/springs";

/** What the highlight reads off the hook. */
export type FluidHoverSource = Pick<
  UseFluidHoverReturn,
  "activeIndex" | "itemRects" | "isMeasured" | "session"
>;

interface HighlightFromHook {
  /** The highlight sits on `itemRects[activeIndex]` once measured. */
  hover: FluidHoverSource;
  /** Keep the list's state but show nothing (a closed popup). */
  hidden?: boolean;
  rect?: never;
  session?: never;
}

interface HighlightFromRect {
  /** A rect resolved by the caller, in the container's coordinate space. */
  rect: ItemRect | null;
  session: number;
  hover?: never;
  hidden?: never;
}

export type FluidHoverHighlightProps = (HighlightFromHook | HighlightFromRect) & {
  /** Where a fresh pointer session fades in from (a checked row). Defaults to the rect. */
  from?: ItemRect | null;
  /** Fill, radius and z-index. The container must be `position: relative`. */
  className?: string;
  /** Positional transition; `false` snaps without travel. */
  transition?: Transition | false;
};

const fade: Transition = { duration: 0.08 };
const snap: Transition = { duration: 0 };

export function toTarget(rect: ItemRect) {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Reduced motion keeps the opacity fade and drops the travel. */
export function resolveHighlightTransition(
  transition: Transition | false | undefined,
  reduceMotion: boolean,
): Transition {
  const positional = transition === false || reduceMotion ? snap : (transition ?? spring.fast);
  return { ...positional, opacity: fade };
}

export function resolveHighlightSource(props: FluidHoverHighlightProps): {
  rect: ItemRect | null;
  session: number;
} {
  if (props.hover) {
    const { activeIndex, itemRects, isMeasured, session } = props.hover;
    const rect =
      !props.hidden && isMeasured && activeIndex !== null ? (itemRects[activeIndex] ?? null) : null;
    return { rect, session };
  }
  return { rect: props.rect, session: props.session };
}

/**
 * One hover fill that glides between the rows `useFluidHover` measures instead of
 * blinking per row. It moves on a transform, so travel stays on the compositor.
 */
export function FluidHoverHighlight(props: FluidHoverHighlightProps) {
  const { from, className, transition } = props;
  const { rect, session } = resolveHighlightSource(props);
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {rect ? (
        <motion.div
          key={session}
          data-slot="fluid-hover-highlight"
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 left-0 rounded-md bg-(--fluid-hover)",
            className,
          )}
          initial={{ opacity: 0, ...toTarget(from ?? rect) }}
          animate={{ opacity: 1, ...toTarget(rect) }}
          exit={{ opacity: 0, transition: spring.fast.exit }}
          transition={resolveHighlightTransition(transition, reduceMotion)}
        />
      ) : null}
    </AnimatePresence>
  );
}
