import { useAtomValue, useStore } from "jotai";
import { btwPendingAtom, btwRequestKey, retryBtw } from "../../atoms/btw";
import { runtimeAtom } from "../../atoms/workspace";
import type { BtwTab as BtwWorkbenchTab } from "../../lib/btw";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

export function BtwTab({ tab }: { tab: BtwWorkbenchTab }) {
  const store = useStore();
  const pending = useAtomValue(btwPendingAtom).has(btwRequestKey(tab.resource, tab.id));
  const runtime = useAtomValue(runtimeAtom);
  const canRetry = runtime?.connected && runtime.profileID === tab.resource.profileID;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <header className="space-y-2">
        <p className="text-meta text-muted-foreground">
          Side question · Not added to the conversation
        </p>
        <h2 className="text-sm font-medium whitespace-pre-wrap break-words">
          {tab.resource.question}
        </h2>
      </header>
      {pending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner role="presentation" aria-hidden="true" /> Answering…
        </div>
      ) : tab.resource.answer !== undefined ? (
        <MarkdownContent value={tab.resource.answer} passiveMedia />
      ) : (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-muted-foreground">
            {tab.resource.error ?? "This question was interrupted. Try again."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canRetry}
            onClick={() => {
              if (canRetry) retryBtw(store, tab.resource, tab.id, runtime.connectionID);
            }}
          >
            Retry
          </Button>
          {!canRetry ? (
            <p className="text-meta text-muted-foreground">
              Connect to this task’s server to retry.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
