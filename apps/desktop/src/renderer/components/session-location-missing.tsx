import { useId, useState } from "react";
import {
  useSessionLocationMissing,
  type SessionLocationMissingOptions,
} from "../hooks/use-session-location-missing";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Mount beside the composer; all recovery operations stay on the supplied owner. */
export function SessionLocationMissing(options: SessionLocationMissingOptions) {
  const recovery = useSessionLocationMissing(options);
  return <SessionLocationMissingView options={options} recovery={recovery} />;
}

export function SessionLocationMissingView({
  options,
  recovery,
}: {
  options: SessionLocationMissingOptions;
  recovery: ReturnType<typeof useSessionLocationMissing>;
}) {
  const identity = JSON.stringify([
    options.owner?.connectionID,
    options.session.id,
    options.session.location.directory,
  ]);
  const [directoryState, setDirectory] = useState<{ identity: string; value: string } | null>(null);
  const directory = directoryState?.identity === identity ? directoryState.value : "";
  const listID = useId();
  if (!recovery.missing) return null;
  return (
    <section
      aria-label="Missing workspace"
      className="space-y-3 rounded-lg border bg-card p-3 text-sm"
    >
      <div>
        <h2 className="font-medium">This workspace is missing</h2>
        <p className="break-all text-meta text-muted-foreground">
          {options.session.location.directory}
        </p>
        <p className="text-meta text-muted-foreground">
          Choose another existing directory on this server, or create a new worktree from the
          project's saved checkout.
        </p>
      </div>
      <form
        className="flex min-w-0 flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void recovery.recover({ type: "existing", directory });
        }}
      >
        <Input
          className="min-w-0 flex-1"
          aria-label="Existing directory"
          placeholder="Existing checkout or directory"
          list={listID}
          value={directory}
          disabled={recovery.pending}
          onChange={(event) => setDirectory({ identity, value: event.target.value })}
        />
        <datalist id={listID}>
          {recovery.directories.map((entry) => (
            <option key={entry.directory} value={entry.directory} />
          ))}
        </datalist>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={recovery.pending || !directory.trim()}
        >
          Use directory
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={recovery.pending || !recovery.canCreate}
          onClick={() => void recovery.recover({ type: "create" })}
        >
          Create new worktree
        </Button>
        {recovery.pending ? (
          <Button type="button" variant="ghost" size="sm" onClick={recovery.cancel}>
            Cancel
          </Button>
        ) : null}
      </form>
      {recovery.pending ? (
        <p role="status" className="text-meta text-muted-foreground">
          Recovering workspace… Cancel stops waiting; work already started on the server may finish.
        </p>
      ) : null}
      {recovery.loadingDirectories ? (
        <p role="status" className="text-meta text-muted-foreground">
          Loading existing checkouts…
        </p>
      ) : null}
      {recovery.directoriesError ? (
        <p className="text-meta text-muted-foreground">
          Could not list checkouts. You can still enter an existing directory.
        </p>
      ) : null}
      {recovery.error ? (
        <p role="alert" className="text-meta text-destructive">
          {recovery.error}
        </p>
      ) : null}
    </section>
  );
}
