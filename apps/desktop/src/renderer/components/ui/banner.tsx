// Adapted from Fluid Functionalism (MIT, github.com/mickadesign/fluid-functionalism @
// bf9ece46728035afef54feef6ac67e1f413cc0b0), registry/default/banner.tsx.
// Palot changes: `motion/react`, Palot's reduced-motion signal and semantic tokens, a
// props-first API (title, body, actions), inline/section variants instead of fixed bars,
// no font-weight animation. See THIRD_PARTY_NOTICES.md.

import {
  animate,
  AnimatePresence,
  motion,
  PresenceContext,
  useMotionValue,
  usePresence,
  useTransform,
  type ValueAnimationTransition,
} from "motion/react";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { InfoIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

/**
 * Banner is Palot's one notice component: a status message with an optional title,
 * body, actions and dismiss control. Errors and warnings use `role="alert"` so a screen
 * reader interrupts; the rest use `role="status"`.
 *
 * Only the icon carries the status at full strength; the surface takes a light wash
 * of it, and text stays on the foreground ramp so it reads the same on every status.
 */
export type BannerStatus = "neutral" | "info" | "success" | "warning" | "error";

/** `inline` sits in a form or row; `section` heads a settings section or page. */
export type BannerVariant = "inline" | "section";

const TONE: Record<BannerStatus, string> = {
  neutral: "var(--muted-foreground)",
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--destructive)",
};

type ColoredStatus = Exclude<BannerStatus, "neutral">;

/**
 * Filled status shapes with the mark cut out in the page color: a solid shape carries
 * the status at icon size far better than a thin outline.
 */
function StatusGlyph({ status, className }: { status: ColoredStatus; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {status === "warning" ? (
        <path
          d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ) : (
        <circle cx="12" cy="12" r="10.5" fill="currentColor" />
      )}
      <g
        className="stroke-background"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {status === "success" ? (
          <path d="m8.5 12.25 2.5 2.5 4.5-5" />
        ) : status === "warning" ? (
          <path d="M12 9.5v3.5M12 17h.01" />
        ) : status === "error" ? (
          <path d="M12 7.5v5M12 16.5h.01" />
        ) : (
          <path d="M12 16.5v-5M12 7.5h.01" />
        )}
      </g>
    </svg>
  );
}

// ── Motion ───────────────────────────────────────────────────────────────────
// The space a banner takes (a one-row grid whose track runs between 0fr and 1fr) and
// the banner itself move separately. Appearing, the row opens and, a fast tier later,
// the banner fades in while growing slightly from its top edge. Dismissing, the row
// closes at once and the banner rides it, shrinking and fading so the closing row never
// cuts it. fr resolves from layout, so rewrapping text never waits on a measurement.
// In a flex column with a gap the row also takes back one gap, so nothing jumps when the
// banner mounts or unmounts. Reduced motion keeps the fades and snaps the row.

const motionConfig = {
  appearRow: {
    type: "spring",
    duration: spring.moderate.duration * 2,
    bounce: 0,
  } satisfies ValueAnimationTransition<number>,
  appearBanner: {
    type: "spring",
    duration: spring.slow.duration,
    bounce: 0,
    delay: spring.fast.duration,
  } satisfies ValueAnimationTransition<number>,
  dismissRow: {
    duration: spring.moderate.exit.duration * 2,
    ease: "easeInOut",
  } satisfies ValueAnimationTransition<number>,
  fromScale: 0.96,
  shrinkTo: 0.6,
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Hands keyboard focus held inside a closing banner to the next focusable element. */
function focusNeighbour(banner: HTMLElement) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !banner.contains(element) && (element.checkVisibility?.() ?? true),
  );
  const after = candidates.find(
    (element) => banner.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const before = candidates
    .filter((element) => banner.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
    .pop();
  (after ?? before)?.focus({ preventScroll: true });
}

function BannerMotion({ reduceMotion, children }: { reduceMotion: boolean; children: ReactNode }) {
  // A banner that is open on first render arrives already in place.
  const appear = useContext(PresenceContext)?.initial !== false;
  const [isPresent, safeToRemove] = usePresence();
  const safeToRemoveRef = useRef(safeToRemove);
  useEffect(() => {
    safeToRemoveRef.current = safeToRemove;
  });
  const scaled = !reduceMotion;

  const row = useMotionValue(appear ? 0 : 1);
  const shown = useMotionValue(appear ? 0 : 1);
  const scale = useMotionValue(appear && scaled ? motionConfig.fromScale : 1);
  const gap = useMotionValue(0);
  const overflow = useMotionValue<"visible" | "hidden">("visible");

  const gridTemplateRows = useTransform(row, (value) => `${value}fr`);
  const marginBottom = useTransform([row, gap], ([r, g]: number[]) => (r! - 1) * g!);
  // A mostly faded banner takes no clicks, so a leaving one can't be pressed twice.
  const pointerEvents = useTransform(shown, (value) => (value > 0.5 ? "auto" : "none"));

  const rootRef = useRef<HTMLDivElement | null>(null);
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element;
      const parent = element?.parentElement;
      if (!parent) return;
      const style = getComputedStyle(parent);
      const column =
        parent.children.length > 1 &&
        style.display.endsWith("flex") &&
        style.flexDirection.startsWith("column");
      gap.set(column ? Number.parseFloat(style.rowGap) || 0 : 0);
    },
    [gap],
  );

  useEffect(() => {
    if (isPresent) {
      overflow.set("visible");
      const open = animate(row, 1, reduceMotion ? { duration: 0 } : motionConfig.appearRow);
      const show = animate(shown, 1, reduceMotion ? spring.fast : motionConfig.appearBanner);
      const grow = scaled ? animate(scale, 1, motionConfig.appearBanner) : undefined;
      return () => {
        open.stop();
        show.stop();
        grow?.stop();
      };
    }

    const root = rootRef.current;
    if (root?.contains(document.activeElement)) focusNeighbour(root);

    if (reduceMotion) {
      const hide = animate(shown, 0, spring.fast.exit);
      void hide.then(() => safeToRemoveRef.current?.());
      return () => hide.stop();
    }

    overflow.set("hidden");
    const end = motionConfig.shrinkTo;
    const rowFrom = row.get();
    const shownFrom = shown.get();
    const scaleFrom = scale.get();
    const unfollow = row.on("change", (value) => {
      const left =
        rowFrom > end ? (value - end) / (rowFrom - end) : rowFrom > 0 ? value / rowFrom : 0;
      shown.set(shownFrom * Math.min(1, Math.max(0, left)));
      scale.set(Math.min(scaleFrom, Math.max(value, end)));
    });
    const close = animate(row, 0, motionConfig.dismissRow);
    void close.then(() => safeToRemoveRef.current?.());
    return () => {
      unfollow();
      close.stop();
    };
  }, [isPresent, reduceMotion, scaled, row, shown, scale, overflow]);

  return (
    <motion.div
      ref={measure}
      data-slot="banner-presence"
      style={{ gridTemplateRows, marginBottom, overflow }}
      className="grid w-full"
    >
      <div className="min-h-0">
        <motion.div style={{ opacity: shown, scale, pointerEvents, transformOrigin: "top" }}>
          {children}
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Banner ───────────────────────────────────────────────────────────────────

export interface BannerProps extends Omit<ComponentProps<"div">, "title"> {
  /** Status color and default icon. @default "neutral" */
  status?: BannerStatus;
  /** @default "inline" */
  variant?: BannerVariant;
  /** Bold first line. */
  title?: ReactNode;
  /** Replaces the status icon; `false` hides it. Rendered in the status color. */
  icon?: ComponentType<{ className?: string }> | false;
  /** Buttons or links. Trail the title on a one-line banner; drop below the body otherwise. */
  actions?: ReactNode;
  /** Shows a dismiss button. Uncontrolled banners hide themselves when dismissed. */
  dismissible?: boolean;
  onDismiss?: () => void;
  /** Accessible name for the dismiss button. @default "Dismiss" */
  dismissLabel?: string;
  /** Controls visibility. Closing collapses the banner's space with its exit motion. */
  open?: boolean;
  /**
   * Animate the first appearance too. Off by default so banners present at page load
   * arrive in place; keep a banner mounted and toggle `open` to get its exit motion.
   */
  appear?: boolean;
  /** Body text. */
  children?: ReactNode;
}

export function Banner({
  status = "neutral",
  variant = "inline",
  title,
  icon,
  actions,
  dismissible = false,
  onDismiss,
  dismissLabel = "Dismiss",
  open: openProp,
  appear = false,
  role,
  className,
  style,
  children,
  ...props
}: BannerProps) {
  const reduceMotion = useReducedMotion();
  const [openState, setOpenState] = useState(true);
  const open = openProp ?? openState;
  const titleId = useId();
  const section = variant === "section";
  const hasBody = children !== undefined && children !== null && children !== false;

  const handleDismiss = () => {
    onDismiss?.();
    if (openProp === undefined) setOpenState(false);
  };

  const iconClassName = section ? "size-4.5" : "size-4";
  let glyph: ReactNode = null;
  if (icon !== false) {
    if (icon) {
      const Icon = icon;
      glyph = <Icon className={iconClassName} aria-hidden="true" />;
    } else if (status === "neutral") {
      glyph = <InfoIcon className={iconClassName} aria-hidden="true" />;
    } else {
      glyph = <StatusGlyph status={status} className={iconClassName} />;
    }
  }

  const body = (
    <div
      role={role ?? (status === "error" || status === "warning" ? "alert" : "status")}
      aria-labelledby={title ? titleId : undefined}
      data-slot="banner"
      data-status={status}
      data-variant={variant}
      className={cn(
        "group/banner @container/banner relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center border text-foreground",
        "border-[color-mix(in_oklch,var(--banner-tone)_28%,var(--border))] bg-[color-mix(in_oklch,var(--banner-tone)_9%,transparent)] data-[status=neutral]:border-border data-[status=neutral]:bg-muted/50",
        // With a body the icon and dismiss hold to the title line instead of centring.
        "has-data-[slot=banner-description]:items-start",
        section ? "rounded-xl p-3.5" : "rounded-lg px-3 py-2.5",
        "text-compact",
        className,
      )}
      style={{ "--banner-tone": TONE[status], ...style } as CSSProperties}
      {...props}
    >
      {glyph ? (
        <span
          aria-hidden="true"
          className={cn(
            "col-start-1 row-start-1 flex items-center justify-center text-(--banner-tone)",
            section ? "mr-3 h-5" : "mr-2.5 h-(--text-compact--line-height)",
          )}
        >
          {glyph}
        </span>
      ) : null}
      {title ? (
        <p
          id={titleId}
          data-slot="banner-title"
          className={cn(
            "col-start-2 row-start-1 min-w-0 font-medium text-foreground",
            section && "text-sm",
            !glyph && "col-start-1 col-end-3",
          )}
        >
          {title}
        </p>
      ) : null}
      {hasBody ? (
        <div
          data-slot="banner-description"
          className={cn(
            "col-start-2 min-w-0 text-foreground/80 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
            title ? "row-start-2 mt-0.5" : "row-start-1",
            !glyph && "col-start-1 col-end-3",
          )}
        >
          {children}
        </div>
      ) : null}
      {actions ? (
        <div
          data-slot="banner-actions"
          className={cn(
            "col-start-3 row-start-1 -my-1 ml-3 flex flex-wrap items-center gap-2",
            // Below the text when there is a body or the banner is narrow.
            "group-has-data-[slot=banner-description]/banner:col-start-2 group-has-data-[slot=banner-description]/banner:row-start-3 group-has-data-[slot=banner-description]/banner:my-0 group-has-data-[slot=banner-description]/banner:mt-2 group-has-data-[slot=banner-description]/banner:ml-0",
            "@max-sm/banner:col-start-2 @max-sm/banner:row-start-3 @max-sm/banner:my-0 @max-sm/banner:mt-2 @max-sm/banner:ml-0",
            !glyph &&
              "group-has-data-[slot=banner-description]/banner:col-start-1 @max-sm/banner:col-start-1",
          )}
        >
          {actions}
        </div>
      ) : null}
      {dismissible ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={dismissLabel}
          onClick={handleDismiss}
          className="col-start-4 row-start-1 -my-0.5 -mr-1.5 ml-2 text-muted-foreground"
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );

  return (
    <AnimatePresence initial={appear}>
      {open ? (
        <BannerMotion key="banner" reduceMotion={reduceMotion}>
          {body}
        </BannerMotion>
      ) : null}
    </AnimatePresence>
  );
}
