import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useEffectEvent } from "react";
import type {
  GitBranchInput,
  PullRequestEditInput,
  PullRequestLabelInput,
  PullRequestAutoMergeInput,
  PullRequestUpdateBranchInput,
  GitCommitInput,
  GitCommitResult,
  GitPathsInput,
  GitPushResult,
  GitPushInput,
  GitPullInput,
  GitSyncInput,
  CreatePullRequestInput,
  PreparePullRequestInput,
  GitTarget,
  GitWorkingTreeStatus,
  LinkPullRequestInput,
  ListPullRequestLinksInput,
  PalotSourceControlApi,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDraftInput,
  PullRequestFileViewedInput,
  PullRequestFiles,
  PullRequestLink,
  PullRequestMergeInput,
  PullRequestRef,
  PullRequestReviewersInput,
  PullRequestReviewInput,
  PullRequestSearchInput,
  PullRequestStateInput,
  PullRequestThreadReplyInput,
  PullRequestThreadResolveInput,
  PullRequestSearchList,
  RefreshPullRequestsInput,
  SourceControlChangedEvent,
  SourceControlErrorCode,
  SourceControlFailure,
  SourceControlResult,
  UnlinkPullRequestInput,
  WatchPullRequestInput,
} from "../../shared/source-control-contract";
import { pullRequestKey } from "../../shared/source-control-contract";
import { runtimeAtom } from "../atoms/workspace";

/** A failed source control call. `code` is stable; `detail` carries Git or hook output. */
export class SourceControlError extends Error {
  readonly code: SourceControlErrorCode;
  readonly detail?: string;
  readonly retryAt?: number;

  constructor(failure: SourceControlFailure) {
    super(failure.message);
    this.name = "SourceControlError";
    this.code = failure.code;
    if (failure.detail !== undefined) this.detail = failure.detail;
    if (failure.retryAt !== undefined) this.retryAt = failure.retryAt;
  }
}

function bridge(): PalotSourceControlApi {
  const api = typeof window === "undefined" ? undefined : window.palot?.sourceControl;
  if (!api)
    throw new SourceControlError({
      code: "unsupported-connection",
      message: "Source control is only available in the Palot desktop app.",
    });
  return api;
}

async function unwrap<T>(result: Promise<SourceControlResult<T>>): Promise<T> {
  const value = await result;
  if (!value.ok) throw new SourceControlError(value.error);
  return value.value;
}

/** Thin, unwrapped bridge calls: resolve with the value or reject with `SourceControlError`. */
export const sourceControl = {
  gitBranch: (input: GitBranchInput) => unwrap(bridge().gitBranch(input)),
  editPullRequest: (input: PullRequestEditInput) => unwrap(bridge().editPullRequest(input)),
  pullRequestLabels: (input: PullRequestRef) => unwrap(bridge().pullRequestLabels(input)),
  setPullRequestLabel: (input: PullRequestLabelInput) =>
    unwrap(bridge().setPullRequestLabel(input)),
  setPullRequestAutoMerge: (input: PullRequestAutoMergeInput) =>
    unwrap(bridge().setPullRequestAutoMerge(input)),
  updatePullRequestBranch: (input: PullRequestUpdateBranchInput) =>
    unwrap(bridge().updatePullRequestBranch(input)),
  status: (profileID?: string) => bridge().status(profileID),
  listPullRequestLinks: (input?: ListPullRequestLinksInput) =>
    unwrap(bridge().listPullRequestLinks(input)),
  linkPullRequest: (input: LinkPullRequestInput) => unwrap(bridge().linkPullRequest(input)),
  preparePullRequest: (input: PreparePullRequestInput) =>
    unwrap(bridge().preparePullRequest(input)),
  createPullRequest: (input: CreatePullRequestInput) => unwrap(bridge().createPullRequest(input)),
  unlinkPullRequest: (input: UnlinkPullRequestInput) => unwrap(bridge().unlinkPullRequest(input)),
  refreshPullRequests: (input: RefreshPullRequestsInput) =>
    unwrap(bridge().refreshPullRequests(input)),
  watchPullRequest: (input: WatchPullRequestInput) => unwrap(bridge().watchPullRequest(input)),
  searchPullRequests: (input: PullRequestSearchInput) => unwrap(bridge().searchPullRequests(input)),
  pullRequestDetail: (ref: PullRequestRef) => unwrap(bridge().pullRequestDetail(ref)),
  pullRequestTimeline: (input: PullRequestRef & { cursor?: string | null; limit?: number }) =>
    unwrap(bridge().pullRequestTimeline(input)),
  pullRequestFiles: (ref: PullRequestRef) => unwrap(bridge().pullRequestFiles(ref)),
  setPullRequestFileViewed: (input: PullRequestFileViewedInput) =>
    unwrap(bridge().setPullRequestFileViewed(input)),
  submitPullRequestReview: (input: PullRequestReviewInput) =>
    unwrap(bridge().submitPullRequestReview(input)),
  addPullRequestComment: (input: PullRequestCommentInput) =>
    unwrap(bridge().addPullRequestComment(input)),
  replyToPullRequestThread: (input: PullRequestThreadReplyInput) =>
    unwrap(bridge().replyToPullRequestThread(input)),
  resolvePullRequestThread: (input: PullRequestThreadResolveInput) =>
    unwrap(bridge().resolvePullRequestThread(input)),
  mergePullRequest: (input: PullRequestMergeInput) => unwrap(bridge().mergePullRequest(input)),
  setPullRequestState: (input: PullRequestStateInput) =>
    unwrap(bridge().setPullRequestState(input)),
  setPullRequestDraft: (input: PullRequestDraftInput) =>
    unwrap(bridge().setPullRequestDraft(input)),
  requestPullRequestReviewers: (input: PullRequestReviewersInput) =>
    unwrap(bridge().requestPullRequestReviewers(input)),
  gitStatus: (target: GitTarget) => unwrap(bridge().gitStatus(target)),
  gitStage: (input: GitPathsInput) => unwrap(bridge().gitStage(input)),
  gitUnstage: (input: GitPathsInput) => unwrap(bridge().gitUnstage(input)),
  gitCommit: (input: GitCommitInput) => unwrap(bridge().gitCommit(input)),
  gitPush: (target: GitPushInput) => unwrap(bridge().gitPush(target)),
  gitFetch: (target: GitTarget) => unwrap(bridge().gitFetch(target)),
  gitPull: (input: GitPullInput) => unwrap(bridge().gitPull(input)),
  gitSync: (input: GitSyncInput) => unwrap(bridge().gitSync(input)),
  onChanged(listener: (event: SourceControlChangedEvent) => void): () => void {
    const api = typeof window === "undefined" ? undefined : window.palot?.sourceControl;
    return api ? api.onChanged(listener) : () => {};
  },
};

export const sourceControlKeys = {
  all: ["source-control"] as const,
  status: (profileID: string | null) =>
    [...sourceControlKeys.all, "status", profileID ?? ""] as const,
  links: (profileID: string) => [...sourceControlKeys.all, "links", profileID] as const,
  searches: () => [...sourceControlKeys.all, "search"] as const,
  search: (list: PullRequestSearchList, limit: number, query = "") =>
    [...sourceControlKeys.searches(), list, limit, query] as const,
  pullRequest: (ref: PullRequestRef) =>
    [...sourceControlKeys.all, "pull-request", pullRequestKey(ref)] as const,
  pullRequestDetail: (ref: PullRequestRef) =>
    [...sourceControlKeys.pullRequest(ref), "detail"] as const,
  pullRequestTimeline: (ref: PullRequestRef) =>
    [...sourceControlKeys.pullRequest(ref), "timeline"] as const,
  pullRequestFiles: (ref: PullRequestRef) =>
    [...sourceControlKeys.pullRequest(ref), "files"] as const,
  gitProfile: (profileID: string) => [...sourceControlKeys.all, "git", profileID] as const,
  git: (profileID: string, directory: string) =>
    [...sourceControlKeys.gitProfile(profileID), directory] as const,
};

/** Applies one change event to the query cache. Exported for tests and custom listeners. */
export function invalidateSourceControlQueries(
  queryClient: QueryClient,
  event: SourceControlChangedEvent,
): void {
  if (event.type === "pull-requests") {
    void queryClient.invalidateQueries({ queryKey: sourceControlKeys.links(event.profileID) });
    return;
  }
  if (event.type === "pull-request") {
    if (event.reason === "viewed") {
      // The toggle already updated the files cache optimistically. Mark it stale for the next
      // mount without re-reading every file page (and the detail and timeline) per click.
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === sourceControlKeys.all[0] &&
          queryKey[1] === "pull-request" &&
          queryKey[2] === event.key &&
          queryKey[3] === "files",
        refetchType: "none",
      });
      return;
    }
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === sourceControlKeys.all[0] &&
        queryKey[1] === "pull-request" &&
        queryKey[2] === event.key,
    });
    void queryClient.invalidateQueries({ queryKey: sourceControlKeys.searches() });
    return;
  }
  if (event.type === "git") {
    void queryClient.invalidateQueries({
      queryKey: sourceControlKeys.git(event.profileID, event.directory),
    });
    // OpenCode's own VCS and diff reads for the directory are stale after a commit.
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === "opencode" &&
        (queryKey[2] === "vcs" || queryKey[2] === "diffs") &&
        queryKey[3] === event.directory,
    });
    return;
  }
  void queryClient.invalidateQueries({ queryKey: [...sourceControlKeys.all, "status"] });
  void queryClient.invalidateQueries({ queryKey: sourceControlKeys.searches() });
}

const subscriptions = new WeakMap<QueryClient, { count: number; dispose: () => void }>();

/** One main-process subscription per query client, shared by every mounted hook. */
function useSourceControlInvalidation(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let entry = subscriptions.get(queryClient);
    if (!entry) {
      entry = {
        count: 0,
        dispose: sourceControl.onChanged((event) =>
          invalidateSourceControlQueries(queryClient, event),
        ),
      };
      subscriptions.set(queryClient, entry);
    }
    entry.count += 1;
    const current = entry;
    return () => {
      current.count -= 1;
      if (current.count === 0) {
        current.dispose();
        subscriptions.delete(queryClient);
      }
    };
  }, [queryClient]);
}

/** Calls `listener` for every source control change event (for toasts or custom refreshes). */
export function useSourceControlEvent(listener: (event: SourceControlChangedEvent) => void) {
  const onEvent = useEffectEvent(listener);
  useEffect(() => sourceControl.onChanged((event) => onEvent(event)), []);
}

function useFocusedProfileID(profileID?: string | null): string | null {
  const runtime = useAtomValue(runtimeAtom);
  return profileID === undefined ? (runtime?.profileID ?? null) : profileID;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/** GitHub sign-in and whether the profile supports source control (focused profile by default). */
export function useSourceControlStatus(profileID?: string | null) {
  const resolved = useFocusedProfileID(profileID);
  useSourceControlInvalidation();
  return useQuery({
    queryKey: sourceControlKeys.status(resolved),
    queryFn: () => sourceControl.status(resolved ?? undefined),
    staleTime: 60_000,
  });
}

/** Every pull request link of a profile. One cache entry backs all per-task selectors. */
export function usePullRequestLinks<T = PullRequestLink[]>(
  profileID?: string | null,
  select?: (links: PullRequestLink[]) => T,
) {
  const resolved = useFocusedProfileID(profileID);
  useSourceControlInvalidation();
  return useQuery({
    queryKey: sourceControlKeys.links(resolved ?? ""),
    queryFn: () => sourceControl.listPullRequestLinks({ profileID: resolved! }),
    enabled: Boolean(resolved),
    staleTime: 30_000,
    ...(select ? { select } : {}),
  });
}

function groupBySession(links: PullRequestLink[]): Map<string, PullRequestLink[]> {
  const grouped = new Map<string, PullRequestLink[]>();
  for (const link of links)
    grouped.set(link.sessionID, [...(grouped.get(link.sessionID) ?? []), link]);
  return grouped;
}

/** Links grouped by session ID, for PR badges on inbox rows. */
export function usePullRequestLinksBySession(profileID?: string | null) {
  return usePullRequestLinks(profileID, groupBySession);
}

/** The pull requests linked to one task. */
export function useSessionPullRequests(sessionID: string | null, profileID?: string | null) {
  return usePullRequestLinks(profileID, (links) =>
    sessionID ? links.filter((link) => link.sessionID === sessionID) : [],
  );
}

/** Cursor-paginated GitHub search for the Pull requests page. */
export function usePullRequestSearch(
  list: PullRequestSearchList,
  options: { limit?: number; enabled?: boolean; query?: string; host?: string } = {},
) {
  const limit = options.limit ?? 25;
  const query = options.query?.trim() ?? "";
  useSourceControlInvalidation();
  return useInfiniteQuery({
    queryKey: [...sourceControlKeys.search(list, limit, query), options.host ?? "github.com"],
    queryFn: ({ pageParam }) =>
      sourceControl.searchPullRequests({
        ...(options.host && options.host !== "github.com" ? { host: options.host } : {}),
        list,
        limit,
        cursor: pageParam,
        ...(query ? { query } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

/** Local Git status of a task directory (files, branch, upstream, ahead/behind). */
export function useGitStatus(
  directory: string | null,
  options: { profileID?: string | null; enabled?: boolean; refetchInterval?: number | false } = {},
) {
  const resolved = useFocusedProfileID(options.profileID);
  useSourceControlInvalidation();
  return useQuery({
    queryKey: sourceControlKeys.git(resolved ?? "", directory ?? ""),
    queryFn: () => sourceControl.gitStatus({ profileID: resolved!, directory: directory! }),
    enabled: Boolean(resolved && directory) && (options.enabled ?? true),
    staleTime: 2_000,
    refetchInterval: options.refetchInterval ?? false,
  });
}

// ---------------------------------------------------------------------------------------------
// Mutations. `profileID` defaults to the focused profile when the mutation runs.
// ---------------------------------------------------------------------------------------------

type WithoutProfile<T extends { profileID: string }> = Omit<T, "profileID">;

function useProfileResolver() {
  const focused = useAtomValue(runtimeAtom)?.profileID ?? null;
  return <T extends object>(input: T & { profileID?: string }): T & { profileID: string } => {
    const profileID = input.profileID ?? focused;
    if (!profileID)
      throw new SourceControlError({
        code: "unknown-profile",
        message: "Connect to an OpenCode server first.",
      });
    return { ...input, profileID };
  };
}

function useLinksMutation<TBase extends object, TResult>(
  run: (input: TBase & { profileID: string }) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  const resolve = useProfileResolver();
  return useMutation({
    mutationFn: (input: TBase & { profileID?: string }) => run(resolve(input)),
    onSettled: (_result, _error, input) => {
      const profileID = resolve(input).profileID;
      void queryClient.invalidateQueries({ queryKey: sourceControlKeys.links(profileID) });
    },
  });
}

/** Link by `url`, or omit `url` to detect the PR from the task's branch. */
export function useLinkPullRequest() {
  return useLinksMutation<WithoutProfile<LinkPullRequestInput>, PullRequestLink>(
    sourceControl.linkPullRequest,
  );
}

export function useCreatePullRequest() {
  return useLinksMutation<WithoutProfile<CreatePullRequestInput>, PullRequestLink>(
    sourceControl.createPullRequest,
  );
}

export function useUnlinkPullRequest() {
  return useLinksMutation<WithoutProfile<UnlinkPullRequestInput>, null>(
    sourceControl.unlinkPullRequest,
  );
}

export function useWatchPullRequest() {
  return useLinksMutation<WithoutProfile<WatchPullRequestInput>, PullRequestLink>(
    sourceControl.watchPullRequest,
  );
}

/** Reads GitHub now (interactive priority) for a task's links, or the whole profile's. */
export function useRefreshPullRequests() {
  return useLinksMutation<WithoutProfile<RefreshPullRequestsInput>, PullRequestLink[]>(
    sourceControl.refreshPullRequests,
  );
}

function useGitMutation<TBase extends { directory: string }, TResult>(
  run: (input: TBase & { profileID: string }) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  const resolve = useProfileResolver();
  return useMutation({
    mutationFn: (input: TBase & { profileID?: string }) => run(resolve(input)),
    onSuccess: (result, input) => {
      const target = resolve(input);
      if (result && typeof result === "object" && "files" in result && "root" in result)
        queryClient.setQueryData(sourceControlKeys.git(target.profileID, target.directory), result);
    },
    onSettled: (_result, _error, input) => {
      const target = resolve(input);
      void queryClient.invalidateQueries({
        queryKey: sourceControlKeys.git(target.profileID, target.directory),
      });
    },
  });
}

export function useGitStage() {
  return useGitMutation<WithoutProfile<GitPathsInput>, GitWorkingTreeStatus>(
    sourceControl.gitStage,
  );
}

export function useGitBranch() {
  useSourceControlInvalidation();
  return useGitMutation<WithoutProfile<GitBranchInput>, GitWorkingTreeStatus>(
    sourceControl.gitBranch,
  );
}

export function useEditPullRequest() {
  return usePullRequestMutation(sourceControl.editPullRequest);
}
export function useSetPullRequestLabel() {
  return usePullRequestMutation(sourceControl.setPullRequestLabel);
}
export function useSetPullRequestAutoMerge() {
  return usePullRequestMutation(sourceControl.setPullRequestAutoMerge);
}
export function useUpdatePullRequestBranch() {
  return usePullRequestMutation(sourceControl.updatePullRequestBranch);
}

export function useGitUnstage() {
  return useGitMutation<WithoutProfile<GitPathsInput>, GitWorkingTreeStatus>(
    sourceControl.gitUnstage,
  );
}

export function useGitCommit() {
  return useGitMutation<WithoutProfile<GitCommitInput>, GitCommitResult>(sourceControl.gitCommit);
}

/** Pushes the current branch, setting the upstream when it has none. */
export function useGitPush() {
  return useGitMutation<WithoutProfile<GitPushInput>, GitPushResult>(sourceControl.gitPush);
}

export function useGitFetch() {
  return useGitMutation<WithoutProfile<GitTarget>, GitWorkingTreeStatus>(sourceControl.gitFetch);
}
export function useGitPull() {
  return useGitMutation<WithoutProfile<GitPullInput>, GitWorkingTreeStatus>(sourceControl.gitPull);
}
export function useGitSync() {
  return useGitMutation<WithoutProfile<GitSyncInput>, GitPushResult>(sourceControl.gitSync);
}

// ---------------------------------------------------------------------------------------------
// Pull request review workspace
// ---------------------------------------------------------------------------------------------

/** Full PR detail for the review workspace: body, checks, reviewers, merge state, viewer. */
export function usePullRequestDetail(ref: PullRequestRef | null) {
  useSourceControlInvalidation();
  return useQuery({
    queryKey: ref ? sourceControlKeys.pullRequestDetail(ref) : [...sourceControlKeys.all, "none"],
    queryFn: () => sourceControl.pullRequestDetail(ref!),
    enabled: ref !== null,
    staleTime: 30_000,
  });
}

/** Oldest-first timeline pages (comments, reviews, threads, commits, events). */
export function usePullRequestTimeline(
  ref: PullRequestRef | null,
  options: { limit?: number } = {},
) {
  useSourceControlInvalidation();
  return useInfiniteQuery({
    queryKey: ref
      ? sourceControlKeys.pullRequestTimeline(ref)
      : [...sourceControlKeys.all, "none", "timeline"],
    queryFn: ({ pageParam }) =>
      sourceControl.pullRequestTimeline({ ...ref!, cursor: pageParam, limit: options.limit }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: ref !== null,
    staleTime: 30_000,
  });
}

/** Changed files with patches and GitHub's viewed marks. */
export function usePullRequestFiles(ref: PullRequestRef | null) {
  useSourceControlInvalidation();
  return useQuery({
    queryKey: ref
      ? sourceControlKeys.pullRequestFiles(ref)
      : [...sourceControlKeys.all, "none", "files"],
    queryFn: () => sourceControl.pullRequestFiles(ref!),
    enabled: ref !== null,
    staleTime: 60_000,
  });
}

function usePullRequestMutation<I extends PullRequestRef, O>(run: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (result, input) => {
      const fresh = result && typeof result === "object" && "headOid" in result && "body" in result;
      if (fresh) queryClient.setQueryData(sourceControlKeys.pullRequestDetail(input), result);
      // Fresh detail came back with the action; only the timeline and files need a re-read.
      void queryClient.invalidateQueries({
        queryKey: sourceControlKeys.pullRequest(input),
        predicate: ({ queryKey }) => !fresh || queryKey[3] !== "detail",
      });
      void queryClient.invalidateQueries({ queryKey: sourceControlKeys.searches() });
    },
  });
}

/** Marks one file viewed/unviewed, updating the files cache optimistically. */
export function useSetPullRequestFileViewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sourceControl.setPullRequestFileViewed,
    onMutate: async (input) => {
      const key = sourceControlKeys.pullRequestFiles(input);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PullRequestFiles>(key);
      if (previous) {
        queryClient.setQueryData<PullRequestFiles>(key, {
          ...previous,
          files: previous.files.map((file) =>
            file.path === input.path
              ? { ...file, viewed: input.viewed ? "viewed" : "unviewed" }
              : file,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sourceControlKeys.pullRequestFiles(input), context.previous);
      }
    },
  });
}

export function useSubmitPullRequestReview() {
  return usePullRequestMutation(sourceControl.submitPullRequestReview);
}
export function useAddPullRequestComment() {
  return usePullRequestMutation(sourceControl.addPullRequestComment);
}
export function useReplyToPullRequestThread() {
  return usePullRequestMutation(sourceControl.replyToPullRequestThread);
}
export function useResolvePullRequestThread() {
  return usePullRequestMutation(sourceControl.resolvePullRequestThread);
}
export function useMergePullRequest() {
  return usePullRequestMutation<PullRequestMergeInput, PullRequestDetail>(
    sourceControl.mergePullRequest,
  );
}
export function useSetPullRequestState() {
  return usePullRequestMutation<PullRequestStateInput, PullRequestDetail>(
    sourceControl.setPullRequestState,
  );
}
export function useSetPullRequestDraft() {
  return usePullRequestMutation<PullRequestDraftInput, PullRequestDetail>(
    sourceControl.setPullRequestDraft,
  );
}
export function useRequestPullRequestReviewers() {
  return usePullRequestMutation<PullRequestReviewersInput, PullRequestDetail>(
    sourceControl.requestPullRequestReviewers,
  );
}
