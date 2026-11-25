/**
 * Longest piece of terminal input sent as one IPC write and one WebSocket frame, in UTF-16 code
 * units. A code unit is at most three UTF-8 bytes, so a piece stays under 48 KiB on the wire.
 */
export const TERMINAL_WRITE_MAX_LENGTH = 16_384;

/** Splits terminal input into pieces of at most `max` code units, never inside a surrogate pair. */
export function chunkTerminalWrite(data: string, max = TERMINAL_WRITE_MAX_LENGTH): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + max, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && end - start > 1 && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}
