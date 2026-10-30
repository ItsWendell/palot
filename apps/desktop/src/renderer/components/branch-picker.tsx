import { useState } from "react";
import { Copy, GitBranch } from "lucide-react";
import { writeClipboardText } from "../lib/clipboard";
import { showErrorToast } from "../lib/toast-error";
import { useVcsBranches, useVcsInfo } from "../hooks/use-vcs-info";
import { useGitBranch } from "../hooks/use-source-control";
import { Button } from "./ui/button";
import { ComposerPicker } from "./ui/composer-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { toast } from "./ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Branch reads remain OpenCode-owned; only local writes use Palot's Git bridge. */
export function CheckoutBranchPicker({
  directory,
  profileID,
  disabled = false,
}: {
  directory: string;
  profileID: string;
  disabled?: boolean;
}) {
  const location = { directory };
  const info = useVcsInfo(location);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const branches = useVcsBranches(location, search);
  const mutation = useGitBranch();
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = info.data?.currentBranch ?? "Detached HEAD";
  const start = (next: "create" | "rename") => {
    setOpen(false);
    setName(next === "rename" ? (info.data?.currentBranch ?? "") : "");
    setBase("");
    setError(null);
    setMode(next);
  };
  return (
    <>
      <ComposerPicker<string>
        size="context"
        label={current}
        ariaLabel="Change branch"
        icon={<GitBranch aria-hidden="true" />}
        triggerClassName="window-no-drag max-w-40"
        disabled={disabled || mutation.isPending}
        open={open}
        onOpenChange={setOpen}
        title="Branches"
        description="Changing branches affects every task using this checkout. Commit or move uncommitted changes first."
        listLabel="Branches"
        search={{
          label: "Search branches",
          placeholder: "Search branches…",
          query: search,
          onQueryChange: setSearch,
          filter: false,
        }}
        sections={[
          {
            key: "branches",
            options: (branches.data ?? []).map((branch) => ({
              key: branch,
              label: branch,
              value: branch,
            })),
          },
        ]}
        selectedKey={info.data?.currentBranch ?? undefined}
        emptyLabel={branches.error ? "Could not read branches" : "No matching branches"}
        errorTitle="Could not switch branch"
        onSelect={async (option) => {
          await mutation.mutateAsync({
            profileID,
            directory,
            action: "switch",
            name: option.value,
          });
        }}
        footer={
          <div className="flex w-full gap-1">
            <Button size="sm" variant="ghost" onClick={() => start("create")}>
              Create branch…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!info.data?.currentBranch}
              onClick={() => start("rename")}
            >
              Rename branch…
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="ms-auto"
                    aria-label="Copy branch name"
                    disabled={!info.data?.currentBranch}
                    onClick={() => {
                      const branch = info.data?.currentBranch;
                      if (!branch) return;
                      setOpen(false);
                      writeClipboardText(branch).then(
                        () => toast.add({ type: "success", title: "Branch name copied" }),
                        (cause: unknown) => showErrorToast("Could not copy the branch name", cause),
                      );
                    }}
                  />
                }
              >
                <Copy aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Copy branch name</TooltipContent>
            </Tooltip>
          </div>
        }
      />
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "rename" ? "Rename current branch" : "Create branch"}
            </DialogTitle>
            <DialogDescription>
              Changes only this local checkout. Existing remote branches are not renamed or deleted.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              if (!mode) return;
              void mutation
                .mutateAsync({
                  profileID,
                  directory,
                  action: mode,
                  name: name.trim(),
                  ...(base.trim() ? { base: base.trim() } : {}),
                })
                .then(() => setMode(null))
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : "Could not change branch."),
                );
            }}
          >
            <Input
              autoFocus
              aria-label="Branch name"
              placeholder="Branch name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {mode === "create" ? (
              <Input
                aria-label="Create from branch"
                placeholder="From current HEAD (or enter a local/remote branch)"
                value={base}
                onChange={(event) => setBase(event.target.value)}
              />
            ) : null}
            {error ? (
              <p role="alert" className="text-meta text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mode === "rename" ? "Rename branch" : "Create branch"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
