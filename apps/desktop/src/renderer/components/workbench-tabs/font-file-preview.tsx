import { useEffect, useId, useMemo, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";

/** Read an sfnt name table when present. Compressed WOFF/WOFF2 can use the filename instead. */
export function fontDisplayName(data: Uint8Array): string | null {
  if (data.length < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) return null;
  const tables = Math.min(view.getUint16(4), 256);
  for (let index = 0; index < tables; index++) {
    const table = 12 + index * 16;
    if (table + 16 > data.length) return null;
    if (view.getUint32(table) !== 0x6e616d65) continue;
    const start = view.getUint32(table + 8);
    const length = view.getUint32(table + 12);
    if (length < 6 || start + length > data.length) return null;
    const strings = start + view.getUint16(start + 4);
    const count = Math.min(view.getUint16(start + 2), 256);
    for (let entry = 0; entry < count; entry++) {
      const offset = start + 6 + entry * 12;
      if (offset + 12 > start + length) return null;
      const platform = view.getUint16(offset);
      if (view.getUint16(offset + 6) !== 1 || ![0, 1, 3].includes(platform)) continue;
      const size = view.getUint16(offset + 8);
      const position = strings + view.getUint16(offset + 10);
      if (size === 0 || size > 1024 || position + size > start + length) continue;
      const name = new TextDecoder(platform === 1 ? "macintosh" : "utf-16be")
        .decode(data.subarray(position, position + size))
        .trim();
      if (name) return name;
    }
  }
  return null;
}

const GLYPHS = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32));
const SIZES = [12, 16, 24, 36, 48];

export function FontFilePreview({ data, path }: { data: Uint8Array; path: string }) {
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const family = `palot-file-font-${id}`;
  const [result, setResult] = useState<{ data: Uint8Array; loaded: boolean } | null>(null);
  const name = useMemo(() => fontDisplayName(data) ?? path.split(/[\\/]/).at(-1), [data, path]);
  useEffect(() => {
    let active = true;
    let font: FontFace | null = null;
    const load = async () => {
      try {
        // Copy the bounded bytes to a regular ArrayBuffer, including SharedArrayBuffer inputs.
        font = new FontFace(family, new Uint8Array(data).buffer);
        await font.load();
        if (!active) return;
        document.fonts.add(font);
        setResult({ data, loaded: true });
      } catch {
        if (active) setResult({ data, loaded: false });
      }
    };
    void load();
    return () => {
      active = false;
      if (font) document.fonts.delete(font);
    };
  }, [data, family]);
  if (result?.data !== data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
        <Spinner /> Loading font
      </div>
    );
  }
  if (!result.loaded) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Preview unavailable</EmptyTitle>
          <EmptyDescription>Could not load {path} as a font.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
      <div className="mx-auto max-w-4xl space-y-6">
        <h2 className="text-sm font-medium">{name}</h2>
        {SIZES.map((size) => (
          <div key={size}>
            <p className="mb-1 text-meta text-muted-foreground">{size} px</p>
            <p
              style={{ fontFamily: `"${family}", sans-serif`, fontSize: size }}
              className="break-words"
            >
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
        ))}
        <section aria-label="Basic Latin glyphs">
          <h3 className="mb-2 text-meta text-muted-foreground">Basic Latin</h3>
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))]"
            style={{ fontFamily: `"${family}", sans-serif` }}
          >
            {GLYPHS.map((glyph) => (
              <span
                key={glyph}
                className="grid min-h-12 place-items-center border text-page-title"
                title={`U+${glyph.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`}
              >
                {glyph}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
