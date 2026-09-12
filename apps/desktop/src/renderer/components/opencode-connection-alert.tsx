import { useAtomValue, useSetAtom } from "jotai";
import { RotateCw, WifiOff } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { OpenCodeConnectInput, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeReleaseSetup } from "./open-code-release-settings";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
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
  const label =
    action === "start"
      ? "Start OpenCode"
      : action === "restart"
        ? "Restart service"
        : "Use selected runtime";
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
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
            This uses the prepared next-start runtime from OpenCode release settings, or the bundled
            runtime if none is prepared. The selected runtime may be untested.{" "}
            {action === "start"
              ? "This may restart an unresponsive shared service and interrupt other OpenCode clients and their running tasks."
              : "This will restart the shared service and may interrupt other OpenCode clients and their running tasks."}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const CONNECTION_ALERT_DELAY_MS = 1_200;

export const OpenCodeConnectionAlert = memo(function OpenCodeConnectionAlert() {
  const runtime = useAtomValue(runtimeAtom);

  if (!runtime || runtime.connected) return null;
  return <DisconnectedOpenCodeAlert key={runtime.connectionID} runtime={runtime} />;
});

function DisconnectedOpenCodeAlert({ runtime }: { runtime: OpenCodeRuntimeStatus }) {
  const setRuntime = useSetAtom(runtimeAtom);
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
      setRuntime(await palot.connectOpenCode(input));
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
