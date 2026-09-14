import { useState } from "react";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { useCacheSession } from "../hooks/use-session-catalog";
import { usePalotNavigation } from "../hooks/use-navigation";
import { copySessionToServer } from "../services/opencode-session-copy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";

export function SessionCopyDialog({
  session,
  source,
  onClose,
}: {
  session: PalotSession;
  source: OpenCodeRuntimeStatus;
  onClose(): void;
}) {
  const { connections, includedProfileIDs } = useConnectionOverview();
  const destinations = connections.filter(
    (entry) =>
      entry.profile.id !== source.profileID &&
      includedProfileIDs.includes(entry.profile.id) &&
      entry.runtime?.connected,
  );
  const [profileID, setProfileID] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<{
    sessionID: string;
    profileID: string;
    serverName: string;
  } | null>(null);
  const destination = destinations.find((entry) => entry.profile.id === profileID);
  const cache = useCacheSession(destination?.runtime ?? null);
  const { openSession } = usePalotNavigation();
  async function copy() {
    const owner = destination?.runtime;
    if (busy || (!copiedTarget && (!owner?.connected || !directory.trim()))) return;
    let target = copiedTarget;
    setBusy(true);
    setError(null);
    try {
      if (!target) {
        const copied = await copySessionToServer({
          sessionID: session.id,
          sourceConnectionID: source.connectionID,
          destinationConnectionID: owner!.connectionID,
          location: { directory: directory.trim() },
        });
        target = {
          sessionID: copied.id,
          profileID: owner!.profileID,
          serverName: destination!.profile.name,
        };
        setCopiedTarget(target);
        cache(copied);
      }
      await openSession(target.sessionID, { profileID: target.profileID });
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The operation failed.";
      setError(
        target
          ? `The task was copied to ${target.serverName}, but could not be opened: ${message} Retry opening the existing copy; it will not be imported again.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy task to server</DialogTitle>
          <DialogDescription>
            Copy the current transcript as a standalone task. The original stays unchanged. Project
            files, running tools, terminals, credentials, and child tasks are not copied. The
            destination needs its own project files and model access. Only copy to a server you
            trust with this conversation. An existing copy on the destination will not be
            overwritten.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={profileID}
          disabled={busy || Boolean(copiedTarget)}
          onValueChange={(value) => {
            setProfileID(value ?? "");
            setDirectory("");
            setError(null);
          }}
        >
          <SelectTrigger className="w-full min-w-0" aria-label="Destination server">
            <SelectValue className="min-w-0 truncate" placeholder="Choose an enabled server">
              {copiedTarget?.serverName ?? destination?.profile.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {destinations.map((entry) => (
              <SelectItem key={entry.profile.id} value={entry.profile.id}>
                {entry.profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {destination?.projects.length ? (
          <Select
            value={directory}
            disabled={busy || Boolean(copiedTarget)}
            onValueChange={(value) => setDirectory(value ?? "")}
          >
            <SelectTrigger className="w-full min-w-0" aria-label="Destination project">
              <SelectValue className="min-w-0 truncate" placeholder="Choose a project">
                {destination.projects.find((project) => project.canonical === directory)?.name ||
                  directory ||
                  undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {destination.projects.map((project) => (
                <SelectItem key={project.id} value={project.canonical}>
                  {project.name || project.canonical}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input
          aria-label="Destination folder"
          placeholder="Absolute folder path on the destination server"
          value={directory}
          disabled={!destination || busy || Boolean(copiedTarget)}
          onChange={(event) => setDirectory(event.target.value)}
        />
        {!destinations.length ? (
          <p className="text-sm text-muted-foreground">
            Enable another server in Connections to copy this task.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {copiedTarget ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={busy || (!copiedTarget && (!destination || !directory.trim()))}
            onClick={() => void copy()}
          >
            {copiedTarget
              ? busy
                ? "Opening…"
                : "Open copied task"
              : busy
                ? "Copying…"
                : "Copy task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
