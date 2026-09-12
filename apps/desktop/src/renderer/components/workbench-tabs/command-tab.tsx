import type { ShellGetOutput } from "@opencode/client";
import { useAtomValue, useStore } from "jotai";
import { Check, Copy, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { useClipboardCopy } from "../../hooks/use-clipboard-copy";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { openCodeClient } from "../../services/opencode-client";
import { Button } from "../ui/button";
import { TerminalOutput } from "../terminal-output";
import { terminalOutput } from "../../lib/terminal-output";
import { CommandActions } from "./command-actions";

type CommandTabDescriptor = Extract<WorkbenchTab, { kind: "command" }>;
const PAGE_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARACTERS = 256 * 1024;

export function CommandTab({
  tab,
  active = true,
}: {
  tab: CommandTabDescriptor;
  active?: boolean;
}) {
  const runtime = useAtomValue(runtimeAtom);
  if (!runtime?.connected || runtime.profileID !== tab.resource.profileID) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Connect to this command's server to view output.
      </p>
    );
  }
  return (
    <CommandOutput
      key={JSON.stringify([runtime.connectionID, tab.resource])}
      tab={tab}
      connectionID={runtime.connectionID}
      active={active}
    />
  );
}

function CommandOutput({
  tab,
  connectionID,
  active,
}: {
  tab: CommandTabDescriptor;
  connectionID: string;
  active: boolean;
}) {
  const store = useStore();
  const { profileID, location, shellID } = tab.resource;
  const [info, setInfo] = useState<ShellGetOutput["data"]>();
  const [buffer, setBuffer] = useState({ text: "", trimmed: false });
  const { text: output, trimmed } = buffer;
  const presentation = useMemo(() => terminalOutput(output), [output]);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [following, setFollowing] = useState(true);
  const [removed, setRemoved] = useState(false);
  const removedRef = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const cursor = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const clipboard = useClipboardCopy();

  useEffect(() => {
    if (removed || complete || !active) return;
    const controller = new AbortController();
    readController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => {
      const runtime = store.get(runtimeAtom);
      return (
        !controller.signal.aborted &&
        !removedRef.current &&
        runtime?.connected &&
        runtime.profileID === profileID &&
        runtime.connectionID === connectionID
      );
    };
    const read = async () => {
      if (!current()) return;
      try {
        const client = openCodeClient();
        const options = { signal: controller.signal };
        const requestLocation = {
          directory: location.directory,
          ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
        };
        // Read status first so a final output read includes everything written before exit.
        const shell = await client.shell.get({ id: shellID, location: requestLocation }, options);
        if (!current()) return;
        setInfo(shell.data);
        const page = await client.shell.output(
          { id: shellID, location: requestLocation, cursor: cursor.current, limit: PAGE_BYTES },
          options,
        );
        if (!current()) return;
        const next = page.data;
        const behind = next.cursor < next.size;
        if (next.cursor < cursor.current || (behind && next.cursor === cursor.current)) {
          throw new Error("The command output cursor did not advance. Retry to reconnect.");
        }
        // Byte offsets come from OpenCode, never from the decoded string length.
        cursor.current = next.cursor;
        setBuffer((previous) => {
          const joined = previous.text + next.output;
          return {
            text: joined.slice(-MAX_OUTPUT_CHARACTERS),
            trimmed: previous.trimmed || joined.length > MAX_OUTPUT_CHARACTERS,
          };
        });
        const drained = shell.data.status !== "running" && !behind;
        setComplete(drained);
        if (!drained) timer = setTimeout(() => void read(), behind ? 50 : 1_000);
      } catch (cause) {
        if (current())
          setError(cause instanceof Error ? cause.message : "Could not load command output.");
      }
    };
    setError(undefined);
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [attempt, connectionID, location, profileID, shellID, store, removed, active, complete]);

  useEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [following, output]);

  return (
    <section
      className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      aria-label="Command output"
      hidden={!active}
    >
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-code-compact"
          title={info?.command ?? tab.resource.command}
        >
          {info?.command ?? tab.resource.command}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={following ? "Pause following output" : "Follow output"}
          title={following ? "Pause following output" : "Follow output"}
          onClick={() => setFollowing(!following)}
        >
          {following ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy visible output"
          title="Copy visible output"
          disabled={!presentation.output}
          onClick={() => void clipboard.copy(presentation.output ?? "")}
        >
          {clipboard.copiedKey ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
        {!removed && active ? (
          <CommandActions
            resource={tab.resource}
            connectionID={connectionID}
            onRemoved={() => {
              removedRef.current = true;
              readController.current?.abort();
              setRemoved(true);
              setComplete(true);
              setError(undefined);
            }}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-meta text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={info?.cwd ?? location.directory}>
          {info?.cwd ?? location.directory}
        </span>
        <span role="status">
          {removed
            ? "Command removed. Only the output already loaded here remains."
            : info
              ? `${info.status}${info.exit !== undefined ? ` · Exit ${info.exit}` : ""}${!complete && info.status !== "running" ? " · Loading output" : ""}`
              : "Loading command…"}
        </span>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-border p-3 text-sm text-destructive"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      {trimmed ? (
        <p className="shrink-0 px-3 py-1 text-meta text-muted-foreground">
          Showing the latest output only. Copy includes the visible buffer.
        </p>
      ) : null}
      <div
        ref={viewport}
        className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-3"
        tabIndex={0}
        aria-label="Combined command output"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight > 24) setFollowing(false);
        }}
      >
        <pre className="m-0 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words select-text">
          {presentation.output ? (
            <TerminalOutput {...presentation} />
          ) : complete ? (
            "No output."
          ) : (
            "Waiting for output…"
          )}
        </pre>
      </div>
    </section>
  );
}
