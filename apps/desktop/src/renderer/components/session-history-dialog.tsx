import { useMemo, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotMessage, PalotSession } from "../../shared";
import { userPromptHistory, promptHistoryLabel } from "../lib/session-history";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { useSessionFork } from "../hooks/use-session-fork";
import { showErrorToast } from "../lib/toast-error";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function SessionHistoryDialog({
  messages,
  mode,
  onClose,
  onSelect,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  messages: PalotMessage[];
  mode: "timeline" | "fork";
  onClose(): void;
  onSelect(message: PalotMessage): void | Promise<void>;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  onLoadMore(): void;
}) {
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const prompts = useMemo(() => userPromptHistory(messages), [messages]);
  const matches = useMemo(
    () =>
      prompts
        .filter((message) =>
          promptHistoryLabel(message).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .toReversed(),
    [prompts, search],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !selecting) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "fork" ? "Fork from prompt" : "Prompt timeline"}</DialogTitle>
          <DialogDescription>
            {mode === "fork"
              ? "Copy history before a prompt and restore it as an unsent, editable draft. File comments become text; unavailable attachments are noted."
              : "Find a user prompt and jump to its turn."}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search prompts"
          placeholder="Search prompts…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <p role="status" className="text-meta text-muted-foreground">
          {loading
            ? "Loading earlier prompts…"
            : hasMore
              ? `Searching ${prompts.length} loaded prompts. Earlier history is not searched yet.`
              : `Searching all ${prompts.length} prompts.`}
        </p>
        <div
          className="flex min-h-0 max-h-80 flex-col gap-1 overflow-y-auto"
          aria-label="Prompt results"
        >
          {matches.map((message) => (
            <Button
              key={message.id}
              variant="ghost"
              className="h-auto justify-start gap-3 py-2 text-left"
              disabled={selecting}
              onClick={() => {
                setSelecting(true);
                void Promise.resolve()
                  .then(() => onSelect(message))
                  .catch((cause) => showErrorToast("Could not open prompt", cause))
                  .finally(() => setSelecting(false));
              }}
            >
              <span className="min-w-0 flex-1 truncate">{promptHistoryLabel(message)}</span>
              <span className="shrink-0 text-meta text-muted-foreground">
                {new Date(message.createdAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </Button>
          ))}
          {!matches.length ? (
            <p className="p-3 text-sm text-muted-foreground">
              {hasMore
                ? "No matching loaded prompts. Load earlier history to search more."
                : "No matching prompts."}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-meta">
            Could not load earlier prompts. Try again.
          </p>
        ) : null}
        {hasMore || error ? (
          <Button variant="outline" disabled={loading || selecting} onClick={onLoadMore}>
            {error ? "Retry loading history" : "Load earlier prompts"}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mount only while open: context menus do not eagerly hydrate every task. */
export function SessionForkHistoryDialog({
  session,
  owner,
  onClose,
}: {
  session: PalotSession;
  owner?: OpenCodeRuntimeStatus | null;
  onClose(): void;
}) {
  const transcript = useSessionTranscript(session, owner);
  const fork = useSessionFork(owner);
  return (
    <SessionHistoryDialog
      mode="fork"
      messages={transcript.messages}
      onClose={onClose}
      loading={transcript.isPending || transcript.isFetchingNextPage || transcript.isHydrating}
      hasMore={transcript.hasNextPage}
      error={Boolean(transcript.error)}
      onLoadMore={() => {
        void transcript.fetchNextPage();
      }}
      onSelect={async (message) => {
        await fork({ sessionID: session.id, beforeMessageID: message.id, restore: message });
        onClose();
      }}
    />
  );
}
