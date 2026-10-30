import { useState } from "react";
import { HighlightedCode } from "../highlighted-code";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import type { NotebookPreviewData } from "./notebook-preview-model";

export function NotebookPreview({ notebook }: { notebook: NotebookPreviewData }) {
  const [visible, setVisible] = useState(20);
  return (
    <>
      <p className="shrink-0 border-b px-3 py-2 text-meta text-muted-foreground">
        {notebook.cells.length.toLocaleString()} cells · {notebook.language} · Saved outputs only.
        Code is never executed.
      </p>
      <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          {notebook.cells.slice(0, visible).map((cell, index) => (
            <section
              key={index}
              aria-label={`Cell ${index + 1}`}
              className="min-w-0 overflow-hidden rounded-md border"
            >
              <div className="border-b bg-muted px-3 py-1.5 text-meta text-muted-foreground">
                {cell.kind === "code" ? `In [${cell.executionCount ?? " "}]:` : cell.kind} · Cell{" "}
                {index + 1}
              </div>
              {cell.kind === "markdown" ? (
                <MarkdownContent value={cell.source} className="p-4" />
              ) : cell.kind === "code" ? (
                <HighlightedCode
                  code={cell.source}
                  language={notebook.language}
                  ariaLabel={`Cell ${index + 1} code`}
                  className="overflow-x-auto p-4"
                />
              ) : (
                <pre className="overflow-x-auto p-4 font-mono text-code-compact whitespace-pre-wrap">
                  {cell.source}
                </pre>
              )}
              {cell.outputs.map((output, outputIndex) => (
                <div key={outputIndex} className="border-t p-4">
                  {output.kind === "image" ? (
                    <img
                      src={output.text}
                      alt={`Cell ${index + 1} output`}
                      loading="lazy"
                      className="max-h-96 max-w-full object-contain"
                    />
                  ) : (
                    <>
                      {output.kind === "html" ? (
                        <p className="mb-2 text-meta text-muted-foreground">HTML output (source)</p>
                      ) : null}
                      <pre className="overflow-x-auto font-mono text-code-compact whitespace-pre-wrap break-words">
                        {output.text}
                      </pre>
                    </>
                  )}
                </div>
              ))}
            </section>
          ))}
          {notebook.cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">This notebook is empty.</p>
          ) : null}
          {visible < notebook.cells.length ? (
            <Button variant="outline" size="sm" onClick={() => setVisible((count) => count + 20)}>
              Show more cells ({notebook.cells.length - visible} remaining)
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
