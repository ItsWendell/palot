import type { Terminal as GhosttyTerminal } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url&no-inline";
import { useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { runtimeAtom } from "../../atoms/workspace";
import { prepareCodeFont } from "../../lib/font-loading";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { ptyNotFound } from "../../services/opencode-pty";
import { Button } from "../ui/button";

type TerminalTabDescriptor = Extract<WorkbenchTab, { kind: "terminal" }>;
type TerminalSnapshot = {
  buffer: string;
  cursor: number;
  cols: number;
  rows: number;
  resumable: boolean;
};

const MAX_RESTORABLE_OUTPUT = 2 * 1024 * 1024;
const snapshots = new Map<string, TerminalSnapshot>();
let ghosttyModule: Promise<{
  mod: typeof import("ghostty-web");
  ghostty: Awaited<ReturnType<(typeof import("ghostty-web"))["Ghostty"]["load"]>>;
}> | null = null;

function loadGhostty() {
  if (ghosttyModule) return ghosttyModule;
  ghosttyModule = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load(ghosttyWasmUrl) }))
    .catch((error) => {
      ghosttyModule = null;
      throw error;
    });
  return ghosttyModule;
}

export function TerminalTab({ tab }: { tab: TerminalTabDescriptor }) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const runtime = useAtomValue(runtimeAtom);
  const [ending, setEnding] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const canManage = runtime?.connected === true && runtime.profileID === tab.resource.profileID;
  const snapshotKey = `${tab.resource.profileID}:${tab.resource.transport}:${tab.resource.ptyID}`;
  const controlKey = `${runtime?.connectionID}:${snapshotKey}`;
  const [controlledConnection, setControlledConnection] = useState<string>();
  const readOnly = tab.resource.readOnly === true && controlledConnection !== controlKey;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminal | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const appearanceRef = useRef(appearance);
  const [status, setStatus] = useState<"connecting" | "connected" | "exited" | "error">(
    "connecting",
  );
  const [errorMessage, setErrorMessage] = useState<string>();

  useLayoutEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    let cancelled = false;
    void prepareCodeFont(appearance.preferences.codeFont).then(() => {
      if (cancelled || terminalRef.current !== terminal) return;
      terminal.setOption("theme", appearance.terminal);
      terminal.setOption("colorScheme", appearance.scheme);
      terminal.setOption("fontFamily", appearance.codeFontFamily);
      terminal.setOption("fontSize", appearance.preferences.terminalFontSize);
      fitRef.current?.fit();
    });
    return () => {
      cancelled = true;
    };
  }, [appearance]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canManage) return;
    const runtimeConnectionID = runtime?.connectionID;
    let disposed = false;
    let connectionID: string | null = null;
    let terminal: GhosttyTerminal | null = null;
    let reconnectTimer: number | undefined;
    let resizeTimer: number | undefined;
    let attempts = 0;
    let fitFrame: number | undefined;
    let cursor = snapshots.get(snapshotKey)?.cursor ?? 0;
    let seek = snapshots.get(snapshotKey)?.resumable ? cursor : 0;
    const cleanups: Array<() => void> = [];
    if (tab.resource.transport === "persistent") {
      cleanups.push(
        palot.subscribe((batch) => {
          if (batch.connectionID !== runtimeConnectionID) return;
          for (const event of batch.events) {
            if (
              event.type === "persistent-pty.added" &&
              event.data.terminal.id === tab.resource.ptyID
            ) {
              // The tab resource already represents creation. Delayed delivery must not reset its status.
              continue;
            }
            if (
              event.type === "persistent-pty.removed" &&
              event.data.ptyID === tab.resource.ptyID
            ) {
              setStatus("exited");
              if (connectionID) void palot.disconnectPty(connectionID);
            }
          }
        }),
      );
    }

    const scheduleFit = (fit: { fit(): void }) => {
      if (fitFrame !== undefined) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = undefined;
        if (!disposed && container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
      });
    };

    const connect = async () => {
      if (disposed) return;
      setStatus("connecting");
      const nextConnectionID = await palot.connectPty(
        {
          ptyID: tab.resource.ptyID,
          location: tab.resource.location,
          cursor: seek,
          transport: tab.resource.transport,
          ...(readOnly ? { readOnly: true } : {}),
        },
        runtimeConnectionID,
      );
      if (disposed) {
        await palot.disconnectPty(nextConnectionID);
        return;
      }
      connectionID = nextConnectionID;
      const unsubscribe = palot.onPtyEvent((event) => {
        if (disposed || event.connectionID !== nextConnectionID) return;
        if (event.type === "open") {
          attempts = 0;
          setStatus("connected");
          return;
        }
        if (event.type === "error") {
          setStatus("error");
          return;
        }
        if (event.type === "data" && terminal) {
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data);
            if (bytes[0] !== 0) return;
            try {
              const value = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as {
                cursor?: unknown;
              };
              if (typeof value.cursor === "number" && Number.isSafeInteger(value.cursor)) {
                cursor = value.cursor;
                seek = cursor;
              }
            } catch {
              // Ignore malformed control frames; terminal output remains usable.
            }
            return;
          }
          const data = event.data;
          if (!data) return;
          terminal.write(data);
          cursor += data.length;
          seek = cursor;
          const current = snapshots.get(snapshotKey) ?? {
            buffer: "",
            cursor: 0,
            cols: terminal.cols,
            rows: terminal.rows,
            resumable: true,
          };
          const buffer = current.resumable ? current.buffer + data : "";
          snapshots.set(snapshotKey, {
            ...current,
            buffer: buffer.length <= MAX_RESTORABLE_OUTPUT ? buffer : "",
            cursor,
            cols: terminal.cols,
            rows: terminal.rows,
            resumable: current.resumable && buffer.length <= MAX_RESTORABLE_OUTPUT,
          });
          return;
        }
        if (event.type === "close") {
          connectionID = null;
          unsubscribe();
          void palot
            .getPty(
              tab.resource.location,
              tab.resource.ptyID,
              tab.resource.transport,
              runtimeConnectionID,
            )
            .then((pty) => {
              if (disposed) return;
              if (pty.status === "exited") {
                setStatus("exited");
                return;
              }
              reconnectTimer = window.setTimeout(
                () => {
                  attempts += 1;
                  void connect().catch(handleConnectionError);
                },
                Math.min(250 * 2 ** Math.min(attempts, 4), 4_000),
              );
            })
            .catch((error) => {
              if (!disposed && ptyNotFound(error)) setStatus("exited");
              else handleConnectionError();
            });
        }
      });
      cleanups.push(unsubscribe);
      try {
        await palot.startPty(nextConnectionID);
      } catch (error) {
        connectionID = null;
        unsubscribe();
        await palot.disconnectPty(nextConnectionID).catch(() => undefined);
        throw error;
      }
    };

    const handleConnectionError = (error?: unknown) => {
      if (!disposed) {
        setErrorMessage(error instanceof Error ? error.message : "Terminal connection failed");
        setStatus("error");
      }
    };

    const run = async () => {
      const loaded = await loadGhostty();
      if (disposed) return;
      let snapshot = snapshots.get(snapshotKey);
      if (!snapshot && tab.resource.transport === "persistent") {
        let missing = false;
        const remote = await palot
          .snapshotPty(tab.resource.ptyID, runtimeConnectionID)
          .catch((error) => {
            if (ptyNotFound(error)) {
              missing = true;
            }
            return null;
          });
        if (disposed) return;
        if (remote) {
          snapshot = {
            buffer: remote.buffer,
            cursor: remote.cursor,
            cols: remote.cols,
            rows: remote.rows,
            resumable: true,
          };
          snapshots.set(snapshotKey, snapshot);
          cursor = remote.cursor;
          seek = remote.cursor;
        } else if (missing) {
          setStatus("exited");
          return;
        }
      }
      const currentAppearance = appearanceRef.current;
      await prepareCodeFont(currentAppearance.preferences.codeFont);
      if (disposed) return;
      const term = new loaded.mod.Terminal({
        ghostty: loaded.ghostty,
        cols: snapshot?.cols ?? 80,
        rows: snapshot?.rows ?? 24,
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: currentAppearance.codeFontFamily,
        fontSize: currentAppearance.preferences.terminalFontSize,
        scrollback: 10_000,
        colorScheme: currentAppearance.scheme,
        theme: currentAppearance.terminal,
      });
      terminal = term;
      terminalRef.current = term;
      const fit = new loaded.mod.FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(container);
      const updateCursorVisibility = () =>
        term.setOption(
          "cursorBlink",
          !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
      updateCursorVisibility();
      document.addEventListener("visibilitychange", updateCursorVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", updateCursorVisibility));
      if (snapshot?.resumable && snapshot.buffer) term.write(snapshot.buffer);
      scheduleFit(fit);
      fit.observeResize();
      cleanups.push(() => fit.dispose());
      const dataSubscription = term.onData((data) => {
        if (!readOnly && !disposed && connectionID) {
          void palot.writePty({ connectionID, data, cols: term.cols, rows: term.rows });
        }
      });
      cleanups.push(() => dataSubscription.dispose());
      const resizeSubscription = term.onResize(({ cols, rows }) => {
        if (readOnly || disposed) return;
        if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          if (disposed) return;
          if (tab.resource.transport === "persistent" && connectionID) {
            void palot.writePty({ connectionID, data: "", cols, rows, control: true });
            return;
          }
          void palot.resizePty(
            tab.resource.location,
            tab.resource.ptyID,
            tab.resource.transport,
            {
              cols,
              rows,
            },
            runtimeConnectionID,
          );
        }, 100);
      });
      cleanups.push(() => resizeSubscription.dispose());
      if (!readOnly) {
        term.focus();
        await palot.resizePty(
          tab.resource.location,
          tab.resource.ptyID,
          tab.resource.transport,
          {
            cols: term.cols,
            rows: term.rows,
          },
          runtimeConnectionID,
        );
      }
      await connect();
    };

    void run().catch(handleConnectionError);
    return () => {
      disposed = true;
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (connectionID) void palot.disconnectPty(connectionID);
      for (const cleanup of cleanups) cleanup();
      if (terminal) {
        const current = snapshots.get(snapshotKey);
        snapshots.set(snapshotKey, {
          buffer: current?.buffer ?? "",
          cursor,
          cols: terminal.cols,
          rows: terminal.rows,
          resumable: current?.resumable ?? false,
        });
        terminal.dispose();
      }
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [
    tab.resource.location,
    tab.resource.ptyID,
    tab.resource.transport,
    readOnly,
    canManage,
    runtime?.connectionID,
    snapshotKey,
    connectionAttempt,
  ]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-code-background font-mono text-code-foreground">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1 font-sans">
        <span className="text-micro text-muted-foreground">
          {readOnly ? "Read-only terminal" : "Terminal"}
        </span>
        <div className="flex items-center gap-2">
          {status === "error" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canManage}
              onClick={() => setConnectionAttempt((attempt) => attempt + 1)}
            >
              Reconnect terminal
            </Button>
          ) : null}
          {readOnly ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canManage || status !== "connected"}
              onClick={() => setControlledConnection(controlKey)}
            >
              Take control
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            disabled={!canManage || ending || status === "exited"}
            onClick={() => {
              if (
                !canManage ||
                !window.confirm(
                  "End this terminal? Its running process will stop. Closing the tab instead leaves it running.",
                )
              )
                return;
              setEnding(true);
              void palot
                .removePty(
                  tab.resource.location,
                  tab.resource.ptyID,
                  tab.resource.transport,
                  runtime?.connectionID,
                )
                .then(() => setStatus("exited"))
                .catch((error: unknown) => {
                  setErrorMessage(
                    error instanceof Error ? error.message : "Could not end terminal",
                  );
                  setStatus("error");
                })
                .finally(() => setEnding(false));
            }}
          >
            End terminal
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden px-3 py-2 font-mono text-foreground caret-transparent"
        data-workbench-terminal={tab.resource.ptyID}
      />
      {!canManage || status !== "connected" ? (
        <span
          title={status === "error" ? errorMessage : undefined}
          className="absolute top-2 right-3 rounded-sm bg-muted px-1.5 py-0.5 text-micro text-muted-foreground"
        >
          {canManage ? status : "disconnected"}
        </span>
      ) : null}
    </div>
  );
}
