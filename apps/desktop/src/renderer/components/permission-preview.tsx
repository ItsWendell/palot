import type { PermissionPreview as Preview } from "../lib/permission-presentation";
import { resolveFileDiff } from "../lib/file-diffs";
import { FileDiffView } from "./file-diff-view";

export function PermissionPreview({ preview }: { preview: Preview }) {
  return (
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
  );
}
