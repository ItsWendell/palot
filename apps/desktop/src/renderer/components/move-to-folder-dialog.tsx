import { FolderOpen } from "lucide-react";
import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { useCacheSession, useProjectCatalog } from "../hooks/use-session-catalog";
import { withoutChatProjects } from "../lib/chats";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { projectLocation, projectName, visibleProjects } from "../lib/view-models";
import { palot } from "../services/palot";
import { getOpenCodeVcsStatus } from "../services/opencode-vcs";
import { FittedPath } from "./fitted-path";
import { ProjectPickerContent } from "./project-picker";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { toast } from "./ui/toast";

/** A request from outside a task's menu (the command palette) to move that task. */
export const moveToFolderRequestAtom = atom<{
  session: PalotSession;
  owner: OpenCodeRuntimeStatus | null;
} | null>(null);

/** Shows the Move to folder dialog the command palette asked for. */
export function MoveToFolderRequestHost() {
  const [request, setRequest] = useAtom(moveToFolderRequestAtom);
  if (!request) return null;
  return (
    <MoveToFolderDialog
      key={request.session.id}
      session={request.session}
      owner={request.owner}
      onClose={() => setRequest(null)}
    />
  );
}

/** Uncommitted paths in the task's folder: loading, the paths, or null when unreadable. */
type SourceChanges = "loading" | string[] | null;

/**
 * Moves a task to another project or any folder on its server with OpenCode's session.move.
 * Only the task moves: uncommitted edits stay in the folder it leaves, so the dialog lists them
 * and its action reads "Move anyway".
 */
export function MoveToFolderDialog({
  session,
  owner: sessionOwner,
  onClose,
}: {
  session: PalotSession;
  /** The server that owns the task; undefined uses the focused server. */
  owner?: OpenCodeRuntimeStatus | null;
  onClose(): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  // The picker and the move keep their original server even if focus changes.
  const [owner] = useState(sessionOwner === undefined ? runtime : sessionOwner);
  const connectionID = owner?.connectionID;
  const connected = canFetchOpenCode(owner);
  const cacheSession = useCacheSession(owner);
  const source = session.location.directory;
  const projects = visibleProjects(withoutChatProjects(useProjectCatalog(owner)));
  const [projectID, setProjectID] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [changes, setChanges] = useState<SourceChanges>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((candidate) => candidate.id === projectID) ?? null;
  const target = custom ?? (project ? projectLocation(project) : null);
  const sameFolder = target !== null && trimSlash(target) === trimSlash(source);
  const dirty = Array.isArray(changes) && changes.length > 0;
  const sourceName = folderName(source);

  useEffect(() => {
    if (!connected) return;
    let current = true;
    getOpenCodeVcsStatus(session.location, undefined, connectionID)
      .then((files) => {
        if (current) setChanges(files.map((file) => file.file));
      })
      .catch(() => {
        if (current) setChanges(null);
      });
    return () => {
      current = false;
    };
  }, [connected, connectionID, session.location]);

  async function chooseFolder() {
    const picked = await palot.pickDirectory(connectionID).catch(() => null);
    if (!picked) return;
    setCustom(picked);
    setProjectID(null);
    setError(null);
  }

  async function move() {
    if (busy || !target || sameFolder || !connected) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await palot.moveSession(session.id, target, connectionID);
      // Null while OpenCode is still applying the move; its session.moved event updates the list.
      if (moved) cacheSession(moved);
      toast.add({
        type: "success",
        title: "Task moved",
        description: `Now working in ${project ? projectName(project) : folderName(target)}.`,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move the task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to folder</DialogTitle>
          <DialogDescription>
            Continue this task in another project or folder. Only the task moves; files stay where
            they are.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border p-1">
          <ProjectPickerContent
            projects={projects}
            value={custom ? null : projectID}
            onValueChange={(value) => {
              setProjectID(value);
              setCustom(null);
              setError(null);
            }}
          />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void chooseFolder()}>
            <FolderOpen aria-hidden="true" />
            Choose folder…
          </Button>
          {custom ? (
            <FittedPath path={custom} className="min-w-0 flex-1 text-meta text-muted-foreground" />
          ) : null}
        </div>
        {sameFolder ? (
          <p className="text-sm text-muted-foreground">The task is already in this folder.</p>
        ) : null}
        {dirty ? (
          <div className="flex flex-col gap-1.5" data-palot-move-uncommitted="">
            <p className="text-sm text-warning">
              {changes.length} uncommitted {changes.length === 1 ? "change stays" : "changes stay"}{" "}
              in {sourceName}. They are not copied to the new folder.
            </p>
            <div
              className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-code-compact text-muted-foreground"
              aria-label={`Uncommitted changes in ${sourceName}`}
            >
              {changes.slice(0, 20).map((file) => (
                <div key={file} className="truncate" title={file}>
                  {file}
                </div>
              ))}
              {changes.length > 20 ? <div>+{changes.length - 20} more</div> : null}
            </div>
          </div>
        ) : null}
        {changes === null ? (
          <p className="text-sm text-muted-foreground">
            Palot couldn't check {sourceName} for uncommitted changes; any edits stay there.
          </p>
        ) : null}
        {!connected ? (
          <p role="alert" className="text-sm text-destructive">
            Connect to OpenCode to move this task.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy || !target || sameFolder || !connected || (connected && changes === "loading")
            }
            onClick={() => void move()}
          >
            {busy ? "Moving…" : dirty ? "Move anyway" : "Move task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function trimSlash(directory: string): string {
  return directory.replace(/[\\/]+$/, "");
}

function folderName(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}
