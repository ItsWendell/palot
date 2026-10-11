import { Lock, RotateCcw, Search, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  KEYBOARD_SHORTCUT_GROUPS,
  KEYBOARD_SHORTCUTS,
  formatShortcut,
  resetShortcutBinding,
  resetShortcutBindings,
  setShortcutBinding,
  shortcutBindingProblem,
  shortcutConflicts,
  shortcutFromKeyboardEvent,
  shortcutKeys,
  useShortcutOverrides,
  type KeyboardShortcut,
  type KeyboardShortcutID,
  type ShortcutKeys,
} from "../lib/keyboard-shortcuts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ShortcutKbd } from "./ui/kbd";
import { toast } from "./ui/toast";
import { SettingsEmpty, SettingsGroup, SettingsSection } from "./settings-layout";

interface PendingConflict {
  id: KeyboardShortcutID;
  keys: ShortcutKeys;
  conflicts: KeyboardShortcut[];
}

function shortcutSearchText(shortcut: KeyboardShortcut, groupLabel: string) {
  return [shortcut.label, shortcut.note, groupLabel, formatShortcut(shortcutKeys(shortcut.id))]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Shortcut reference generated from the shared catalog, with personal bindings. */
export function KeyboardShortcutsSettings() {
  const overrides = useShortcutOverrides();
  const [query, setQuery] = useState("");
  const [recordingID, setRecordingID] = useState<KeyboardShortcutID | null>(null);
  const [problem, setProblem] = useState<{ id: KeyboardShortcutID; message: string } | null>(null);
  const [pending, setPending] = useState<PendingConflict | null>(null);
  const normalized = query.trim().toLowerCase();
  const groups = KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: KEYBOARD_SHORTCUTS.filter(
      (shortcut) =>
        shortcut.group === group.id &&
        (!normalized || shortcutSearchText(shortcut, group.label).includes(normalized)),
    ),
  })).filter((group) => group.shortcuts.length > 0);
  const customized = Object.keys(overrides).length > 0;

  const startRecording = (id: KeyboardShortcutID) => {
    setPending(null);
    setProblem(null);
    setRecordingID(id);
  };
  const stopRecording = () => {
    setRecordingID(null);
    setProblem(null);
  };
  const save = (id: KeyboardShortcutID, keys: ShortcutKeys | null) => {
    try {
      setShortcutBinding(id, keys);
    } catch (error) {
      setProblem({ id, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const record = (shortcut: KeyboardShortcut, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Keep recorded keys away from global shortcuts and the Settings Escape handler.
    event.preventDefault();
    event.stopPropagation();
    const bare = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (bare && event.key === "Escape") {
      stopRecording();
      return;
    }
    if (bare && (event.key === "Backspace" || event.key === "Delete")) {
      if (shortcut.required) {
        setProblem({ id: shortcut.id, message: `${shortcut.label} needs a shortcut.` });
        return;
      }
      save(shortcut.id, null);
      stopRecording();
      return;
    }
    const keys = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!keys) return;
    const issue = shortcutBindingProblem(shortcut.id, keys);
    if (issue) {
      setProblem({ id: shortcut.id, message: issue });
      return;
    }
    const conflicts = shortcutConflicts(shortcut.id, keys);
    stopRecording();
    if (conflicts.length > 0) {
      setPending({ id: shortcut.id, keys, conflicts });
      return;
    }
    save(shortcut.id, keys);
  };

  const replace = (conflict: PendingConflict) => {
    for (const other of conflict.conflicts) setShortcutBinding(other.id, null);
    save(conflict.id, conflict.keys);
    setPending(null);
  };

  const restoreDefaults = () => {
    resetShortcutBindings();
    setPending(null);
    stopRecording();
    toast.add({ type: "success", title: "Default shortcuts restored" });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            placeholder="Filter shortcuts"
            aria-label="Filter keyboard shortcuts"
            className="h-8 pr-8 pl-8"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Clear shortcut filter"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!customized}
          onClick={restoreDefaults}
        >
          <RotateCcw aria-hidden="true" />
          Restore defaults
        </Button>
      </div>
      {groups.length === 0 ? (
        <SettingsGroup>
          <SettingsEmpty>No shortcuts match “{query.trim()}”.</SettingsEmpty>
        </SettingsGroup>
      ) : (
        groups.map((group) => (
          <SettingsSection key={group.id} title={group.label}>
            <SettingsGroup>
              {group.shortcuts.map((shortcut) => (
                <ShortcutRow
                  key={shortcut.id}
                  shortcut={shortcut}
                  customized={overrides[shortcut.id] !== undefined}
                  recording={recordingID === shortcut.id}
                  problem={problem?.id === shortcut.id ? problem.message : null}
                  conflict={pending?.id === shortcut.id ? pending : null}
                  onStart={() => startRecording(shortcut.id)}
                  onStop={stopRecording}
                  onRecord={(event) => record(shortcut, event)}
                  onReset={() => {
                    resetShortcutBinding(shortcut.id);
                    if (pending?.id === shortcut.id) setPending(null);
                  }}
                  onReplace={replace}
                  onCancelConflict={() => setPending(null)}
                />
              ))}
            </SettingsGroup>
          </SettingsSection>
        ))
      )}
    </div>
  );
}

function ShortcutRow({
  shortcut,
  customized,
  recording,
  problem,
  conflict,
  onStart,
  onStop,
  onRecord,
  onReset,
  onReplace,
  onCancelConflict,
}: {
  shortcut: KeyboardShortcut;
  customized: boolean;
  recording: boolean;
  problem: string | null;
  conflict: PendingConflict | null;
  onStart(): void;
  onStop(): void;
  onRecord(event: ReactKeyboardEvent<HTMLButtonElement>): void;
  onReset(): void;
  onReplace(conflict: PendingConflict): void;
  onCancelConflict(): void;
}) {
  const keys = shortcutKeys(shortcut.id);
  // A recorded Space must not reach the button's keyup activation and restart recording.
  const capturedCode = useRef<string | null>(null);
  const label = keys.length > 0 ? formatShortcut(keys) : "Not set";
  const replaceable = conflict?.conflicts.every((other) => !other.locked && !other.required);
  const hint = recording
    ? shortcut.required
      ? "Press the new keys. Esc cancels."
      : "Press the new keys. Esc cancels, Delete clears."
    : shortcut.note;

  return (
    <div className="px-4 py-2.5" data-shortcut-id={shortcut.id}>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">{shortcut.label}</span>
          {hint ? <span className="block text-meta text-muted-foreground">{hint}</span> : null}
          {problem ? (
            <span role="alert" className="block text-meta text-destructive">
              {problem}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shortcut.locked ? (
            <span className="flex items-center gap-1.5" title={shortcut.locked}>
              <ShortcutKbd keys={keys} />
              <Lock className="size-3 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{shortcut.locked}</span>
            </span>
          ) : (
            <>
              {customized ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Reset ${shortcut.label} to ${formatShortcut(shortcut.keys)}`}
                  title={`Reset to ${formatShortcut(shortcut.keys)}`}
                  onClick={onReset}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={
                  recording
                    ? `Recording shortcut for ${shortcut.label}`
                    : `Change shortcut for ${shortcut.label}, currently ${label}`
                }
                aria-pressed={recording}
                className="min-w-20 justify-center"
                onClick={() => (recording ? onStop() : onStart())}
                onBlur={() => {
                  if (recording) onStop();
                }}
                onKeyDown={(event) => {
                  if (!recording) return;
                  capturedCode.current = event.code;
                  onRecord(event);
                }}
                onKeyUp={(event) => {
                  if (capturedCode.current !== event.code) return;
                  capturedCode.current = null;
                  event.preventDefault();
                }}
              >
                {recording ? (
                  <span className="text-meta text-muted-foreground" aria-live="polite">
                    Press keys…
                  </span>
                ) : keys.length > 0 ? (
                  <ShortcutKbd keys={keys} />
                ) : (
                  <span className="text-meta text-muted-foreground">Not set</span>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
      {conflict ? (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-compact"
        >
          <span className="min-w-0">
            {formatShortcut(conflict.keys)} is already used by{" "}
            {conflict.conflicts.map((other) => other.label).join(", ")}.
            {replaceable ? null : " That shortcut can't be cleared."}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={onCancelConflict}>
              Cancel
            </Button>
            {replaceable ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onReplace(conflict)}
              >
                Replace
              </Button>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
