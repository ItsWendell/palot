import { useState } from "react";
import { useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { useProjectCatalog } from "../hooks/use-session-catalog";
import { isChatDirectory, withoutChatProjects } from "../lib/chats";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { cacheSession } from "../lib/session-catalog-query";
import { projectLocation, projectName, visibleProjects } from "../lib/view-models";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "./ui/toast";

export function MoveToProjectDialog({
  session,
  owner: sessionOwner,
  onClose,
}: {
  session: PalotSession;
  /** The server that owns the chat; defaults to the focused server. */
  owner?: OpenCodeRuntimeStatus | null;
  onClose(): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  // The picker and mutation keep their original server even if focus changes.
  const [owner] = useState(sessionOwner === undefined ? runtime : sessionOwner);
  const projects = visibleProjects(withoutChatProjects(useProjectCatalog(owner)));
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = projects
    .flatMap((project) =>
      [...new Set([projectLocation(project), ...project.sandboxes])]
        .filter((path) => path && !isChatDirectory(path))
        .map((path) => ({
          directory: path,
          label:
            path === projectLocation(project)
              ? projectName(project)
              : `${projectName(project)} · ${path.split(/[\\/]/).filter(Boolean).at(-1)}`,
        })),
    )
    .filter(
      (candidate, index, all) =>
        all.findIndex((item) => item.directory === candidate.directory) === index,
    );
  const target = targets.find((candidate) => candidate.directory === directory);

  async function move() {
    if (busy || !target || !canFetchOpenCode(owner)) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await palot.moveSession(session.id, target.directory, owner!.connectionID);
      // Null while OpenCode is still applying the move; its session.moved event updates the list.
      if (moved) cacheSession(queryClient, owner!.connectionID, moved);
      toast.add({ type: "success", title: "Chat moved to project", description: target.label });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move chat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to project</DialogTitle>
          <DialogDescription>
            Continue this chat as a task in a project. Only the conversation moves; files stay in
            the chat folder.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={directory}
          disabled={busy}
          onValueChange={(value) => setDirectory(value ?? "")}
        >
          <SelectTrigger aria-label="Destination project" className="w-full min-w-0">
            <SelectValue placeholder="Choose a project">{target?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {targets.map((candidate) => (
              <SelectItem key={candidate.directory} value={candidate.directory}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!targets.length ? (
          <p className="text-sm text-muted-foreground">Add a project before moving this chat.</p>
        ) : null}
        {!canFetchOpenCode(owner) ? (
          <p role="alert" className="text-sm text-destructive">
            Connect to OpenCode to move this chat.
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
            disabled={busy || !target || !canFetchOpenCode(owner)}
            onClick={() => void move()}
          >
            {busy ? "Moving…" : "Move to project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
