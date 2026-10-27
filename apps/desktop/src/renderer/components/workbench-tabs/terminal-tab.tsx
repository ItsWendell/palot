import type { Terminal as GhosttyTerminal } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url&no-inline";
import { useAtomValue, useStore } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { runtimeAtom, selectedSessionIDAtom } from "../../atoms/workspace";
import { prepareCodeFont } from "../../lib/font-loading";
import {
  formatShortcut,
  matchesShortcut,
  shortcutAriaKeys,
  useShortcutKeys,
} from "../../lib/keyboard-shortcuts";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { ptyNotFound } from "../../services/opencode-pty";
import {
  recoverWorkbenchTerminal,
  type WorkbenchTerminalStatus,
} from "../../services/workbench-terminal";
import { Button } from "../ui/button";
import { quoteTerminalInComposer } from "./terminal-quote";

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
  const store = useStore();
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const [selection, setSelection] = useState("");
  const canQuote = Boolean(selectedSessionID && runtime?.profileID === tab.resource.profileID);
  const quoteKeys = useShortcutKeys("terminal.quote");
  const [ending, setEnding] = useState(false);
  const [terminalVersion, setTerminalVersion] = useState(0);
  const [viewAttempt, setViewAttempt] = useState(0);
  const canManage = runtime?.connected === true && runtime.profileID === tab.resource.profileID;
  const snapshotKey = JSON.stringify([
    tab.resource.profileID,
    tab.resource.location,
    tab.resource.transport,
    tab.resource.ptyID,
  ]);
  const controlKey = `${runtime?.connectionID}:${snapshotKey}`;
  const [controlledConnection, setControlledConnection] = useState<string>();
  const readOnly = tab.resource.readOnly === true && controlledConnection !== controlKey;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminal | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const appearanceRef = useRef(appearance);
  const readOnlyRef = useRef(readOnly);
  const ownerRef = useRef(runtime?.connectionID);
  const ownershipGenerationRef = useRef(0);
  const recoveryRef = useRef<ReturnType<typeof recoverWorkbenchTerminal> | null>(null);
  const cursorRef = useRef(0);
  const seekRef = useRef(0);
  const [status, setStatus] = useState<WorkbenchTerminalStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>();

  useLayoutEffect(() => {
    appearanceRef.current = appearance;
    readOnlyRef.current = readOnly;
    ownerRef.current = canManage ? runtime?.connectionID : undefined;
  }, [appearance, readOnly, canManage, runtime?.connectionID]);

  useLayoutEffect(() => {
    ownershipGenerationRef.current += 1;
    setEnding(false);
    return () => {
      ownershipGenerationRef.current += 1;
    };
  }, [canManage, runtime?.connectionID, readOnly, terminalVersion, snapshotKey, tab.resource]);

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
    if (!container) return;
    let disposed = false;
    let terminal: GhosttyTerminal | null = null;
    let resizeTimer: number | undefined;
    let fitFrame: number | undefined;
    cursorRef.current = snapshots.get(snapshotKey)?.cursor ?? 0;
    seekRef.current = snapshots.get(snapshotKey)?.resumable ? cursorRef.current : 0;
    const cleanups: Array<() => void> = [];

    const scheduleFit = (fit: { fit(): void }) => {
      if (fitFrame !== undefined) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = undefined;
        if (!disposed && container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
      });
    };

    const run = async () => {
      const loaded = await loadGhostty();
      if (disposed) return;
      const snapshot = snapshots.get(snapshotKey);
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
      setSelection("");
      const selectionSubscription = term.onSelectionChange(() => setSelection(term.getSelection()));
      cleanups.push(() => selectionSubscription.dispose());
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
        const connectionID = recoveryRef.current?.connectionID();
        if (!readOnlyRef.current && !disposed && connectionID) {
          void palot
            .writePty({ connectionID, data, cols: term.cols, rows: term.rows })
            .catch(() => undefined);
        }
      });
      cleanups.push(() => dataSubscription.dispose());
      const resizeSubscription = term.onResize(({ cols, rows }) => {
        if (readOnlyRef.current || disposed) return;
        if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          const connectionID = recoveryRef.current?.connectionID();
          if (disposed || readOnlyRef.current || !ownerRef.current || !connectionID) return;
          if (tab.resource.transport === "persistent" && connectionID) {
            void palot
              .writePty({ connectionID, data: "", cols, rows, control: true })
              .catch(() => undefined);
            return;
          }
          void palot
            .resizePty(
              tab.resource.location,
              tab.resource.ptyID,
              tab.resource.transport,
              {
                cols,
                rows,
              },
              ownerRef.current,
            )
            .catch(() => undefined);
        }, 100);
      });
      cleanups.push(() => resizeSubscription.dispose());
      setTerminalVersion((version) => version + 1);
    };

    void run().catch((error: unknown) => {
      if (disposed) return;
      setErrorMessage(error instanceof Error ? error.message : "Terminal view failed to load");
      setStatus("error");
    });
    return () => {
      disposed = true;
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      for (const cleanup of cleanups) cleanup();
      if (terminal) {
        const current = snapshots.get(snapshotKey);
        snapshots.set(snapshotKey, {
          buffer: current?.buffer ?? "",
          cursor: cursorRef.current,
          cols: terminal.cols,
          rows: terminal.rows,
          resumable: current?.resumable ?? false,
        });
        terminal.dispose();
      }
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [snapshotKey, tab.resource.location, tab.resource.ptyID, tab.resource.transport, viewAttempt]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const ownerConnectionID = runtime?.connectionID;
    if (!terminal || !canManage || !ownerConnectionID) return;
    let cancelled = false;
    let removed = false;
    let recovery: ReturnType<typeof recoverWorkbenchTerminal> | null = null;
    setStatus("connecting");
    const unsubscribe =
      tab.resource.transport === "persistent"
        ? palot.subscribe((batch) => {
            if (batch.connectionID !== ownerConnectionID) return;
            if (
              batch.events.some(
                (event) =>
                  event.type === "persistent-pty.removed" &&
                  event.data.ptyID === tab.resource.ptyID,
              )
            ) {
              removed = true;
              recovery?.exit();
              setStatus("exited");
            }
          })
        : () => {};
    const run = async () => {
      if (!snapshots.has(snapshotKey) && tab.resource.transport === "persistent") {
        const remote = await palot
          .snapshotPty(tab.resource.ptyID, ownerConnectionID)
          .catch((error: unknown) => {
            if (ptyNotFound(error)) removed = true;
            return null;
          });
        if (cancelled || removed) {
          if (!cancelled) setStatus("exited");
          return;
        }
        if (remote) {
          snapshots.set(snapshotKey, { ...remote, resumable: true });
          terminal.write(remote.buffer);
          cursorRef.current = remote.cursor;
          seekRef.current = remote.cursor;
        }
      }
      if (cancelled || removed) return;
      if (!readOnly) {
        terminal.focus();
        // A failed resize must not throw away the view or prevent reattachment.
        void palot
          .resizePty(
            tab.resource.location,
            tab.resource.ptyID,
            tab.resource.transport,
            { cols: terminal.cols, rows: terminal.rows },
            ownerConnectionID,
          )
          .catch(() => undefined);
      }
      recovery = recoverWorkbenchTerminal(tab.resource, ownerConnectionID, {
        readOnly,
        cursor: () => seekRef.current,
        onStatus: (status, error) => {
          if (cancelled) return;
          setStatus(status);
          setErrorMessage(error instanceof Error ? error.message : undefined);
        },
        onData: (data) => {
          if (data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(data);
            if (bytes[0] !== 0) return;
            try {
              const value = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as {
                cursor?: unknown;
              };
              if (typeof value.cursor === "number" && Number.isSafeInteger(value.cursor)) {
                cursorRef.current = value.cursor;
                seekRef.current = value.cursor;
                const snapshot = snapshots.get(snapshotKey);
                if (snapshot) snapshot.cursor = value.cursor;
              }
            } catch {
              // Ignore malformed control frames; terminal output remains usable.
            }
            return;
          }
          if (!data) return;
          terminal.write(data);
          cursorRef.current += data.length;
          seekRef.current = cursorRef.current;
          const current = snapshots.get(snapshotKey) ?? {
            buffer: "",
            cursor: 0,
            cols: terminal.cols,
            rows: terminal.rows,
            resumable: true,
          };
          const buffer = current.resumable ? current.buffer + data : "";
          snapshots.set(snapshotKey, {
            buffer: buffer.length <= MAX_RESTORABLE_OUTPUT ? buffer : "",
            cursor: cursorRef.current,
            cols: terminal.cols,
            rows: terminal.rows,
            resumable: current.resumable && buffer.length <= MAX_RESTORABLE_OUTPUT,
          });
        },
      });
      recoveryRef.current = recovery;
    };
    void run();
    return () => {
      cancelled = true;
      unsubscribe();
      recovery?.stop();
      if (recoveryRef.current === recovery) recoveryRef.current = null;
    };
  }, [canManage, runtime?.connectionID, readOnly, terminalVersion, snapshotKey, tab.resource]);

  function quoteSelection(): boolean {
    if (!canQuote || !runtime || !selectedSessionID) return false;
    const text = terminalRef.current?.getSelection() ?? "";
    if (!quoteTerminalInComposer(store, runtime.profileID, selectedSessionID, text)) return false;
    terminalRef.current?.clearSelection();
    document.querySelector<HTMLElement>("[data-palot-composer-input]")?.focus();
    return true;
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-code-background font-mono text-code-foreground"
      onKeyDownCapture={(event) => {
        if (
          !event.defaultPrevented &&
          matchesShortcut(event.nativeEvent, quoteKeys) &&
          quoteSelection()
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1 font-sans">
        <span className="text-micro text-muted-foreground">
          {readOnly ? "Read-only terminal" : "Terminal"}
        </span>
        <div className="flex items-center gap-2">
          {canQuote && selection.trim() ? (
            <Button
              size="xs"
              variant="outline"
              className="absolute top-12 right-3 z-10 bg-popover text-popover-foreground"
              title={
                quoteKeys.length
                  ? `Quote in composer (${formatShortcut(quoteKeys)})`
                  : "Quote in composer"
              }
              aria-keyshortcuts={shortcutAriaKeys(quoteKeys)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={quoteSelection}
            >
              Quote in composer
            </Button>
          ) : null}
          {status === "error" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canManage}
              onClick={() => {
                if (recoveryRef.current) recoveryRef.current.reconnect();
                else setViewAttempt((attempt) => attempt + 1);
              }}
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
              const recovery = recoveryRef.current;
              const generation = ownershipGenerationRef.current;
              const ownerConnectionID = runtime?.connectionID;
              const current = () =>
                ownershipGenerationRef.current === generation && recoveryRef.current === recovery;
              setEnding(true);
              void palot
                .removePty(
                  tab.resource.location,
                  tab.resource.ptyID,
                  tab.resource.transport,
                  ownerConnectionID,
                )
                .then(() => {
                  if (!current()) return;
                  recovery?.exit();
                  setStatus("exited");
                })
                .catch((error: unknown) => {
                  if (!current()) return;
                  setErrorMessage(
                    error instanceof Error ? error.message : "Could not end terminal",
                  );
                  setStatus("error");
                })
                .finally(() => {
                  if (current()) setEnding(false);
                });
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
