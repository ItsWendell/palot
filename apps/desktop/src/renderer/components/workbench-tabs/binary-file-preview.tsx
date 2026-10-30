import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { BinaryPreviewWorker } from "./binary-preview-loader";
import {
  SQLITE_PAGE_SIZE,
  type ArchiveEntry,
  type DocumentBlock,
  type SqlitePage,
  type SqliteTable,
  type StructuredDocument,
} from "./binary-preview-model";
import { ReadOnlyFilePreview } from "./file-tab";
import { VirtualPreviewTable } from "./virtual-preview-table";
import type { RichWorkspaceFilePreview } from "./workspace-file-preview";

type Preview = Extract<RichWorkspaceFilePreview, { kind: "sqlite" | "archive" | "document" }>;
type Loaded = { preview: Preview; worker: BinaryPreviewWorker } & (
  | { type: "sqlite"; tables: SqliteTable[] }
  | { type: "archive"; entries: ArchiveEntry[] }
  | { type: "document"; document: StructuredDocument }
);

export default function BinaryFilePreview({
  preview,
  path,
  depth,
}: {
  preview: Preview;
  path: string;
  depth: number;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ preview: Preview; message: string } | null>(null);
  useEffect(() => {
    const worker = new BinaryPreviewWorker();
    let active = true;
    void worker
      .request(
        preview.kind === "document"
          ? { type: "document", data: preview.data, format: preview.format }
          : { type: "open", data: preview.data, path, kind: preview.kind },
      )
      .then((result) => {
        if (
          active &&
          (result.type === "sqlite" || result.type === "archive" || result.type === "document")
        )
          setLoaded({ ...result, preview, worker });
      })
      .catch((error: unknown) => {
        if (active)
          setError({
            preview,
            message: error instanceof Error ? error.message : "Could not read this file.",
          });
      });
    return () => {
      active = false;
      worker.close();
    };
  }, [preview, path]);
  if (error?.preview === preview) return <PreviewError message={error.message} />;
  if (loaded?.preview !== preview) return <Loading />;
  if (loaded.type === "sqlite")
    return <SqlitePreview key={path} tables={loaded.tables} worker={loaded.worker} />;
  if (loaded.type === "archive")
    return (
      <ArchivePreview key={path} entries={loaded.entries} worker={loaded.worker} depth={depth} />
    );
  return (
    <DocumentPreview
      document={loaded.document}
      path={path}
      format={preview.kind === "document" ? preview.format : ""}
    />
  );
}

function SqlitePreview({ tables, worker }: { tables: SqliteTable[]; worker: BinaryPreviewWorker }) {
  const [table, setTable] = useState(tables[0]?.name ?? "");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ table: string; page: number; data: SqlitePage } | null>(
    null,
  );
  const [error, setError] = useState("");
  const count = tables.find((item) => item.name === table)?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / SQLITE_PAGE_SIZE));
  useEffect(() => {
    if (!table) return;
    let active = true;
    setError("");
    void worker
      .request({ type: "page", table, page })
      .then((result) => {
        if (active && result.type === "page") setResult({ table, page, data: result.page });
      })
      .catch((error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : "Could not read database rows.");
      });
    return () => {
      active = false;
    };
  }, [table, page, worker]);
  const current = result?.table === table && result.page === page ? result.data : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-meta">
        <label className="flex min-w-0 items-center gap-2">
          Table{" "}
          <select
            aria-label="Database table"
            value={table}
            className="max-w-48 rounded-md border border-input bg-background px-2 py-1"
            onChange={(event) => {
              setTable(event.target.value);
              setPage(0);
            }}
          >
            {tables.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count} rows)
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1 text-muted-foreground">Read-only · {count} rows</span>
        <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous page
        </Button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </Button>
      </div>
      {!tables.length ? (
        <PreviewError message="No user tables in this database." />
      ) : error ? (
        <PreviewError message={error} />
      ) : !current ? (
        <Loading />
      ) : (
        <VirtualPreviewTable
          key={`${table}:${page}`}
          label={`Database table: ${table}`}
          columns={current.columns.map((label) => ({ label, width: 24 }))}
          rowCount={current.rows.length}
          row={(index) => current.rows[index] ?? []}
        />
      )}
    </div>
  );
}

function ArchivePreview({
  entries,
  worker,
  depth,
}: {
  entries: ArchiveEntry[];
  worker: BinaryPreviewWorker;
  depth: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ path: string; data: Uint8Array } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setError("");
    void worker
      .request({ type: "entry", path: selected })
      .then((result) => {
        if (active && result.type === "entry") setEntry({ path: selected, data: result.data });
      })
      .catch((error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : "Could not read archive entry.");
      });
    return () => {
      active = false;
    };
  }, [selected, worker]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1 text-meta">
        {selected ? (
          <Button variant="ghost" size="xs" onClick={() => setSelected(null)}>
            Back to archive
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{selected || `${entries.length} entries`}</span>
        <span className="text-muted-foreground">Read-only · In memory</span>
      </div>
      {selected ? (
        error ? (
          <PreviewError message={error} />
        ) : entry?.path === selected ? (
          <ReadOnlyFilePreview key={selected} data={entry.data} path={selected} depth={depth + 1} />
        ) : (
          <Loading />
        )
      ) : (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto">
          <table aria-label="Archive entries" className="w-full border-collapse text-meta">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Modified</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.path} className="border-b">
                  <td className="px-3 py-1">
                    {entry.directory ? (
                      <span>{entry.path}</span>
                    ) : (
                      <Button variant="link" size="xs" onClick={() => setSelected(entry.path)}>
                        {entry.path}
                      </Button>
                    )}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                    {entry.directory ? "Folder" : `${entry.size.toLocaleString()} B`}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground">
                    {entry.modified ? new Date(entry.modified).toLocaleString() : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length ? (
            <p className="p-3 text-meta text-muted-foreground">Empty archive.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DocumentPreview({
  document,
  path,
  format,
}: {
  document: StructuredDocument;
  path: string;
  format: string;
}) {
  const [section, setSection] = useState(0);
  const label = format === "ods" ? "Sheet" : format === "odp" ? "Slide" : "Chapter";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-meta">
        <span className="flex-1 text-muted-foreground">Document content · Read-only</span>
        {document.sections.length > 1 || ["ods", "odp", "epub"].includes(format) ? (
          <label className="flex items-center gap-2">
            {label}
            <select
              aria-label={label}
              value={section}
              onChange={(event) => setSection(Number(event.target.value))}
              className="max-w-48 rounded-md border border-input bg-background px-2 py-1"
            >
              {document.sections.map((item, index) => (
                <option key={index} value={index}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="shrink-0 border-b px-3 py-2 text-meta text-muted-foreground">
        Text, tables and embedded raster images only. Layout, scripts and external resources are
        omitted; links are inactive.{" "}
        {format === "ods" ? "Saved values only, not recalculated. " : ""}
        {document.truncated ? (
          <span role="status">Preview truncated to bounded content.</span>
        ) : null}
      </p>
      <article
        aria-label={`Document preview: ${path}`}
        className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5"
      >
        <div className="mx-auto max-w-4xl space-y-3 text-sm">
          {document.sections[section]?.blocks.map((block, index) => (
            <DocumentContent key={index} block={block} />
          ))}
          {!document.sections[section]?.blocks.length ? (
            <p className="text-muted-foreground">No readable content.</p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
function DocumentContent({ block }: { block: DocumentBlock }) {
  if (block.kind === "image") return <DocumentImage block={block} />;
  if (block.kind === "table")
    return (
      <div className="overflow-auto">
        <table aria-label="Document table" className="w-full border-collapse text-meta">
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border px-3 py-2 align-top break-words whitespace-pre-wrap"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (block.kind === "heading")
    return <h2 className="text-sm font-semibold whitespace-pre-wrap">{block.text}</h2>;
  return <p className="break-words whitespace-pre-wrap">{block.text}</p>;
}
function DocumentImage({ block }: { block: Extract<DocumentBlock, { kind: "image" }> }) {
  const [url, setURL] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(block.data)], { type: block.mime }));
    setURL(url);
    return () => URL.revokeObjectURL(url);
  }, [block]);
  return url ? (
    <img src={url} alt={block.alt} className="max-h-96 max-w-full object-contain" />
  ) : null;
}
function Loading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
      <Spinner /> Loading preview
    </div>
  );
}
function PreviewError({ message }: { message: string }) {
  return (
    <Empty className="rounded-none p-5">
      <EmptyHeader>
        <EmptyTitle>Preview unavailable</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
