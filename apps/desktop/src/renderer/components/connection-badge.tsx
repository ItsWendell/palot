import { Cloud, CloudOff, Monitor } from "lucide-react";
import type { OpenCodeProfile } from "../../shared";
import { cn } from "../lib/cn";

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
}: {
  profile: OpenCodeProfile;
  connected: boolean;
  compact?: boolean;
}) {
  const label = `${connectionDescription(profile)} · ${connected ? "Connected" : "Disconnected"}`;
  const Icon = !connected ? CloudOff : profile.kind === "local" ? Monitor : Cloud;
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          connected && profile.kind !== "local" ? "text-success" : "text-muted-foreground",
        )}
      />
      <span aria-hidden="true" className={cn("truncate", compact ? "max-w-12" : "max-w-40")}>
        {compact && profile.kind === "local" ? "Local" : profile.name}
      </span>
    </span>
  );
}
