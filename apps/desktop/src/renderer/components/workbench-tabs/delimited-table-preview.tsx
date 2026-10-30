import { useMemo } from "react";
import type { DelimitedPreviewData } from "./delimited-preview-model";
import { VirtualPreviewTable } from "./virtual-preview-table";

export function DelimitedTablePreview({
  table,
  path,
}: {
  table: DelimitedPreviewData;
  path: string;
}) {
  const columns = useMemo(() => {
    const count = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
    return Array.from({ length: count }, (_, column) => ({
      label: table.rows[0]?.[column] || `Column ${column + 1}`,
      width: Math.max(
        12,
        Math.min(
          42,
          Math.max(...table.rows.slice(0, 100).map((row) => row[column]?.length ?? 0)) + 4,
        ),
      ),
    }));
  }, [table]);
  return (
    <>
      <div role="status" className="shrink-0 border-b px-3 py-2 text-meta text-muted-foreground">
        {(table.rows.length - 1).toLocaleString()} rows · {columns.length} columns
        {table.truncated
          ? " · Preview limited to 50,000 data rows and 100 columns. Source is complete."
          : ""}
      </div>
      <VirtualPreviewTable
        label={`Table: ${path}`}
        columns={columns}
        rowCount={Math.max(0, table.rows.length - 1)}
        row={(index) => table.rows[index + 1]!}
      />
    </>
  );
}
