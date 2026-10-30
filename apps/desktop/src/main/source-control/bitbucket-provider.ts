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
  hostDetail,
  RestHostProvider,
  time,
  type HostRepository,
  type RestHostOptions,
  repositoryPath,
} from "./host-provider";
import { SourceControlError } from "./errors";
interface User {
  nickname?: string;
  display_name?: string;
  uuid?: string;
}
interface Pull {
  id: number;
  title: string;
  description?: string;
  state: string;
  author?: User;
  created_on?: string;
  updated_on?: string;
  source: { branch: { name: string }; commit: { hash: string } };
  destination: { branch: { name: string } };
  participants?: Array<{ user: User; approved?: boolean }>;
}
interface Page<T> {
  values: T[];
  next?: string;
  size?: number;
}
interface Build {
  key: string;
  name?: string;
  state: string;
  url?: string;
}
export class BitbucketProvider extends RestHostProvider {
  readonly kind = "bitbucket";
  protected api = "https://api.bitbucket.org/2.0";
  constructor(options: RestHostOptions) {
    super(options);
  }
  private repo(repo: HostRepository): string {
    this.assertRef(repo);
    if (repo.repository.split("/").length !== 2)
      throw new SourceControlError(
        "invalid-input",
        "Bitbucket repositories use workspace/repository.",
      );
    return `repositories/${repo.repository.split("/").map(encodeURIComponent).join("/")}`;
  }
  private pull(ref: PullRequestRef): string {
    this.assertRef(ref);
    return `${this.repo(ref)}/pullrequests/${ref.number}`;
  }
  async defaultBranch(repo: HostRepository): Promise<string> {
    return (await this.request<{ mainbranch: { name: string } }>(this.repo(repo))).mainbranch.name;
  }
  async find(
    repo: HostRepository,
    branch: string,
    openOnly = false,
  ): Promise<PullRequestRef | null> {
    const query = `source.branch.name=${JSON.stringify(branch)}`;
    const page = await this.request<Page<Pull>>(
      `${this.repo(repo)}/pullrequests?q=${encodeURIComponent(query)}&${openOnly ? "state=OPEN" : "state=OPEN&state=MERGED&state=DECLINED"}&sort=-updated_on&pagelen=20`,
    );
    const row = page.values.find((pull) => pull.state === "OPEN") ?? page.values[0];
    return row ? { ...repo, number: row.id } : null;
  }
  async create(
    repo: HostRepository,
    branch: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef> {
    if (input.draft) this.unsupported();
    const row = await this.request<Pull>(`${this.repo(repo)}/pullrequests`, "POST", {
      title: input.title,
      description: input.body,
      source: { branch: { name: branch } },
      destination: { branch: { name: input.base } },
      close_source_branch: false,
    });
    return { ...repo, number: row.id };
  }
  private toSnapshot(row: Pull, repository: string) {
    return {
      host: this.host,
      repository,
      number: row.id,
      title: row.title,
      url: `https://bitbucket.org/${repository}/pull-requests/${row.id}`,
      state:
        row.state === "MERGED"
          ? ("merged" as const)
          : row.state === "DECLINED" || row.state === "SUPERSEDED"
            ? ("closed" as const)
            : ("open" as const),
      checks: "none" as const,
      reviewDecision: row.participants?.some((participant) => participant.approved)
        ? ("approved" as const)
        : null,
      mergeable: "unknown" as const,
      headBranch: row.source.branch.name,
      baseBranch: row.destination.branch.name,
      author: row.author?.nickname ?? row.author?.display_name ?? null,
      updatedAt: time(row.updated_on),
      mergedAt: row.state === "MERGED" ? time(row.updated_on) : null,
      closedAt: row.state === "DECLINED" ? time(row.updated_on) : null,
    };
  }
  async detail(ref: PullRequestRef): Promise<PullRequestDetail> {
    const row = await this.request<Pull>(this.pull(ref));
    const checks = await this.request<Page<Build>>(
      `${this.repo(ref)}/commit/${encodeURIComponent(row.source.commit.hash)}/statuses/build?pagelen=100`,
    );
    const detail = hostDetail(
      this.toSnapshot(row, ref.repository),
      row.source.commit.hash,
      row.description ?? "",
    );
    detail.checkRuns = checks.values.map((build) => ({
      name: build.name || build.key,
      workflow: "Bitbucket",
      status: build.state === "INPROGRESS" ? "in-progress" : "completed",
      conclusion:
        build.state === "SUCCESSFUL" ? "success" : build.state === "INPROGRESS" ? null : "failure",
      required: false,
      url: build.url ?? null,
      startedAt: null,
      completedAt: null,
    }));
    detail.checksComplete = !checks.next;
    detail.checks = detail.checkRuns.some((check) => check.conclusion === "failure")
      ? "failing"
      : detail.checkRuns.some((check) => check.status !== "completed")
        ? "pending"
        : detail.checkRuns.length
          ? "passing"
          : "none";
    detail.createdAt = time(row.created_on);
    // Cloud's merge endpoint has no expected-head precondition. Preserve Palot's merge safety
    // contract rather than offer a racy read-then-merge; the web link remains available.
    detail.viewer.canMerge = false;
    detail.mergeMethods = [];
    detail.capabilities = {
      ...detail.capabilities!,
      mergeDisabledReason:
        "Bitbucket's API cannot atomically verify the reviewed head when merging. Merge on Bitbucket instead.",
    };
    return detail;
  }
  async search(input: PullRequestSearchInput): Promise<PullRequestSearchPage> {
    const match = /(?:^|\s)repo:([^\s]+)/.exec(input.query ?? "");
    const repository = match && repositoryPath(match[1]!);
    if (!repository)
      throw new SourceControlError(
        "unsupported-action",
        "For Bitbucket, choose a repository filter or search repo:workspace/repository.",
      );
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new SourceControlError("invalid-input", "Invalid list cursor.");
    const rows = await this.request<Page<Pull>>(
      `${this.repo({ host: this.host, repository })}/pullrequests?state=${input.list === "recently-merged" ? "MERGED" : "OPEN"}&sort=-updated_on&pagelen=${input.limit ?? 25}&page=${page}`,
    );
    return {
      list: input.list,
      items: rows.values.map((row) => this.toSnapshot(row, repository)),
      totalCount: rows.size ?? rows.values.length,
      nextCursor: rows.next ? String(page + 1) : null,
    };
  }
  async timeline(input: PullRequestTimelineInput): Promise<PullRequestTimelinePage> {
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new SourceControlError("invalid-input", "Invalid timeline cursor.");
    const rows = await this.request<
      Page<{
        id: number;
        content: { raw: string };
        user?: User;
        created_on?: string;
        updated_on?: string;
        deleted?: boolean;
      }>
    >(`${this.pull(input)}/comments?sort=-updated_on&pagelen=100&page=${page}`);
    return {
      items: rows.values
        .filter((row) => !row.deleted)
        .toReversed()
        .map((row) => ({
          kind: "comment",
          id: String(row.id),
          author: row.user
            ? {
                login: row.user.nickname || row.user.display_name || "Unknown",
                avatarUrl: null,
                isBot: false,
              }
            : null,
          body: row.content.raw,
          createdAt: time(row.created_on),
          updatedAt: time(row.updated_on),
          url: `https://bitbucket.org/${input.repository}/pull-requests/${input.number}#comment-${row.id}`,
        })),
      nextCursor: rows.next ? String(page + 1) : null,
    };
  }
  async files(ref: PullRequestRef): Promise<PullRequestFiles> {
    const detail = await this.detail(ref);
    const rows = await this.request<
      Page<{
        status: string;
        old?: { path: string };
        new?: { path: string };
        lines_added?: number;
        lines_removed?: number;
      }>
    >(`${this.pull(ref)}/diffstat?pagelen=100`);
    return {
      headOid: detail.headOid,
      truncated: Boolean(rows.next),
      files: rows.values.map((row) => ({
        path: row.new?.path || row.old?.path || "",
        previousPath: row.status === "renamed" ? (row.old?.path ?? null) : null,
        status:
          row.status === "added"
            ? "added"
            : row.status === "removed"
              ? "removed"
              : row.status === "renamed"
                ? "renamed"
                : "modified",
        additions: row.lines_added ?? 0,
        deletions: row.lines_removed ?? 0,
        patch: null,
        viewed: "unviewed",
      })),
    };
  }
  async comment(input: PullRequestCommentInput): Promise<void> {
    if (!input.body.trim()) throw new SourceControlError("invalid-input", "Write a comment first.");
    await this.request(`${this.pull(input)}/comments`, "POST", { content: { raw: input.body } });
    this.changed(input, "commented");
  }
  async review(input: PullRequestReviewInput): Promise<void> {
    if (input.comments.length || input.event === "request-changes") this.unsupported();
    if (input.event === "approve") await this.request(`${this.pull(input)}/approve`, "POST");
    if (input.body.trim()) await this.comment(input);
    this.changed(input, "reviewed");
  }
  async merge(_input: PullRequestMergeInput): Promise<PullRequestDetail> {
    throw new SourceControlError(
      "unsupported-action",
      "Bitbucket Cloud cannot atomically check the reviewed head while merging. Merge on Bitbucket to avoid merging unseen commits.",
    );
  }
}
