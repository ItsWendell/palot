import type { LucideIcon } from "lucide-react";
import { memo, type ComponentProps, type PropsWithChildren, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton as ShadcnSkeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AppIcon, type AppIconName } from "./ui/app-icon";

type IconButtonProps = ComponentProps<typeof Button> &
  (
    | { label: string; icon: LucideIcon; appIcon?: never; children?: never }
    | { label: string; appIcon: AppIconName; icon?: never; children?: never }
    | { label: string; icon?: never; appIcon?: never; children: ReactNode }
  );

export const IconButton = memo(function IconButton({
  label,
  icon: Icon,
  appIcon,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          Icon || appIcon ? (
            <Button type="button" variant="ghost" size="icon" aria-label={label} {...props}>
              {appIcon ? <AppIcon name={appIcon} aria-hidden="true" /> : null}
              {Icon ? <Icon data-icon="fallback" aria-hidden="true" /> : null}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" aria-label={label} {...props} />
          )
        }
      >
        {Icon || appIcon ? null : children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

export function LoadingButton({
  loading = false,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-busy={loading}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

export function LiveActivity({ label = "Working" }: { label?: string }) {
  return (
    <Badge variant="outline" role="status" aria-label={label || "Working"}>
      <Spinner aria-hidden="true" />
      {label || null}
    </Badge>
  );
}

export function TooltipGroup({ children }: PropsWithChildren) {
  return <div className="flex gap-0.5">{children}</div>;
}

export function Skeleton(props: ComponentProps<typeof ShadcnSkeleton>) {
  return <ShadcnSkeleton aria-hidden="true" {...props} />;
}
