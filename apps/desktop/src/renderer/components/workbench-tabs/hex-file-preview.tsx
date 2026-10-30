import { VirtualPreviewTable } from "./virtual-preview-table";

const COLUMNS = [
  { label: "Offset", width: 12 },
  { label: "Hex", width: 52 },
  { label: "ASCII", width: 20 },
];

export function HexFilePreview({ data, path }: { data: Uint8Array; path: string }) {
  return (
    <>
      <p className="shrink-0 border-b px-3 py-2 text-meta text-muted-foreground">
        {data.byteLength.toLocaleString()} bytes · Hex view
      </p>
      <VirtualPreviewTable
        label={`Hex: ${path}`}
        columns={COLUMNS}
        rowCount={Math.ceil(data.byteLength / 16)}
        row={(index) => {
          const offset = index * 16;
          const bytes = Array.from(data.subarray(offset, offset + 16));
          return [
            offset.toString(16).padStart(8, "0"),
            bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" "),
            bytes
              .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "."))
              .join(""),
          ];
        }}
      />
    </>
  );
}
