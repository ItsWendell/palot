import { Check, Copy, WrapText, Terminal, AppWindow } from "lucide-react";
import { useContext, useState } from "react";
import { useAtom } from "jotai";
import { markdownCodeWrapAtom } from "../atoms/markdown-preferences";
import { MarkdownActionsContext } from "./markdown-actions";
import { showErrorToast } from "../lib/toast-error";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { IconButton } from "./ui";
import { HighlightedCode, type CodeAnimationRange } from "./highlighted-code";
import { MermaidDiagram } from "./markdown-rich";

export function MarkdownCodeBlock({
  code,
  language,
  streaming = false,
  animationRanges,
  filename,
  lineNumbers = false,
  highlightLines,
}: {
  code: string;
  language: string;
  streaming?: boolean;
  animationRanges?: readonly CodeAnimationRange[];
  filename?: string;
  lineNumbers?: boolean;
  highlightLines?: readonly number[];
}) {
  const { copiedKey, copy } = useClipboardCopy();
  const copied = copiedKey === "code";
  const [wrap, setWrap] = useAtom(markdownCodeWrapAtom);
  const [running, setRunning] = useState(false);
  const actions = useContext(MarkdownActionsContext);
  const shell = ["sh", "bash", "zsh", "shell", "console", "fish", "powershell"].includes(
    language.toLowerCase(),
  );

  return (
    <div className="group/markdown-code relative" data-code-wrap={wrap}>
      {filename ? <div className="markdown-code-filename">{filename}</div> : null}
      <div className="absolute top-2 right-2 z-10 flex gap-0.5 rounded-md bg-code-background opacity-0 transition-opacity group-hover/markdown-code:opacity-100 focus-within:opacity-100">
        <IconButton
          label={wrap ? "Unwrap code" : "Wrap code"}
          aria-pressed={wrap}
          onClick={() => setWrap((current) => !current)}
        >
          <WrapText aria-hidden="true" />
        </IconButton>
        {shell && actions.runCode ? (
          <IconButton
            label="Paste into terminal without executing. Press Enter to run."
            aria-label="Run in terminal"
            title="Paste into the task terminal without executing. Press Enter to run."
            disabled={streaming || running}
            onClick={() => {
              setRunning(true);
              void actions.runCode!(code)
                .catch((error: unknown) => showErrorToast("Could not paste command", error))
                .finally(() => setRunning(false));
            }}
          >
            <Terminal aria-hidden="true" />
          </IconButton>
        ) : null}
        {language.toLowerCase() === "html" && actions.previewHTML ? (
          <IconButton
            label="Preview HTML"
            disabled={streaming}
            onClick={() => actions.previewHTML!(code)}
          >
            <AppWindow aria-hidden="true" />
          </IconButton>
        ) : null}
        <IconButton label={copied ? "Copied" : "Copy code"} onClick={() => void copy(code, "code")}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </IconButton>
      </div>
      {language.toLowerCase() === "mermaid" && !streaming ? (
        <MermaidDiagram code={code} />
      ) : (
        <HighlightedCode
          code={code}
          language={language}
          className={
            language.toLowerCase() === "mermaid"
              ? "markdown-highlight markdown-mermaid-streaming"
              : "markdown-highlight"
          }
          wrap={wrap}
          streaming={streaming}
          animationRanges={animationRanges}
          lineNumbers={lineNumbers}
          highlightLines={highlightLines}
        />
      )}
    </div>
  );
}
