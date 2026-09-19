import { useAtomValue, useStore } from "jotai";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { openCodeClient } from "../../services/opencode-client";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function CommandActions({
  resource,
  connectionID,
  onRemoved,
}: {
  resource: Extract<WorkbenchTab, { kind: "command" }>["resource"];
  connectionID: string;
  onRemoved(): void;
}) {
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const available =
    runtime?.connected &&
    runtime.profileID === resource.profileID &&
    runtime.connectionID === connectionID;

  useEffect(() => {
    const unsubscribe = store.sub(runtimeAtom, () => {
      const value = store.get(runtimeAtom);
      if (
        !value?.connected ||
        value.profileID !== resource.profileID ||
        value.connectionID !== connectionID
      )
        request.current?.abort();
    });
    return () => {
      unsubscribe();
      request.current?.abort();
    };
  }, [connectionID, resource, store]);

  const run = async () => {
    const currentServer = () => {
      const value = store.get(runtimeAtom);
      return (
        value?.connected &&
        value.profileID === resource.profileID &&
        value.connectionID === connectionID
      );
    };
    if (!currentServer() || request.current) return;
    if (
      !window.confirm(
        "Stop and remove this command? This terminates its running process and permanently deletes its stored output. Only output already loaded in this tab will remain.",
      )
    )
      return;
    if (!currentServer()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    const current = () => !controller.signal.aborted && currentServer();
    try {
      const client = openCodeClient();
      const input = {
        id: resource.shellID,
        location: {
          directory: resource.location.directory,
        },
      };
      await client.shell.remove(input, { signal: controller.signal });
      if (current()) onRemoved();
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Could not update command.");
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Command actions"
              disabled={!available || busy}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            disabled={!available || busy}
            onClick={() => void run()}
          >
            Stop and remove command
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span role="alert" className="basis-full text-meta text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
}
