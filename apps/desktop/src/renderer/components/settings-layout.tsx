import { useId, type ComponentType, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Banner, type BannerProps } from "./ui/banner";

/** A titled settings section: heading, optional description and header actions, then content. */
export function SettingsSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("@container/settings space-y-3", className)}>
      <header className="flex flex-col gap-3 @lg/settings:flex-row @lg/settings:items-start @lg/settings:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {Icon ? (
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {title}
          </h2>
          {description ? (
            <p className="max-w-prose text-compact leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A bordered card of rows separated by hairlines. Put `SettingsRow`s (or notices) inside. */
export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type SettingsTone = "default" | "info" | "success" | "warning" | "destructive";

const TONE_TEXT: Record<SettingsTone, string> = {
  default: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/**
 * Row padding scale: `default` is `p-4` for rows with a description or a large control;
 * `compact` is `px-4 py-2.5` for dense lists of one-line toggles. Rows never hand-pad.
 */
export type SettingsRowDensity = "default" | "compact";

/**
 * One setting: title, description and status on the left, its control on the right
 * (stacked below in a narrow container).
 *
 * - `icon` leads the title; `badge` trails it (e.g. "Beta", "Restart required").
 * - `control` is the primary control; `actions` holds secondary ones (overflow menu, reset).
 * - `tone` colors `status` and the icon for a row-level state (an error, a warning).
 * - `align="start"` top-aligns the control for tall content (lists, text areas).
 * - `htmlFor` renders the title as a `<label>` for a single form control.
 * - `children` render full-width under the row, e.g. a `SettingsNotice` or extra fields.
 */
export function SettingsRow({
  title,
  description,
  status,
  control,
  icon: Icon,
  badge,
  actions,
  tone = "default",
  align = "center",
  density = "default",
  htmlFor,
  id,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
  actions?: ReactNode;
  tone?: SettingsTone;
  align?: "center" | "start";
  density?: SettingsRowDensity;
  htmlFor?: string;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  const TitleTag = htmlFor ? "label" : "h3";
  const compact = density === "compact";
  return (
    <div
      id={id}
      data-slot="settings-row"
      data-tone={tone}
      data-density={density}
      className={cn("min-w-0", compact ? "px-4 py-2.5" : "p-4", className)}
    >
      <div
        className={cn(
          "grid min-w-0 gap-3 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:gap-6",
          align === "start" ? "@lg/settings:items-start" : "@lg/settings:items-center",
        )}
      >
        <div className="flex min-w-0 gap-3">
          {Icon ? (
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                tone === "default" ? "text-muted-foreground" : TONE_TEXT[tone],
              )}
              aria-hidden="true"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <TitleTag htmlFor={htmlFor} className="text-sm font-medium">
                {title}
              </TitleTag>
              {badge}
            </div>
            {description ? (
              <p
                className={cn(
                  "max-w-prose text-compact leading-relaxed text-muted-foreground",
                  compact ? "mt-0.5" : "mt-1",
                )}
              >
                {description}
              </p>
            ) : null}
            {status ? (
              <p className={cn("text-meta", compact ? "mt-0.5" : "mt-1", TONE_TEXT[tone])}>
                {status}
              </p>
            ) : null}
          </div>
        </div>
        {control || actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 @lg/settings:justify-end">
            {control}
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className={cn("min-w-0", compact ? "mt-2" : "mt-3")}>{children}</div> : null}
    </div>
  );
}

/** Placeholder text for an empty group. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-compact leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * A settings notice: `Banner` with settings spacing. Standalone it is a `section` banner;
 * with `inGroup` it fills a `SettingsGroup` row (padded like a row, no second border).
 */
export function SettingsNotice({
  inGroup = false,
  variant,
  className,
  ...props
}: BannerProps & { inGroup?: boolean }) {
  const banner = (
    <Banner
      variant={variant ?? (inGroup ? "inline" : "section")}
      className={className}
      {...props}
    />
  );
  return inGroup ? <div className="p-3">{banner}</div> : banner;
}

export interface SettingsFact {
  label: ReactNode;
  value: ReactNode;
  /** Monospace value (ids, versions, paths). */
  mono?: boolean;
}

/**
 * Read-only facts as a definition list. `rows` pairs a label column with values;
 * `columns` stacks label over value in tiles that wrap with the available width.
 * For a value people copy, pass a `CopyField` as the value.
 */
export function SettingsFacts({
  facts,
  layout = "rows",
  className,
}: {
  facts: readonly SettingsFact[];
  layout?: "rows" | "columns";
  className?: string;
}) {
  if (layout === "columns") {
    return (
      <dl
        className={cn(
          "grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-x-6 gap-y-3 text-compact",
          className,
        )}
      >
        {facts.map((fact, index) => (
          <div key={index} className="min-w-0">
            <dt className="text-meta text-muted-foreground">{fact.label}</dt>
            <dd
              className={cn(
                "mt-0.5 min-w-0 wrap-anywhere",
                fact.mono && "font-mono text-code-compact",
              )}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      className={cn(
        "grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-compact",
        className,
      )}
    >
      {facts.map((fact, index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className={cn("min-w-0 wrap-anywhere", fact.mono && "font-mono text-code-compact")}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A collapsed group of advanced or rarely changed settings. The trigger shows `title`
 * and `description`; the body holds rows or any content. Controlled with `open` and
 * `onOpenChange`, or uncontrolled with `defaultOpen`.
 */
export function SettingsDisclosure({
  title,
  description,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const value = useId();
  return (
    <Accordion
      className={cn("rounded-xl border-border bg-card", className)}
      value={open === undefined ? undefined : open ? [value] : []}
      defaultValue={open === undefined && defaultOpen ? [value] : undefined}
      onValueChange={(next) => onOpenChange?.(next.includes(value))}
    >
      <AccordionItem value={value} className="data-open:bg-transparent">
        <AccordionTrigger className="items-center px-4 py-3 hover:no-underline">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            {description ? (
              <span className="text-compact font-normal text-muted-foreground">{description}</span>
            ) : null}
          </span>
        </AccordionTrigger>
        <AccordionContent
          panelClassName="px-0"
          className="border-t border-border pb-0 [&>*+*]:border-t [&>*+*]:border-border"
        >
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
