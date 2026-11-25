import { FileCode2, Globe } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "../../lib/cn";
import { quoteLocation, type MessageQuote } from "../../lib/inline-quotes";

/** Opens what a quote points at: the file or diff at its lines, or the commented page. */
export type MessageQuoteOpener = (quote: MessageQuote, event: React.MouseEvent) => void;

export const MessageQuoteOpenerContext = createContext<MessageQuoteOpener | null>(null);

/** A sent message's review and browser comments, one compact chip each, under its text. */
export function UserMessageQuotes({
  quotes,
  className,
}: {
  quotes: readonly MessageQuote[];
  className?: string;
}) {
  return (
    <ul
      className={cn("flex max-w-full flex-col items-end gap-1.5", className)}
      aria-label={quotes.length === 1 ? "Comment" : `${quotes.length} comments`}
      data-user-message-quotes=""
    >
      {quotes.map((quote, index) => (
        <li key={index} className="flex max-w-full min-w-0 justify-end">
          <QuoteChip quote={quote} />
        </li>
      ))}
    </ul>
  );
}

const CHIP_CLASS =
  "flex max-w-md min-w-0 flex-col items-start gap-0.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-left text-xs";

function QuoteChip({ quote }: { quote: MessageQuote }) {
  const open = useContext(MessageQuoteOpenerContext);
  const review = quote.kind === "review";
  const location = review ? quoteLocation(quote) : quote.label;
  const Icon = review ? FileCode2 : Globe;
  const content = (
    <>
      <span className="flex max-w-full min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span
          className={cn("min-w-0 truncate", review && "font-mono text-code-compact")}
          data-quote-location=""
        >
          {location}
        </span>
        {review && quote.removed ? (
          <span
            className="shrink-0 rounded-sm bg-destructive/10 px-1 text-tag text-destructive"
            title="Removed lines, numbered in the version before the change"
          >
            removed
          </span>
        ) : null}
      </span>
      {quote.comment ? (
        <span className="line-clamp-4 max-w-full whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
          {quote.comment}
        </span>
      ) : null}
    </>
  );
  const target = review
    ? `${quote.removed ? "the change to " : ""}${location}`
    : `${quote.label} at ${quote.url}`;
  if (!open) {
    return (
      <div className={CHIP_CLASS} title={review ? undefined : quote.url} data-message-quote="">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        CHIP_CLASS,
        "cursor-pointer outline-none transition-colors hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={review ? undefined : quote.url}
      aria-label={`Open ${target}. Comment: ${quote.comment}`}
      data-message-quote=""
      onClick={(event) => open(quote, event)}
    >
      {content}
    </button>
  );
}
