import { QueryClientContext } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { RotateCw, WifiOff } from "lucide-react";
import { memo, useContext, useEffect, useState } from "react";
import type { OpenCodeConnectInput, OpenCodeRuntimeStatus } from "../../shared";
import { includeStartedProfileAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import type { ProjectCatalogRecovery } from "../hooks/use-project-catalog-recovery";
import { connectionOverview } from "../lib/connection-overview";
import {
  runningLocalTasks,
  runningTasksSentence,
  type RunningLocalTask,
} from "../lib/running-local-tasks";
import { palot } from "../services/palot";
import { OpenCodeReleaseSetup } from "./open-code-release-settings";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

/** Running tasks the confirmation names before "and N more". */
const MAX_LISTED_TASKS = 5;

export function SharedOpenCodeAction({
  action = "start",
  disabled,
  onConfirm,
}: {
  action?: "start" | "restart" | "replace";
  disabled?: boolean;
  onConfirm(): void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useContext(QueryClientContext);
  // Read when the dialog opens: the list is what this press would stop.
  const [running, setRunning] = useState<readonly RunningLocalTask[]>([]);
  const label =
    action === "start"
      ? "Start OpenCode"
      : action === "restart"
        ? "Restart service"
        : "Use selected runtime";
  const verb =
    action === "start" ? "recovering" : action === "restart" ? "restarting" : "replacing";
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next)
          setRunning(
            queryClient ? runningLocalTasks(connectionOverview(queryClient).getSnapshot()) : [],
          );
        setOpen(next);
      }}
    >
      <AlertDialogTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === "start"
              ? "Start or recover shared OpenCode?"
              : action === "restart"
                ? "Restart shared OpenCode?"
                : "Replace shared OpenCode?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This uses the runtime selected in local OpenCode settings. Your installed OpenCode is
            preferred by default; an explicitly downloaded Palot runtime is the fallback. The
            selected runtime may be untested.{" "}
            {action === "start"
              ? "This may restart an unresponsive shared service and interrupt other OpenCode clients and their running tasks."
              : "This will restart the shared service and may interrupt other OpenCode clients and their running tasks."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {running.length ? (
          <Banner
            status="warning"
            data-palot-running-tasks=""
            title={`${runningTasksSentence(running.length)}; ${verb} stops ${running.length === 1 ? "it" : "them"}.`}
          >
            <ul className="m-0 list-none space-y-0.5 p-0 text-meta text-muted-foreground">
              {running.slice(0, MAX_LISTED_TASKS).map((task) => (
                <li key={task.id} className="truncate" title={task.title}>
                  {task.title}
                </li>
              ))}
              {running.length > MAX_LISTED_TASKS ? (
                <li>and {running.length - MAX_LISTED_TASKS} more</li>
              ) : null}
            </ul>
          </Banner>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {action === "start"
              ? "Start or recover"
              : action === "restart"
                ? "Restart"
                : "Replace service"}
            {running.length ? " anyway" : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const CONNECTION_ALERT_DELAY_MS = 1_200;

export const OpenCodeConnectionAlert = memo(function OpenCodeConnectionAlert({
  recovery = null,
}: {
  /** A connected server that could not load this project's catalogs. */
  recovery?: ProjectCatalogRecovery | null;
}) {
  const runtime = useAtomValue(runtimeAtom);

  if (!runtime) return null;
  if (runtime.connected) {
    // Only explain the catalogs of the connection that reported them.
    return recovery && recovery.connectionID === runtime.connectionID ? (
      <ProjectCatalogAlert recovery={recovery} />
    ) : null;
  }
  return <DisconnectedOpenCodeAlert key={runtime.connectionID} runtime={runtime} />;
});

function ProjectCatalogAlert({ recovery }: { recovery: ProjectCatalogRecovery }) {
  const labels = recovery.failures.map((failure) => failure.label.toLowerCase()).join(" and ");
  return (
    <Banner
      status="error"
      className="mb-2"
      title={`Can't load ${labels} for this project`}
      actions={
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={recovery.retrying}
          onClick={() => void recovery.retry().catch(() => undefined)}
        >
          {recovery.retrying ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <RotateCw data-icon="inline-start" aria-hidden="true" />
          )}
          Retry
        </Button>
      }
    >
      <p>
        New tasks here can't start until OpenCode loads them. Fix the problem below, then retry.
      </p>
      <ul className="mt-1 grid gap-1">
        {recovery.failures.map((failure) => (
          <li key={failure.capability} className="min-w-0">
            <span className="font-medium">{failure.label}: </span>
            <span className="whitespace-pre-wrap wrap-anywhere">{failure.message}</span>
            {failure.reference ? (
              <span className="block font-mono text-code-compact text-muted-foreground wrap-anywhere">
                Reference {failure.reference}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

function DisconnectedOpenCodeAlert({ runtime }: { runtime: OpenCodeRuntimeStatus }) {
  const setRuntime = useSetAtom(runtimeAtom);
  const includeStartedProfile = useSetAtom(includeStartedProfileAtom);
  const [visible, setVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), CONNECTION_ALERT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

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
    <Alert className="mb-2 has-data-[slot=alert-action]:pr-2" role="status">
      {reconnecting ? <Spinner aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      <AlertTitle>
        {reconnecting ? "Reconnecting to OpenCode" : "OpenCode is unavailable"}
      </AlertTitle>
      <AlertDescription>
        Sending is temporarily unavailable. Your conversation is safe.
      </AlertDescription>
      <AlertAction className="static col-start-2 row-auto flex flex-wrap items-center gap-1 justify-self-start">
        {runtime.canStartLocalService ? (
          <SharedOpenCodeAction
            disabled={retrying || runtime.phase === "starting"}
            onConfirm={() => void reconnect({ startLocalService: true })}
          />
        ) : null}
        {runtime.source === "shared-service" || runtime.canStartLocalService ? (
          <OpenCodeReleaseSetup />
        ) : null}
        <Dialog>
          <DialogTrigger render={<Button type="button" variant="ghost" size="xs" />}>
            Details
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>OpenCode connection details</DialogTitle>
              <DialogDescription>
                Technical details for diagnosing the Palot to OpenCode connection.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Phase</dt>
              <dd>{runtime.phase}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{runtime.version ?? "Unknown"}</dd>
              <dt className="text-muted-foreground">Process</dt>
              <dd>{runtime.pid ?? "Not running"}</dd>
              <dt className="text-muted-foreground">Error</dt>
              <dd className="min-w-0 break-words font-mono">
                {runtime.error ?? "No error reported"}
              </dd>
            </dl>
          </DialogContent>
        </Dialog>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={reconnecting}
          onClick={() => void reconnect()}
        >
          {retrying ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <RotateCw data-icon="inline-start" aria-hidden="true" />
          )}
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
