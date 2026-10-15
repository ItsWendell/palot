// Adapted from Fluid Functionalism (MIT, github.com/mickadesign/fluid-functionalism @
// bf9ece46728035afef54feef6ac67e1f413cc0b0), registry/default/radio-group.tsx.
// Palot changes: `motion/react`, a value-keyed options API, list and card variants,
// disabled options with a reason, Palot tokens, no font-weight animation.
// See THIRD_PARTY_NOTICES.md.

import { AnimatePresence, motion } from "motion/react";
import {
  useId,
  useRef,
  type ComponentProps,
  type ComponentType,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { FluidSelectionPill } from "@/components/ui/fluid-list";
import { isOwnEvent, useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

export interface ChoiceOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  /** Card variant: shown in a tile above the label. List variant: before the label. */
  icon?: ComponentType<{ className?: string }>;
  /** Non-interactive trailing content, such as a badge. */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Why the option is unavailable. Shown under the label and announced with it. */
  disabledReason?: ReactNode;
}

export interface ChoiceGroupProps<V extends string = string> extends Omit<
  ComponentProps<"div">,
  "children" | "defaultValue" | "onChange" | "ref"
> {
  options: readonly ChoiceOption<V>[];
  /** The chosen value; `null` or a value not in `options` means nothing is chosen. */
  value: V | null | undefined;
  onValueChange: (value: V) => void;
  /** `list` stacks radio rows; `card` lays out icon + title + description tiles. @default "list" */
  variant?: "list" | "card";
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
}

const isDisabledElement = (element: HTMLElement) =>
  element.getAttribute("aria-disabled") === "true";

/**
 * A single choice among a few visible options: `role="radiogroup"` with a roving tab
 * stop. Arrow keys move and select (wrapping, skipping disabled options); Home/End jump
 * to the ends; Space or Enter selects the focused option. One highlight glides under the
 * pointer and the selection slides between options.
 */
export function ChoiceGroup<V extends string>({
  options,
  value,
  onValueChange,
  variant = "list",
  disabled = false,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  ...props
}: ChoiceGroupProps<V>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const card = variant === "card";
  const hover = useFluidHover(containerRef, {
    axis: card ? "xy" : "y",
    isItemDisabled: isDisabledElement,
  });
  const { activeIndex, setActiveIndex, itemRects, registerItem, handlers } = hover;
  const baseId = useId();

  const optionDisabled = (index: number) => disabled || options[index]?.disabled === true;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((_, index) => !optionDisabled(index));
  const tabStop =
    selectedIndex >= 0 && !optionDisabled(selectedIndex) ? selectedIndex : firstEnabled;

  const rows = () =>
    Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[data-slot="choice-group-item"]') ?? [],
    );

  const select = (index: number) => {
    const option = options[index];
    if (!option || optionDisabled(index)) return;
    if (option.value !== value) onValueChange(option.value);
  };

  const move = (from: number, step: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (from + step * offset + options.length * offset) % options.length;
      if (!optionDisabled(index)) return index;
    }
    return -1;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isOwnEvent(event)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-slot="choice-group-item"]',
    );
    if (!row) return;
    const current = Number(row.dataset.index);
    let next = -1;
    if (["ArrowDown", "ArrowRight"].includes(event.key)) next = move(current, 1);
    else if (["ArrowUp", "ArrowLeft"].includes(event.key)) next = move(current, -1);
    else if (event.key === "Home") next = move(-1 + options.length, 1);
    else if (event.key === "End") next = move(0, -1);
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      select(current);
      return;
    } else return;
    event.preventDefault();
    if (next < 0) return;
    rows()[next]?.focus();
    select(next);
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    if (!isOwnEvent(event)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-slot="choice-group-item"]',
    );
    if (row) setActiveIndex(Number(row.dataset.index));
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    onBlur?.(event);
    if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
    setActiveIndex(null);
  };

  const selectedRect = selectedIndex >= 0 ? itemRects[selectedIndex] : null;
  const hoveringOther = activeIndex !== null && activeIndex !== selectedIndex;

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-slot="choice-group"
      data-variant={variant}
      className={cn(
        "relative isolate min-w-0 select-none",
        card
          ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-2"
          : "flex flex-col gap-0.5",
        className,
      )}
      onMouseEnter={handlers.onMouseEnter}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onClick={handlers.onClick}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...props}
    >
      {card ? (
        <FluidSelectionPill
          rect={selectedRect}
          className="z-0 rounded-lg border-2 border-primary bg-primary/5"
        />
      ) : (
        <FluidSelectionPill rect={selectedRect} dimmed={hoveringOther} className="z-0 bg-muted" />
      )}
      <FluidHoverHighlight
        hover={hover}
        hidden={!card && !hoveringOther}
        from={card ? undefined : selectedRect}
        className={cn("z-0", card ? "rounded-lg" : "rounded-md")}
      />
      {options.map((option, index) => (
        <ChoiceGroupItem
          key={option.value}
          option={option}
          index={index}
          id={`${baseId}-${index}`}
          card={card}
          checked={index === selectedIndex}
          disabled={optionDisabled(index)}
          tabbable={index === tabStop}
          registerItem={registerItem}
          onSelect={() => select(index)}
        />
      ))}
    </div>
  );
}

function ChoiceGroupItem<V extends string>({
  option,
  index,
  id,
  card,
  checked,
  disabled,
  tabbable,
  registerItem,
  onSelect,
}: {
  option: ChoiceOption<V>;
  index: number;
  id: string;
  card: boolean;
  checked: boolean;
  disabled: boolean;
  tabbable: boolean;
  registerItem: (index: number, element: HTMLElement | null) => void;
  onSelect: () => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useRegisterFluidHoverItem(registerItem, index, rowRef);
  const Icon = option.icon;
  const labelId = `${id}-label`;
  const descriptionId = option.description ? `${id}-description` : undefined;
  const reasonId = disabled && option.disabledReason ? `${id}-reason` : undefined;
  const describedBy = [descriptionId, reasonId].filter(Boolean).join(" ") || undefined;

  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        id={labelId}
        className={cn("min-w-0 font-medium text-foreground", card ? "text-sm" : "text-compact")}
      >
        {option.label}
      </span>
      {option.description ? (
        <span id={descriptionId} className="text-meta text-muted-foreground">
          {option.description}
        </span>
      ) : null}
      {reasonId ? (
        <span id={reasonId} className="text-meta text-muted-foreground italic">
          {option.disabledReason}
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      ref={rowRef}
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      tabIndex={tabbable ? 0 : -1}
      data-slot="choice-group-item"
      data-index={index}
      data-checked={checked ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={cn(
        "relative z-10 flex min-w-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
        card
          ? "flex-col gap-2 rounded-lg border border-border p-3 data-checked:border-transparent"
          : "items-start gap-2.5 rounded-md px-2.5 py-2",
      )}
    >
      {card ? (
        <>
          <span className="flex items-start justify-between gap-2">
            {Icon ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground in-data-checked:text-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
            ) : (
              <span />
            )}
            <RadioMark checked={checked} />
          </span>
          {text}
        </>
      ) : (
        <>
          <span className="flex h-(--text-compact--line-height) shrink-0 items-center">
            <RadioMark checked={checked} />
          </span>
          {Icon ? (
            <span className="flex h-(--text-compact--line-height) shrink-0 items-center text-muted-foreground">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          ) : null}
          {text}
        </>
      )}
      {option.trailing ? (
        <span
          className={cn(
            "flex shrink-0 items-center",
            card ? "absolute right-3 bottom-3" : "h-(--text-compact--line-height)",
          )}
        >
          {option.trailing}
        </span>
      ) : null}
    </div>
  );
}

/** The radio circle. The dot pops in on spring.fast; reduced motion fades it. */
function RadioMark({ checked }: { checked: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary" : "border-input dark:bg-input/30",
      )}
    >
      <AnimatePresence initial={false}>
        {checked ? (
          <motion.span
            className="size-1.5 rounded-full bg-primary-foreground"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={spring.fast}
          />
        ) : null}
      </AnimatePresence>
    </span>
  );
}
