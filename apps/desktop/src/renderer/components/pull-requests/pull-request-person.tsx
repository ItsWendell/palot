import { Bot } from "lucide-react";
import { useState } from "react";
import type { PullRequestPerson, PullRequestState } from "../../../shared/source-control-contract";
import { cn } from "../../lib/cn";
import {
  initials,
  PULL_REQUEST_STATE_ICON,
  PULL_REQUEST_STATE_LABEL,
} from "./pull-request-presentation";

const AVATAR_ORIGIN = "https://avatars.githubusercontent.com/";

/** GitHub avatar when it comes from GitHub's avatar host (the only one the CSP allows). */
function avatarSource(person: PullRequestPerson | null | undefined): string | null {
  const url = person?.avatarUrl;
  return url && url.startsWith(AVATAR_ORIGIN) ? url : null;
}

/**
 * GitHub avatar, falling back to initials (or a bot glyph) when there is no allowed image or it
 * fails to load. Both render at the same size so rows never shift.
 */
export function PullRequestAvatar({
  person,
  login = person?.login ?? "ghost",
  className,
}: {
  person?: PullRequestPerson | null;
  login?: string;
  className?: string;
}) {
  const source = avatarSource(person);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[0.625rem] leading-none font-medium text-muted-foreground",
        className,
      )}
    >
      {source && failed !== source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(source)}
        />
      ) : person?.isBot ? (
        <Bot className="size-3" />
      ) : (
        initials(login)
      )}
    </span>
  );
}

export function PullRequestPersonLabel({
  person,
  login = person?.login ?? "ghost",
  className,
}: {
  person?: PullRequestPerson | null;
  login?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <PullRequestAvatar person={person} login={login} className="size-4" />
      <span className="truncate">{login}</span>
    </span>
  );
}

const STATE_PILL: Record<PullRequestState, string> = {
  open: "bg-success/12 text-success",
  draft: "bg-muted text-muted-foreground",
  merged: "bg-info/12 text-info",
  closed: "bg-destructive/10 text-destructive",
};

export function PullRequestStatePill({
  state,
  className,
}: {
  state: PullRequestState;
  className?: string;
}) {
  const Icon = PULL_REQUEST_STATE_ICON[state];
  return (
    <span
      data-pull-request-state={state}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-tag font-medium",
        STATE_PILL[state],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {PULL_REQUEST_STATE_LABEL[state]}
    </span>
  );
}
