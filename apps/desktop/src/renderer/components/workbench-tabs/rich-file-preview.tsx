import { DelimitedTablePreview } from "./delimited-table-preview";
import { FontFilePreview } from "./font-file-preview";
import { HexFilePreview } from "./hex-file-preview";
import { MermaidFilePreview } from "./mermaid-file-preview";
import { NotebookPreview } from "./notebook-preview";
import type { RichWorkspaceFilePreview } from "./workspace-file-preview";
import { lazy, Suspense } from "react";
import { Spinner } from "../ui/spinner";

const BinaryFilePreview = lazy(() => import("./binary-file-preview"));

export { isRichFilePreview } from "./workspace-file-preview";

/**
 * Renders a rich preview. Formats with source text (CSV/TSV, notebooks, Mermaid) get their
 * Preview/Source toggle from the file tab header, where Source opens the editor.
 */
export function RichFilePreview({
  preview,
  path,
  depth = 0,
}: {
  preview: RichWorkspaceFilePreview;
  path: string;
  depth?: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {preview.kind === "sqlite" || preview.kind === "archive" || preview.kind === "document" ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
              <Spinner /> Loading preview
            </div>
          }
        >
          <BinaryFilePreview preview={preview} path={path} depth={depth} />
        </Suspense>
      ) : preview.kind === "delimited" ? (
        <DelimitedTablePreview table={preview.table} path={path} />
      ) : preview.kind === "notebook" ? (
        <NotebookPreview notebook={preview.notebook} />
      ) : preview.kind === "mermaid" ? (
        <MermaidFilePreview text={preview.text} />
      ) : preview.kind === "font" ? (
        <FontFilePreview data={preview.data} path={path} />
      ) : (
        <HexFilePreview data={preview.data} path={path} />
      )}
    </div>
  );
}
