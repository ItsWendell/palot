import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PullRequestDetail } from "../../../shared/source-control-contract";
import {
  sourceControl,
  useEditPullRequest,
  useSetPullRequestAutoMerge,
  useSetPullRequestLabel,
  useUpdatePullRequestBranch,
} from "../../hooks/use-source-control";
import { Button } from "../ui/button";
import { CheckList } from "../ui/check-list";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { refOf } from "./pull-request-actions";
import { sourceControlErrorMessage } from "./pull-request-presentation";
import { useArmedConfirm } from "./use-armed-confirm";

export function PullRequestEdit({ detail }: { detail: PullRequestDetail }) {
  const edit = useEditPullRequest();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!detail.viewer.canUpdate || detail.capabilities?.edit === false}
        title={
          detail.capabilities?.edit === false
            ? "Editing is not supported for this host in Palot yet."
            : undefined
        }
        onClick={() => {
          setTitle(detail.title);
          setBody(detail.body);
          edit.reset();
          setOpen(true);
        }}
      >
        Edit title and description
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit pull request</DialogTitle>
            <DialogDescription>
              Updates the title and description on your code host.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void edit
                .mutateAsync({ ...refOf(detail), title, body })
                .then(() => setOpen(false))
                .catch(() => undefined);
            }}
          >
            <Input
              autoFocus
              aria-label="Pull request title"
              maxLength={256}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Textarea
              aria-label="Pull request description"
              rows={10}
              maxLength={65536}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            {edit.error ? (
              <p role="alert" className="text-meta text-destructive">
                {sourceControlErrorMessage(edit.error)}
              </p>
            ) : null}
            <Button type="submit" disabled={!title.trim() || edit.isPending}>
              Save pull request
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PullRequestLabelPicker({ detail }: { detail: PullRequestDetail }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const labels = useQuery({
    queryKey: ["source-control", "repo-labels", detail.host, detail.repository],
    queryFn: () => sourceControl.pullRequestLabels(refOf(detail)),
    enabled: open,
    staleTime: 60_000,
  });
  const mutation = useSetPullRequestLabel();
  const selected = detail.labels.map((label) => label.name);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={!detail.viewer.canUpdate || detail.capabilities?.labels === false}
            title={
              detail.capabilities?.labels === false
                ? "Editing labels is not supported for this host in Palot yet."
                : undefined
            }
          />
        }
      >
        Edit labels
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label="Repository labels">
        <Input
          aria-label="Search labels"
          placeholder="Search labels…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-64 overflow-auto">
          <CheckList
            aria-label="Repository labels"
            disabled={mutation.isPending}
            options={(labels.data ?? [])
              .filter((label) => label.name.toLowerCase().includes(search.toLowerCase()))
              .map((label) => ({ value: label.name, label: label.name }))}
            value={selected}
            onValueChange={(next) => {
              const name =
                next.find((value) => !selected.includes(value)) ??
                selected.find((value) => !next.includes(value));
              if (name) mutation.mutate({ ...refOf(detail), name, add: next.includes(name) });
            }}
          />
        </div>
        {labels.isPending ? <p className="text-meta">Loading labels…</p> : null}
        {labels.error || mutation.error ? (
          <p role="alert" className="text-meta text-destructive">
            {sourceControlErrorMessage(labels.error ?? mutation.error)}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function PullRequestBranchActions({
  detail,
  method,
}: {
  detail: PullRequestDetail;
  method: "merge" | "squash" | "rebase" | null;
}) {
  const auto = useSetPullRequestAutoMerge();
  const update = useUpdatePullRequestBranch();
  const busy = auto.isPending || update.isPending;
  // Enabling auto-merge can merge immediately, so it shares the irreversible-action contract.
  const enable = useArmedConfirm(() => {
    if (method) auto.mutate({ ...refOf(detail), enabled: true, method });
  });
  const updateConfirm = useArmedConfirm(() =>
    update.mutate({ ...refOf(detail), expectedHeadOid: detail.headOid }),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {detail.autoMerge ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !detail.viewer.canMerge}
            onClick={() =>
              auto.mutate({ ...refOf(detail), enabled: false, method: detail.autoMerge!.method })
            }
          >
            Disable auto-merge
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              !detail.autoMergeAllowed ||
              !detail.viewer.canMerge ||
              !method ||
              detail.state !== "open"
            }
            {...enable.buttonProps}
          >
            {enable.armed ? "Confirm enable auto-merge" : "Enable auto-merge"}
          </Button>
        )}
        {detail.mergeState === "behind" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || !detail.viewer.canUpdate || detail.capabilities?.updateBranch === false
            }
            title={
              detail.capabilities?.updateBranch === false
                ? "Updating branches is not supported by this host integration."
                : undefined
            }
            {...updateConfirm.buttonProps}
          >
            {updateConfirm.armed ? "Confirm update branch" : "Update branch"}
          </Button>
        ) : null}
      </div>
      {!detail.autoMergeAllowed ? (
        <p className="text-meta text-muted-foreground">
          Auto-merge is unavailable for this repository.
        </p>
      ) : null}
      {auto.error || update.error ? (
        <p role="alert" className="text-meta text-destructive">
          {sourceControlErrorMessage(auto.error ?? update.error)}
        </p>
      ) : null}
    </div>
  );
}
