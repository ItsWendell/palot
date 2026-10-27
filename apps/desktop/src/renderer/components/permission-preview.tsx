import { useAutomations } from "../hooks/use-automations";
import type { PermissionPreview as Preview } from "../lib/permission-presentation";
import { resolveFileDiff } from "../lib/file-diffs";
import { FileDiffView } from "./file-diff-view";

export function PermissionPreview({ preview }: { preview: Preview }) {
  return (
    <>
      {preview.automationID ? (
        <ScheduledTaskSubject automationID={preview.automationID} />
      ) : preview.subject ? (
        <p className="min-w-0 truncate text-compact font-medium">{preview.subject}</p>
      ) : null}
      <details className="min-w-0 rounded-md border p-2">
        <summary className="cursor-pointer text-compact font-medium">{preview.label}</summary>
        {preview.patch &&
        preview.file &&
        resolveFileDiff({ file: preview.file, patch: preview.patch }) ? (
          <FileDiffView file={preview.file} patch={preview.patch} className="max-h-64" />
        ) : (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-code-compact">
            {preview.text}
          </pre>
        )}
        {preview.truncated ? (
          <p className="text-meta text-muted-foreground">
            Preview truncated. Review the full action before allowing it.
          </p>
        ) : null}
      </details>
    </>
  );
}

/** An agent names a scheduled task by ID; show the user its name and schedule. */
function ScheduledTaskSubject({ automationID }: { automationID: string }) {
  const { snapshot, loading } = useAutomations();
  const automation = snapshot?.automations.find((item) => item.id === automationID);
  return (
    <p className="min-w-0 truncate text-compact font-medium" title={automationID}>
      {automation
        ? `“${automation.name}”${automation.status === "paused" ? " (paused)" : ""}`
        : loading
          ? "Loading scheduled task…"
          : `Unknown scheduled task ${automationID}`}
    </p>
  );
}
