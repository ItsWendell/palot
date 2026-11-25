import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { keepEditorFocus, useComposerDock, useControllableState } from "./dock";
import { fitCount, splitVisible } from "./fit";

const TAB_GAP = 4;
/** Room kept for the "+N" tab while measuring how many tabs fit. */
const OVERFLOW_TAB_WIDTH = 44;

type TabsMode = "bar" | "measure" | "menu";

interface ComposerTabsContextValue {
  value: string | null;
  toggle: (value: string) => void;
  inactive: boolean;
  panelId: string | undefined;
  folded: ReadonlySet<number>;
}

const ComposerTabsContext = React.createContext<ComposerTabsContextValue | null>(null);
const TabSlotContext = React.createContext<{ mode: TabsMode; index: number }>({
  mode: "bar",
  index: 0,
});

function useTabsContext(): ComposerTabsContextValue {
  const context = React.useContext(ComposerTabsContext);
  if (!context) throw new Error("ComposerTab must be used within ComposerTabs");
  return context;
}

/**
 * Tabs on the card's top edge for standing context (goal, plan, voice, undo, background).
 * At most one is open (`value`, or `null`); pressing the open tab closes it. Tabs that do not
 * fit fold into a "+N" tab with a menu, and the open tab always stays visible. `inactive`
 * keeps them in view but unusable while a request owns the panel slot.
 */
function ComposerTabs({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  inactive = false,
  className,
  children,
  "aria-label": ariaLabel = "Task context",
  ...props
}: Omit<React.ComponentProps<"div">, "defaultValue"> & {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  inactive?: boolean;
}) {
  const dock = useComposerDock();
  const [value, setValue] = useControllableState(valueProp, defaultValue, onValueChange);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);
  const tabs = React.Children.toArray(children).filter(React.isValidElement);
  const values = tabs.map((tab) => (tab.props as { value?: string }).value);
  const [fitting, setFitting] = React.useState(tabs.length);
  const fittingRef = React.useRef(fitting);

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      const style = getComputedStyle(row);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const widths = Array.from(measure.children, (child) => (child as HTMLElement).offsetWidth);
      const next = fitCount(
        widths,
        row.clientWidth - padding,
        TAB_GAP,
        OVERFLOW_TAB_WIDTH,
        fittingRef.current,
      );
      fittingRef.current = next;
      setFitting(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [tabs.length]);

  const openIndex = value === null ? -1 : values.indexOf(value);
  const { folded } = splitVisible(tabs.length, Math.min(fitting, tabs.length), openIndex);
  const context: ComposerTabsContextValue = {
    value,
    toggle: (next) => setValue(value === next ? null : next),
    inactive,
    panelId: dock?.panelId,
    folded: new Set(folded),
  };
  const slots = (mode: TabsMode) =>
    tabs.map((tab, index) => (
      <TabSlotContext.Provider key={tab.key ?? index} value={{ mode, index }}>
        {tab}
      </TabSlotContext.Provider>
    ));

  if (!tabs.length) return null;
  return (
    <ComposerTabsContext.Provider value={context}>
      <div
        ref={rowRef}
        role="toolbar"
        aria-label={ariaLabel}
        data-slot="composer-tabs"
        data-inactive={inactive ? "" : undefined}
        // No clipping: the open tab overlaps the card's top border by a pixel.
        className={cn("relative z-20 flex min-w-0 items-end gap-1 px-3", className)}
        onMouseDown={keepEditorFocus}
        {...props}
      >
        <div
          ref={measureRef}
          aria-hidden="true"
          inert
          data-slot="composer-tabs-measure"
          className="pointer-events-none invisible absolute top-0 left-0 flex gap-1 whitespace-nowrap"
        >
          {slots("measure")}
        </div>
        {slots("bar")}
        {folded.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inactive}
              aria-label={`${folded.length} more`}
              data-slot="composer-tabs-overflow"
              className={composerTabVariants({ state: inactive ? "inactive" : "closed" })}
            >
              +{folded.length}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-60">
              {slots("menu")}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </ComposerTabsContext.Provider>
  );
}

const composerTabVariants = cva(
  "relative flex h-7 max-w-80 min-w-0 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 border-foreground/12 px-2.5 text-meta whitespace-nowrap outline-none transition-[color,background-color] focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      state: {
        // The open tab covers the card's top border so tab and panel read as one surface.
        open: "-mb-px h-[calc(--spacing(7)+1px)] bg-(--composer-background-opaque) text-foreground",
        closed:
          "bg-(--composer-background-opaque)/50 text-muted-foreground hover:bg-(--composer-background-opaque) hover:text-foreground",
        inactive: "cursor-default bg-(--composer-background-opaque)/50 text-muted-foreground/70",
      },
      tone: {
        default: "",
        live: "",
        warning: "[&>svg]:text-warning",
      },
    },
    defaultVariants: { state: "closed", tone: "default" },
  },
);

/**
 * One tab: an icon, a `ComposerTabLabel` that never truncates and an optional
 * `ComposerTabDetail` that does. `tone="live"` adds a pulsing dot (voice).
 */
function ComposerTab({
  value,
  tone = "default",
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  Pick<VariantProps<typeof composerTabVariants>, "tone"> & { value: string }) {
  const tabs = useTabsContext();
  const { mode, index } = React.useContext(TabSlotContext);
  const folded = tabs.folded.has(index);
  const open = tabs.value === value && !tabs.inactive;
  const state = tabs.inactive ? "inactive" : open ? "open" : "closed";
  const content = (
    <>
      {tone === "live" ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse"
        />
      ) : null}
      {children}
    </>
  );
  if (mode === "measure") {
    return <span className={cn(composerTabVariants({ state: "closed", tone }))}>{content}</span>;
  }
  if (mode === "menu") {
    if (!folded) return null;
    return (
      <DropdownMenuItem
        data-slot="composer-tab"
        data-value={value}
        onClick={() => tabs.toggle(value)}
      >
        {content}
      </DropdownMenuItem>
    );
  }
  if (folded) return null;
  return (
    <button
      type="button"
      data-slot="composer-tab"
      data-state={state}
      data-tone={tone}
      data-value={value}
      disabled={tabs.inactive}
      aria-expanded={open}
      aria-controls={open ? tabs.panelId : undefined}
      className={cn(composerTabVariants({ state, tone }), "shrink", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.toggle(value);
      }}
      {...props}
    >
      {content}
    </button>
  );
}

/** The part of a tab that never truncates ("Plan · 3/7"). */
function ComposerTabLabel({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="composer-tab-label" className={cn("shrink-0", className)} {...props} />;
}

/** The part of a tab that may truncate (the plan's current step). */
function ComposerTabDetail({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-tab-detail"
      className={cn("min-w-0 truncate before:content-['·_']", className)}
      {...props}
    />
  );
}

export { ComposerTab, ComposerTabDetail, ComposerTabLabel, ComposerTabs, composerTabVariants };
