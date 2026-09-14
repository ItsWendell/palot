import { Cloud, CloudOff, Monitor } from "lucide-react";
import type { OpenCodeProfile } from "../../shared";
import { cn } from "../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function connectionDescription(profile: OpenCodeProfile): string {
  if (profile.kind === "local") return `${profile.name} · Local`;
  if (profile.kind === "ssh")
    return `${profile.name} · ${profile.ssh.target}${profile.ssh.port ? `:${profile.ssh.port}` : ""}`;
  const hosts = profile.urls.map((url) => {
    try {
      return new URL(url).host;
    } catch {
      return "Invalid host";
    }
  });
  return `${profile.name} · ${hosts.join(", ")}`;
}

export function ConnectionBadge({
  profile,
  connected,
  compact = false,
  iconOnly = false,
}: {
  profile: OpenCodeProfile;
  connected: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const label = `${connectionDescription(profile)} · ${connected ? "Connected" : "Disconnected"}`;
  const Icon = !connected ? CloudOff : profile.kind === "local" ? Monitor : Cloud;
  const badge = (
    <span
      title={iconOnly ? undefined : label}
      aria-label={label}
      role="img"
      tabIndex={iconOnly ? 0 : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground",
        iconOnly &&
          "pointer-events-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          iconOnly
            ? connected
              ? "text-muted-foreground"
              : "text-warning"
            : connected && profile.kind !== "local"
              ? "text-success"
              : "text-muted-foreground",
        )}
      />
      {!iconOnly && (
        <span aria-hidden="true" className={cn("truncate", compact ? "max-w-12" : "max-w-40")}>
          {compact && profile.kind === "local" ? "Local" : profile.name}
        </span>
      )}
    </span>
  );
  if (!iconOnly) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent side="right" className="leading-normal">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
