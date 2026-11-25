/**
 * The task header's next shipping step: one button that reads the task checkout's Git status
 * and its linked pull request and offers Commit, Commit & push, Push, Push & create PR,
 * Create PR or View PR. It runs the step's stages by name in its popover and never runs
 * without a press (or its shortcut).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  Check,
  Circle,
  CircleAlert,
  CircleMinus,
  ExternalLink,
  Eye,
  GitCommitHorizontal,
  Upload,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import type { PalotSession } from "../../shared";
import type { GitWorkingTreeStatus, PullRequestLink } from "../../shared/source-control-contract";
import { shipWatchPullRequestAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { worktreeBranchPrefixAtom } from "../atoms/worktree-preferences";
import { locationDiffsQueryOptions } from "../hooks/use-location-diffs";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useTextGenerationModel } from "../hooks/use-text-generation-model";
import {
  sourceControl,
  SourceControlError,
  useGitStatus,
  useSessionPullRequests,
  useSourceControlStatus,
  useWatchPullRequest,
} from "../hooks/use-source-control";
import { useVcsInfo } from "../hooks/use-vcs-info";
import { cn } from "../lib/cn";
import { cleanCommitMessage, commitMessagePrompt, stageablePaths } from "../lib/git-staging";
import {
  formatShortcut,
  matchesShortcut,
  shortcutKeys,
  useShortcutKeys,
} from "../lib/keyboard-shortcuts";
import {
  chainStages,
  createUpstreamCheck,
  decideFreshShipStep,
  runningText,
  runShipChain,
  type ShipChainDeps,
  type ShipStageState,
} from "../lib/ship-chain";
import {
  decideShipStep,
  needsUpstreamCheck,
  suggestBranchName,
  type ShipStage,
  type ShipStep,
} from "../lib/ship-step";
import { generateOpenCodeText } from "../services/opencode-generate";
import { CreatePullRequestDialog } from "./pull-requests/create-pull-request";
import {
  primaryPullRequestLink,
  pullRequestCanWatch,
  WATCH_EXPLANATION,
} from "./pull-requests/pull-request-presentation";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { describeSourceControlError } from "./workbench-tabs/changes-source-control";

type RunStep = Extract<ShipStep, { kind: "run" }>;

type Phase =
  | { kind: "idle" }
  | {
      kind: "confirm";
      step: RunStep;
      message: string;
      generating: boolean;
      generateError: string | null;
      branchName: string;
    }
  | { kind: "running" | "finished"; step: RunStep; stages: ShipStageState[]; ok: boolean };

/** Reads Git again on this interval while the window has focus; writes refresh it at once. */
const STATUS_INTERVAL_MS = 15_000;

/** One shared upstream fetch per checkout, across every ship button. */
const upstreamCheck = createUpstreamCheck();

export function ShipButton({ session }: { session: PalotSession }) {
  const runtime = useAtomValue(runtimeAtom);
  const profileID = runtime?.profileID ?? null;
  const directory = session.location.directory;
  const status = useSourceControlStatus(profileID);
  const supported = status.data?.supported === true;
  const git = useGitStatus(directory, {
    profileID,
    enabled: supported,
    refetchInterval: STATUS_INTERVAL_MS,
  });
  const vcs = useVcsInfo(supported ? session.location : null);
  const links = useSessionPullRequests(session.id, profileID);
  const primary = primaryPullRequestLink(links.data ?? []) ?? null;
  const step: ShipStep = git.data
    ? decideShipStep({
        tree: git.data,
        defaultBranch: vcs.data?.defaultBranch ?? null,
        pullRequest: primary?.pullRequest ?? null,
      })
    : { kind: "none" };
  const { openPullRequests } = usePalotNavigation();
  const queryClient = useQueryClient();
  const prefix = useAtomValue(worktreeBranchPrefixAtom);
  const [watchAfterShip, setWatchAfterShip] = useAtom(shipWatchPullRequestAtom);
  const store = useStore();
  const watch = useWatchPullRequest();
  const shortcut = useShortcutKeys("task.ship");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [pushConfirm, setPushConfirm] = useState<((confirmed: boolean) => void) | null>(null);
  const [prDialog, setPrDialog] = useState<{
    resolve(link: PullRequestLink | null): void;
  } | null>(null);
  const messageEdited = useRef(false);
  const generationModel = useTextGenerationModel(session);
  const [checking, setChecking] = useState(false);
  /** Set when the last upstream fetch failed and the step rests on the last known status. */
  const [upstreamHint, setUpstreamHint] = useState<string | null>(null);

  const remoteOf = (tree: GitWorkingTreeStatus) => tree.branch.upstream?.split("/")[0] || "origin";
  const fetchUpstream = async () => {
    if (!profileID) return false;
    return upstreamCheck(`${profileID}\u0000${directory}`, () =>
      sourceControl.gitFetch({ profileID, directory }),
    );
  };
  const noteUpstream = (ok: boolean, tree: GitWorkingTreeStatus) =>
    setUpstreamHint(ok ? null : `Couldn't check ${remoteOf(tree)}. Using the last known status.`);

  /** Hover or focus warms the fetch so a press rarely waits; deduped and skipped when fresh. */
  const prefetchUpstream = async () => {
    const tree = git.data;
    if (!tree || phase.kind !== "idle" || !needsUpstreamCheck(tree, step)) return;
    const ok = await fetchUpstream();
    noteUpstream(ok, tree);
    if (ok) void git.refetch();
  };

  const generateMessage = async (target: RunStep, tree: GitWorkingTreeStatus) => {
    const diffs = await queryClient.fetchQuery(
      locationDiffsQueryOptions(runtime?.connectionID ?? "disconnected", session.location),
    );
    const staged = new Set(tree.files.filter((file) => file.staged).map((file) => file.path));
    const included =
      target.commit?.scope === "staged"
        ? diffs.filter((file) =>
            [...staged].some((path) => path === file.file || path.endsWith(`/${file.file}`)),
          )
        : diffs;
    const text = await generateOpenCodeText(
      {
        prompt: commitMessagePrompt(included.length ? included : diffs),
        model: await generationModel(),
      },
      runtime?.connectionID ?? undefined,
    );
    const cleaned = cleanCommitMessage(text);
    if (!cleaned) throw new Error("The model returned no message.");
    return cleaned;
  };

  const deps = (target: RunStep): ShipChainDeps => {
    if (!profileID) throw new Error("Connect to an OpenCode server first.");
    const where = { profileID, directory };
    return {
      createBranch: (name) =>
        sourceControl.gitBranch({ ...where, action: "create", name, carryChanges: true }),
      stageAll: async () => {
        const tree = await sourceControl.gitStatus(where);
        const paths = stageablePaths(tree);
        if (paths.length) await sourceControl.gitStage({ ...where, paths });
      },
      commit: (message) => sourceControl.gitCommit({ ...where, message }),
      push: (confirmDefaultBranch) =>
        sourceControl.gitPush({
          ...where,
          ...(confirmDefaultBranch ? { confirmDefaultBranch } : {}),
        }),
      confirmDefaultBranchPush: () =>
        new Promise((resolve) => {
          setOpen(true);
          setPushConfirm(() => (confirmed: boolean) => {
            setPushConfirm(null);
            resolve(confirmed);
          });
        }),
      preparePullRequest: () =>
        sourceControl.preparePullRequest({ profileID, sessionID: session.id }),
      createPullRequest: () =>
        new Promise((resolve) => {
          setOpen(false);
          setPrDialog({ resolve });
        }),
      // Read when the watch stage starts, so unticking it mid-run (or in Create PR) counts.
      watchEnabled: () => store.get(shipWatchPullRequestAtom),
      watchPullRequest: (link) =>
        watch.mutateAsync({ profileID, sessionID: session.id, key: link.key, watching: true }),
      describe: (stage, error) => describeFailure(stage, error, target),
    };
  };

  const report = (state: ShipStageState) =>
    setPhase((current) =>
      current.kind === "running"
        ? {
            ...current,
            stages: current.stages.map((entry) => (entry.stage === state.stage ? state : entry)),
          }
        : current,
    );

  const run = async (target: RunStep, input: { message?: string; branchName?: string }) => {
    setPhase({
      kind: "running",
      step: target,
      ok: false,
      stages: chainStages(target).map((stage) => ({
        stage,
        status: "pending",
        text:
          stage === "watch"
            ? "Watch PR"
            : runningText(stage, target.remote, input.branchName).replace(/…$/, ""),
      })),
    });
    setOpen(true);
    const result = await runShipChain(target, input, deps(target), report);
    setPhase((current) =>
      current.kind === "running" ? { ...current, kind: "finished", ok: result.ok } : current,
    );
    if (!result.ok) setOpen(true);
  };

  const press = async () => {
    if (phase.kind === "running") {
      setOpen(true);
      return;
    }
    if (checking) return;
    // Decide on fresh status, not the last poll, and on fresh remote refs for a push or PR.
    const decision = await decideFreshShipStep(
      {
        defaultBranch: vcs.data?.defaultBranch ?? null,
        pullRequest: primary?.pullRequest ?? null,
      },
      {
        readStatus: async () => (await git.refetch()).data ?? git.data,
        fetchUpstream: async () => {
          setChecking(true);
          try {
            return await fetchUpstream();
          } finally {
            setChecking(false);
          }
        },
      },
    );
    if (!decision) return;
    const { step: next, tree: fresh } = decision;
    noteUpstream(!decision.upstreamUnchecked, fresh);
    if (next.kind !== "run") return;
    if (next.action === "view-pr") {
      if (primary) void openPullRequests(primary.pullRequest);
      return;
    }
    if (!next.commit && !next.newBranch) {
      void run(next, {});
      return;
    }
    messageEdited.current = false;
    setPhase({
      kind: "confirm",
      step: next,
      message: "",
      generating: Boolean(next.commit),
      generateError: null,
      branchName: next.newBranch ? suggestBranchName(session.title, prefix) : "",
    });
    setOpen(true);
    if (!next.commit) return;
    try {
      const message = await generateMessage(next, fresh);
      setPhase((current) =>
        current.kind === "confirm" && current.step === next
          ? {
              ...current,
              generating: false,
              message: messageEdited.current ? current.message : message,
            }
          : current,
      );
    } catch (error) {
      setPhase((current) =>
        current.kind === "confirm" && current.step === next
          ? {
              ...current,
              generating: false,
              generateError: `Generating the commit message failed: ${error instanceof Error ? error.message : String(error)}. Write one below.`,
            }
          : current,
      );
    }
  };

  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || !matchesShortcut(event, shortcutKeys("task.ship"))) return;
    if (step.kind !== "run" && phase.kind !== "running") return;
    event.preventDefault();
    void press();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (!supported || !git.data) return null;
  const shortcutLabel = shortcut.length ? formatShortcut(shortcut) : null;

  if (step.kind === "blocked" && phase.kind === "idle") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled="true"
              aria-label={`Can't ship: ${step.reason}`}
              data-ship-button="blocked"
              className="window-no-drag shrink-0 text-muted-foreground hover:bg-transparent"
              onPointerEnter={() => void prefetchUpstream()}
              onFocus={() => void prefetchUpstream()}
            />
          }
        >
          <CircleAlert data-icon="inline-start" className="text-warning" aria-hidden="true" />
          <span className="text-meta">{step.short}</span>
        </TooltipTrigger>
        <TooltipContent>
          {step.reason}
          {upstreamHint ? (
            <span className="block text-muted-foreground">{upstreamHint}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (step.kind !== "run" && phase.kind === "idle") return null;

  const busy = phase.kind === "running" || checking;
  const current =
    phase.kind === "running" ? phase.stages.find((stage) => stage.status === "running") : undefined;
  const label =
    phase.kind === "running"
      ? (current?.text ?? phase.step.label)
      : checking
        ? `Checking ${remoteOf(git.data)}…`
        : step.kind === "run"
          ? step.label
          : phase.kind !== "idle"
            ? phase.step.label
            : "";
  const Icon =
    step.kind === "run" && step.action === "view-pr"
      ? ExternalLink
      : step.kind === "run" && step.commit
        ? GitCommitHorizontal
        : Upload;
  const closePopover = (next: boolean) => {
    setOpen(next);
    if (next) return;
    if (pushConfirm) pushConfirm(false);
    if (phase.kind === "confirm" || phase.kind === "finished") setPhase({ kind: "idle" });
  };

  return (
    <>
      <Popover
        open={open && phase.kind !== "idle"}
        onOpenChange={(next) => {
          // Pressing the trigger runs the step; the step opens the popover when it has more.
          if (next) void press();
          else closePopover(false);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-ship-button={step.kind === "run" ? step.action : "running"}
              aria-keyshortcuts={shortcut.length ? shortcut.join("+") : undefined}
              aria-busy={busy || undefined}
              title={shortcutLabel ? `${label} (${shortcutLabel})` : undefined}
              className="window-no-drag shrink-0"
              onPointerEnter={() => void prefetchUpstream()}
              onFocus={() => void prefetchUpstream()}
            />
          }
        >
          {busy ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Icon data-icon="inline-start" aria-hidden="true" />
          )}
          <span className="max-w-48 truncate text-meta">{label}</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 gap-3 p-3"
          aria-label={phase.kind === "idle" ? "Ship" : phase.step.label}
        >
          {upstreamHint && phase.kind !== "idle" && phase.step.stages.some(remoteStage) ? (
            <p data-ship-upstream="unchecked" className="text-micro text-muted-foreground">
              {upstreamHint}
            </p>
          ) : null}
          {phase.kind === "confirm" ? (
            <ConfirmStep
              phase={phase}
              watch={watchAfterShip}
              onWatchChange={setWatchAfterShip}
              onChange={(patch) => {
                if ("message" in patch) messageEdited.current = true;
                setPhase((currentPhase) =>
                  currentPhase.kind === "confirm" ? { ...currentPhase, ...patch } : currentPhase,
                );
              }}
              onCancel={() => closePopover(false)}
              onAccept={() =>
                void run(phase.step, {
                  ...(phase.step.commit ? { message: phase.message } : {}),
                  ...(phase.step.newBranch ? { branchName: phase.branchName } : {}),
                })
              }
            />
          ) : phase.kind === "running" || phase.kind === "finished" ? (
            <Progress
              stages={phase.stages}
              watch={watchAfterShip}
              onWatchChange={setWatchAfterShip}
              finished={phase.kind === "finished"}
              pushConfirm={pushConfirm}
              onClose={() => closePopover(false)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      {step.kind === "run" &&
      step.action === "view-pr" &&
      phase.kind === "idle" &&
      primary &&
      !primary.watch &&
      pullRequestCanWatch(primary.pullRequest) ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-ship-watch-offer
                disabled={watch.isPending}
                aria-label={`Watch PR #${primary.pullRequest.number}`}
                className="window-no-drag -ml-1 shrink-0 text-muted-foreground"
                onClick={() =>
                  void watch
                    .mutateAsync({
                      profileID: primary.profileID,
                      sessionID: primary.sessionID,
                      key: primary.key,
                      watching: true,
                    })
                    .catch((error: unknown) =>
                      toast.add({
                        type: "error",
                        title: "Couldn't watch the PR",
                        description: error instanceof Error ? error.message : String(error),
                      }),
                    )
                }
              />
            }
          >
            <Eye data-icon="inline-start" aria-hidden="true" />
            <span className="text-meta">Watch</span>
          </TooltipTrigger>
          <TooltipContent>{WATCH_EXPLANATION}</TooltipContent>
        </Tooltip>
      ) : null}
      {prDialog && profileID ? (
        <CreatePullRequestDialog
          profileID={profileID}
          sessionID={session.id}
          resolveModel={generationModel}
          connectionID={runtime?.connectionID}
          pushing={false}
          startWatch={false}
          push={(onSuccess, onError) =>
            void sourceControl.gitPush({ profileID, directory }).then(onSuccess, onError)
          }
          open
          onCreated={(link) => {
            prDialog.resolve(link);
            setPrDialog((currentDialog) =>
              currentDialog === prDialog ? { resolve: () => {} } : currentDialog,
            );
          }}
          onOpenChange={(next) => {
            if (next) return;
            prDialog.resolve(null);
            setPrDialog(null);
            // Back to the stage list, which now says whether the PR is watched.
            setOpen(true);
          }}
        />
      ) : null}
    </>
  );
}

const remoteStage = (stage: ShipStage) => stage === "push" || stage === "pull-request";

function describeFailure(stage: ShipStage, error: unknown, step: RunStep): string {
  const message = error instanceof Error && error.message ? error.message : String(error);
  if (stage !== "commit" && stage !== "push") return message;
  if (!(error instanceof SourceControlError)) return message;
  const described = describeSourceControlError(stage, error).text;
  // Generic descriptions repeat the stage; Palot's own message is more specific then.
  if (described.startsWith("Could not")) return message;
  if (stage === "push" && error.code === "push-rejected")
    return `${step.remote} has commits this branch doesn't. Pull them first, then push again.`;
  return described;
}

function ConfirmStep({
  phase,
  watch,
  onWatchChange,
  onChange,
  onCancel,
  onAccept,
}: {
  phase: Extract<Phase, { kind: "confirm" }>;
  watch: boolean;
  onWatchChange(watch: boolean): void;
  onChange(
    patch: Partial<Pick<Extract<Phase, { kind: "confirm" }>, "message" | "branchName">>,
  ): void;
  onCancel(): void;
  onAccept(): void;
}) {
  const { step } = phase;
  const ready =
    (!step.commit || (!phase.generating && phase.message.trim() !== "")) &&
    (!step.newBranch || phase.branchName.trim() !== "");
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (ready) onAccept();
  };
  return (
    <form
      className="flex flex-col gap-2.5 text-sm"
      aria-label={step.label}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onAccept();
      }}
    >
      {step.newBranch ? (
        <label className="flex flex-col gap-1">
          <span className="text-meta text-muted-foreground">
            You're on the default branch. Create a branch for these changes:
          </span>
          <Input
            aria-label="New branch name"
            value={phase.branchName}
            spellCheck={false}
            autoFocus={!step.commit}
            className="h-7 font-mono text-meta"
            onChange={(event) => onChange({ branchName: event.target.value })}
            onKeyDown={onKeyDown}
          />
        </label>
      ) : null}
      {step.commit ? (
        <label className="flex flex-col gap-1">
          <span className="text-meta text-muted-foreground">
            {step.commit.scope === "staged"
              ? `Commits ${step.commit.count === 1 ? "the staged file" : `${step.commit.count} staged files`}`
              : `Stages and commits ${step.commit.count === 1 ? "the changed file" : `all ${step.commit.count} changed files`}`}
          </span>
          {phase.generating ? (
            <span
              role="status"
              className="flex items-center gap-1.5 text-meta text-muted-foreground"
            >
              <Spinner aria-hidden="true" />
              Generating commit message…
            </span>
          ) : null}
          <Textarea
            aria-label="Commit message"
            value={phase.message}
            placeholder={phase.generating ? "" : "Commit message"}
            rows={3}
            spellCheck
            autoFocus
            className="max-h-40 min-h-16 text-compact"
            onChange={(event) => onChange({ message: event.target.value })}
            onKeyDown={onKeyDown}
          />
          {phase.generateError ? (
            <span role="alert" className="text-meta text-destructive">
              {phase.generateError}
            </span>
          ) : null}
        </label>
      ) : null}
      {step.stages.includes("watch") ? (
        <span className="flex items-center gap-2 text-meta text-muted-foreground">
          <Checkbox
            id="ship-confirm-watch-pr"
            checked={watch}
            onCheckedChange={(value) => onWatchChange(value === true)}
          />
          <label htmlFor="ship-confirm-watch-pr" title={WATCH_EXPLANATION}>
            Watch the PR once it's open
          </label>
        </span>
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-micro text-muted-foreground">
          Enter accepts · Shift+Enter new line
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!ready}>
          {step.label}
        </Button>
      </div>
    </form>
  );
}

const STAGE_ICON = {
  pending: Circle,
  done: Check,
  failed: CircleAlert,
  skipped: CircleMinus,
} as const;

function Progress({
  stages,
  watch,
  onWatchChange,
  finished,
  pushConfirm,
  onClose,
}: {
  stages: ShipStageState[];
  watch: boolean;
  onWatchChange(watch: boolean): void;
  finished: boolean;
  pushConfirm: ((confirmed: boolean) => void) | null;
  onClose(): void;
}) {
  const failed = stages.find((stage) => stage.status === "failed");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ol aria-label="Stages" className="flex flex-col gap-1.5">
        {stages.map((stage) => {
          if (stage.stage === "watch" && stage.status === "pending")
            return (
              <li
                key={stage.stage}
                data-ship-stage={stage.stage}
                data-status={stage.status}
                className="flex min-w-0 items-start gap-2 text-compact"
              >
                <Checkbox
                  id="ship-watch-pr"
                  className="mt-0.5"
                  checked={watch}
                  onCheckedChange={(value) => onWatchChange(value === true)}
                />
                <label htmlFor="ship-watch-pr" className="min-w-0" title={WATCH_EXPLANATION}>
                  {stage.text}
                </label>
              </li>
            );
          const Icon = stage.status === "running" ? null : STAGE_ICON[stage.status];
          return (
            <li
              key={stage.stage}
              data-ship-stage={stage.stage}
              data-status={stage.status}
              className={cn(
                "flex min-w-0 items-start gap-2 text-compact",
                stage.status === "pending" && "text-muted-foreground",
                stage.status === "failed" && "text-destructive",
              )}
            >
              {Icon ? (
                <Icon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    stage.status === "done" && "text-success",
                  )}
                  aria-hidden="true"
                />
              ) : (
                <Spinner className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span
                className="min-w-0 break-words"
                role={stage.status === "failed" ? "alert" : undefined}
              >
                {stage.text}
              </span>
            </li>
          );
        })}
      </ol>
      {pushConfirm ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border/70 p-2">
          <p className="text-meta text-muted-foreground">
            This push may update the remote's default branch. Push anyway?
          </p>
          <div className="flex justify-end gap-1.5">
            <Button type="button" size="xs" variant="ghost" onClick={() => pushConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" size="xs" onClick={() => pushConfirm(true)}>
              Confirm push
            </Button>
          </div>
        </div>
      ) : null}
      {finished ? (
        <div className="flex items-center justify-end gap-1.5">
          {failed && stages.some((stage) => stage.stage === "commit" && stage.status === "done") ? (
            <span className="mr-auto text-micro text-muted-foreground">The commit is kept.</span>
          ) : null}
          <Button type="button" size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
