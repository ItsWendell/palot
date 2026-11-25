import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  Play,
  ShieldCheck,
  Shrink,
  Square,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { shortcutAriaKeys, shortcutPlatform, type ShortcutKeys } from "@/lib/keyboard-shortcuts";
import { spring } from "@/lib/springs";

/* Pill */

const composerPillVariants = cva(
  "h-7 min-w-0 shrink gap-1.5 px-2 text-compact leading-none font-normal [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        default: "",
        // A setting that needs attention, such as Full access.
        warning:
          "rounded-full bg-warning/12 px-2.5 text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))] hover:bg-warning/20 hover:text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
        // The chosen model or agent cannot be used right now.
        unavailable:
          "bg-warning/12 text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))] hover:bg-warning/18 hover:text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
      },
      // What a pill keeps when the row drops labels.
      compact: {
        label: "group-data-[compact]/composer-footer:[&_[data-slot=composer-pill-detail]]:hidden",
        icon: "group-data-[compact]/composer-footer:[&_[data-slot=composer-pill-detail]]:hidden group-data-[compact]/composer-footer:[&_[data-slot=composer-pill-label]]:hidden",
      },
    },
    defaultVariants: { tone: "default", compact: "label" },
  },
);

/**
 * The trigger for agent and model: icon, `ComposerPillLabel`, an optional muted
 * `ComposerPillDetail` and `ComposerPillChevron`. Use it as a Popover or Menu trigger through
 * `render` (`<PopoverTrigger render={<ComposerPill … />} />`).
 */
function ComposerPill({
  tone = "default",
  compact = "label",
  className,
  ...props
}: React.ComponentProps<typeof Button> & VariantProps<typeof composerPillVariants>) {
  return (
    <Button
      variant="ghost"
      data-slot="composer-pill"
      data-tone={tone}
      className={cn(composerPillVariants({ tone, compact }), className)}
      {...props}
    />
  );
}

function ComposerPillLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-pill-label"
      data-truncate=""
      className={cn("min-w-8 truncate", className)}
      {...props}
    />
  );
}

/** Secondary text after the label ("High"); the first thing to go when room runs out. */
function ComposerPillDetail({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-pill-detail"
      className={cn("shrink-0 text-muted-foreground before:me-1 before:content-['·']", className)}
      {...props}
    />
  );
}

function ComposerPillChevron({ className, ...props }: React.ComponentProps<typeof ChevronDown>) {
  return (
    <ChevronDown
      aria-hidden="true"
      data-slot="composer-pill-chevron"
      className={cn("size-3! shrink-0 text-muted-foreground", className)}
      {...props}
    />
  );
}

/* Shortcut hint */

const GLYPHS: Record<string, string> = {
  Shift: "⇧",
  Enter: "↵",
  Backspace: "⌫",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
};

/** A shortcut as compact glyphs ("Ctrl⇧↵"); the button's `aria-keyshortcuts` names it. */
function shortcutGlyphs(keys: ShortcutKeys, platform?: string): string {
  const mac = shortcutPlatform(platform) === "mac";
  return keys
    .map((key) =>
      key === "Mod"
        ? mac
          ? "⌘"
          : "Ctrl"
        : key === "Alt"
          ? mac
            ? "⌥"
            : "Alt"
          : (GLYPHS[key] ?? key),
    )
    .join("");
}

/**
 * A shortcut shown inside a button, quieter than its label. Hidden from assistive technology;
 * put the binding on the button's `aria-keyshortcuts` instead.
 */
function ComposerShortcut({
  keys,
  className,
  ...props
}: React.ComponentProps<"span"> & { keys: ShortcutKeys }) {
  return (
    <span
      aria-hidden="true"
      data-slot="composer-shortcut"
      className={cn(
        "shrink-0 text-micro font-normal tracking-wide opacity-55 @max-[34rem]/composer:hidden",
        className,
      )}
      {...props}
    >
      {shortcutGlyphs(keys)}
    </span>
  );
}

/* Primary button */

type ComposerPrimaryKind =
  | "send"
  | "steer"
  | "queue"
  | "stop"
  | "update"
  | "run"
  | "allow"
  | "submit"
  | "compact-send"
  | "resume";

const PRIMARY_ICONS: Record<ComposerPrimaryKind, LucideIcon | null> = {
  send: ArrowUp,
  steer: Zap,
  queue: Clock3,
  stop: Square,
  update: Check,
  run: Play,
  allow: ShieldCheck,
  submit: null,
  "compact-send": Shrink,
  resume: Play,
};

/** Send and Stop are icons alone; every other kind shows its label. */
const ICON_ONLY: ReadonlySet<ComposerPrimaryKind> = new Set(["send", "stop"]);

export interface ComposerPrimaryView {
  kind: ComposerPrimaryKind;
  /** The visible word, and the accessible name of the icon-only kinds. */
  label: string;
  /** An accessible name that says more than the word ("Queue message after current turn"). */
  name?: string;
  shortcut?: ShortcutKeys;
}

/** Holding Mod alone for 150 ms; any other key in between makes it a shortcut, not a hold. */
function useModifierHeld(enabled: boolean): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) {
      setHeld(false);
      return;
    }
    const modKey = shortcutPlatform() === "mac" ? "Meta" : "Control";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const release = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      setHeld(false);
    };
    const down = (event: KeyboardEvent) => {
      if (event.key === modKey && !event.repeat && !event.shiftKey && !event.altKey) {
        timer = setTimeout(() => setHeld(true), 150);
      } else if (event.key !== modKey && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === modKey) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [enabled]);
  return held;
}

/**
 * The one primary button. Its props are the composer state machine's output: `kind`, `label`,
 * `disabled`, `busy` and `shortcut`. With `preview`, holding Mod shows the alternate
 * (`data-previewing`); the click handler reads the modifier from the event. Its width follows
 * the label briefly.
 */
function ComposerPrimary({
  kind,
  label,
  name,
  shortcut,
  preview,
  busy = false,
  disabled,
  className,
  "aria-label": ariaLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children"> &
  ComposerPrimaryView & {
    busy?: boolean;
    preview?: ComposerPrimaryView;
  }) {
  const previewing = useModifierHeld(Boolean(preview) && !disabled);
  const view = previewing && preview ? preview : { kind, label, name, shortcut };
  const Icon = PRIMARY_ICONS[view.kind];
  const iconOnly = ICON_ONLY.has(view.kind);
  return (
    <Button
      data-slot="composer-primary"
      data-kind={view.kind}
      data-previewing={previewing ? "" : undefined}
      aria-label={ariaLabel ?? view.name ?? (iconOnly ? view.label : undefined)}
      aria-keyshortcuts={view.shortcut ? shortcutAriaKeys(view.shortcut) : undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      size={iconOnly ? "icon" : "default"}
      className={cn(
        "shrink-0 overflow-hidden rounded-full font-medium",
        iconOnly ? "" : "px-3 text-compact",
        // A disabled primary reads as muted, not as a faded primary.
        "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        className,
      )}
      {...props}
    >
      <AnimatedWidth>
        {busy ? (
          <Spinner aria-hidden="true" role={undefined} className="size-3.5" />
        ) : Icon ? (
          <Icon
            aria-hidden="true"
            className={view.kind === "stop" ? "size-3 fill-current" : "size-3.5"}
          />
        ) : null}
        {iconOnly ? null : <span>{view.label}</span>}
        {view.shortcut && !iconOnly ? (
          <ComposerShortcut keys={view.shortcut} className="-me-0.5" />
        ) : null}
      </AnimatedWidth>
    </Button>
  );
}

/** Animates its own width when its content's width changes; instant under reduced motion. */
function AnimatedWidth({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const innerRef = React.useRef<HTMLSpanElement>(null);
  const [width, setWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setWidth(inner.offsetWidth || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.span
      className="flex justify-center"
      initial={false}
      animate={{ width: width ?? "auto" }}
      transition={reduceMotion ? { duration: 0 } : spring.fast}
    >
      <span ref={innerRef} className="flex w-max shrink-0 items-center justify-center gap-1.5">
        {children}
      </span>
    </motion.span>
  );
}

/** The secondary Stop that stays beside the primary while the agent works and there is a draft. */
function ComposerStop({
  className,
  "aria-label": ariaLabel = "Stop",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Button
      variant="outline"
      size="icon"
      data-slot="composer-stop"
      aria-label={ariaLabel}
      className={cn("shrink-0 rounded-full", className)}
      {...props}
    >
      <Square aria-hidden="true" className="size-2.5 fill-current" />
    </Button>
  );
}

/* Context pie */

type ComposerContextTone = "normal" | "label" | "warning";

/** Percentage text from 70% full, warning colour from 90%. */
function composerContextTone(value: number): ComposerContextTone {
  return value >= 0.9 ? "warning" : value >= 0.7 ? "label" : "normal";
}

/**
 * A small pie: a thin outline for the whole window and a filled wedge for what is used. A
 * wedge never reads as a spinner, which a partial arc does at low fill.
 */
function ComposerContextPieGlyph({
  value,
  className,
  ...props
}: React.ComponentProps<"svg"> & { value: number }) {
  const used = Math.min(100, Math.max(0, value * 100));
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      data-slot="composer-context-pie-glyph"
      className={cn(
        "size-4 shrink-0 -rotate-90",
        composerContextTone(value) === "warning" ? "text-warning" : "text-foreground/70",
        className,
      )}
      {...props}
    >
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* A stroke as wide as the radius draws a wedge; the dash sets its angle. */}
      <circle
        cx="10"
        cy="10"
        r="2.75"
        pathLength="100"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeDasharray={`${used} 100`}
        className="transition-[stroke-dasharray] duration-300 motion-reduce:transition-none"
      />
    </svg>
  );
}

/**
 * The context meter (`value` 0–1). Usable as a Popover trigger through `render`; its
 * accessible name says how full the window is unless `aria-label` replaces it.
 */
function ComposerContextPie({
  value,
  className,
  "aria-label": ariaLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "value"> & { value: number }) {
  const tone = composerContextTone(value);
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <Button
      variant="ghost"
      data-slot="composer-context-pie"
      data-tone={tone}
      aria-label={ariaLabel ?? `Context window ${percent}% full`}
      className={cn(
        "h-7 min-w-7 shrink-0 justify-center gap-1.5 rounded-full px-0 text-compact font-normal data-[tone=label]:px-1.5 data-[tone=warning]:px-1.5",
        className,
      )}
      {...props}
    >
      <ComposerContextPieGlyph value={value} />
      {tone === "normal" ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "text-meta tabular-nums",
            tone === "warning" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {percent}%
        </span>
      )}
    </Button>
  );
}

export {
  ComposerContextPie,
  ComposerContextPieGlyph,
  ComposerPill,
  ComposerPillChevron,
  ComposerPillDetail,
  ComposerPillLabel,
  ComposerPrimary,
  ComposerShortcut,
  ComposerStop,
  composerPillVariants,
  shortcutGlyphs,
};
