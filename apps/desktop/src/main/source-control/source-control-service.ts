import type {
  GitBranchInput,
  PullRequestEditInput,
  PullRequestLabelInput,
  PullRequestAutoMergeInput,
  PullRequestUpdateBranchInput,
  GitHubAccountStatus,
  GitCommitInput,
  GitPushInput,
  GitPullInput,
  GitSyncInput,
  CreatePullRequestInput,
  PreparePullRequestInput,
  PullRequestPreparation,
  GitCommitResult,
  GitPathsInput,
  GitPushResult,
  GitTarget,
  GitWorkingTreeStatus,
  LinkPullRequestInput,
  ListPullRequestLinksInput,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDraftInput,
  PullRequestFileViewedInput,
  PullRequestFiles,
  PullRequestLink,
  PullRequestMergeInput,
  PullRequestRef,
  PullRequestReviewInput,
  PullRequestReviewersInput,
  PullRequestSearchInput,
  PullRequestStateInput,
  PullRequestThreadReplyInput,
  PullRequestThreadResolveInput,
  PullRequestTimelineInput,
  PullRequestTimelinePage,
  PullRequestSearchPage,
  RefreshPullRequestsInput,
  SourceControlChangedEvent,
  SourceControlResult,
  SourceControlStatus,
  UnlinkPullRequestInput,
  WatchPullRequestInput,
} from "../../shared/source-control-contract";
import { SourceControlError, sourceControlResult, toSourceControlFailure } from "./errors";
import type { GitHubGateway } from "./github-client";
import { configuredGitHubHosts } from "./github-credentials";
import type { GitRunner } from "./git";
import type { PullRequestReviewService } from "./pull-request-review";
import type { PullRequestService } from "./pull-request-service";
import type { HostProviders } from "./host-providers";
import type { SaveCodeHostInput } from "../../shared/source-control-contract";

const DEFAULT_HOST = "github.com";

export interface SourceControlServiceOptions {
  gitForProfile?(profileID: string): Promise<SourceControlServiceOptions["git"]>;
  providers?: HostProviders;
  pullRequests: PullRequestService;
  review: PullRequestReviewService;
  git: Pick<
    GitRunner,
    "status" | "stage" | "unstage" | "commit" | "push" | "fetch" | "pull" | "changeBranch"
  >;
  github: GitHubGateway;
  isLocalProfile(profileID: string): boolean | null;
  emit(event: SourceControlChangedEvent): void;
  env?: () => Readonly<Record<string, string | undefined>>;
}

/** The IPC-facing facade: every method returns a `SourceControlResult` instead of throwing. */
export class SourceControlService {
  constructor(private readonly options: SourceControlServiceOptions) {}
  codeHosts() {
    return Promise.resolve(this.options.providers?.accounts() ?? []);
  }
  saveCodeHost(input: SaveCodeHostInput) {
    return sourceControlResult(() => {
      if (!this.options.providers)
        throw new SourceControlError("unsupported-action", "Code hosts are unavailable.");
      this.options.providers.credentials.save(input);
      this.options.emit({ type: "github", host: new URL(input.url).host });
      return null;
    });
  }
  removeCodeHost(host: string) {
    return sourceControlResult(() => {
      this.options.providers?.credentials.remove(host);
      this.options.emit({ type: "github", host });
      return null;
    });
  }
  private reviewFor(ref: PullRequestRef) {
    return this.options.providers?.get(ref.host) ?? this.options.review;
  }

  start(): void {
    this.options.pullRequests.start();
  }

  stop(): Promise<void> {
    return this.options.pullRequests.stop();
  }

  async status(profileID?: string): Promise<SourceControlStatus> {
    const local = profileID ? this.options.isLocalProfile(profileID) : null;
    const supported = profileID ? local === true : true;
    const hosts = configuredGitHubHosts(this.options.env?.() ?? process.env);
    const githubHosts = await Promise.all(hosts.map((host) => this.accountStatus(host)));
    return {
      profileID: profileID ?? null,
      supported,
      unsupportedReason: supported
        ? null
        : local === null
          ? "Unknown OpenCode profile."
          : "Pull requests and Git actions are only available for local OpenCode connections.",
      github: githubHosts.find((account) => account.host === DEFAULT_HOST)!,
      githubHosts,
      hosts: this.options.providers?.accounts(),
    };
  }

  private async accountStatus(host: string): Promise<GitHubAccountStatus> {
    const account: GitHubAccountStatus = {
      host,
      authenticated: false,
      source: null,
      login: null,
      error: null,
      pausedUntil: this.options.github.pausedUntil(host),
    };
    try {
      const credential = await this.options.github.credential(host);
      account.authenticated = true;
      account.source = credential.source;
      account.login = await this.options.pullRequests.viewerLogin(host);
    } catch (error) {
      account.error = toSourceControlFailure(error);
      if (account.error.code === "github-auth-failed") account.authenticated = false;
    }
    return account;
  }

  listPullRequestLinks(
    input: ListPullRequestLinksInput = {},
  ): Promise<SourceControlResult<PullRequestLink[]>> {
    return sourceControlResult(() => this.options.pullRequests.list(input));
  }

  linkPullRequest(input: LinkPullRequestInput): Promise<SourceControlResult<PullRequestLink>> {
    return sourceControlResult(() => this.options.pullRequests.link(input));
  }

  preparePullRequest(
    input: PreparePullRequestInput,
  ): Promise<SourceControlResult<PullRequestPreparation>> {
    return sourceControlResult(() => this.options.pullRequests.prepare(input));
  }

  createPullRequest(input: CreatePullRequestInput): Promise<SourceControlResult<PullRequestLink>> {
    return sourceControlResult(() => this.options.pullRequests.create(input));
  }

  unlinkPullRequest(input: UnlinkPullRequestInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(() => {
      this.options.pullRequests.unlink(input);
      return null;
    });
  }

  refreshPullRequests(
    input: RefreshPullRequestsInput,
  ): Promise<SourceControlResult<PullRequestLink[]>> {
    return sourceControlResult(() => this.options.pullRequests.refresh(input));
  }

  watchPullRequest(input: WatchPullRequestInput): Promise<SourceControlResult<PullRequestLink>> {
    return sourceControlResult(() => this.options.pullRequests.watch(input));
  }

  searchPullRequests(
    input: PullRequestSearchInput,
  ): Promise<SourceControlResult<PullRequestSearchPage>> {
    return sourceControlResult(() => this.options.pullRequests.search(input));
  }

  // Review workspace: GitHub-only, no OpenCode profile, the local machine's credentials.

  pullRequestDetail(ref: PullRequestRef): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.reviewFor(ref).detail(ref));
  }

  pullRequestTimeline(
    input: PullRequestTimelineInput,
  ): Promise<SourceControlResult<PullRequestTimelinePage>> {
    return sourceControlResult(() => this.reviewFor(input).timeline(input));
  }

  pullRequestFiles(ref: PullRequestRef): Promise<SourceControlResult<PullRequestFiles>> {
    return sourceControlResult(() => this.reviewFor(ref).files(ref));
  }

  setPullRequestFileViewed(input: PullRequestFileViewedInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.reviewFor(input).setFileViewed(input);
      return null;
    });
  }

  submitPullRequestReview(input: PullRequestReviewInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.reviewFor(input).review(input);
      return null;
    });
  }

  addPullRequestComment(input: PullRequestCommentInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.reviewFor(input).comment(input);
      return null;
    });
  }

  replyToPullRequestThread(input: PullRequestThreadReplyInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.reviewFor(input).reply(input);
      return null;
    });
  }

  resolvePullRequestThread(
    input: PullRequestThreadResolveInput,
  ): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.reviewFor(input).resolve(input);
      return null;
    });
  }

  mergePullRequest(input: PullRequestMergeInput): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.reviewFor(input).merge(input));
  }

  setPullRequestState(
    input: PullRequestStateInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.reviewFor(input).setState(input));
  }

  setPullRequestDraft(
    input: PullRequestDraftInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.reviewFor(input).setDraft(input));
  }

  requestPullRequestReviewers(
    input: PullRequestReviewersInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.reviewFor(input).requestReviewers(input));
  }

  gitStatus(target: GitTarget): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return sourceControlResult(async () => {
      this.assertLocal(target.profileID);
      return (await this.gitFor(target.profileID)).status(target.directory);
    });
  }

  gitBranch(input: GitBranchInput) {
    return this.write(input, (git) => git.changeBranch(input));
  }

  editPullRequest(input: PullRequestEditInput) {
    return sourceControlResult(() => this.reviewFor(input).edit(input));
  }
  pullRequestLabels(input: PullRequestRef) {
    return sourceControlResult(() => this.reviewFor(input).labels(input));
  }
  setPullRequestLabel(input: PullRequestLabelInput) {
    return sourceControlResult(() => this.reviewFor(input).setLabel(input));
  }
  setPullRequestAutoMerge(input: PullRequestAutoMergeInput) {
    return sourceControlResult(() => this.reviewFor(input).setAutoMerge(input));
  }
  updatePullRequestBranch(input: PullRequestUpdateBranchInput) {
    return sourceControlResult(() => this.reviewFor(input).updateBranch(input));
  }

  gitStage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(input, (git) => git.stage(input.directory, input.paths));
  }

  gitUnstage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(input, (git) => git.unstage(input.directory, input.paths));
  }

  gitCommit(input: GitCommitInput): Promise<SourceControlResult<GitCommitResult>> {
    return this.write(input, (git) => git.commit(input.directory, input.message));
  }

  gitPush(target: GitPushInput): Promise<SourceControlResult<GitPushResult>> {
    return this.write(target, (git) => git.push(target.directory, target.confirmDefaultBranch));
  }

  gitFetch(target: GitTarget): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(target, (git) => git.fetch(target.directory));
  }

  gitPull(input: GitPullInput): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(input, (git) => git.pull(input.directory, input.strategy));
  }

  gitSync(input: GitSyncInput): Promise<SourceControlResult<GitPushResult>> {
    return this.write(input, async (git) => {
      await git.pull(input.directory, input.strategy);
      return git.push(input.directory, input.confirmDefaultBranch);
    });
  }

  private async write<T>(
    target: GitTarget,
    operation: (git: SourceControlServiceOptions["git"]) => Promise<T>,
  ): Promise<SourceControlResult<T>> {
    const guard = await sourceControlResult(() => this.assertLocal(target.profileID));
    if (!guard.ok) return { ok: false, error: guard.error };
    const result = await sourceControlResult(async () =>
      operation(await this.gitFor(target.profileID)),
    );
    // A failed commit hook may still have rewritten files, so announce failures too.
    this.options.emit({ type: "git", profileID: target.profileID, directory: target.directory });
    return result;
  }

  private assertLocal(profileID: string): void {
    const local = this.options.isLocalProfile(profileID);
    if (local === null)
      throw new SourceControlError("unknown-profile", "Unknown OpenCode profile.");
    if (!local)
      throw new SourceControlError(
        "unsupported-connection",
        "Pull requests and Git actions are only available for local OpenCode connections.",
      );
  }
  private gitFor(profileID: string) {
    return this.options.gitForProfile?.(profileID) ?? Promise.resolve(this.options.git);
  }
}
