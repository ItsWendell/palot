import type {
  CodeHostAccount,
  PullRequestRef,
  PullRequestSearchInput,
} from "../../shared/source-control-contract";
import { BitbucketProvider } from "./bitbucket-provider";
import { ForgejoProvider } from "./forgejo-provider";
import { GitLabProvider } from "./gitlab-provider";
import type { GitHubGateway } from "./github-client";
import { isSupportedGitHubHost } from "./github-credentials";
import {
  parsePullRequestBatch,
  pullRequestBatchQuery,
  parsePullRequestSearch,
  pullRequestSearchQuery,
} from "./github-pull-requests";
import { completeWatchDetail } from "./pull-request-watch-reader";
import { HostCredentials } from "./host-credentials";
import type {
  CodeHostProvider,
  HostRepository,
  HostReview,
  RestHostOptions,
} from "./host-provider";
import { SourceControlError } from "./errors";

export class HostProviders {
  private readonly cached = new Map<string, { account: string; provider: CodeHostProvider }>();
  constructor(
    readonly credentials: HostCredentials,
    private readonly github: GitHubGateway,
    private readonly githubReview: HostReview,
    private readonly options: Pick<RestHostOptions, "emit" | "syncLinks" | "fetch">,
    private readonly env: () => NodeJS.ProcessEnv = () => process.env,
  ) {}
  accounts(): CodeHostAccount[] {
    return this.credentials.accounts();
  }
  supports(host: string): boolean {
    return (
      isSupportedGitHubHost(host, this.env()) ||
      this.accounts().some((account) => account.host === host)
    );
  }
  get(host: string): CodeHostProvider {
    if (isSupportedGitHubHost(host, this.env()))
      return githubProvider(host, this.github, this.githubReview);
    const account = this.accounts().find((entry) => entry.host === host);
    if (!account)
      throw new SourceControlError(
        "unsupported-remote",
        `Configure ${host} in Settings → Source control first.`,
      );
    const identity = JSON.stringify(account);
    const cached = this.cached.get(host);
    if (cached?.account === identity) return cached.provider;
    const options = { ...this.options, account, credentials: this.credentials };
    const provider =
      account.kind === "gitlab"
        ? new GitLabProvider(options)
        : account.kind === "forgejo"
          ? new ForgejoProvider(options)
          : new BitbucketProvider(options);
    this.cached.set(host, { account: identity, provider });
    return provider;
  }
}

/** GitHub stays the reference implementation, including its existing review semantics. */
function githubProvider(host: string, github: GitHubGateway, review: HostReview): CodeHostProvider {
  const path = (repo: HostRepository) => {
    const [owner, name, extra] = repo.repository.split("/");
    if (!owner || !name || extra)
      throw new SourceControlError("invalid-input", "GitHub repositories use owner/name.");
    return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  };
  const read = async (ref: PullRequestRef, watched: boolean) => {
    const [owner = "", name = ""] = ref.repository.split("/");
    const targets = [{ ref: { host, owner, name, number: ref.number }, watched }];
    const query = pullRequestBatchQuery(targets);
    const result = parsePullRequestBatch(
      await github.graphql<Record<string, unknown>>({ host, ...query, priority: "interactive" }),
      targets,
    );
    const entry = result.entries[0];
    if (!entry?.snapshot)
      throw new SourceControlError(
        "github-not-found",
        `GitHub could not find ${ref.repository}#${ref.number}, or the credential cannot see it.`,
      );
    return { ...entry, snapshot: entry.snapshot, viewer: result.viewer };
  };
  return {
    kind: "github",
    snapshot: async (ref) => (await read(ref, false)).snapshot,
    host,
    defaultBranch: async (repo) =>
      (
        await github.rest<{ default_branch: string }>({
          host,
          path: path(repo),
          priority: "interactive",
        })
      ).data.default_branch,
    find: async (repo, branch, openOnly = false) => {
      const owner = repo.repository.split("/")[0]!;
      const result = await github.rest<Array<{ number: number; state: string }>>({
        host,
        path: `${path(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=${openOnly ? "open" : "all"}&sort=updated&direction=desc&per_page=10`,
        priority: "interactive",
      });
      const row = result.data.find((pull) => pull.state === "open") ?? result.data[0];
      return row ? { ...repo, number: row.number } : null;
    },
    create: async (repo, branch, input) => {
      const result = await github.rest<{ number: number }>({
        host,
        path: `${path(repo)}/pulls`,
        method: "POST",
        priority: "interactive",
        body: {
          head: branch,
          base: input.base,
          title: input.title.trim(),
          body: input.body,
          draft: input.draft ?? false,
        },
      });
      if (!Number.isSafeInteger(result.data.number) || result.data.number < 1)
        throw new SourceControlError(
          "github-unavailable",
          "GitHub did not return a pull request number. Check GitHub before retrying.",
        );
      return { ...repo, number: result.data.number };
    },
    search: async (input: PullRequestSearchInput) => {
      const { query, search } = pullRequestSearchQuery(input.list, input.query);
      const data = await github.graphql<Parameters<typeof parsePullRequestSearch>[0]>({
        host,
        query,
        variables: { q: search, first: input.limit ?? 25, after: input.cursor ?? null },
        priority: "interactive",
      });
      return { list: input.list, ...parsePullRequestSearch(data, host) };
    },
    watch: async (ref) => {
      const entry = await read(ref, true);
      if (!entry.watch)
        throw new SourceControlError(
          "github-unavailable",
          "GitHub returned the pull request without its checks and comments.",
        );
      const detail = await completeWatchDetail({
        github,
        host,
        number: ref.number,
        page: entry.watch,
        snapshot: entry.snapshot,
        since: 0,
        priority: "interactive",
      });
      return { snapshot: entry.snapshot, detail, viewer: entry.viewer };
    },
    detail: (input) => review.detail(input),
    timeline: (input) => review.timeline(input),
    files: (input) => review.files(input),
    comment: (input) => review.comment(input),
    review: (input) => review.review(input),
    merge: (input) => review.merge(input),
    edit: (input) => review.edit(input),
    setState: (input) => review.setState(input),
    setDraft: (input) => review.setDraft(input),
    setAutoMerge: (input) => review.setAutoMerge(input),
    setFileViewed: (input) => review.setFileViewed(input),
    reply: (input) => review.reply(input),
    resolve: (input) => review.resolve(input),
    requestReviewers: (input) => review.requestReviewers(input),
    labels: (input) => review.labels(input),
    setLabel: (input) => review.setLabel(input),
    updateBranch: (input) => review.updateBranch(input),
  };
}
