import Anser from "anser";

export type NotebookOutput = { kind: "text" | "html" | "image"; text: string };
export interface NotebookCell {
  kind: "markdown" | "code" | "raw";
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}
export interface NotebookPreviewData {
  language: string;
  cells: NotebookCell[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function multiline(value: unknown): string | null {
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.every((line) => typeof line === "string")
    ? value.join("")
    : null;
}

function outputs(value: unknown): NotebookOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): NotebookOutput[] => {
    const output = record(item);
    if (!output) return [];
    if (output.output_type === "stream") {
      const text = multiline(output.text);
      return text === null ? [] : [{ kind: "text", text: Anser.ansiToText(text) }];
    }
    if (output.output_type === "error") {
      const traceback = Array.isArray(output.traceback)
        ? output.traceback.filter((line): line is string => typeof line === "string").join("\n")
        : "";
      const fallback = [output.ename, output.evalue]
        .filter((s) => typeof s === "string")
        .join(": ");
      return [{ kind: "text", text: Anser.ansiToText(traceback || fallback) }];
    }
    if (output.output_type !== "display_data" && output.output_type !== "execute_result") return [];
    const data = record(output.data);
    if (!data) return [];
    // A MIME bundle offers alternatives, not multiple independent outputs. Never embed HTML/SVG.
    for (const mime of ["image/png", "image/jpeg"] as const) {
      const image = multiline(data[mime])?.replace(/\s/g, "");
      if (image && /^[A-Za-z0-9+/]+={0,2}$/.test(image) && image.length % 4 === 0) {
        return [{ kind: "image", text: `data:${mime};base64,${image}` }];
      }
    }
    const plain = multiline(data["text/plain"]);
    if (plain !== null) return [{ kind: "text", text: Anser.ansiToText(plain) }];
    const html = multiline(data["text/html"]);
    return html === null ? [] : [{ kind: "html", text: html }];
  });
}

/** Only v4 notebooks with well-formed cells enter the rich viewer. */
export function parseNotebookPreview(text: string): NotebookPreviewData | null {
  let notebook: Record<string, unknown> | null;
  try {
    notebook = record(JSON.parse(text));
  } catch {
    return null;
  }
  if (!notebook || notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) return null;
  const metadata = record(notebook.metadata);
  const languageInfo = record(metadata?.language_info);
  const kernel = record(metadata?.kernelspec);
  const language = languageInfo?.name ?? kernel?.language;
  const cells: NotebookCell[] = [];
  for (const item of notebook.cells) {
    const cell = record(item);
    const source = multiline(cell?.source);
    if (
      !cell ||
      source === null ||
      (cell.cell_type !== "markdown" && cell.cell_type !== "code" && cell.cell_type !== "raw")
    )
      return null;
    cells.push({
      kind: cell.cell_type,
      source,
      executionCount: Number.isSafeInteger(cell.execution_count)
        ? Number(cell.execution_count)
        : null,
      outputs: cell.cell_type === "code" ? outputs(cell.outputs) : [],
    });
  }
  return { language: typeof language === "string" ? language : "plaintext", cells };
}
