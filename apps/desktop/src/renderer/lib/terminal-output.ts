import Anser from "anser";

export interface TerminalTextRun {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

const MAX_STYLED_TERMINAL_OUTPUT = 256 * 1024;
const MAX_TERMINAL_RUNS = 4096;

// A cumulative log projection, not a terminal emulator. Keep only complete SGR
// sequences; cursor commands and OSC metadata (including links) are not content.
function normalizeTerminalOutput(value: string): string {
  const chunks: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value[index];
    if (code !== "\u001b" && code !== "\u009b" && code !== "\u009d") continue;
    chunks.push(value.slice(start, index));
    const csi = code === "\u009b" || (code === "\u001b" && value[index + 1] === "[");
    const osc = code === "\u009d" || (code === "\u001b" && value[index + 1] === "]");
    const body = index + (code === "\u001b" ? 2 : 1);
    if (csi) {
      let end = body;
      while (end < value.length && value.charCodeAt(end) >= 0x20 && value.charCodeAt(end) <= 0x3f) {
        end += 1;
      }
      if (end === value.length) return chunks.join("").replace(/\r\n?/g, "\n");
      if (value.charCodeAt(end) >= 0x40 && value.charCodeAt(end) <= 0x7e) {
        if (value[end] === "m") chunks.push(`\u001b[${value.slice(body, end + 1)}`);
        index = end;
      } else {
        index = end - 1;
      }
    } else if (osc) {
      let end = body;
      while (
        end < value.length &&
        value[end] !== "\u0007" &&
        value[end] !== "\u009c" &&
        !(value[end] === "\u001b" && value[end + 1] === "\\")
      ) {
        end += 1;
      }
      index = value[end] === "\u001b" ? end + 1 : end;
    } else if (index + 1 < value.length) {
      // Leave other complete escape sequences to Anser.
      chunks.push(value.slice(index, index + 2));
      index += 1;
    }
    start = index + 1;
  }
  chunks.push(value.slice(start));
  return chunks.join("").replace(/\r\n?/g, "\n");
}

export function terminalOutput(value: string | null): {
  output: string | null;
  terminal: TerminalTextRun[] | null;
} {
  if (value === null) return { output: null, terminal: null };
  const normalized = normalizeTerminalOutput(value);
  if (!normalized.includes("\u001b")) return { output: normalized, terminal: null };
  if (normalized.length > MAX_STYLED_TERMINAL_OUTPUT) {
    return { output: Anser.ansiToText(normalized), terminal: null };
  }

  const entries = Anser.ansiToJson(normalized, { remove_empty: true });
  const output = entries.map((entry) => entry.content).join("");
  if (entries.length > MAX_TERMINAL_RUNS) return { output, terminal: null };
  const terminal = entries.flatMap((entry) => {
    if (!entry.content) return [];
    const decorations = new Set(entry.decorations ?? []);
    return [
      {
        text: entry.content,
        ...(entry.fg ? { color: `rgb(${entry.fg})` } : {}),
        ...(entry.bg ? { backgroundColor: `rgb(${entry.bg})` } : {}),
        ...(decorations.has("bold") ? { bold: true } : {}),
        ...(decorations.has("dim") ? { dim: true } : {}),
        ...(decorations.has("italic") ? { italic: true } : {}),
        ...(decorations.has("underline") ? { underline: true } : {}),
        ...(decorations.has("strikethrough") ? { strikethrough: true } : {}),
      },
    ];
  });
  return { output, terminal };
}
