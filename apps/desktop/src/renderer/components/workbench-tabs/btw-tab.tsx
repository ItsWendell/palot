import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import {
  btwFocusRequestAtom,
  btwPendingAtom,
  btwRequestKey,
  cancelBtw,
  retryBtw,
  submitBtwQuestion,
} from "../../atoms/btw";
import { transcriptJumpTargetAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import {
  BTW_FOLLOW_UP_LIMIT,
  BTW_QUOTE_LIMIT,
  btwExchanges,
  type BtwExchange,
  type BtwTab as BtwWorkbenchTab,
} from "../../lib/btw";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

export function BtwTab({ tab }: { tab: BtwWorkbenchTab }) {
  const store = useStore();
  const pending = useAtomValue(btwPendingAtom).has(btwRequestKey(tab.resource, tab.id));
  const runtime = useAtomValue(runtimeAtom);
  const canAsk = runtime?.connected && runtime.profileID === tab.resource.profileID;
  const exchanges = btwExchanges(tab.resource);
  const last = exchanges.at(-1);
  const followUps = tab.resource.followUps?.length ?? 0;
  const atLimit = last?.answer !== undefined && followUps >= BTW_FOLLOW_UP_LIMIT;
  // A failed question offers Retry instead; the field stays while answering so focus does.
  const showForm = last ? last.answer !== undefined || pending : Boolean(tab.resource.quote);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <header className="space-y-2">
        <p className="text-meta text-muted-foreground">
          Side question · Not added to the conversation
        </p>
        {tab.resource.quote ? <BtwQuoteView tab={tab} /> : null}
      </header>
      {exchanges.map((exchange, index) => (
        <BtwExchangeView
          key={exchange.id}
          exchange={exchange}
          heading={index === 0}
          pending={pending && exchange === last}
          retry={
            exchange === last && !pending
              ? {
                  disabled: !canAsk,
                  onRetry: () => {
                    if (canAsk) retryBtw(store, tab.resource, tab.id, runtime.connectionID);
                  },
                }
              : null
          }
          onStop={() => cancelBtw(store, tab.resource, tab.id)}
        />
      ))}
      {atLimit ? (
        <p className="text-meta text-muted-foreground">
          This side chat has reached its follow-up limit. Ask a new side question to continue.
        </p>
      ) : showForm ? (
        <BtwQuestionForm
          tab={tab}
          first={!last}
          pending={pending}
          disabledReason={canAsk ? null : "Connect to this task’s server to ask."}
          onAsk={(question) => {
            if (!canAsk) throw new Error("Connect to this task’s server to ask.");
            submitBtwQuestion(store, tab.resource, tab.id, runtime.connectionID, question);
          }}
        />
      ) : null}
    </div>
  );
}

function BtwQuoteView({ tab }: { tab: BtwWorkbenchTab }) {
  const quote = tab.resource.quote!;
  const setJumpTarget = useSetAtom(transcriptJumpTargetAtom);
  return (
    <figure className="space-y-1.5">
      <blockquote className="max-h-48 overflow-auto border-l-2 border-border pl-3 text-sm whitespace-pre-wrap break-words text-muted-foreground">
        {quote.text}
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
        <span>
          Selected from a response
          {quote.truncated ? ` · Shortened to ${BTW_QUOTE_LIMIT.toLocaleString()} characters` : ""}
        </span>
        <Button
          type="button"
          variant="link"
          size="context"
          className="h-auto px-0"
          onClick={() =>
            setJumpTarget({
              sessionID: tab.resource.sessionID,
              // The response itself; its prompt loads earlier history when needed.
              messageID: quote.messageID,
              ...(quote.turnMessageID ? { fallbackMessageID: quote.turnMessageID } : {}),
            })
          }
        >
          Show in conversation
        </Button>
      </figcaption>
    </figure>
  );
}

function BtwExchangeView({
  exchange,
  heading,
  pending,
  retry,
  onStop,
}: {
  exchange: BtwExchange;
  heading: boolean;
  pending: boolean;
  retry: { disabled: boolean; onRetry(): void } | null;
  onStop(): void;
}) {
  const Question = heading ? "h2" : "h3";
  return (
    <section className="space-y-2">
      <Question className="text-sm font-medium whitespace-pre-wrap break-words">
        {exchange.question}
      </Question>
      {pending ? (
        <div className="flex items-center gap-2">
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner role="presentation" aria-hidden="true" /> Answering…
          </div>
          <Button type="button" variant="ghost" size="xs" onClick={onStop}>
            Stop
          </Button>
        </div>
      ) : exchange.answer !== undefined ? (
        <MarkdownContent value={exchange.answer} passiveMedia />
      ) : retry ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-muted-foreground">
            {exchange.error ?? "This question was interrupted. Try again."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={retry.disabled}
            onClick={retry.onRetry}
          >
            Retry
          </Button>
          {retry.disabled ? (
            <p className="text-meta text-muted-foreground">
              Connect to this task’s server to retry.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function BtwQuestionForm({
  tab,
  first,
  pending,
  disabledReason,
  onAsk,
}: {
  tab: BtwWorkbenchTab;
  first: boolean;
  pending: boolean;
  disabledReason: string | null;
  onAsk(question: string): void;
}) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useAtom(btwFocusRequestAtom);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const errorID = useId();
  const label = first ? "Question about this selection" : "Ask a follow-up";
  useEffect(() => {
    if (focusRequest !== tab.id) return;
    setFocusRequest(null);
    // Scroll only the side chat, never the transcript behind it.
    fieldRef.current?.focus({ preventScroll: true });
  }, [focusRequest, setFocusRequest, tab.id]);
  const submit = () => {
    if (!question.trim() || pending || disabledReason) return;
    try {
      onAsk(question);
      setQuestion("");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not ask this question.");
    }
  };
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        ref={fieldRef}
        aria-label={label}
        aria-describedby={error ? errorID : undefined}
        aria-invalid={error ? true : undefined}
        placeholder={first ? "What would you like to know about this?" : "Ask a follow-up…"}
        value={question}
        rows={2}
        className="min-h-14"
        onChange={(event) => {
          setQuestion(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta text-muted-foreground">
          {disabledReason ?? "Answered without tools. Not added to the conversation."}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={!question.trim() || pending || Boolean(disabledReason)}
        >
          Ask
        </Button>
      </div>
      {error ? (
        <p id={errorID} role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
