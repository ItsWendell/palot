import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { AppWindow, FileText, SquareArrowOutUpRight } from "lucide-react";
import { memo, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { useBrowserSession } from "../../hooks/use-browser-session";
import { useLocationArtifacts } from "../../hooks/use-location-artifacts";
import {
  artifactDestination,
  artifactKind,
  matchArtifact,
  type ArtifactCall,
  type ArtifactOperation,
} from "../../lib/artifact-calls";
import { cn } from "../../lib/cn";
import { openCodeKeys } from "../../lib/opencode-query";
import { canFetchOpenCode } from "../../lib/opencode-runtime-query";
import { showErrorToast } from "../../lib/toast-error";
import { formatRelativeTime } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PulseDot } from "../ui/pulse-dot";
import { TranscriptArtifactContext } from "./artifact-context";

const VERB: Record<ArtifactOperation, { done: string; active: string; failed: string }> = {
  create: { done: "Published", active: "Publishing", failed: "Couldn't publish" },
  update: { done: "Updated", active: "Updating", failed: "Couldn't update" },
  read: { done: "Read", active: "Reading", failed: "Couldn't read" },
  delete: { done: "Deleted", active: "Deleting", failed: "Couldn't delete" },
};

// One shared minute tick keeps "Updated 3m ago" honest without a timer per card.
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
let clockNow = Date.now();
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, 60_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
function useMinuteClock() {
  return useSyncExternalStore(subscribeClock, () => clockNow);
}

function updatedLabel(timestamp: number, now: number): string {
  const relative = formatRelativeTime(timestamp, Math.max(now, timestamp));
  if (relative === "now") return "updated just now";
  return /^\d/.test(relative) ? `updated ${relative} ago` : `updated ${relative}`;
}

/**
 * One artifact tool call: what was published, its kind, and when it last changed, with Open in
 * the task's Palot Browser. The project's artifact list keeps it current after later updates.
 */
export const ArtifactCard = memo(function ArtifactCard({ call }: { call: ArtifactCall }) {
  const scope = useContext(TranscriptArtifactContext);
  const runtime = useAtomValue(runtimeAtom);
  const browserEnabled = useAtomValue(experimentalBrowserAtom);
  const now = useMinuteClock();
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState(false);
  const connected = Boolean(
    scope && runtime?.connectionID === scope.connectionID && canFetchOpenCode(runtime),
  );
  const browser = useBrowserSession({
    profileID: runtime?.profileID ?? "",
    sessionID: scope?.sessionID ?? "",
  });
  const { artifacts, loaded, unavailable } = useLocationArtifacts(
    scope?.connectionID ?? "disconnected",
    scope?.location.directory ?? "",
    connected && call.status !== "running",
  );
  // A list read before this call finished misses its change; refresh it once so every card
  // for the same artifact, including earlier ones, shows the result.
  useEffect(() => {
    if (!scope || !connected || call.settledAt === null) return;
    const queryKey = openCodeKeys.artifactsLocation(scope.connectionID, scope.location.directory);
    const state = queryClient.getQueryState(queryKey);
    if (state && state.dataUpdatedAt >= call.settledAt) return;
    void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  }, [call.settledAt, connected, queryClient, scope]);

  const live = matchArtifact(call, artifacts, scope?.sessionID);
  const id = live?.id ?? call.id;
  const title = live?.title ?? call.title ?? id ?? "Artifact";
  const entry = live?.entry ?? call.entry;
  const kind = artifactKind(entry);
  const provider = live?.provider ?? call.provider;
  const updatedAt = live?.time.updated ?? call.updatedAt;
  const destination = artifactDestination(live?.url ?? call.url);
  const removed =
    call.operation === "delete" ||
    (call.status === "complete" && Boolean(call.id) && loaded && !unavailable && !live);
  const verb =
    call.status === "running"
      ? `${VERB[call.operation].active}…`
      : call.status === "error"
        ? VERB[call.operation].failed
        : VERB[call.operation].done;
  const meta = [
    verb,
    call.status === "complete" && !removed ? kind : null,
    provider && provider !== "local" ? provider : null,
    call.status === "complete" && !removed && updatedAt ? updatedLabel(updatedAt, now) : null,
    call.status === "complete" && removed && call.operation !== "delete"
      ? "no longer available"
      : null,
  ].filter(Boolean);
  const canOpen = call.status === "complete" && !removed && Boolean(id && destination);

  const open = async () => {
    if (!id || !destination) return;
    if (!browserEnabled) {
      showErrorToast(
        "Browser unavailable",
        new Error("Enable Palot Browser in settings to open artifacts"),
      );
      return;
    }
    if (!connected || !browser?.bindingID) {
      showErrorToast(
        "Browser unavailable",
        new Error(
          scope && runtime?.connectionID !== scope.connectionID
            ? "Switch to this task's server to open its artifacts"
            : (browser?.error ?? "Browser is still connecting to this task"),
        ),
      );
      return;
    }
    setOpening(true);
    try {
      if (destination.kind === "hosted") await palot.browserOpenArtifact(browser.bindingID, id);
      else
        await palot.browserCommand(browser.bindingID, {
          type: "tabs.open",
          url: destination.url,
          focus: true,
        });
    } catch (error) {
      showErrorToast("Could not open artifact", error);
    } finally {
      setOpening(false);
    }
  };

  const Icon = kind === "Markdown" ? FileText : AppWindow;
  return (
    <div
      role="group"
      aria-label={`Artifact: ${title}`}
      data-palot-artifact={id ?? undefined}
      data-status={call.status}
      className={cn(
        "my-1 flex w-full max-w-md min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/15 py-1 pr-1 pl-2 text-xs",
        removed && "text-muted-foreground",
      )}
    >
      {call.status === "running" ? (
        <PulseDot />
      ) : (
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate font-medium",
            removed ? "text-muted-foreground line-through" : "text-foreground/90",
          )}
          title={title}
        >
          {title}
        </span>
        <span
          className="truncate text-meta text-muted-foreground"
          title={call.error ?? (updatedAt ? new Date(updatedAt).toLocaleString() : undefined)}
        >
          {meta.join(" · ")}
        </span>
      </span>
      {call.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
      {canOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={opening}
          aria-label={`Open ${title} in Palot Browser`}
          onClick={() => void open()}
        >
          <SquareArrowOutUpRight data-icon="inline-start" aria-hidden="true" />
          Open
        </Button>
      ) : null}
    </div>
  );
});
