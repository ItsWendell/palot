import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useStore } from "jotai";
import { useCallback } from "react";
import type { PalotProject } from "../../../shared";
import type {
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestSearchList,
  PullRequestSnapshot,
} from "../../../shared/source-control-contract";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { newTaskDestinationAtom, runtimeAtom } from "../../atoms/workspace";
import { usePalotNavigation } from "../../hooks/use-navigation";
import { useProjectCatalog } from "../../hooks/use-session-catalog";
import {
  SourceControlError,
  sourceControl,
  sourceControlKeys,
  useMergePullRequest,
  useSetPullRequestState,
  useSubmitPullRequestReview,
} from "../../hooks/use-source-control";
import { composerScope } from "../../lib/composer-scope";
import { projectLocation, visibleProjects } from "../../lib/view-models";
import {
  pullRequestMergeMethodsAtom,
  rememberMergeMethod,
  resolveMergeMethod,
} from "./pull-request-preferences";
import { mergeAvailability } from "./pull-request-presentation";

export function refOf(pullRequest: Pick<PullRequestSnapshot, "host" | "repository" | "number">) {
  return {
    host: pullRequest.host,
    repository: pullRequest.repository,
    number: pullRequest.number,
  } satisfies PullRequestRef;
}

export function repositoryKey(pullRequest: Pick<PullRequestSnapshot, "host" | "repository">) {
  return `${pullRequest.host}/${pullRequest.repository}`;
}

/** The remembered merge method per repository, falling back to GitHub's first allowed. */
export function useMergeMethod(
  detail: Pick<PullRequestDetail, "host" | "repository" | "mergeMethods">,
) {
  const [remembered, setRemembered] = useAtom(pullRequestMergeMethodsAtom);
  const key = repositoryKey(detail);
  const method = resolveMergeMethod(detail.mergeMethods, remembered[key]);
  const setMethod = useCallback(
    (next: PullRequestMergeMethod) =>
      setRemembered((current) => rememberMergeMethod(current, key, next)),
    [key, setRemembered],
  );
  return [method, setMethod] as const;
}

export type QuickAction = "approve" | "merge" | "close";

/** Which quick actions a list row offers; merge needs a known mergeable open PR. */
export function quickActionsFor(
  list: PullRequestSearchList,
  pullRequest: PullRequestSnapshot,
): QuickAction[] {
  const actions: QuickAction[] = [];
  if (list === "review-requested" && pullRequest.state === "open") actions.push("approve");
  if (pullRequest.state === "open" && pullRequest.mergeable === "mergeable") actions.push("merge");
  if (pullRequest.state === "open" || pullRequest.state === "draft") actions.push("close");
  return actions;
}

/**
 * Runs a list row's quick action. Approve and merge read the PR detail first (from cache
 * when fresh) so they anchor to the head the user would see and use the repository's
 * remembered merge method; a moved head fails on the server instead of merging blindly.
 */
export function useQuickAction() {
  const queryClient = useQueryClient();
  const store = useStore();
  const review = useSubmitPullRequestReview();
  const merge = useMergePullRequest();
  const setState = useSetPullRequestState();
  return useCallback(
    async (action: QuickAction, pullRequest: PullRequestSnapshot) => {
      const ref = refOf(pullRequest);
      if (action === "close") {
        await setState.mutateAsync({ ...ref, state: "closed" });
        return;
      }
      const detail = await queryClient.fetchQuery({
        queryKey: sourceControlKeys.pullRequestDetail(ref),
        queryFn: () => sourceControl.pullRequestDetail(ref),
        staleTime: 10_000,
      });
      if (action === "approve") {
        await review.mutateAsync({
          ...ref,
          event: "approve",
          body: "",
          comments: [],
          commitOid: detail.headOid,
        });
        return;
      }
      const { blocked } = mergeAvailability(detail);
      if (blocked) throw new SourceControlError({ code: "invalid-input", message: blocked });
      const method = resolveMergeMethod(
        detail.mergeMethods,
        store.get(pullRequestMergeMethodsAtom)[repositoryKey(detail)],
      );
      if (!method)
        throw new SourceControlError({
          code: "invalid-input",
          message: "This repository allows no merge method.",
        });
      await merge.mutateAsync({ ...ref, method, expectedHeadOid: detail.headOid });
    },
    [merge, queryClient, review, setState, store],
  );
}

const START_PROMPT: Record<PullRequestSearchList | "detail", (url: string) => string> = {
  "review-requested": (url) => `Review this pull request: ${url}`,
  assigned: (url) => `Work on this pull request: ${url}`,
  authored: (url) => `Continue work on this pull request: ${url}`,
  mentioned: (url) => `Look into this pull request: ${url}`,
  "recently-merged": (url) => `Follow up on this merged pull request: ${url}`,
  detail: (url) => `Work on this pull request: ${url}`,
};

/**
 * Opens New task with a prompt referencing the PR, in the project whose folder matches
 * the repository name, else the remembered or first project. The prompt goes through
 * the normal draft, so the user reviews it before anything runs.
 */
export function useStartPullRequestTask() {
  const store = useStore();
  const projects = useProjectCatalog();
  const { openNewTask } = usePalotNavigation();
  return async (
    source: PullRequestSearchList | "detail",
    pullRequest: Pick<PullRequestSnapshot, "repository" | "url">,
    /** Replaces the default prompt, such as a question about one stop of a review guide. */
    customPrompt?: string,
  ) => {
    const profileID = store.get(runtimeAtom)?.profileID;
    const project = pickProject(
      visibleProjects(projects),
      pullRequest.repository,
      store.get(newTaskDestinationAtom),
      profileID,
    );
    if (project && profileID) {
      const draftAtom = composerDraftAtomFamily(
        composerScope(profileID, `new:${project.id}:${project.canonical}:`),
      );
      const draft = store.get(draftAtom);
      const prompt = customPrompt ?? START_PROMPT[source](pullRequest.url);
      // A custom prompt is a new question; only an identical one is already there.
      if (!draft.text.includes(customPrompt ?? pullRequest.url))
        store.set(draftAtom, {
          ...draft,
          text: draft.text.trim() ? `${draft.text.trimEnd()}\n\n${prompt}` : prompt,
        });
    }
    await openNewTask(project?.id, project ? profileID : undefined);
  };
}

export function pickProject(
  projects: PalotProject[],
  repository: string,
  remembered: { profileID: string; projectID: string | null } | null,
  profileID: string | undefined,
): PalotProject | null {
  const name = repository.split("/").at(-1)?.toLowerCase();
  const byName = projects.find(
    (project) =>
      project.name?.toLowerCase() === name ||
      projectLocation(project).split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() === name,
  );
  if (byName) return byName;
  const rememberedProject =
    remembered?.profileID === profileID
      ? projects.find((project) => project.id === remembered?.projectID)
      : undefined;
  return rememberedProject ?? projects[0] ?? null;
}
