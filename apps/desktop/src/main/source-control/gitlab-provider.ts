import type {
  CreatePullRequestInput,
  PullRequestAutoMergeInput,
  PullRequestCommentInput,
  PullRequestDetail,
  PullRequestDraftInput,
  PullRequestEditInput,
  PullRequestFiles,
  PullRequestMergeInput,
  PullRequestRef,
  PullRequestReviewInput,
  PullRequestSearchInput,
  PullRequestSearchPage,
  PullRequestStateInput,
  PullRequestTimelineInput,
  PullRequestTimelinePage,
  PullRequestPerson,
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
  id: number;
  username: string;
  avatar_url?: string;
}
interface Pipeline {
  id: number;
  status: string;
  web_url?: string;
  sha?: string;
}
interface MergeRequest {
  iid: number;
  project_id: number;
  title: string;
  description?: string;
  web_url: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  sha?: string;
  diff_refs?: { head_sha?: string };
  source_branch: string;
  target_branch: string;
  author?: User;
  created_at?: string;
  updated_at?: string;
  merged_at?: string;
  closed_at?: string;
  has_conflicts?: boolean;
  detailed_merge_status?: string;
  head_pipeline?: Pipeline;
  merge_when_pipeline_succeeds?: boolean;
  squash?: boolean;
  labels?: string[];
  user?: { can_merge?: boolean };
  references?: { full?: string };
}
interface Note {
  id: number;
  body: string;
  author?: User;
  created_at?: string;
  updated_at?: string;
  system?: boolean;
}
interface Diff {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
  too_large?: boolean;
  collapsed?: boolean;
}
const CAPABILITIES = {
  ...CORE_CAPABILITIES,
  draft: true,
  autoMerge: true,
  state: true,
  edit: true,
};
const person = (user?: User): PullRequestPerson | null =>
  user ? { login: user.username, avatarUrl: null, isBot: false } : null;

export class GitLabProvider extends RestHostProvider {
  readonly kind = "gitlab";
  protected api: string;
  private viewer: { user: User; at: number } | null = null;
  constructor(options: RestHostOptions) {
    super(options);
    this.api = `${options.account.url}/api/v4`;
  }
  private project(repo: HostRepository): string {
    this.assertRef(repo);
    return `projects/${encodeURIComponent(repo.repository)}`;
  }
  private mr(ref: PullRequestRef): string {
    this.assertRef(ref);
    return `${this.project(ref)}/merge_requests/${ref.number}`;
  }
  private async user(): Promise<User> {
    if (!this.viewer || Date.now() - this.viewer.at > 60_000)
      this.viewer = { user: await this.request<User>("user"), at: Date.now() };
    return this.viewer.user;
  }
  async defaultBranch(repo: HostRepository): Promise<string> {
    return (await this.request<{ default_branch: string }>(this.project(repo))).default_branch;
  }
  async find(
    repo: HostRepository,
    branch: string,
    openOnly = false,
  ): Promise<PullRequestRef | null> {
    const rows = await this.request<MergeRequest[]>(
      `${this.project(repo)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=${openOnly ? "opened" : "all"}&order_by=updated_at&sort=desc&per_page=20`,
    );
    const chosen = rows.find((row) => row.state === "opened") ?? rows[0];
    return chosen ? { ...repo, number: chosen.iid } : null;
  }
  async create(
    repo: HostRepository,
    branch: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef> {
    const row = await this.request<MergeRequest>(`${this.project(repo)}/merge_requests`, "POST", {
      source_branch: branch,
      target_branch: input.base,
      title: input.draft ? `Draft: ${input.title}` : input.title,
      description: input.body,
    });
    if (!Number.isSafeInteger(row.iid) || row.iid < 1)
      throw new SourceControlError(
        "host-unavailable",
        "GitLab did not return a merge request number. Check GitLab before retrying.",
      );
    return { ...repo, number: row.iid };
  }
  private toSnapshot(row: MergeRequest, repository: string) {
    return {
      host: this.host,
      repository,
      number: row.iid,
      title: row.title,
      url: `${this.options.account.url}/${repository}/-/merge_requests/${row.iid}`,
      state:
        row.state === "merged"
          ? ("merged" as const)
          : row.state === "closed"
            ? ("closed" as const)
            : row.draft || row.work_in_progress || /^(Draft:|WIP:)/i.test(row.title)
              ? ("draft" as const)
              : ("open" as const),
      checks:
        row.head_pipeline?.sha && row.head_pipeline.sha !== (row.diff_refs?.head_sha || row.sha)
          ? ("pending" as const)
          : pipelineSummary(row.head_pipeline?.status),
      reviewDecision: null,
      mergeable: row.has_conflicts
        ? ("conflicting" as const)
        : row.detailed_merge_status === "mergeable"
          ? ("mergeable" as const)
          : ("unknown" as const),
      headBranch: row.source_branch,
      baseBranch: row.target_branch,
      author: row.author?.username ?? null,
      updatedAt: time(row.updated_at),
      mergedAt: row.merged_at ? time(row.merged_at) : null,
      closedAt: row.closed_at ? time(row.closed_at) : null,
    };
  }
  async search(input: PullRequestSearchInput): Promise<PullRequestSearchPage> {
    const viewer = await this.user();
    if (input.list === "others")
      throw new SourceControlError(
        "unsupported-action",
        "Others' merge requests are listed for GitHub only.",
      );
    if (input.list === "mentioned")
      throw new SourceControlError(
        "unsupported-action",
        "GitLab does not expose a mentioned merge requests list. Use Authored, Assigned or Review requested.",
      );
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000)
      throw new SourceControlError("invalid-input", "Invalid list cursor.");
    const params = new URLSearchParams({
      scope: "all",
      state: input.list === "recently-merged" ? "merged" : "opened",
      order_by: "updated_at",
      sort: "desc",
      per_page: String(input.limit ?? 25),
      page: String(page),
    });
    if (input.list === "authored" || input.list === "recently-merged")
      params.set("author_id", String(viewer.id));
    if (input.list === "assigned") params.set("assignee_id", String(viewer.id));
    if (input.list === "review-requested") params.set("reviewer_id", String(viewer.id));
    if (input.query?.trim()) params.set("search", input.query.trim().slice(0, 256));
    const rows = await this.request<MergeRequest[]>(`merge_requests?${params}`);
    const items = rows.flatMap((row) => {
      const repository =
        row.references?.full?.replace(/!\d+$/, "") ||
        (() => {
          try {
            return new URL(row.web_url).pathname.split("/-/merge_requests/")[0]?.replace(/^\//, "");
          } catch {
            return null;
          }
        })();
      return repository ? [this.toSnapshot(row, repository)] : [];
    });
    return {
      list: input.list,
      items,
      totalCount: items.length,
      nextCursor: rows.length === (input.limit ?? 25) ? String(page + 1) : null,
    };
  }
  async detail(ref: PullRequestRef): Promise<PullRequestDetail> {
    const [row, user] = await Promise.all([this.request<MergeRequest>(this.mr(ref)), this.user()]);
    if (row.iid !== ref.number)
      throw new SourceControlError(
        "host-unavailable",
        "GitLab returned a different merge request.",
      );
    const detail = hostDetail(
      this.toSnapshot(row, ref.repository),
      row.diff_refs?.head_sha || row.sha || "",
      row.description ?? "",
      CAPABILITIES,
    );
    detail.authorPerson = person(row.author);
    detail.createdAt = time(row.created_at);
    detail.labels = (row.labels ?? []).map((name) => ({ name, color: "888888" }));
    detail.viewer = {
      ...detail.viewer,
      login: user.username,
      isAuthor: row.author?.id === user.id,
      canMerge: row.user?.can_merge !== false,
    };
    detail.mergeState = row.has_conflicts
      ? "dirty"
      : row.detailed_merge_status === "mergeable"
        ? "clean"
        : "blocked";
    const pipeline = row.head_pipeline;
    detail.checksComplete = !pipeline?.sha || pipeline.sha === detail.headOid;
    if (pipeline)
      detail.checkRuns = [
        {
          name: `Pipeline #${pipeline.id}`,
          workflow: "GitLab CI",
          status: pipelineSummary(pipeline.status) === "pending" ? "in-progress" : "completed",
          conclusion:
            pipelineSummary(pipeline.status) === "passing"
              ? "success"
              : pipelineSummary(pipeline.status) === "failing"
                ? "failure"
                : null,
          required: false,
          url: pipeline.web_url ?? null,
          startedAt: null,
          completedAt: null,
        },
      ];
    detail.autoMerge = row.merge_when_pipeline_succeeds
      ? { method: row.squash ? "squash" : "merge" }
      : null;
    return detail;
  }
  async timeline(input: PullRequestTimelineInput): Promise<PullRequestTimelinePage> {
    const page = input.cursor ? Number(input.cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new SourceControlError("invalid-input", "Invalid timeline cursor.");
    const rows = await this.request<Note[]>(
      `${this.mr(input)}/notes?sort=desc&order_by=updated_at&per_page=100&page=${page}`,
    );
    return {
      items: rows
        .filter((row) => !row.system || /(?:approved|unapproved|requested changes)/i.test(row.body))
        .toReversed()
        .map((row) => ({
          kind: "comment",
          id: String(row.id),
          author: person(row.author),
          body: row.body,
          createdAt: time(row.created_at),
          updatedAt: time(row.updated_at) || time(row.created_at),
          url: `${this.options.account.url}/${input.repository}/-/merge_requests/${input.number}#note_${row.id}`,
        })),
      nextCursor: rows.length === 100 ? String(page + 1) : null,
    };
  }
  async files(ref: PullRequestRef): Promise<PullRequestFiles> {
    const detail = await this.detail(ref);
    const rows: Diff[] = [];
    let truncated = false;
    for (let page = 1; page <= 30; page++) {
      const batch = await this.request<Diff[]>(`${this.mr(ref)}/diffs?per_page=100&page=${page}`);
      rows.push(...batch);
      truncated ||= batch.some((row) => row.too_large || row.collapsed);
      if (batch.length < 100) break;
      if (page === 30) truncated = true;
    }
    return {
      headOid: detail.headOid,
      truncated,
      files: rows.map((row) => ({
        path: row.new_path,
        previousPath: row.renamed_file ? row.old_path : null,
        status: row.new_file
          ? "added"
          : row.deleted_file
            ? "removed"
            : row.renamed_file
              ? "renamed"
              : "modified",
        additions: 0,
        deletions: 0,
        patch: row.diff ?? null,
        viewed: "unviewed",
      })),
    };
  }
  async comment(input: PullRequestCommentInput): Promise<void> {
    if (!input.body.trim()) throw new SourceControlError("invalid-input", "Write a comment first.");
    await this.request(`${this.mr(input)}/notes`, "POST", { body: input.body });
    this.changed(input, "commented");
  }
  async review(input: PullRequestReviewInput): Promise<void> {
    if (input.comments.length || input.event === "request-changes") this.unsupported();
    if (input.event === "approve")
      await this.request(`${this.mr(input)}/approve`, "POST", { sha: input.commitOid });
    if (input.body.trim()) await this.comment(input);
    this.changed(input, "reviewed");
  }
  async merge(input: PullRequestMergeInput): Promise<PullRequestDetail> {
    if (input.method === "rebase") this.unsupported();
    await this.request(`${this.mr(input)}/merge`, "PUT", {
      sha: input.expectedHeadOid,
      squash: input.method === "squash",
      ...(input.commitTitle
        ? {
            merge_commit_message: [input.commitTitle, input.commitBody]
              .filter(Boolean)
              .join("\n\n"),
          }
        : {}),
    });
    return this.after(input, "merged");
  }
  override async setAutoMerge(input: PullRequestAutoMergeInput): Promise<PullRequestDetail> {
    if (!input.enabled)
      await this.request(`${this.mr(input)}/cancel_merge_when_pipeline_succeeds`, "POST");
    else {
      const detail = await this.detail(input);
      await this.request(`${this.mr(input)}/merge`, "PUT", {
        sha: detail.headOid,
        merge_when_pipeline_succeeds: true,
        squash: input.method === "squash",
      });
    }
    return this.after(input, "state");
  }
  override async edit(input: PullRequestEditInput): Promise<PullRequestDetail> {
    await this.request(this.mr(input), "PUT", { title: input.title, description: input.body });
    return this.after(input, "edited");
  }
  override async setState(input: PullRequestStateInput): Promise<PullRequestDetail> {
    await this.request(this.mr(input), "PUT", {
      state_event: input.state === "closed" ? "close" : "reopen",
    });
    return this.after(input, "state");
  }
  override async setDraft(input: PullRequestDraftInput): Promise<PullRequestDetail> {
    const detail = await this.detail(input);
    const title = detail.title.replace(/^(?:Draft:|WIP:)\s*/i, "");
    await this.request(this.mr(input), "PUT", { title: input.draft ? `Draft: ${title}` : title });
    return this.after(input, "state");
  }
}

function pipelineSummary(status?: string): "none" | "passing" | "failing" | "pending" {
  if (!status) return "none";
  if (["success", "skipped"].includes(status)) return "passing";
  if (["failed", "canceled"].includes(status)) return "failing";
  return "pending";
}
