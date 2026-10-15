import { useEffect, useId, useState } from "react";
import { Plus, SquareTerminal } from "lucide-react";
import {
  PROJECT_SCRIPT_LIMITS,
  type ProjectScript,
  type ProjectScriptDraft,
  type ProjectScriptsTarget,
} from "../../shared/project-scripts-contract";
import {
  useProjectScripts,
  useRemoveProjectScript,
  useSaveProjectScript,
} from "../hooks/use-project-scripts";
import {
  SettingsEmpty,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { Button } from "./ui/button";
import { CopyField } from "./ui/copy-field";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const EMPTY_DRAFT: ProjectScriptDraft = {
  name: "",
  command: "",
  runOnSettle: true,
  timeoutSeconds: PROJECT_SCRIPT_LIMITS.defaultTimeoutSeconds,
};

/**
 * Per-project scripts Palot runs on this computer in a task's directory. Settings show the
 * exact command; nothing runs unless a script is saved here.
 */
export function ProjectScriptsSettings({ target }: { target: ProjectScriptsTarget }) {
  const query = useProjectScripts(target);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const state = query.data;
  const supported = state?.availability.supported === true;
  const scripts = state?.scripts ?? [];

  return (
    <SettingsSection
      title="Scripts"
      icon={SquareTerminal}
      description="Commands Palot runs on this computer through your shell, in the task's own directory. Nothing runs until you add a script here, and the agent is never prompted with the result."
      action={
        supported && editing === null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add script
          </Button>
        ) : null
      }
    >
      {query.error ? (
        <SettingsNotice
          status="error"
          title="Could not load scripts"
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          {query.error.message}
        </SettingsNotice>
      ) : null}
      {state && state.availability.supported !== true ? (
        <SettingsNotice status="neutral" title="Scripts are unavailable for this connection">
          {state.availability.reason}
        </SettingsNotice>
      ) : null}
      {state && (supported || scripts.length > 0) ? (
        <SettingsGroup>
          {scripts.length === 0 && editing !== "new" ? (
            <SettingsEmpty>
              No scripts yet. Add one to clean build output or run checks each time a task in this
              project settles. To prepare new worktrees, use the worktree startup command above.
            </SettingsEmpty>
          ) : null}
          {scripts.map((script) =>
            editing === script.id ? (
              <ScriptEditor
                key={script.id}
                target={target}
                script={script}
                onDone={() => setEditing(null)}
              />
            ) : (
              <ScriptRow
                key={script.id}
                target={target}
                script={script}
                editable={supported && editing === null}
                onEdit={() => setEditing(script.id)}
              />
            ),
          )}
          {editing === "new" ? (
            <ScriptEditor target={target} onDone={() => setEditing(null)} />
          ) : null}
        </SettingsGroup>
      ) : null}
      {!state && !query.error ? <p role="status">Loading scripts…</p> : null}
    </SettingsSection>
  );
}

function ScriptRow({
  target,
  script,
  editable,
  onEdit,
}: {
  target: ProjectScriptsTarget;
  script: ProjectScript;
  editable: boolean;
  onEdit(): void;
}) {
  const remove = useRemoveProjectScript(target);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <SettingsRow
      title={script.name}
      description={triggerSummary(script)}
      status={remove.error ? remove.error.message : undefined}
      tone={remove.error ? "destructive" : "default"}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!editable}
            aria-label={`Edit ${script.name}`}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant={armed ? "destructive" : "ghost"}
            size="sm"
            disabled={remove.isPending}
            aria-label={armed ? `Confirm removing ${script.name}` : `Remove ${script.name}`}
            onBlur={() => setArmed(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && armed) {
                event.stopPropagation();
                setArmed(false);
              }
            }}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              remove.mutate(script.id);
            }}
          >
            {armed ? "Confirm remove" : "Remove"}
          </Button>
        </>
      }
    >
      <CopyField label="Command" valueName={`${script.name} command`} value={script.command} />
    </SettingsRow>
  );
}

function ScriptEditor({
  target,
  script,
  onDone,
}: {
  target: ProjectScriptsTarget;
  script?: ProjectScript;
  onDone(): void;
}) {
  const id = useId();
  const save = useSaveProjectScript(target);
  const [draft, setDraft] = useState<ProjectScriptDraft>(() =>
    script
      ? {
          id: script.id,
          name: script.name,
          command: script.command,
          runOnSettle: script.runOnSettle,
          timeoutSeconds: script.timeoutSeconds,
        }
      : EMPTY_DRAFT,
  );
  const [timeout, setTimeoutText] = useState(String(draft.timeoutSeconds));
  const timeoutSeconds = Number(timeout);
  const timeoutValid =
    Number.isInteger(timeoutSeconds) &&
    timeoutSeconds >= PROJECT_SCRIPT_LIMITS.minTimeoutSeconds &&
    timeoutSeconds <= PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds;
  const valid = draft.name.trim() !== "" && draft.command.trim() !== "" && timeoutValid;

  return (
    <form
      aria-label={script ? `Edit ${script.name}` : "New script"}
      className="p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || save.isPending) return;
        save.mutate({ ...draft, timeoutSeconds }, { onSuccess: onDone });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !save.isPending) {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Script name</FieldLabel>
          <Input
            id={`${id}-name`}
            autoFocus
            value={draft.name}
            maxLength={PROJECT_SCRIPT_LIMITS.name}
            disabled={save.isPending}
            placeholder="Clean build output"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-command`}>Command</FieldLabel>
          <Textarea
            id={`${id}-command`}
            value={draft.command}
            maxLength={PROJECT_SCRIPT_LIMITS.command}
            disabled={save.isPending}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-16 font-mono text-code-compact"
            placeholder="cargo clean"
            onChange={(event) =>
              setDraft((current) => ({ ...current, command: event.target.value }))
            }
          />
          <FieldDescription>
            Runs through your shell with the task's directory as the working directory.
          </FieldDescription>
        </Field>
        <label className="flex min-h-7 cursor-pointer items-center justify-between gap-4 text-sm">
          <span>When a task settles</span>
          <Switch
            checked={draft.runOnSettle}
            disabled={save.isPending}
            onCheckedChange={(runOnSettle) => setDraft((current) => ({ ...current, runOnSettle }))}
          />
        </label>
        <Field>
          <FieldLabel htmlFor={`${id}-timeout`}>Timeout in seconds</FieldLabel>
          <Input
            id={`${id}-timeout`}
            type="number"
            inputMode="numeric"
            min={PROJECT_SCRIPT_LIMITS.minTimeoutSeconds}
            max={PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds}
            value={timeout}
            disabled={save.isPending}
            aria-invalid={!timeoutValid || undefined}
            className="w-32"
            onChange={(event) => setTimeoutText(event.target.value)}
          />
          <FieldDescription>
            Palot stops the script after {PROJECT_SCRIPT_LIMITS.minTimeoutSeconds}–
            {PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds} seconds and reports it as timed out.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {save.error ? (
        <SettingsNotice className="mt-3" status="error">
          {save.error.message}
        </SettingsNotice>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!valid || save.isPending}>
          {save.isPending ? "Saving…" : "Save script"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function triggerSummary(script: ProjectScript): string {
  const timeout =
    script.timeoutSeconds % 60 === 0
      ? `${script.timeoutSeconds / 60} min`
      : `${script.timeoutSeconds} s`;
  return script.runOnSettle
    ? `Runs when a task settles · stops after ${timeout}`
    : "Off · no trigger selected";
}
