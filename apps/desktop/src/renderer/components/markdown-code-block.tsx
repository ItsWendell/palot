import { Check, Copy } from "lucide-react";
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

  return (
    <div className="group/markdown-code relative">
      {filename ? <div className="markdown-code-filename">{filename}</div> : null}
      <IconButton
        label={copied ? "Copied" : "Copy code"}
        className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/markdown-code:opacity-100 focus-visible:opacity-100"
        onClick={() => void copy(code, "code")}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </IconButton>
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
          streaming={streaming}
          animationRanges={animationRanges}
          lineNumbers={lineNumbers}
          highlightLines={highlightLines}
        />
      )}
    </div>
  );
}
