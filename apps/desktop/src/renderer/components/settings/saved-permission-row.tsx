import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import type { PermissionSavedInfo } from "@opencode/client";
import { useSettingsOwner } from "../../hooks/use-settings-owner";
import { showErrorToast } from "../../lib/toast-error";
import { supportsSavedPermissionUpdate } from "../../services/opencode-settings";
import { palot } from "../../services/palot";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type EditProblem = "conflict" | "unsupported" | null;

const problemText: Record<Exclude<EditProblem, null>, string> = {
  conflict: "A rule for this already exists.",
  unsupported: "This OpenCode server can't edit saved approvals. Update OpenCode to edit them.",
};

/** One saved approval, with Remove and, on servers that support it, an inline Edit. */
export function SavedPermissionRow({
  permission,
  location,
  onChanged,
}: {
  permission: PermissionSavedInfo;
  location: { directory: string; workspaceID?: string } | undefined;
  onChanged(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const editable = supportsSavedPermissionUpdate(owner?.version);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(permission.action);
  const [resource, setResource] = useState(permission.resource);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<EditProblem>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const resourceInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      resourceInput.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const request = {
    connectionID: owner?.connectionID,
    id: permission.id,
    projectID: permission.projectID,
    directory: location?.directory ?? "",
    ...(location?.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
  const nextAction = action.trim();
  const nextResource = resource.trim();
  const changed = nextAction !== permission.action || nextResource !== permission.resource;
  const canSave = changed && Boolean(nextAction) && Boolean(nextResource) && !busy;

  function startEditing() {
    setAction(permission.action);
    setResource(permission.resource);
    setProblem(null);
    setEditing(true);
  }

  function stopEditing() {
    returnFocus.current = true;
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await palot.updateSavedPermission({
        ...request,
        ...(nextAction === permission.action ? {} : { action: nextAction }),
        ...(nextResource === permission.resource ? {} : { resource: nextResource }),
      });
      if (result.status !== "updated") {
        setProblem(result.status);
        return;
      }
      await onChanged();
      stopEditing();
    } catch (cause) {
      showErrorToast("Could not update saved approval", cause);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // Settings closes on Escape unless the event is already handled.
    event.preventDefault();
    if (!busy) stopEditing();
  }

  if (editing) {
    return (
      <form
        className="grid min-w-0 gap-2 p-4"
        aria-label={`Edit saved approval for ${permission.resource}`}
        onSubmit={(event) => void save(event)}
        onKeyDown={onKeyDown}
      >
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="grid w-32 gap-1 text-meta font-medium">
            Action
            <Input
              value={action}
              disabled={busy}
              className="font-mono text-code-compact"
              onChange={(event) => {
                setAction(event.target.value);
                setProblem(null);
              }}
            />
          </label>
          <label className="grid min-w-48 flex-1 gap-1 text-meta font-medium">
            Resource
            <Input
              ref={resourceInput}
              value={resource}
              disabled={busy}
              className="font-mono text-code-compact"
              aria-invalid={problem === "conflict" || undefined}
              onChange={(event) => {
                setResource(event.target.value);
                setProblem(null);
              }}
            />
          </label>
        </div>
        {changed && nextAction && nextResource ? (
          <p className="text-meta wrap-anywhere text-muted-foreground">
            Was{" "}
            <code className="text-code-compact text-foreground">
              {permission.action} {permission.resource}
            </code>{" "}
            → now{" "}
            <code className="text-code-compact text-foreground">
              {nextAction} {nextResource}
            </code>
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-meta text-destructive">
            {problemText[problem]}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={stopEditing}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <Badge variant="secondary">{permission.action}</Badge>
          <code className="min-w-0 text-code-compact wrap-anywhere" title={permission.resource}>
            {permission.resource}
          </code>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {editable ? (
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit saved approval for ${permission.resource}`}
            onClick={startEditing}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove saved approval for ${permission.resource}`}
          onClick={() =>
            void palot
              .removeSavedPermission(request)
              .then(onChanged)
              .catch((cause) => showErrorToast("Could not remove saved approval", cause))
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
