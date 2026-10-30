import { describe, expect, it } from "vitest";
import { parseNotebookPreview } from "./notebook-preview-model";

describe("saved notebook output parsing", () => {
  it("joins source arrays, records counts and handles text, ANSI errors and whitelisted images", () => {
    const notebook = parseNotebookPreview(
      JSON.stringify({
        nbformat: 4,
        metadata: { language_info: { name: "python" } },
        cells: [
          {
            cell_type: "code",
            source: ["print(", "1)"],
            execution_count: 7,
            outputs: [
              { output_type: "stream", text: ["hello", "\n"] },
              { output_type: "error", traceback: ["\u001b[31mValueError\u001b[0m", "bad value"] },
              { output_type: "execute_result", data: { "text/plain": ["42"] } },
              { output_type: "display_data", data: { "image/png": ["aGVs", "bG8=\n"] } },
              { output_type: "display_data", data: { "image/jpeg": "aGVsbG8=" } },
              { output_type: "display_data", data: { "text/html": "<script>bad()</script>" } },
              { output_type: "display_data", data: { "image/svg+xml": "<svg onload='bad()'/>" } },
              { output_type: "display_data", data: { "image/png": "data:text/html,<script>" } },
            ],
          },
        ],
      }),
    );
    expect(notebook).toEqual({
      language: "python",
      cells: [
        {
          kind: "code",
          source: "print(1)",
          executionCount: 7,
          outputs: [
            { kind: "text", text: "hello\n" },
            { kind: "text", text: "ValueError\nbad value" },
            { kind: "text", text: "42" },
            { kind: "image", text: "data:image/png;base64,aGVsbG8=" },
            { kind: "image", text: "data:image/jpeg;base64,aGVsbG8=" },
            { kind: "html", text: "<script>bad()</script>" },
          ],
        },
      ],
    });
  });
});
