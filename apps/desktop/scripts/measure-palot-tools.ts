/**
 * Measures the text Palot's agent tools add to every model turn.
 * Run: bun apps/desktop/scripts/measure-palot-tools.ts [--json]
 */
import { palotTools, type PalotToolContext } from "../src/main/palot-tools/tools";

// Same shape as `tools/list` in @opencode/client/mcp. Building the list never calls the context.
const listed = palotTools({} as PalotToolContext).map((tool) => ({
  name: tool.name,
  description: tool.description ?? "",
  inputSchema: { type: "object", ...tool.inputSchema },
}));

/** Characters in every nested `description` string, such as parameter descriptions. */
function describedChars(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + describedChars(item), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (total, [key, item]) =>
      total +
      (key === "description" && typeof item === "string" ? item.length : describedChars(item)),
    0,
  );
}

const columns = ["description", "schema", "text", "total"] as const;
type Row = { name: string; tokens: number } & Record<(typeof columns)[number], number>;

const rows: Row[] = listed.map((tool) => {
  const total = JSON.stringify(tool).length;
  return {
    name: tool.name,
    description: tool.description.length,
    schema: JSON.stringify(tool.inputSchema).length,
    text: tool.description.length + describedChars(tool.inputSchema),
    total,
    tokens: Math.round(total / 4),
  };
});
const totals: Row = {
  name: `TOTAL (${rows.length} tools)`,
  ...(Object.fromEntries(
    columns.map((key) => [key, rows.reduce((total, row) => total + row[key], 0)]),
  ) as Record<(typeof columns)[number], number>),
  tokens: 0,
};
totals.tokens = Math.round(totals.total / 4);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ tools: rows, totals }, null, 2));
} else {
  const header = ["tool", "description", "schema", "text", "total JSON", "~tokens"];
  const lines = [...rows, totals].map((row) => [
    row.name,
    ...columns.map((key) => String(row[key])),
    String(row.tokens),
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...lines.map((line) => line[index]!.length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => (index ? cell.padStart(widths[index]!) : cell.padEnd(widths[index]!)))
      .join("  ");
  console.log(format(header));
  for (const line of lines.slice(0, -1)) console.log(format(line));
  console.log(format(widths.map((width) => "-".repeat(width))));
  console.log(format(lines.at(-1)!));
  console.log(
    [
      "",
      "Characters as sent in tools/list. description: the tool description. schema: inputSchema as",
      "compact JSON. text: the tool description plus every description inside the schema.",
      "total JSON: the whole tool entry (name, description, inputSchema).",
      "~tokens is an approximation (total JSON characters / 4), not a tokenizer count.",
    ].join("\n"),
  );
}
