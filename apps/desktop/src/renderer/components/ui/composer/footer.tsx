import * as React from "react";
import { Ellipsis } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { keepEditorFocus } from "./dock";
import { foldedAt, nextFooterLevel, type FoldableItem } from "./fit";

interface ComposerFooterContextValue {
  folded: ReadonlySet<string>;
  register: (value: string, priority: number) => () => void;
}

const ComposerFooterContext = React.createContext<ComposerFooterContextValue | null>(null);

function useFooterContext(part: string): ComposerFooterContextValue {
  const context = React.useContext(ComposerFooterContext);
  if (!context) throw new Error(`${part} must be used within ComposerFooter`);
  return context;
}

/**
 * The row's content width: each action group's own width, plus what truncated labels hide,
 * plus the gaps between groups. Spacing that only pushes groups apart does not count.
 */
function naturalWidth(row: HTMLElement): { natural: number; available: number } {
  const style = getComputedStyle(row);
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const groups = Array.from(row.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.slot === "composer-actions",
  );
  let natural = gap * Math.max(0, groups.length - 1);
  for (const group of groups) {
    natural += group.scrollWidth;
    for (const label of group.querySelectorAll<HTMLElement>("[data-truncate]")) {
      natural += Math.max(0, label.scrollWidth - label.clientWidth);
    }
  }
  return { natural, available: row.clientWidth - padding };
}

/**
 * The control row. It never wraps: when its content does not fit it first drops labels
 * (`data-compact`, which pills and labels follow), then folds `ComposerFoldable` children
 * into `ComposerOverflow`, lowest `priority` first. Only the last resort truncates.
 */
function ComposerFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [items, setItems] = React.useState<FoldableItem[]>([]);
  const [level, setLevel] = React.useState(0);
  const orderRef = React.useRef(0);
  // Content widths measured at each level; cleared when the content changes.
  const knownRef = React.useRef(new Map<number, number>());
  const levelRef = React.useRef(level);
  const maxLevel = 1 + items.length;

  const register = React.useCallback((value: string, priority: number) => {
    const item = { value, priority, order: orderRef.current++ };
    setItems((current) => [...current.filter((entry) => entry.value !== value), item]);
    return () => setItems((current) => current.filter((entry) => entry !== item));
  }, []);

  const fit = React.useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const current = levelRef.current;
    const { natural, available } = naturalWidth(row);
    const known = knownRef.current;
    const previous = known.get(current);
    // The same level measuring differently means the content changed: other levels are stale.
    if (previous !== undefined && Math.abs(previous - natural) > 1) known.clear();
    known.set(current, natural);
    const next = nextFooterLevel(current, maxLevel, natural, available, known);
    if (next !== current) {
      levelRef.current = next;
      setLevel(next);
    }
  }, [maxLevel]);

  React.useLayoutEffect(() => {
    knownRef.current.clear();
  }, [items]);

  React.useLayoutEffect(() => {
    levelRef.current = level;
    fit();
  });

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(row);
    for (const group of row.children) observer.observe(group);
    return () => observer.disconnect();
  }, [fit]);

  const capped = Math.min(level, maxLevel);
  const folded = foldedAt(items, capped);
  const context: ComposerFooterContextValue = { folded, register };
  return (
    <ComposerFooterContext.Provider value={context}>
      <div
        ref={rowRef}
        data-slot="composer-footer"
        data-compact={capped >= 1 ? "" : undefined}
        data-level={capped}
        className={cn(
          "group/composer-footer flex h-11 min-w-0 shrink-0 flex-nowrap items-center gap-1 px-3 pb-1",
          className,
        )}
        onMouseDown={keepEditorFocus}
        {...props}
      >
        {children}
      </div>
    </ComposerFooterContext.Provider>
  );
}

/** A group of controls at the start or the end of the row. */
function ComposerActions({
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="composer-actions"
      data-align={align}
      className={cn(
        "flex flex-nowrap items-center gap-1",
        align === "end" ? "ms-auto min-w-0 justify-end" : "shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A control that may fold into the `…` menu when the row runs out of room. Lower `priority`
 * folds first. Give the menu a matching `ComposerOverflowItem` with the same `value`.
 */
function ComposerFoldable({
  value,
  priority = 0,
  className,
  ...props
}: React.ComponentProps<"div"> & { value: string; priority?: number }) {
  const footer = useFooterContext("ComposerFoldable");
  const { register } = footer;
  React.useLayoutEffect(() => register(value, priority), [register, value, priority]);
  const folded = footer.folded.has(value);
  return (
    <div
      data-slot="composer-foldable"
      data-value={value}
      data-folded={folded ? "" : undefined}
      className={cn(folded ? "hidden" : "contents", className)}
      {...props}
    />
  );
}

/** The `…` menu for folded controls. Shows only while something is folded. */
function ComposerOverflow({
  children,
  className,
  "aria-label": ariaLabel = "More controls",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "render">) {
  const footer = useFooterContext("ComposerOverflow");
  if (footer.folded.size === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-slot="composer-overflow"
            aria-label={ariaLabel}
            className={cn("shrink-0 rounded-full [&_svg:not([class*='size-'])]:size-4", className)}
            {...props}
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A folded control's entry in the `…` menu; shown only while `value` is folded. */
function ComposerOverflowItem({
  value,
  ...props
}: React.ComponentProps<typeof DropdownMenuItem> & { value: string }) {
  const footer = useFooterContext("ComposerOverflowItem");
  if (!footer.folded.has(value)) return null;
  return <DropdownMenuItem data-value={value} {...props} />;
}

export {
  ComposerActions,
  ComposerFoldable,
  ComposerFooter,
  ComposerOverflow,
  ComposerOverflowItem,
};
