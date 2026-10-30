import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PalotModel } from "../../shared";
import type { ModelTaskResult } from "../lib/composer-multi-model";
import { openCodeClient } from "../services/opencode-client";
import { Button } from "./ui/button";
import { CheckList } from "./ui/check-list";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

export function ComposerMultiModelDialog({
  models,
  connectionID,
  busy,
  onSend,
  onClose,
  onOpenTask,
}: {
  models: PalotModel[];
  connectionID: string;
  busy: boolean;
  onSend(models: PalotModel[]): Promise<ModelTaskResult[]>;
  onClose(): void;
  onOpenTask(sessionID: string): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModelTaskResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = (model: PalotModel) => JSON.stringify([model.providerID, model.id]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className={results ? "sm:max-w-4xl" : "sm:max-w-lg"} showCloseButton={!busy}>
        <DialogTitle>{results ? "Compare models" : "Send to several models…"}</DialogTitle>
        <DialogDescription>
          {results
            ? "Sibling tasks share a title prefix in the Inbox. Open a task to continue it."
            : "Choose 2–4 models. Each gets the same prompt, context, agent and approvals in a new task, using your selected workspace mode."}
        </DialogDescription>
        {results ? (
          <div
            className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2"
            aria-label="Model comparison"
          >
            {results.map((result) => (
              <section
                key={key(result.model)}
                className="min-w-0 rounded-lg border border-border p-3"
              >
                <h3 className="text-sm font-medium">{result.model.name}</h3>
                <p className="text-meta text-muted-foreground">{result.model.providerID}</p>
                {result.error ? (
                  <p role="alert" className="text-compact text-destructive">
                    {result.error} Check the task before sending again.
                  </p>
                ) : null}
                {result.session ? (
                  <>
                    <ComparisonReply
                      sessionID={result.session.id}
                      connectionID={connectionID}
                      sent={result.sent}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenTask(result.session!.id)}
                    >
                      Open {result.model.name} task
                    </Button>
                  </>
                ) : null}
              </section>
            ))}
          </div>
        ) : (
          <>
            <Input
              aria-label="Search comparison models"
              placeholder="Search models…"
              value={query}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
            />
            <CheckList
              aria-label="Comparison models"
              className="max-h-72 overflow-y-auto"
              value={selected}
              disabled={busy}
              onValueChange={setSelected}
              options={models
                .filter((model) =>
                  `${model.providerID} ${model.name}`.toLowerCase().includes(query.toLowerCase()),
                )
                .map((model) => ({
                  value: key(model),
                  label: model.name,
                  description: model.providerID,
                  disabled: selected.length >= 4 && !selected.includes(key(model)),
                  disabledReason:
                    selected.length >= 4 && !selected.includes(key(model))
                      ? "Choose up to four models"
                      : undefined,
                }))}
            />
            {error ? (
              <p role="alert" className="text-compact text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              disabled={busy || selected.length < 2}
              onClick={async () => {
                try {
                  setError(null);
                  setResults(await onSend(models.filter((model) => selected.includes(key(model)))));
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Could not create the tasks.");
                }
              }}
            >
              {busy ? "Creating tasks…" : `Send to ${selected.length} models`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComparisonReply({
  sessionID,
  connectionID,
  sent,
}: {
  sessionID: string;
  connectionID: string;
  sent: boolean;
}) {
  const response = useQuery({
    queryKey: ["composer-model-comparison", connectionID, sessionID],
    queryFn: async ({ signal }) => {
      const page = await openCodeClient(connectionID).message.list(
        { sessionID, limit: 100 },
        { signal },
      );
      const messages = page.data;
      return {
        text: messages
          .flatMap((message) =>
            message.type === "assistant"
              ? message.content.filter((part) => part.type === "text").map((part) => part.text)
              : [],
          )
          .join("\n\n"),
        complete: messages.some((message) => message.type === "idle"),
      };
    },
    refetchInterval: (query) => (query.state.data?.complete ? false : 2_000),
    enabled: sent,
  });
  return (
    <p
      className="my-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-compact"
      aria-live="polite"
    >
      {response.error
        ? "Could not load the reply. Open the task to inspect it."
        : response.data?.text || (sent ? "Waiting for the model…" : "Not confirmed sent")}
    </p>
  );
}
