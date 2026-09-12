import type { ComponentType, ReactNode } from "react";
import { cn } from "../lib/cn";

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

export function SettingsRow({
  title,
  description,
  status,
  control,
}: {
  title: string;
  description?: string;
  status?: string;
  control?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-center @lg/settings:gap-6">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-prose text-compact leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {status ? <p className="mt-1 text-meta text-muted-foreground">{status}</p> : null}
      </div>
      {control ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 @lg/settings:justify-end">
          {control}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-compact leading-relaxed text-muted-foreground">{children}</p>;
}
