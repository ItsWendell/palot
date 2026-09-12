import { useEffect, useState } from "react";
import type { SshConnectionState } from "../../shared/ssh-contract";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { toast } from "./ui/toast";

const stageLabels: Record<string, string> = {
  connecting: "Connecting over SSH…",
  checking: "Checking remote OpenCode…",
  setup: "Waiting for setup approval…",
  downloading: "Downloading the matching runtime…",
  uploading: "Installing the remote runtime…",
  starting: "Starting remote OpenCode…",
  forwarding: "Opening the local tunnel…",
  "checking-health": "Verifying the connection…",
};

export function SshPrompts() {
  const [state, setState] = useState<SshConnectionState | null>(null);
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = palot.onSshConnectionState((value) => {
      received = true;
      if (active) setState(value);
    });
    void palot
      .getSshConnectionState()
      .then((value) => {
        if (active && !received) setState(value);
      })
      .catch((error: unknown) => {
        if (active && !received) showError(error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state ? (
    <SshOperation key={`${state.operationID}:${state.prompt?.id ?? "progress"}`} state={state} />
  ) : null;
}

function SshOperation({ state }: { state: SshConnectionState }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const request = state.prompt?.request;
  const secret = request?.kind === "authentication" && !request.confirm;
  const cancel = async () => {
    setAnswer("");
    setBusy(true);
    try {
      await palot.cancelSshConnection(state.operationID);
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  };
  const respond = async () => {
    if (!state.prompt || busy) return;
    const value = secret ? answer : "yes";
    setAnswer("");
    setBusy(true);
    try {
      await palot.respondSshPrompt({
        operationID: state.operationID,
        promptID: state.prompt.id,
        value,
      });
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  };
  const action = request?.kind === "setup" ? request.action : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void cancel();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {action
              ? `${action === "install" ? "Install" : action === "start" ? "Start" : "Replace"} remote OpenCode?`
              : "SSH connection"}
          </DialogTitle>
          <DialogDescription className="wrap-anywhere">{state.target}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void respond();
          }}
        >
          {request?.kind === "setup" ? (
            <div className="space-y-2 text-sm">
              <p>Palot requires OpenCode {request.version} on this computer.</p>
              {request.currentVersion ? <p>Current version: {request.currentVersion}.</p> : null}
              <p>
                {action === "replace"
                  ? "Replacing the remote runtime can interrupt other clients and running tasks."
                  : action === "install"
                    ? "This will download and install the required runtime on the remote computer."
                    : "This will start the remote OpenCode background service."}
              </p>
              <p className="text-compact text-muted-foreground">
                The service stays running after the tunnel closes. Continue only if you control this
                computer.
              </p>
            </div>
          ) : request?.kind === "authentication" ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-sm wrap-anywhere">{request.text}</p>
              {secret ? (
                <label className="grid gap-2 text-sm">
                  SSH answer
                  <Input
                    type="password"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {stageLabels[state.stage] ?? state.stage}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
              Cancel connection
            </Button>
            {request ? (
              <Button type="submit" disabled={busy || (secret && !answer)}>
                {action ? `Allow ${action}` : secret ? "Continue" : "Confirm"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function showError(error: unknown) {
  toast.add({ type: "error", title: error instanceof Error ? error.message : "SSH action failed" });
}
