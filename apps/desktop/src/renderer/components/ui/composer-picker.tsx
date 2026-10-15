"use client";

/**
 * One picker for composer and new-task choices (model, reasoning, agent, approvals, work
 * location, branch, destination). A Popover owns the trigger, positioning and focus return;
 * an inline Base UI Combobox owns keyboard navigation and the fluid gliding highlight.
 * Selection is async-aware: the picker shows the pending row, closes on success, hands
 * focus back (for example to the composer) and reports failures through one error toast.
 */

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Check, ChevronDown, ChevronRight, Search, Star } from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";
import {
  formatShortcut,
  shortcutAriaKeys,
  shortcutKeys,
  useShortcutOverrides,
  type KeyboardShortcutID,
} from "@/lib/keyboard-shortcuts";
import { matchesPickerSearch } from "@/lib/picker-search";
import { showErrorToast } from "@/lib/toast-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComboboxGroup, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox";
import { popupMotionClassName } from "@/components/ui/fluid-list";
import { InputGroupButton } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { SurfaceBackdrop } from "@/components/ui/surface-backdrop";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ComposerPickerTone = "default" | "warning";

export type ComposerPickerDataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface ComposerPickerBadge {
  label: string;
  tone?: "neutral" | "new" | "warning" | "danger";
}

export interface ComposerPickerOption<T> {
  /** Stable identity; also what `selectedKey` refers to. */
  key: string;
  value: T;
  label: string;
  description?: string;
  /** Extra search terms (IDs, provider names, paths). */
  keywords?: readonly (string | null | undefined)[];
  icon?: ReactNode;
  badges?: readonly ComposerPickerBadge[];
  /** Right-aligned metadata such as a context size. */
  meta?: ReactNode;
  disabled?: boolean;
  /** Shown under the row and announced when the row can't be chosen. */
  disabledReason?: string;
  tone?: ComposerPickerTone;
  /** Shows a filled star when the picker offers favorites. */
  favorite?: boolean;
  attributes?: ComposerPickerDataAttributes;
}

export interface ComposerPickerSection<T> {
  key: string;
  heading?: string;
  options: readonly ComposerPickerOption<T>[];
  /** The heading toggles the section's rows. Searching always shows every match. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Shortcut sections (Favorites, Recent) step aside while a query is typed. */
  hideWhenSearching?: boolean;
}

export interface ComposerPickerSearch {
  /** Accessible name of the search field, for example "Choose model". */
  label: string;
  placeholder?: string;
  /** Controlled query, for callers that search on the server. */
  query?: string;
  onQueryChange?(query: string): void;
  /** Set to false when the caller already filtered `sections` for the query. */
  filter?: boolean;
}

export interface ComposerPickerAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect(): void;
}

export interface ComposerPickerActionOptions {
  /** Toast title for a failed selection. */
  errorTitle: string;
  /** Runs after a successful selection, for example to close the popup. */
  onSuccess?(): void;
  onError?(error: unknown): void;
}

/**
 * Shared async selection: one choice at a time, a success callback, and an error toast.
 * Pickers use it internally; confirmation dialogs reuse it for their confirm action.
 */
export function useComposerPickerAction({
  errorTitle,
  onSuccess,
  onError,
}: ComposerPickerActionOptions) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(
    async (task: () => unknown): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        await task();
      } catch (error) {
        onError?.(error);
        showErrorToast(errorTitle, error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      onSuccess?.();
      return true;
    },
    [errorTitle, onError, onSuccess],
  );
  return { busy, run };
}

export interface ComposerPickerProps<T> {
  /** Visible trigger value. */
  label: ReactNode;
  /** Trigger name, for example `Model: GPT-5`. */
  ariaLabel: string;
  icon?: ReactNode;
  /** Muted value after the label, such as "Default" or a server name. */
  secondary?: ReactNode;
  /** Warning-colored status after the label, such as "Offline". */
  status?: ReactNode;
  tone?: ComposerPickerTone;
  size?: "composer" | "context";
  /** Destination-style triggers announce themselves as comboboxes. */
  triggerRole?: "button" | "combobox";
  triggerClassName?: string;
  triggerProps?: Pick<ComponentProps<"button">, "title" | "aria-description"> &
    ComposerPickerDataAttributes;
  labelClassName?: string;
  labelAttributes?: ComposerPickerDataAttributes;
  secondaryAttributes?: ComposerPickerDataAttributes;
  /** Tooltip text; the effective shortcut bindings are appended. */
  tooltip?: string;
  shortcuts?: readonly KeyboardShortcutID[];
  disabled?: boolean;

  open?: boolean;
  onOpenChange?(open: boolean): void;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  popupClassName?: string;
  title?: string;
  description?: ReactNode;
  /** Context above the list, such as a note about custom rules. */
  notice?: ReactNode;
  /** Accessible name of the option list. */
  listLabel: string;
  sections: readonly ComposerPickerSection<T>[];
  selectedKey?: string | null;
  search?: ComposerPickerSearch;
  loading?: boolean;
  loadingLabel?: string;
  error?: string | null;
  emptyLabel?: string;
  /** Detail pane for the highlighted (or current) row, beside the list when space allows. */
  renderDetail?(option: ComposerPickerOption<T> | null): ReactNode;
  /** Quiet text under the list. */
  footer?: ReactNode;
  /** Where `actions` sit: a quiet footer bar, or beside the title in the header. */
  actionsPlacement?: "header" | "footer";
  actions?: readonly ComposerPickerAction[];

  onSelect(option: ComposerPickerOption<T>): unknown;
  /** Toast title when `onSelect` fails. */
  errorTitle: string;
  /**
   * Return true when the caller takes over this choice, for example by asking for
   * confirmation. The popup closes without calling `onSelect`.
   */
  confirm?(option: ComposerPickerOption<T>): boolean;
  /** After a successful choice; the composer uses it to take focus back. */
  onSelectionComplete?(): void;
  onToggleFavorite?(option: ComposerPickerOption<T>): void;
}

const KEY_SEPARATOR = "\u0000";
const optionKeyOf = (value: unknown) =>
  typeof value === "string" ? (value.split(KEY_SEPARATOR).at(-1) ?? value) : "";
const sameOption = (left: unknown, right: unknown) => optionKeyOf(left) === optionKeyOf(right);

const BADGE_CLASS: Record<NonNullable<ComposerPickerBadge["tone"]>, string> = {
  neutral: "text-muted-foreground",
  new: "border-transparent bg-primary/12 text-primary dark:bg-primary/20",
  warning: "border-warning/40 text-warning",
  danger: "",
};

export function ComposerPicker<T>({
  label,
  ariaLabel,
  icon,
  secondary,
  status,
  tone = "default",
  size = "composer",
  triggerRole = "button",
  triggerClassName,
  triggerProps,
  labelClassName,
  labelAttributes,
  secondaryAttributes,
  tooltip,
  shortcuts,
  disabled = false,
  open: openProp,
  onOpenChange,
  side = "top",
  align = "start",
  popupClassName,
  title,
  description,
  notice,
  listLabel,
  sections,
  selectedKey = null,
  search,
  loading = false,
  loadingLabel = "Loading…",
  error = null,
  emptyLabel = "No matches",
  renderDetail,
  footer,
  actionsPlacement = "footer",
  actions,
  onSelect,
  errorTitle,
  confirm,
  onSelectionComplete,
  onToggleFavorite,
}: ComposerPickerProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, openProp],
  );
  const [internalQuery, setInternalQuery] = useState("");
  const query = search?.query ?? internalQuery;
  const setQuery = useCallback(
    (next: string) => {
      if (search?.query === undefined) setInternalQuery(next);
      search?.onQueryChange?.(next);
    },
    [search],
  );
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(sections.filter((section) => section.defaultCollapsed).map(({ key }) => key)),
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const focusTargetRef = useRef<HTMLElement | null>(null);
  const setFocusTarget = useCallback((node: HTMLElement | null) => {
    focusTargetRef.current = node;
  }, []);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const headerActions = actionsPlacement === "header" ? (actions ?? []) : [];
  const footerActions = actionsPlacement === "footer" ? (actions ?? []) : [];
  const completeSelection = useCallback(() => {
    close();
    onSelectionComplete?.();
  }, [close, onSelectionComplete]);
  const { busy, run } = useComposerPickerAction({ errorTitle, onSuccess: completeSelection });

  const searching = Boolean(search) && query.trim() !== "";
  const filter = search?.filter !== false;
  const visibleSections = useMemo(
    () =>
      sections.flatMap((section) => {
        if (searching && section.hideWhenSearching) return [];
        const options =
          searching && filter
            ? section.options.filter((option) =>
                matchesPickerSearch(query, [
                  option.label,
                  option.description,
                  ...(option.keywords ?? []),
                ]),
              )
            : section.options;
        return options.length > 0 ? [{ ...section, options }] : [];
      }),
    [filter, query, searching, sections],
  );
  const optionsByKey = useMemo(() => {
    const map = new Map<string, ComposerPickerOption<T>>();
    for (const section of sections) {
      for (const option of section.options) if (!map.has(option.key)) map.set(option.key, option);
    }
    return map;
  }, [sections]);
  const hasOptions = visibleSections.length > 0;

  function choose(option: ComposerPickerOption<T>) {
    if (busy || disabled || option.disabled) return;
    if (option.key === selectedKey) {
      completeSelection();
      return;
    }
    if (confirm?.(option)) {
      close();
      return;
    }
    setPendingKey(option.key);
    void run(() => onSelect(option)).finally(() => setPendingKey(null));
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setHighlightedKey(null);
    }
    setOpen(next);
  }

  // Subscribes to personal bindings so labels follow rebinding immediately.
  useShortcutOverrides();
  const bindings = (shortcuts ?? []).map((id) => shortcutKeys(id)).filter((keys) => keys.length);
  const tooltipText = tooltip
    ? bindings.length > 0
      ? `${tooltip} · ${bindings.map((keys) => formatShortcut(keys)).join(" / ")}`
      : tooltip
    : null;

  const triggerElementProps = {
    type: "button" as const,
    "aria-label": ariaLabel,
    "aria-keyshortcuts": bindings[0] ? shortcutAriaKeys(bindings[0]) : undefined,
    ...(triggerRole === "combobox" ? { role: "combobox", "aria-expanded": open } : {}),
    disabled: disabled || busy,
    className: cn(
      "min-w-0",
      size === "composer" && "gap-1.5 px-2",
      tone === "warning" && "text-warning",
      triggerClassName,
    ),
    ...triggerProps,
  };
  const triggerButton =
    size === "composer" ? (
      <InputGroupButton size="composer" {...triggerElementProps} />
    ) : (
      <Button variant="ghost" size="context" {...triggerElementProps} />
    );
  const triggerContent = (
    <>
      {icon}
      <span className={cn("min-w-0 truncate", labelClassName)} {...labelAttributes}>
        {label}
      </span>
      {secondary ? (
        <span className="max-w-32 shrink-0 truncate text-muted-foreground" {...secondaryAttributes}>
          {secondary}
        </span>
      ) : null}
      {status ? <span className="shrink-0 text-warning">{status}</span> : null}
      {busy ? (
        <Spinner className="size-3 shrink-0" aria-hidden="true" role={undefined} />
      ) : (
        <ChevronDown className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );

  const highlighted =
    (highlightedKey ? optionsByKey.get(highlightedKey) : undefined) ??
    (selectedKey ? optionsByKey.get(selectedKey) : undefined) ??
    visibleSections[0]?.options[0] ??
    null;
  const detail = open && renderDetail ? renderDetail(highlighted) : null;
  const selectedValue = selectedKey && optionsByKey.has(selectedKey) ? selectedKey : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {tooltipText ? (
        <Tooltip>
          <TooltipTrigger render={<PopoverPrimitive.Trigger render={triggerButton} />}>
            {triggerContent}
          </TooltipTrigger>
          <TooltipContent>{tooltipText}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverPrimitive.Trigger render={triggerButton}>{triggerContent}</PopoverPrimitive.Trigger>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="palot-glass-positioner isolate z-50 rounded-lg"
        >
          <PopoverPrimitive.Popup
            data-slot="composer-picker"
            initialFocus={focusTargetRef}
            className={cn(
              "relative isolate flex max-h-(--available-height) w-80 max-w-(--available-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
              popupMotionClassName,
              popupClassName,
            )}
          >
            <SurfaceBackdrop />
            <ComboboxPrimitive.Root
              inline
              open={open}
              value={selectedValue}
              isItemEqualToValue={sameOption}
              inputValue={query}
              onInputValueChange={(next) => setQuery(next)}
              onValueChange={(value) => {
                const option = optionsByKey.get(optionKeyOf(value));
                if (option) choose(option);
              }}
              onItemHighlighted={(value) => {
                if (value !== undefined) setHighlightedKey(optionKeyOf(value));
              }}
              filter={null}
              autoHighlight={searching}
            >
              {title || description || headerActions.length > 0 ? (
                <div className="grid gap-0.5 px-3 pt-2.5 pb-1">
                  <div className="flex min-h-6 items-center gap-2">
                    {title ? (
                      <PopoverPrimitive.Title className="min-w-0 flex-1 truncate text-compact font-medium">
                        {title}
                      </PopoverPrimitive.Title>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {headerActions.map((item) => (
                      <Button
                        key={item.key}
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="-mr-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          close();
                          item.onSelect();
                        }}
                      >
                        {item.icon}
                        {item.label}
                      </Button>
                    ))}
                  </div>
                  {description ? (
                    <PopoverPrimitive.Description className="text-meta text-muted-foreground">
                      {description}
                    </PopoverPrimitive.Description>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <div className="px-3 pb-1 text-meta text-muted-foreground">{notice}</div>
              ) : null}
              {search ? (
                <div className="px-1.5 pt-1.5">
                  <div className="flex h-8 items-center gap-2 rounded-md bg-input/20 px-2 dark:bg-input/30">
                    <Search
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <ComboboxPrimitive.Input
                      ref={setFocusTarget}
                      aria-label={search.label}
                      placeholder={search.placeholder}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>
              ) : (
                // Keyboard navigation lives on the combobox input; a focusable, invisible
                // target keeps arrows and Enter working for short lists without a search field.
                <ComboboxPrimitive.Input
                  ref={setFocusTarget}
                  aria-label={listLabel}
                  render={<div tabIndex={0} />}
                  className="sr-only"
                />
              )}
              <div className="@container/picker flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <ComboboxList
                    aria-label={listLabel}
                    aria-busy={busy || loading || undefined}
                    className="max-h-80 min-h-0 flex-1 px-1.5 pb-1.5 data-empty:p-0"
                  >
                    {visibleSections.map((section) => {
                      const isCollapsed =
                        !searching && section.collapsible === true && collapsed.has(section.key);
                      return (
                        <ComboboxGroup
                          key={section.key}
                          className="not-first:mt-1.5 not-first:border-t not-first:border-border/50"
                          data-picker-section={section.key}
                        >
                          {section.heading ? (
                            // Base UI hides the group label from assistive technology (it
                            // names the group), so a collapsible heading adds its own button.
                            <ComboboxLabel
                              className={cn(
                                STICKY_HEADING_CLASS,
                                "px-3.5 pt-2.5 pb-1.5 text-meta font-medium text-muted-foreground",
                                section.collapsible && !searching && "sr-only",
                              )}
                            >
                              {section.heading}
                            </ComboboxLabel>
                          ) : null}
                          {section.heading && section.collapsible && !searching ? (
                            <button
                              type="button"
                              aria-expanded={!isCollapsed}
                              className={cn(
                                STICKY_HEADING_CLASS,
                                "flex w-[calc(100%+0.75rem)] items-center gap-1 px-3.5 pt-2.5 pb-1.5 text-left text-meta font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                              )}
                              onClick={() =>
                                setCollapsed((current) => {
                                  const next = new Set(current);
                                  if (next.has(section.key)) next.delete(section.key);
                                  else next.add(section.key);
                                  return next;
                                })
                              }
                            >
                              {section.heading}
                              {isCollapsed ? (
                                <ChevronRight className="size-3" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="size-3" aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                          {isCollapsed
                            ? null
                            : section.options.map((option) => (
                                <ComposerPickerRow
                                  key={`${section.key}${KEY_SEPARATOR}${option.key}`}
                                  itemValue={`${section.key}${KEY_SEPARATOR}${option.key}`}
                                  option={option}
                                  current={option.key === selectedKey}
                                  pending={option.key === pendingKey}
                                  locked={busy || disabled}
                                  onToggleFavorite={onToggleFavorite}
                                />
                              ))}
                        </ComboboxGroup>
                      );
                    })}
                  </ComboboxList>
                  {error ? (
                    <p role="alert" className="px-3 pt-1 pb-3 text-meta text-destructive">
                      {error}
                    </p>
                  ) : !hasOptions ? (
                    <p
                      role="status"
                      className="flex items-center justify-center gap-2 px-3 pt-2 pb-3 text-meta text-muted-foreground"
                    >
                      {loading ? (
                        <Spinner className="size-3" aria-hidden="true" role={undefined} />
                      ) : null}
                      {loading ? loadingLabel : emptyLabel}
                    </p>
                  ) : null}
                </div>
                {detail ? (
                  <aside
                    aria-label="Details"
                    className="hidden w-56 shrink-0 overflow-y-auto border-l border-border/60 p-3 @[34rem]/picker:block"
                  >
                    {detail}
                  </aside>
                ) : null}
              </div>
              {footer || footerActions.length > 0 ? (
                <div className="flex min-h-9 items-center gap-2 border-t border-border/60 px-1.5 py-1">
                  <div className="min-w-0 flex-1 px-1.5 text-meta text-muted-foreground">
                    {footer}
                  </div>
                  {footerActions.map((item) => (
                    <Button
                      key={item.key}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        close();
                        item.onSelect();
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </ComboboxPrimitive.Root>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * Group headings stay pinned while their rows scroll beneath, on the popup's own material so
 * rows don't show through; they bleed to the list edges and sit above the gliding highlight.
 */
const STICKY_HEADING_CLASS =
  "sticky top-0 z-10 -mx-1.5 bg-popover supports-backdrop-filter:bg-popover/85 supports-backdrop-filter:backdrop-blur-md";

interface ComposerPickerRowProps<T> {
  itemValue: string;
  option: ComposerPickerOption<T>;
  current: boolean;
  pending: boolean;
  locked: boolean;
  onToggleFavorite?(option: ComposerPickerOption<T>): void;
}

function ComposerPickerRowView<T>({
  itemValue,
  option,
  current,
  pending,
  locked,
  onToggleFavorite,
}: ComposerPickerRowProps<T>) {
  return (
    <ComboboxItem
      hideIndicator
      value={itemValue}
      disabled={option.disabled || locked}
      aria-description={option.disabled ? option.disabledReason : undefined}
      className="group/picker-row min-h-8 items-start gap-2 py-1.5 pr-1.5"
      {...option.attributes}
    >
      {option.icon ? (
        <span className="mt-0.5 flex shrink-0 items-center text-muted-foreground">
          {option.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate", option.tone === "warning" && "text-warning")}>
            {option.label}
          </span>
          {option.badges?.map((badge) => (
            <Badge
              key={badge.label}
              variant={badge.tone === "danger" ? "destructive" : "outline"}
              className={cn("h-4 px-1.5", BADGE_CLASS[badge.tone ?? "neutral"])}
            >
              {badge.label}
            </Badge>
          ))}
        </span>
        {option.description ? (
          <span className="block truncate text-meta text-muted-foreground">
            {option.description}
          </span>
        ) : null}
        {option.disabled && option.disabledReason ? (
          <span className="block text-meta text-muted-foreground">{option.disabledReason}</span>
        ) : null}
      </span>
      {option.meta != null ? (
        <span className="mt-0.5 shrink-0 text-micro text-muted-foreground tabular-nums">
          {option.meta}
        </span>
      ) : null}
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {pending ? (
          <Spinner className="size-3" role={undefined} />
        ) : current ? (
          <Check className="size-3.5" data-picker-current="" />
        ) : null}
      </span>
      {onToggleFavorite ? (
        // Pointer shortcut only: a button inside an option is not reachable by assistive
        // technology, so pickers that offer favorites also expose the toggle in their details.
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          title={option.favorite ? "Remove from favorites" : "Add to favorites"}
          data-favorite={option.favorite ? "true" : undefined}
          className="-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/picker-row:opacity-100 group-data-highlighted/picker-row:opacity-100 hover:text-foreground data-[favorite=true]:text-warning data-[favorite=true]:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(option);
          }}
        >
          <Star className={cn("size-3", option.favorite && "fill-current")} />
        </button>
      ) : null}
    </ComboboxItem>
  );
}

const ComposerPickerRow = memo(ComposerPickerRowView) as typeof ComposerPickerRowView;
