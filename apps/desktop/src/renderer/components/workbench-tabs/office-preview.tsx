import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { loadOfficePreview } from "./office-preview-loader";
import {
  type OfficeBlock,
  type OfficeDocument,
  type OfficeFormat,
  type OfficeSheet,
} from "./office-preview-model";

type LoadState =
  | { data: Uint8Array; document: OfficeDocument }
  | { data: Uint8Array; error: string };

export default function OfficePreview({
  data,
  path,
  format,
}: {
  data: Uint8Array;
  path: string;
  format: OfficeFormat;
}) {
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const [index, setIndex] = useState(0);
  const current = loaded?.data === data ? loaded : null;

  useEffect(() => {
    const controller = new AbortController();
    void loadOfficePreview(data, format, controller.signal).then(
      (document) => {
        if (!controller.signal.aborted) {
          setIndex(0);
          setLoaded({ data, document });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            data,
            error: error instanceof Error ? error.message : "Could not read this Office file.",
          });
      },
    );
    return () => controller.abort();
  }, [data, format]);

  if (current && "error" in current) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Preview unavailable</EmptyTitle>
          <EmptyDescription>{current.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!current || !("document" in current)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
        <Spinner /> Loading Office preview
      </div>
    );
  }
  const doc = current.document;
  const count = format === "xlsx" ? doc.sheets.length : doc.sections.length;
  const selected = Math.min(index, Math.max(0, count - 1));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1 text-meta">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {format === "xlsx"
            ? "Saved cell values"
            : format === "pptx"
              ? "Slide content"
              : "Document content"}{" "}
          · Read-only
        </span>
        {format === "xlsx" && count ? (
          <label className="flex min-w-0 items-center gap-2">
            Sheet
            <select
              aria-label="Sheet"
              value={selected}
              onChange={(event) => setIndex(Number(event.target.value))}
              className="max-w-48 rounded-md border border-input bg-background px-2 py-1 text-meta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {doc.sheets.map((sheet, i) => (
                <option key={i} value={i}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {format === "pptx" && count ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Previous slide"
              disabled={selected === 0}
              onClick={() => setIndex(selected - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span>
              Slide {selected + 1} of {count}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Next slide"
              disabled={selected + 1 >= count}
              onClick={() => setIndex(selected + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-border px-3 py-2 text-meta text-muted-foreground">
        {format === "xlsx"
          ? "Values only, not recalculated. Dates and number formats may appear as stored numbers. Images, charts and layout are omitted."
          : "Text, basic emphasis and tables only. Images, charts, page layout and animations are omitted. Links are inactive."}
        {doc.truncated ? (
          <p role="status" className="mt-1 text-foreground">
            Preview truncated: up to 30 sheets, 100 slides, 200 rows × 50 columns, 10,000 content
            items and 500,000 characters.
          </p>
        ) : null}
      </div>
      <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
        {format === "xlsx" && doc.sheets[selected] ? (
          <SheetContent sheet={doc.sheets[selected]} />
        ) : (
          <article
            aria-label={`Office preview: ${path}`}
            className="mx-auto max-w-4xl space-y-3 text-sm"
          >
            {doc.sections[selected]?.blocks.map((block, i) => (
              <ContentBlock key={i} block={block} />
            ))}
          </article>
        )}
        {!count ||
        (format !== "xlsx" && !doc.sections[selected]?.blocks.length) ||
        (format === "xlsx" && !doc.sheets[selected]?.rows.length) ? (
          <p className="text-sm text-muted-foreground">
            No readable content in this{" "}
            {format === "xlsx" ? "sheet" : format === "pptx" ? "slide" : "document"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ContentBlock({ block }: { block: OfficeBlock }) {
  if (block.kind === "table")
    return (
      <div className="overflow-auto">
        <table aria-label="Document table" className="w-full border-collapse text-sm">
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  cell === null ? null : (
                    <td
                      key={c}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className="border border-border px-3 py-2 align-top whitespace-pre-wrap"
                    >
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const content = block.runs.map((run, i) => (
    <span key={i}>
      {run.bold ? (
        <strong>{run.italic ? <em>{run.text}</em> : run.text}</strong>
      ) : run.italic ? (
        <em>{run.text}</em>
      ) : (
        run.text
      )}
    </span>
  ));
  if (block.kind === "heading")
    return (
      <div
        role="heading"
        aria-level={block.level}
        className="pt-2 text-sm font-semibold whitespace-pre-wrap"
      >
        {content}
      </div>
    );
  if (block.kind === "list")
    return (
      <ul className="list-disc pl-5">
        <li className="whitespace-pre-wrap">{content}</li>
      </ul>
    );
  return <p className="break-words whitespace-pre-wrap">{content}</p>;
}

function SheetContent({ sheet }: { sheet: OfficeSheet }) {
  return (
    <table
      aria-label={`Sheet: ${sheet.name}`}
      className="w-full border-collapse font-mono text-code-compact"
    >
      <thead>
        <tr>
          <th scope="col" className="border border-border bg-muted px-2 py-1">
            Row
          </th>
          {Array.from({ length: sheet.columns }, (_, i) => (
            <th key={i} scope="col" className="border border-border bg-muted px-3 py-1">
              {columnName(i + 1)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, i) => (
          <tr key={i}>
            <th scope="row" className="border border-border bg-muted px-2 py-1 font-normal">
              {row.number}
            </th>
            {Array.from({ length: sheet.columns }, (_, c) => (
              <td
                key={c}
                className="max-w-64 border border-border px-3 py-1 align-top break-words whitespace-pre-wrap"
              >
                {row.cells[c] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function columnName(number: number): string {
  let label = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
