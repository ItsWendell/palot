export interface DelimitedPreviewData {
  rows: string[][];
  truncated: boolean;
}

const MAX_ROWS = 50_001; // One header plus 50,000 data rows.
const MAX_COLUMNS = 100;

/** RFC 4180 quoting, also used for TSV. Malformed quoting falls back to source. */
export function parseDelimitedPreview(
  text: string,
  delimiter: "," | "\t",
): DelimitedPreviewData | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let truncated = false;
  let rowStart = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endCell = () => {
    if (row.length < MAX_COLUMNS) row.push(cell);
    else truncated = true;
    cell = "";
    closedQuote = false;
  };
  for (let index = rowStart; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else cell += char;
      continue;
    }
    if (char === delimiter || char === "\n" || char === "\r") {
      endCell();
      if (char !== delimiter) {
        rows.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index++;
        rowStart = index + 1;
        if (rows.length === MAX_ROWS) {
          return { rows, truncated: truncated || rowStart < text.length };
        }
      }
    } else if (char === '"' && cell === "" && !closedQuote) quoted = true;
    else {
      if (closedQuote || char === '"') return null;
      cell += char;
    }
  }
  if (quoted) return null;
  if (rowStart < text.length) {
    endCell();
    rows.push(row);
  }
  return { rows, truncated };
}
