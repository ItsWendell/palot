import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

export interface PreviewColumn {
  label: string;
  width: number;
}

/** Fixed-height source rows keep both table and hex previews bounded to the visible range. */
export function VirtualPreviewTable({
  label,
  columns,
  rowCount,
  row,
}: {
  label: string;
  columns: PreviewColumn[];
  rowCount: number;
  row(index: number): readonly string[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 8,
    paddingStart: 32,
  });
  const gridTemplateColumns = columns.map((column) => `${column.width}ch`).join(" ");
  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="region"
      aria-label={`${label} scroll area`}
      className="palot-native-scrollbar min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div
        role="table"
        aria-label={label}
        aria-rowcount={rowCount + 1}
        aria-colcount={columns.length}
        className="relative min-w-full font-mono text-code-compact"
        style={{ width: "max-content", height: virtualizer.getTotalSize() }}
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 grid h-8 border-b bg-muted text-muted-foreground"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column, index) => (
            <div
              key={index}
              role="columnheader"
              aria-colindex={index + 1}
              title={column.label}
              className="truncate border-r px-3 py-1.5 font-medium"
            >
              {column.label}
            </div>
          ))}
        </div>
        <div role="rowgroup">
          {virtualizer.getVirtualItems().map((item) => {
            const cells = row(item.index);
            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                className="absolute top-0 left-0 grid min-w-full border-b even:bg-muted/30"
                style={{
                  gridTemplateColumns,
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {columns.map((_, column) => (
                  <div
                    key={column}
                    role="cell"
                    aria-colindex={column + 1}
                    title={cells[column] ?? ""}
                    className="overflow-hidden border-r px-3 py-1.5 whitespace-pre text-ellipsis"
                  >
                    {cells[column] ?? ""}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
