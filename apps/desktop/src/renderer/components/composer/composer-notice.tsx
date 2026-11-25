/**
 * The one condition line above the card: the task's workspace is missing, OpenCode cannot be
 * reached, the provider's usage limit is reached, or the context would be read again in full.
 * One shows at a time by that priority; "+1" says another waits and shows it.
 */

import { useAtomValue, useSetAtom } from "jotai";
import { CircleGauge, Ellipsis, FolderX, RotateCw, Shrink, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { OpenCodeConnectInput, OpenCodeRuntimeStatus } from "../../../shared";
import { formatLimitReset, type ProviderLimit } from "../../../shared/provider-limit";
import { compactBeforeSendSuggestionAtom } from "../../atoms/ui";
import { includeStartedProfileAtom } from "../../atoms/connections";
import { runtimeAtom } from "../../atoms/workspace";
import type { ProjectCatalogRecovery } from "../../hooks/use-project-catalog-recovery";
import { formatTokenCount } from "../../lib/context-usage";
import { palot } from "../../services/palot";
import { OpenCodeReleaseSetup } from "../open-code-release-settings";
import { SharedOpenCodeAction } from "../opencode-connection-alert";
import { SessionLocationMissingView } from "../session-location-missing";
import { Button } from "../ui/button";
import {
  ComposerNotice,
  ComposerNoticeAction,
  ComposerNoticeMore,
  ComposerNoticeText,
} from "../ui/composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import type { ComposerController } from "./use-composer";

type ComposerNoticeID = "workspace-missing" | "connection" | "usage-limit" | "context-full";

/** The order notices take: one shows, the rest wait behind "+N". */
const NOTICE_PRIORITY: readonly ComposerNoticeID[] = [
  "workspace-missing",
  "connection",
  "usage-limit",
  "context-full",
];

const NOTICE_TONE: Record<ComposerNoticeID, "info" | "warning" | "destructive"> = {
  "workspace-missing": "warning",
  connection: "destructive",
  "usage-limit": "warning",
  "context-full": "info",
};

/** A lost connection is reported after this long, so a brief reconnect does not flash. */
export const CONNECTION_NOTICE_DELAY_MS = 1_200;

/** True once `active` has held for `delay`; resets when `key` changes. */
function useDelayed(active: boolean, delay: number, key: string): boolean {
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setShownFor(key), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay, key]);
  return active && shownFor === key;
}

/** True until `at`, re-rendering once when it passes. */
function useBefore(at: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null || at <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), at - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [at]);
  return at !== null && at > Math.max(now, Date.now());
}

/**
 * The notice line for the composer `c`. `usageLimit` is the provider limit that failed the last
 * turn (`lastMessageLimit`).
 */
export function ComposerNoticeLine({
  composer: c,
  usageLimit,
}: {
  composer: ComposerController;
  usageLimit: ProviderLimit | null;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const recovery = c.selection.catalogRecovery;
  const disconnected = Boolean(runtime && !runtime.connected);
  const connectionLost = useDelayed(
    disconnected,
    CONNECTION_NOTICE_DELAY_MS,
    runtime?.connectionID ?? "",
  );
  const catalogFailed = Boolean(
    runtime?.connected && recovery && recovery.connectionID === runtime.connectionID,
  );
  const resetsAt = usageLimit?.resets ? usageLimit.resetsAt : null;
  const beforeReset = useBefore(resetsAt);
  // A limit with a reset shows until it lifts; one without stays until the next message, except a
  // plain rate limit, which says nothing worth keeping.
  const limited =
    usageLimit !== null &&
    (resetsAt !== null ? beforeReset : !usageLimit.resets || usageLimit.kind !== "rate-limit");
  const active: Record<ComposerNoticeID, boolean> = {
    "workspace-missing": c.location.missing,
    connection: connectionLost || catalogFailed,
    "usage-limit": limited && !c.newTask,
    "context-full": c.compact.tokens !== null,
  };
  const notices = NOTICE_PRIORITY.filter((id) => active[id]);
  const [front, setFront] = useState<ComposerNoticeID | null>(null);
  // The notice brought forward with "+1" leads while it lasts; then priority decides again.
  const ordered =
    front && notices.includes(front) ? [front, ...notices.filter((id) => id !== front)] : notices;
  const shown = ordered[0] ?? null;
  const more =
    ordered.length > 1 ? (
      <ComposerNoticeMore
        aria-label={`${ordered.length - 1} more ${ordered.length === 2 ? "notice" : "notices"}`}
        onClick={() => setFront(ordered[1]!)}
      >
        +{ordered.length - 1}
      </ComposerNoticeMore>
    ) : null;

  let notice: ReactNode = null;
  if (shown === "workspace-missing") {
    notice = (
      <>
        <FolderX aria-hidden="true" />
        <ComposerNoticeText title={c.session.location.directory}>
          This workspace folder is missing
        </ComposerNoticeText>
        <Popover>
          <PopoverTrigger render={<ComposerNoticeAction />}>Recover…</PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[420px] p-0">
            <SessionLocationMissingView
              options={c.location.options}
              recovery={c.location.recovery}
            />
          </PopoverContent>
        </Popover>
        {more}
      </>
    );
  } else if (shown === "connection") {
    notice =
      catalogFailed && recovery ? (
        <CatalogNotice recovery={recovery} more={more} />
      ) : runtime ? (
        <ConnectionNotice key={runtime.connectionID} runtime={runtime} more={more} />
      ) : null;
  } else if (shown === "usage-limit" && usageLimit) {
    notice = (
      <>
        <CircleGauge aria-hidden="true" />
        <ComposerNoticeText>
          {usageLimit.title}
          {resetsAt !== null ? ` · resets ${formatLimitReset(resetsAt)}` : ""}
          {usageLimit.adminRequest ? " · ask your workspace admin" : ""}
        </ComposerNoticeText>
        <ComposerNoticeAction onClick={() => c.menus.open("model")}>
          Switch model
        </ComposerNoticeAction>
        {more}
      </>
    );
  } else if (shown === "context-full" && c.compact.tokens !== null) {
    notice = <ContextNotice composer={c} tokens={c.compact.tokens} more={more} />;
  }
  const id = notice === null ? null : shown === "connection" && catalogFailed ? "catalogs" : shown;
  return (
    <ComposerNotice
      open={notice !== null}
      tone={shown ? NOTICE_TONE[shown] : "info"}
      data-palot-notice={id ?? undefined}
    >
      {notice}
    </ComposerNotice>
  );
}

function ConnectionNotice({ runtime, more }: { runtime: OpenCodeRuntimeStatus; more: ReactNode }) {
  const setRuntime = useSetAtom(runtimeAtom);
  const includeStartedProfile = useSetAtom(includeStartedProfileAtom);
  const [retrying, setRetrying] = useState(false);
  const reconnecting =
    retrying || runtime.phase === "reconnecting" || runtime.phase === "connecting";

  async function reconnect(input?: OpenCodeConnectInput) {
    setRetrying(true);
    try {
      const next = await palot.connectOpenCode(input);
      if (input?.startLocalService) includeStartedProfile(next);
      setRuntime(next);
    } catch {
      setRuntime(await palot.runtimeStatus().catch(() => runtime));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      {reconnecting ? <Spinner aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      <ComposerNoticeText>
        {reconnecting ? "Reconnecting to OpenCode" : "OpenCode is unavailable"}
        <span className="text-muted-foreground">
          {" "}
          · Sending is paused; your conversation is safe
        </span>
      </ComposerNoticeText>
      <ComposerNoticeAction disabled={reconnecting} onClick={() => void reconnect()}>
        <RotateCw data-icon="inline-start" aria-hidden="true" />
        Retry
      </ComposerNoticeAction>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Connection details"
              className="shrink-0"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80 gap-3">
          <p className="m-0 text-compact">
            Sending is temporarily unavailable. Your conversation is safe.
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {runtime.canStartLocalService ? (
              <SharedOpenCodeAction
                disabled={retrying || runtime.phase === "starting"}
                onConfirm={() => void reconnect({ startLocalService: true })}
              />
            ) : null}
            {runtime.source === "shared-service" || runtime.canStartLocalService ? (
              <OpenCodeReleaseSetup />
            ) : null}
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
            <dt className="text-muted-foreground">Phase</dt>
            <dd className="m-0">{runtime.phase}</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="m-0">{runtime.version ?? "Unknown"}</dd>
            <dt className="text-muted-foreground">Process</dt>
            <dd className="m-0">{runtime.pid ?? "Not running"}</dd>
            <dt className="text-muted-foreground">Error</dt>
            <dd className="m-0 min-w-0 font-mono break-words">
              {runtime.error ?? "No error reported"}
            </dd>
          </dl>
        </PopoverContent>
      </Popover>
      {more}
    </>
  );
}

function CatalogNotice({ recovery, more }: { recovery: ProjectCatalogRecovery; more: ReactNode }) {
  const labels = recovery.failures.map((failure) => failure.label.toLowerCase()).join(" and ");
  return (
    <>
      <WifiOff aria-hidden="true" />
      <ComposerNoticeText>Can&apos;t load {labels} for this project</ComposerNoticeText>
      <ComposerNoticeAction
        disabled={recovery.retrying}
        onClick={() => void recovery.retry().catch(() => undefined)}
      >
        {recovery.retrying ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <RotateCw data-icon="inline-start" aria-hidden="true" />
        )}
        Retry
      </ComposerNoticeAction>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label="What failed" className="shrink-0" />
          }
        >
          <Ellipsis aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-96 gap-2 text-meta">
          <p className="m-0">
            New tasks here can&apos;t start until OpenCode loads them. Fix the problem below, then
            retry.
          </p>
          <ul className="m-0 grid gap-1 p-0">
            {recovery.failures.map((failure) => (
              <li key={failure.capability} className="min-w-0 list-none">
                <span className="font-medium">{failure.label}: </span>
                <span className="whitespace-pre-wrap wrap-anywhere">{failure.message}</span>
                {failure.reference || failure.detail ? (
                  <span className="block font-mono text-code-compact text-muted-foreground wrap-anywhere">
                    {[failure.detail?.tag, failure.reference ? `ref ${failure.reference}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {more}
    </>
  );
}

/**
 * The task has been idle long enough that sending reads its whole history again. The toggle
 * picks what the primary does: compact first (the default) or send as is.
 */
function ContextNotice({
  composer: c,
  tokens,
  more,
}: {
  composer: ComposerController;
  tokens: number;
  more: ReactNode;
}) {
  const setSuggestion = useSetAtom(compactBeforeSendSuggestionAtom);
  const { sendAsIs, setSendAsIs } = c.compact;
  return (
    <>
      <Shrink aria-hidden="true" />
      <ComposerNoticeText title="The task has been idle, so its history would be read again in full.">
        Sending re-reads {formatTokenCount(tokens)} tokens of history
      </ComposerNoticeText>
      <ToggleGroup
        variant="segmented"
        size="sm"
        aria-label="Before sending"
        className="shrink-0"
        value={[sendAsIs ? "skip" : "compact"]}
        onValueChange={(value) => {
          if (value[0] === "skip") setSendAsIs(true);
          else if (value[0] === "compact") setSendAsIs(false);
        }}
      >
        <ToggleGroupItem value="compact">Compact first</ToggleGroupItem>
        <ToggleGroupItem value="skip">Send as is</ToggleGroupItem>
      </ToggleGroup>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="More about compacting"
              className="shrink-0"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <DropdownMenuItem onClick={() => setSuggestion(false)}>
            Don&apos;t suggest again
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {more}
    </>
  );
}
