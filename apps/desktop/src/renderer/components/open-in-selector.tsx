import { Check, ChevronDown, Code2, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";

import type { ExternalOpenTarget, ExternalOpenTargetID } from "../../shared";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function TargetIcon({ target }: { target: ExternalOpenTarget }) {
  if (target.iconDataUrl) {
    return (
      <img src={target.iconDataUrl} alt="" className="size-3.5 rounded-sm" aria-hidden="true" />
    );
  }
  return target.kind === "file-manager" ? (
    <FolderOpen className="size-3.5" aria-hidden="true" />
  ) : (
    <Code2 className="size-3.5" aria-hidden="true" />
  );
}

export function OpenInSelector({ sessionID }: { sessionID: string }) {
  const connectionID = useAtomValue(runtimeAtom)?.connectionID;
  const [targets, setTargets] = useState<ExternalOpenTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      setTargets(await palot.externalOpenTargets(sessionID, connectionID));
    } catch {
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }, [sessionID, connectionID]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  const preferred = useMemo(
    () => targets.find((target) => target.preferred) ?? targets[0],
    [targets],
  );
  const editors = targets.filter((target) => target.kind === "editor");
  const utilities = targets.filter((target) => target.kind === "file-manager");

  const open = useCallback(
    async (targetID?: ExternalOpenTargetID) => {
      setOpening(true);
      try {
        const result = await palot.externalOpen(
          {
            resource: { kind: "session-directory", sessionID },
            ...(targetID ? { targetID } : {}),
          },
          connectionID,
        );
        setTargets((current) => {
          const opened = current.find((target) => target.id === result.openedTargetID);
          if (opened?.kind !== "editor") return current;
          return current.map((target) => ({
            ...target,
            preferred: target.kind === "editor" && target.id === result.openedTargetID,
          }));
        });
      } catch (error) {
        showErrorToast("Could not open this checkout", error);
        await loadTargets();
      } finally {
        setOpening(false);
      }
    },
    [loadTargets, sessionID, connectionID],
  );

  if ((!loading && targets.length === 0) || !preferred) return null;

  return (
    <div className="window-no-drag ml-auto flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-input/30">
      <Button
        variant="ghost"
        size="sm"
        className="rounded-none border-0 bg-transparent pr-1.5 focus-visible:ring-inset"
        disabled={opening || loading}
        onClick={() => void open()}
        aria-label={`Open checkout in ${preferred.label}`}
      >
        <TargetIcon target={preferred} />
        <span className="hidden @[430px]/thread-header:inline">{preferred.label}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-none border-y-0 border-r-0 border-l border-border bg-transparent focus-visible:ring-inset"
              disabled={opening || loading}
              aria-label="Choose an application"
            />
          }
        >
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {editors.map((target) => (
            <DropdownMenuItem key={target.id} onClick={() => void open(target.id)}>
              <TargetIcon target={target} />
              <span className="min-w-0 flex-1 truncate">{target.label}</span>
              {target.preferred ? <Check className="ml-auto" aria-label="Preferred" /> : null}
            </DropdownMenuItem>
          ))}
          {editors.length > 0 && utilities.length > 0 ? <DropdownMenuSeparator /> : null}
          {utilities.map((target) => (
            <DropdownMenuItem key={target.id} onClick={() => void open(target.id)}>
              <TargetIcon target={target} />
              <span>{target.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
