import { useAtom } from "jotai";
import { useState } from "react";
import {
  automaticWorktreeCleanupAtom,
  worktreeBranchPrefixAtom,
  worktreeCleanupLogAtom,
} from "../../atoms/worktree-preferences";
import { useWorktreeCleanup } from "../../hooks/use-worktree-cleanup";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";

export function WorktreeCleanupControls() {
  const [enabled, setEnabled] = useAtom(automaticWorktreeCleanupAtom);
  const [prefix, setPrefix] = useAtom(worktreeBranchPrefixAtom);
  const [entries] = useAtom(worktreeCleanupLogAtom);
  const cleanup = useWorktreeCleanup();
  const [result, setResult] = useState<string | null>(null);
  const confirm = useArmedConfirm(() => {
    setResult(null);
    void cleanup
      .run()
      .then(({ removed, kept }) =>
        setResult(`Retired ${removed} worktrees; kept ${kept} that did not pass safety checks.`),
      )
      .catch((error: unknown) =>
        setResult(error instanceof Error ? error.message : "Cleanup failed."),
      );
  });
  return (
    <section
      aria-label="Worktree preferences"
      className="mb-5 flex flex-col gap-3 rounded-xl border bg-card/45 p-4"
    >
      <label className="flex items-center gap-3 text-sm">
        <span className="flex-1">New branch prefix</span>
        <Input
          aria-label="New branch prefix"
          className="w-40"
          maxLength={100}
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
          aria-label="Automatically retire merged worktrees"
        />
        Automatically retire merged worktrees
      </label>
      <p className="text-meta text-muted-foreground">
        Off by default. While Palot is open on a local connection, checks all its projects every
        minute. Only removes managed worktrees whose linked PRs have merged, with no running tasks,
        uncommitted changes or unmerged commits. Task history stays. The main checkout is never
        removed.
      </p>
      <Button
        className="self-start"
        size="sm"
        variant="outline"
        disabled={cleanup.busy}
        {...confirm.buttonProps}
      >
        {cleanup.busy
          ? "Checking worktrees…"
          : confirm.armed
            ? "Confirm cleanup now"
            : "Run cleanup now"}
      </Button>
      {result ? (
        <p role="status" className="text-meta text-muted-foreground">
          {result}
        </p>
      ) : null}
      {entries.length ? (
        <details>
          <summary className="cursor-pointer text-meta text-muted-foreground">
            Cleanup log ({entries.length})
          </summary>
          <ul className="mt-2 max-h-48 overflow-auto text-meta text-muted-foreground">
            {entries.map((entry) => (
              <li className="break-all" key={`${entry.at}:${entry.directory}`}>
                {new Date(entry.at).toLocaleString()} · {entry.directory} · {entry.pullRequest}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
