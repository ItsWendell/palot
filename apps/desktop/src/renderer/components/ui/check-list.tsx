// Adapted from Fluid Functionalism (MIT, github.com/mickadesign/fluid-functionalism @
// bf9ece46728035afef54feef6ac67e1f413cc0b0), registry/default/checkbox-group.tsx.
// Palot changes: `motion/react`, a value-keyed options API (no indices), descriptions,
// disabled options with a reason, an optional select-all row, Palot tokens, no
// font-weight animation. See THIRD_PARTY_NOTICES.md.

import { AnimatePresence, motion } from "motion/react";
import {
  useId,
  useRef,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { isOwnEvent, useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

export interface CheckListOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  /** Non-interactive trailing content, such as a badge or count. */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Why the option is unavailable. Shown under the label and announced with it. */
  disabledReason?: ReactNode;
}

export interface CheckListProps<V extends string = string> extends Omit<
  ComponentProps<"div">,
  "children" | "defaultValue" | "onChange" | "ref"
> {
  options: readonly CheckListOption<V>[];
  /** Checked values, as a Set or an array. */
  value: ReadonlySet<V> | readonly V[];
  /**
   * The next checked values, in option order. Checked values that are not in `options`
   * are kept at the end, so filtering the options never drops a selection.
   */
  onValueChange: (value: V[]) => void;
  disabled?: boolean;
  /** Adds a tri-state row that checks or clears every enabled option. Pass a string to relabel it. */
  selectAll?: boolean | string;
  ref?: Ref<HTMLDivElement>;
}

const ROW = '[data-slot="check-list-item"]';

const isDisabledElement = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

/**
 * Independent multi-select over a few visible options. Each row is a `role="checkbox"`
 * tab stop; Up/Down/Home/End move focus between rows and Space or Enter toggles. One
 * highlight glides under the pointer and keyboard focus.
 */
export function CheckList<V extends string>({
  options,
  value,
  onValueChange,
  disabled = false,
  selectAll = false,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  ...props
}: CheckListProps<V>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hover = useFluidHover(containerRef, { isItemDisabled: isDisabledElement });
  const { setActiveIndex, registerItem, handlers } = hover;
  const baseId = useId();
  const checked = value instanceof Set ? (value as ReadonlySet<V>) : new Set(value as readonly V[]);
  const offset = selectAll ? 1 : 0;

  const optionDisabled = (option: CheckListOption<V>) => disabled || option.disabled === true;

  const emit = (next: Set<V>) => {
    const known = new Set(options.map((option) => option.value));
    const ordered = options
      .filter((option) => next.has(option.value))
      .map((option) => option.value);
    const extra = [...next].filter((item) => !known.has(item));
    onValueChange([...ordered, ...extra]);
  };

  const toggle = (option: CheckListOption<V>) => {
    if (optionDisabled(option)) return;
    const next = new Set(checked);
    if (next.has(option.value)) next.delete(option.value);
    else next.add(option.value);
    emit(next);
  };

  const enabled = options.filter((option) => !optionDisabled(option));
  const enabledChecked = enabled.filter((option) => checked.has(option.value)).length;
  const allState: boolean | "mixed" =
    enabled.length > 0 && enabledChecked === enabled.length
      ? true
      : enabledChecked > 0
        ? "mixed"
        : false;

  const toggleAll = () => {
    if (disabled || enabled.length === 0) return;
    const next = new Set(checked);
    for (const option of enabled) {
      if (allState === true) next.delete(option.value);
      else next.add(option.value);
    }
    emit(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isOwnEvent(event)) return;
    const rows = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(ROW) ?? []);
    const current = rows.indexOf(event.target as HTMLElement);
    if (current === -1) return;
    let next = -1;
    if (event.key === "ArrowDown") next = (current + 1) % rows.length;
    else if (event.key === "ArrowUp") next = (current - 1 + rows.length) % rows.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      rows[current]?.click();
      return;
    } else return;
    event.preventDefault();
    rows[next]?.focus();
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    if (!isOwnEvent(event)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(ROW);
    if (row) setActiveIndex(Number(row.dataset.index));
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    onBlur?.(event);
    if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
    setActiveIndex(null);
  };

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="group"
      aria-disabled={disabled || undefined}
      data-slot="check-list"
      className={cn("relative isolate flex min-w-0 flex-col gap-0.5 select-none", className)}
      onMouseEnter={handlers.onMouseEnter}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onClick={handlers.onClick}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...props}
    >
      <FluidHoverHighlight hover={hover} className="z-0 rounded-md" />
      {selectAll ? (
        <CheckListRow
          index={0}
          id={`${baseId}-all`}
          label={typeof selectAll === "string" ? selectAll : "Select all"}
          checked={allState}
          disabled={disabled || enabled.length === 0}
          registerItem={registerItem}
          onToggle={toggleAll}
          className="mb-0.5 after:absolute after:inset-x-2.5 after:-bottom-0.5 after:h-px after:bg-border"
        />
      ) : null}
      {options.map((option, index) => (
        <CheckListRow
          key={option.value}
          index={index + offset}
          id={`${baseId}-${index}`}
          label={option.label}
          description={option.description}
          trailing={option.trailing}
          disabledReason={option.disabledReason}
          checked={checked.has(option.value)}
          disabled={optionDisabled(option)}
          registerItem={registerItem}
          onToggle={() => toggle(option)}
        />
      ))}
    </div>
  );
}

function CheckListRow({
  index,
  id,
  label,
  description,
  trailing,
  disabledReason,
  checked,
  disabled,
  registerItem,
  onToggle,
  className,
}: {
  index: number;
  id: string;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  disabledReason?: ReactNode;
  checked: boolean | "mixed";
  disabled: boolean;
  registerItem: (index: number, element: HTMLElement | null) => void;
  onToggle: () => void;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useRegisterFluidHoverItem(registerItem, index, rowRef);
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const reasonId = disabled && disabledReason ? `${id}-reason` : undefined;
  const describedBy = [descriptionId, reasonId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      ref={rowRef}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      tabIndex={disabled ? -1 : 0}
      data-slot="check-list-item"
      data-index={index}
      data-checked={checked === true ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      className={cn(
        "relative z-10 flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
        className,
      )}
    >
      <span className="flex h-(--text-compact--line-height) shrink-0 items-center">
        <CheckMark checked={checked} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="min-w-0 text-compact font-medium text-foreground">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-meta text-muted-foreground">
            {description}
          </span>
        ) : null}
        {reasonId ? (
          <span id={reasonId} className="text-meta text-muted-foreground italic">
            {disabledReason}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex h-(--text-compact--line-height) shrink-0 items-center">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

/** The checkbox square. The check draws itself; reduced motion shows it at once. */
function CheckMark({ checked }: { checked: boolean | "mixed" }) {
  const reduceMotion = useReducedMotion();
  const on = checked !== false;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-input dark:bg-input/30",
      )}
    >
      <AnimatePresence initial={false}>
        {on ? (
          <motion.svg
            key={checked === "mixed" ? "mixed" : "check"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute size-3"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
          >
            <motion.path
              d={checked === "mixed" ? "M6 12h12" : "M5 12.5l4.5 4.5L19 7.5"}
              initial={{ pathLength: reduceMotion ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: spring.fast.duration, ease: "easeOut" }
              }
            />
          </motion.svg>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
