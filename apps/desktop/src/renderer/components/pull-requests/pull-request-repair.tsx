/**
 * PR repair: Fix review comments, Fix failing checks and Resolve conflicts. Each puts one PR
 * context chip into the composer of the task that owns the pull request, or starts a task with
 * it when none does. Nothing is sent until the person sends the message.
 */
import { GitMerge, ListChecks, MessageSquareWarning } from "lucide-react";
import { useStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PullRequestCheckLog,
  PullRequestDetail,
  PullRequestLink,
  PullRequestRef,
} from "../../../shared/source-control-contract";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { usePalotNavigation } from "../../hooks/use-navigation";
import {
  sourceControl,
  useGitStatus,
  usePullRequestDetail,
  usePullRequestTimeline,
} from "../../hooks/use-source-control";
import { applyComposerTextEdit, type ComposerDraft } from "../../lib/composer-draft";
import { composerScope } from "../../lib/composer-scope";
import {
  conflictsContext,
  failingChecks,
  failingChecksContext,
  prContextInsertion,
  reviewCommentsContext,
  type PrContext,
  type PrRepairKind,
} from "../../lib/pr-context";
import { showErrorToast } from "../../lib/toast-error";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useStartPullRequestTask } from "./pull-request-actions";
import { lineReviewThreads } from "./pull-request-threads";

/** Like the Code tab, read threads from at most this many timeline pages. */
const MAX_TIMELINE_PAGES = 20;

export const REPAIR_ACTION_LABEL: Record<PrRepairKind, string> = {
  review: "Fix review comments",
  checks: "Fix failing checks",
  conflicts: "Resolve conflicts",
};

const REPAIR_ICON = {
  review: MessageSquareWarning,
  checks: ListChecks,
  conflicts: GitMerge,
} satisfies Record<PrRepairKind, unknown>;

/** The repair contexts a pull request has something for, in a fixed order. */
export function pullRequestRepairContexts(
  detail: PullRequestDetail,
  items: Parameters<typeof lineReviewThreads>[0],
  conflictedFiles: readonly string[] = [],
): PrContext[] {
  if (detail.state === "merged" || detail.state === "closed") return [];
  return [
    reviewCommentsContext(detail, lineReviewThreads(items)),
    failingChecksContext(detail, detail.checkRuns),
    detail.mergeable === "conflicting" ? conflictsContext(detail, conflictedFiles) : null,
  ].filter((context): context is PrContext => context !== null);
}

/**
 * Reads what a pull request needs: detail (checks, mergeability) and every timeline page for
 * review threads. `local` adds the conflicted paths of the task's checkout when it has any.
 */
export function usePullRequestRepair(
  ref: PullRequestRef | null,
  local?: { profileID: string; directory: string } | null,
) {
  const detail = usePullRequestDetail(ref);
  const timeline = usePullRequestTimeline(ref);
  const git = useGitStatus(local?.directory ?? null, {
    profileID: local?.profileID ?? null,
    enabled: Boolean(local && detail.data?.mergeable === "conflicting"),
  });
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = timeline;
  const pages = timeline.data?.pages.length ?? 0;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isError || pages >= MAX_TIMELINE_PAGES) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage, pages]);
  const contexts = useMemo(() => {
    if (!detail.data) return [];
    const items = timeline.data?.pages.flatMap((page) => page.items) ?? [];
    const conflicted = git.data?.files.filter((file) => file.conflicted).map((file) => file.path);
    return pullRequestRepairContexts(detail.data, items, conflicted);
  }, [detail.data, git.data, timeline.data]);
  const data = detail.data;
  const prepare = useCallback(
    (context: PrContext) => (data ? withCheckLogs(context, data) : Promise.resolve(context)),
    [data],
  );
  return {
    contexts,
    /** The context to insert; Fix failing checks reads each failing check's log first. */
    prepare,
    // Review comments may still be on a page not read yet.
    loading: detail.isPending || timeline.isPending || (hasNextPage && pages < MAX_TIMELINE_PAGES),
  };
}

/**
 * Adds each failing check's log excerpt to a checks context. A log that cannot be read (or a
 * failed read altogether) says "(log unavailable)" instead of failing the chip.
 */
export async function withCheckLogs(
  context: PrContext,
  detail: PullRequestDetail,
): Promise<PrContext> {
  if (context.kind !== "checks") return context;
  const ids = failingChecks(detail.checkRuns).flatMap((check) =>
    check.checkRunID ? [check.checkRunID] : [],
  );
  const logs = new Map<number, PullRequestCheckLog>();
  if (ids.length) {
    try {
      const read = await sourceControl.pullRequestCheckLogs({
        host: detail.host,
        repository: detail.repository,
        number: detail.number,
        checkRunIDs: ids.slice(0, 50),
      });
      for (const log of read) logs.set(log.checkRunID, log);
    } catch {
      // Every check then says its log is unavailable.
    }
  }
  return failingChecksContext(detail, detail.checkRuns, logs) ?? context;
}

/**
 * Appends a PR context to a task's composer: the message being edited when there is one, else
 * the task's draft. Returns false while that composer is sending.
 */
export function insertPrContextInComposer(
  store: ReturnType<typeof useStore>,
  profileID: string,
  sessionID: string,
  context: PrContext,
): boolean {
  const scope = composerScope(profileID, `session:${sessionID}`);
  const stateAtom = composerStateAtomFamily(scope);
  const state = store.get(stateAtom);
  if (state.sending) return false;
  const append = (draft: ComposerDraft) => {
    const text = prContextInsertion(draft.text, context);
    return text === null
      ? draft
      : applyComposerTextEdit(draft, { start: draft.text.length, end: draft.text.length, text });
  };
  if (state.edit) {
    store.set(stateAtom, (current) =>
      current.edit
        ? { ...current, edit: { ...current.edit, draft: append(current.edit.draft) } }
        : current,
    );
  } else {
    store.set(composerDraftAtomFamily(scope), append);
  }
  return true;
}

function focusComposerSoon() {
  // The task's composer mounts after navigation; focus it once it is there.
  let tries = 0;
  const focus = () => {
    const input = document.querySelector<HTMLElement>("[data-palot-composer-input]");
    if (input) input.focus();
    else if (tries++ < 20) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}

/**
 * Sends a context to the task that owns the PR (opening it when needed), or starts a new task
 * through the normal Start task flow when no task owns it.
 */
export function usePrContextTarget() {
  const store = useStore();
  const { openSession } = usePalotNavigation();
  const startTask = useStartPullRequestTask();
  return async (
    context: PrContext,
    pullRequest: Pick<PullRequestDetail, "repository" | "url">,
    owner: Pick<PullRequestLink, "profileID" | "sessionID"> | null,
    options: { navigate: boolean },
  ) => {
    if (!owner) {
      await startTask("detail", pullRequest, context.source);
      focusComposerSoon();
      return;
    }
    if (!insertPrContextInComposer(store, owner.profileID, owner.sessionID, context)) {
      showErrorToast(
        "Could not add the pull request context",
        new Error("The task's composer is sending a message. Try again once it is sent."),
      );
      return;
    }
    if (options.navigate) await openSession(owner.sessionID, { profileID: owner.profileID });
    focusComposerSoon();
  };
}

/** One button per repair the pull request has something for. */
export function PullRequestRepairButtons({
  contexts,
  onChoose,
  size = "sm",
}: {
  contexts: readonly PrContext[];
  /** A returned promise shows the button busy until it settles. */
  onChoose(context: PrContext): void | Promise<void>;
  size?: "sm" | "xs";
}) {
  const [busy, setBusy] = useState<PrRepairKind | null>(null);
  return contexts.map((context) => {
    const Icon = REPAIR_ICON[context.kind];
    const pending = busy === context.kind;
    return (
      <Button
        key={context.kind}
        type="button"
        variant="ghost"
        size={size}
        title={`Adds "${context.label}" to the composer`}
        data-pr-repair={context.kind}
        aria-busy={pending || undefined}
        disabled={busy !== null}
        onClick={() => {
          const result = onChoose(context);
          if (!result) return;
          setBusy(context.kind);
          void result.finally(() => setBusy(null));
        }}
      >
        {pending ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <Icon data-icon="inline-start" aria-hidden="true" />
        )}
        {pending && context.kind === "checks"
          ? "Reading check logs…"
          : REPAIR_ACTION_LABEL[context.kind]}
      </Button>
    );
  });
}
