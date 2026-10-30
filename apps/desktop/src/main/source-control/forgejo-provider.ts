import type {
  CreatePullRequestInput,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestFiles,
  PullRequestMergeInput,
  PullRequestRef,
  PullRequestReviewInput,
  PullRequestSearchInput,
  PullRequestSearchPage,
  PullRequestTimelineInput,
  PullRequestTimelinePage,
} from "../../shared/source-control-contract";
import {
  CORE_CAPABILITIES,
  hostDetail,
  RestHostProvider,
  time,
  type HostRepository,
  type RestHostOptions,
} from "./host-provider";
import { SourceControlError } from "./errors";

interface User {
  login: string;
  id?: number;
}
interface Pull {
  number: number;
  title: string;
  body?: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  user?: User;
  head: { ref: string; sha: string };
  base: { ref: string; repo?: { full_name?: string } };
  updated_at?: string;
  created_at?: string;
  merged_at?: string;
  closed_at?: string;
  mergeable?: boolean;
}
interface Status {
  context: string;
  status: string;
  target_url?: string;
}
interface Comment {
  id: number;
  body: string;
  user?: User;
  created_at?: string;
  updated_at?: string;
}
export class ForgejoProvider extends RestHostProvider {
  readonly kind = "forgejo";
  protected api: string;
  constructor(options: RestHostOptions) {
    super(options);
    this.api = `${options.account.url}/api/v1`;
  }
  private repo(repo: HostRepository): string {
    this.assertRef(repo);
    return `repos/${repo.repository.split("/").map(encodeURIComponent).join("/")}`;
  }
  private pull(ref: PullRequestRef): string {
    this.assertRef(ref);
    return `${this.repo(ref)}/pulls/${ref.number}`;
  }
  async defaultBranch(repo: HostRepository): Promise<string> {
    return (await this.request<{ default_branch: string }>(this.repo(repo))).default_branch;
  }
  async find(
    repo: HostRepository,
    branch: string,
    openOnly = false,
  ): Promise<PullRequestRef | null> {
    // Gitea's list endpoint does not filter by head. Bound the scan, don't claim absence if incomplete.
    for (let page = 1; page <= 20; page++) {
      const pulls = await this.request<Pull[]>(
        `${this.repo(repo)}/pulls?state=${openOnly ? "open" : "all"}&sort=recentupdate&limit=50&page=${page}`,
      );
      const row = pulls.find((pull) => pull.head.ref === branch);
      if (row) return { ...repo, number: row.number };
      if (pulls.length < 50) return null;
    }
    throw new SourceControlError(
      "host-unavailable",
      "Too many pull requests to detect this branch safely. Link its URL instead.",
    );
  }
  async create(
    repo: HostRepository,
    branch: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef> {
    if (input.draft) this.unsupported();
    const row = await this.request<Pull>(`${this.repo(repo)}/pulls`, "POST", {
      head: branch,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { ...repo, number: row.number };
  }
  private toSnapshot(row: Pull, repository: string) {
    return {
      host: this.host,
      repository,
      number: row.number,
      title: row.title,
      url: `${this.options.account.url}/${repository}/pulls/${row.number}`,
      state: row.merged
        ? ("merged" as const)
        : row.state === "closed"
          ? ("closed" as const)
          : row.draft
            ? ("draft" as const)
            : ("open" as const),
      checks: "none" as const,
      reviewDecision: null,
      mergeable:
        row.mergeable === true
          ? ("mergeable" as const)
          : row.mergeable === false
            ? ("conflicting" as const)
            : ("unknown" as const),
      headBranch: row.head.ref,
      baseBranch: row.base.ref,
      author: row.user?.login ?? null,
      updatedAt: time(row.updated_at),
      mergedAt: row.merged_at ? time(row.merged_at) : null,
      closedAt: row.closed_at ? time(row.closed_at) : null,
    };
  }
  async detail(ref: PullRequestRef): Promise<PullRequestDetail> {
    const row = await this.request<Pull>(this.pull(ref));
    const [statuses, viewer] = await Promise.all([
      this.request<{ statuses: Status[]; total_count?: number }>(
        `${this.repo(ref)}/commits/${encodeURIComponent(row.head.sha)}/status?limit=100`,
      ),
      this.request<User>("user"),
    ]);
    const detail = hostDetail(this.toSnapshot(row, ref.repository), row.head.sha, row.body ?? "", {
      ...CORE_CAPABILITIES,
      requestChanges: true,
    });
    const byName = new Map<string, Status>();
    for (const status of statuses.statuses ?? [])
      if (!byName.has(status.context)) byName.set(status.context, status);
    detail.checkRuns = [...byName.values()].map((status) => ({
      name: status.context,
      workflow: null,
      status: status.status === "pending" ? "in-progress" : "completed",
      conclusion:
        status.status === "success" ? "success" : status.status === "pending" ? null : "failure",
      required: false,
      url: status.target_url ?? null,
      startedAt: null,
      completedAt: null,
    }));
    detail.checksComplete = (statuses.total_count ?? statuses.statuses.length) <= 100;
    detail.checks = detail.checkRuns.some((check) => check.conclusion === "failure")
      ? "failing"
      : detail.checkRuns.some((check) => check.status !== "completed")
        ? "pending"
        : detail.checkRuns.length
          ? "passing"
          : "none";
    detail.viewer = {
      ...detail.viewer,
      login: viewer.login,
      isAuthor: viewer.login === row.user?.login,
    };
    detail.createdAt = time(row.created_at);
    detail.mergeState =
      row.mergeable === true ? "clean" : row.mergeable === false ? "dirty" : "unknown";
    detail.mergeMethods = ["merge", "squash", "rebase"];
    return detail;
  }
  async search(input: PullRequestSearchInput): Promise<PullRequestSearchPage> {
    if (input.list === "mentioned" || input.list === "recently-merged" || input.list === "others")
      this.unsupported();
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new SourceControlError("invalid-input", "Invalid list cursor.");
    const rows = await this.request<
      Array<Pull & { repository?: { full_name: string }; pull_request?: unknown }>
    >(
      `repos/issues/search?type=pulls&state=open&${input.list === "authored" ? "created" : input.list === "assigned" ? "assigned" : "review_requested"}=true&q=${encodeURIComponent(input.query ?? "")}&limit=${input.limit ?? 25}&page=${page}`,
    );
    // The issue search returns issue-shaped rows; read each PR for its head/base metadata.
    const items = await Promise.all(
      rows
        .filter((row) => row.repository?.full_name)
        .map((row) =>
          this.detail({
            host: this.host,
            repository: row.repository!.full_name,
            number: row.number,
          }),
        ),
    );
    return {
      list: input.list,
      items,
      totalCount: items.length,
      nextCursor: rows.length === (input.limit ?? 25) ? String(page + 1) : null,
    };
  }
  async timeline(input: PullRequestTimelineInput): Promise<PullRequestTimelinePage> {
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new SourceControlError("invalid-input", "Invalid timeline cursor.");
    const rows = await this.request<Comment[]>(
      `${this.repo(input)}/issues/${input.number}/comments?limit=100&page=${page}`,
    );
    return {
      items: rows.map((row) => ({
        kind: "comment",
        id: String(row.id),
        author: row.user ? { login: row.user.login, avatarUrl: null, isBot: false } : null,
        body: row.body,
        createdAt: time(row.created_at),
        updatedAt: time(row.updated_at),
        url: `${this.options.account.url}/${input.repository}/pulls/${input.number}#issuecomment-${row.id}`,
      })),
      nextCursor: rows.length === 100 ? String(page + 1) : null,
    };
  }
  async files(ref: PullRequestRef): Promise<PullRequestFiles> {
    const detail = await this.detail(ref);
    const rows = await this.request<
      Array<{
        filename: string;
        previous_filename?: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>
    >(`${this.pull(ref)}/files?limit=100`);
    return {
      headOid: detail.headOid,
      truncated: rows.length === 100,
      files: rows.map((row) => ({
        path: row.filename,
        previousPath: row.previous_filename ?? null,
        status:
          row.status === "added"
            ? "added"
            : row.status === "removed" || row.status === "deleted"
              ? "removed"
              : row.status === "renamed"
                ? "renamed"
                : "modified",
        additions: row.additions ?? 0,
        deletions: row.deletions ?? 0,
        patch: row.patch ?? null,
        viewed: "unviewed",
      })),
    };
  }
  async comment(input: PullRequestCommentInput): Promise<void> {
    if (!input.body.trim()) throw new SourceControlError("invalid-input", "Write a comment first.");
    await this.request(`${this.repo(input)}/issues/${input.number}/comments`, "POST", {
      body: input.body,
    });
    this.changed(input, "commented");
  }
  async review(input: PullRequestReviewInput): Promise<void> {
    if (input.comments.length) this.unsupported();
    await this.request(`${this.pull(input)}/reviews`, "POST", {
      event:
        input.event === "approve"
          ? "APPROVED"
          : input.event === "request-changes"
            ? "REQUEST_CHANGES"
            : "COMMENT",
      body: input.body,
      commit_id: input.commitOid,
    });
    this.changed(input, "reviewed");
  }
  async merge(input: PullRequestMergeInput): Promise<PullRequestDetail> {
    await this.request(`${this.pull(input)}/merge`, "POST", {
      Do: input.method,
      head_commit_id: input.expectedHeadOid,
      ...(input.commitTitle ? { MergeTitleField: input.commitTitle } : {}),
      ...(input.commitBody ? { MergeMessageField: input.commitBody } : {}),
    });
    return this.after(input, "merged");
  }
}
