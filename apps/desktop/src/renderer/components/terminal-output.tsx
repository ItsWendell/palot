import type { CSSProperties } from "react";
import type { TerminalTextRun } from "../lib/terminal-output";

export function TerminalOutput({
  output,
  terminal,
}: {
  output: string | null;
  terminal: TerminalTextRun[] | null;
}) {
  return (
    <>
      {terminal
        ? terminal.map((run, index) => (
            <span key={index} style={terminalRunStyle(run)}>
              {run.text}
            </span>
          ))
        : output}
    </>
  );
}

function terminalRunStyle(run: TerminalTextRun): CSSProperties {
  return {
    color: run.color,
    backgroundColor: run.backgroundColor,
    fontWeight: run.bold ? 700 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.65 : undefined,
    textDecoration:
      run.underline && run.strikethrough
        ? "underline line-through"
        : run.underline
          ? "underline"
          : run.strikethrough
            ? "line-through"
            : undefined,
  };
}
