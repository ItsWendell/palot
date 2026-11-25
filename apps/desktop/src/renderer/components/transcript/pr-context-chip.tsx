import { Check, Copy, GitPullRequest } from "lucide-react";
import { useState } from "react";
import { writeClipboardText } from "../../lib/clipboard";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * A sent PR repair context, compact in the message. Pressing it shows the exact text the
 * message supplied to the agent.
 */
export function PrContextChip({ label, source }: { label: string; source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-pr-context-chip=""
            className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-xs text-foreground outline-none transition-colors hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Pull request context: ${label}. Show the text it supplied`}
          />
        }
      >
        <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(36rem,90vw)] gap-2" aria-label={label}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-compact font-medium">{label}</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              void writeClipboardText(source);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre
          className="palot-native-scrollbar max-h-80 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-code-compact whitespace-pre-wrap text-foreground"
          aria-label="Text sent to the agent"
        >
          {source}
        </pre>
      </PopoverContent>
    </Popover>
  );
}
