import type {
  GitHubAccountStatus,
  GitCommitInput,
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

const DEFAULT_HOST = "github.com";

export interface SourceControlServiceOptions {
  pullRequests: PullRequestService;
  review: PullRequestReviewService;
  git: Pick<GitRunner, "status" | "stage" | "unstage" | "commit" | "push">;
  github: GitHubGateway;
  isLocalProfile(profileID: string): boolean | null;
  emit(event: SourceControlChangedEvent): void;
  env?: () => Readonly<Record<string, string | undefined>>;
}

/** The IPC-facing facade: every method returns a `SourceControlResult` instead of throwing. */
export class SourceControlService {
  constructor(private readonly options: SourceControlServiceOptions) {}

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
    return sourceControlResult(() => this.options.review.detail(ref));
  }

  pullRequestTimeline(
    input: PullRequestTimelineInput,
  ): Promise<SourceControlResult<PullRequestTimelinePage>> {
    return sourceControlResult(() => this.options.review.timeline(input));
  }

  pullRequestFiles(ref: PullRequestRef): Promise<SourceControlResult<PullRequestFiles>> {
    return sourceControlResult(() => this.options.review.files(ref));
  }

  setPullRequestFileViewed(input: PullRequestFileViewedInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.options.review.setFileViewed(input);
      return null;
    });
  }

  submitPullRequestReview(input: PullRequestReviewInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.options.review.review(input);
      return null;
    });
  }

  addPullRequestComment(input: PullRequestCommentInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.options.review.comment(input);
      return null;
    });
  }

  replyToPullRequestThread(input: PullRequestThreadReplyInput): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.options.review.reply(input);
      return null;
    });
  }

  resolvePullRequestThread(
    input: PullRequestThreadResolveInput,
  ): Promise<SourceControlResult<null>> {
    return sourceControlResult(async () => {
      await this.options.review.resolve(input);
      return null;
    });
  }

  mergePullRequest(input: PullRequestMergeInput): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.options.review.merge(input));
  }

  setPullRequestState(
    input: PullRequestStateInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.options.review.setState(input));
  }

  setPullRequestDraft(
    input: PullRequestDraftInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.options.review.setDraft(input));
  }

  requestPullRequestReviewers(
    input: PullRequestReviewersInput,
  ): Promise<SourceControlResult<PullRequestDetail>> {
    return sourceControlResult(() => this.options.review.requestReviewers(input));
  }

  gitStatus(target: GitTarget): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return sourceControlResult(() => {
      this.assertLocal(target.profileID);
      return this.options.git.status(target.directory);
    });
  }

  gitStage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(input, () => this.options.git.stage(input.directory, input.paths));
  }

  gitUnstage(input: GitPathsInput): Promise<SourceControlResult<GitWorkingTreeStatus>> {
    return this.write(input, () => this.options.git.unstage(input.directory, input.paths));
  }

  gitCommit(input: GitCommitInput): Promise<SourceControlResult<GitCommitResult>> {
    return this.write(input, () => this.options.git.commit(input.directory, input.message));
  }

  gitPush(target: GitTarget): Promise<SourceControlResult<GitPushResult>> {
    return this.write(target, () => this.options.git.push(target.directory));
  }

  private async write<T>(
    target: GitTarget,
    operation: () => Promise<T>,
  ): Promise<SourceControlResult<T>> {
    const guard = await sourceControlResult(() => this.assertLocal(target.profileID));
    if (!guard.ok) return { ok: false, error: guard.error };
    const result = await sourceControlResult(operation);
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
}
