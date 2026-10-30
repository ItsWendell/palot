import type {
  CodeHostAccount,
  CodeHostCapabilities,
  CodeHostKind,
  PullRequestDetail,
  PullRequestRef,
  PullRequestSnapshot,
  PullRequestSearchInput,
  PullRequestSearchPage,
  CreatePullRequestInput,
  PullRequestTimelinePage,
  PullRequestTimelineInput,
  PullRequestFiles,
  PullRequestCommentInput,
  PullRequestMergeInput,
  PullRequestReviewInput,
  PullRequestAutoMergeInput,
  PullRequestEditInput,
  PullRequestStateInput,
  SourceControlChangedEvent,
} from "../../shared/source-control-contract";
import { pullRequestKey } from "../../shared/source-control-contract";
import type { PullRequestWatchDetail } from "./github-pull-requests";
import type { PullRequestReviewService } from "./pull-request-review";
import type { HostCredentials } from "./host-credentials";
import { SourceControlError } from "./errors";

export interface HostRepository {
  host: string;
  repository: string;
}
export type HostReview = Pick<
  PullRequestReviewService,
  | "detail"
  | "timeline"
  | "files"
  | "comment"
  | "review"
  | "merge"
  | "edit"
  | "setState"
  | "setDraft"
  | "setAutoMerge"
  | "setFileViewed"
  | "reply"
  | "resolve"
  | "requestReviewers"
  | "labels"
  | "setLabel"
  | "updateBranch"
>;

/** Provider identity is selected from a configured remote, never from response URLs. */
export interface CodeHostProvider extends HostReview {
  kind: CodeHostKind;
  host: string;
  snapshot(ref: PullRequestRef): Promise<PullRequestSnapshot>;
  defaultBranch(repo: HostRepository): Promise<string>;
  find(repo: HostRepository, branch: string, openOnly?: boolean): Promise<PullRequestRef | null>;
  create(
    repo: HostRepository,
    branch: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef>;
  search(input: PullRequestSearchInput): Promise<PullRequestSearchPage>;
  watch(ref: PullRequestRef): Promise<{
    snapshot: PullRequestSnapshot;
    detail: PullRequestWatchDetail;
    viewer: string | null;
  }>;
}

const SEGMENT = /^[\p{L}\p{N}_.-]+$/u;
export function repositoryPath(input: string): string | null {
  const segments = input
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/");
  return segments.length >= 2 &&
    segments.length <= 20 &&
    segments.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..")
    ? segments.join("/")
    : null;
}
export function parseHostRemote(input: string): HostRepository | null {
  const scp = /^[\w.-]+@([\w.-]+):\/?(.+)$/.exec(input.trim());
  if (scp) {
    const repository = repositoryPath(scp[2]!);
    return repository ? { host: scp[1]!.toLowerCase(), repository } : null;
  }
  try {
    const url = new URL(input.trim());
    if (!["https:", "ssh:", "git:", "git+ssh:"].includes(url.protocol)) return null;
    const repository = repositoryPath(decodeURIComponent(url.pathname));
    return repository
      ? { host: url.protocol === "ssh:" ? url.hostname : url.host, repository }
      : null;
  } catch {
    return null;
  }
}
export function parseHostPullRequestUrl(input: string): PullRequestRef | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const match = /^(.*?)\/(?:-\/merge_requests|pulls?|pull-requests)\/(\d{1,9})(?:\/|$)/.exec(
      url.pathname,
    );
    const repository = match ? repositoryPath(decodeURIComponent(match[1]!)) : null;
    const number = Number(match?.[2]);
    return repository && number > 0 ? { host: url.host, repository, number } : null;
  } catch {
    return null;
  }
}

export const CORE_CAPABILITIES: CodeHostCapabilities = {
  requestChanges: false,
  draft: false,
  review: true,
  inlineReview: false,
  fileViewed: false,
  reviewers: false,
  labels: false,
  updateBranch: false,
  autoMerge: false,
  state: false,
  edit: false,
};
export function hostDetail(
  snapshot: PullRequestSnapshot,
  headOid: string,
  body: string,
  capabilities = CORE_CAPABILITIES,
): PullRequestDetail {
  return {
    ...snapshot,
    body,
    headOid,
    capabilities,
    authorPerson: null,
    labels: [],
    assignees: [],
    reviewers: [],
    checkRuns: [],
    checksComplete: true,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    mergeState: snapshot.mergeable === "conflicting" ? "dirty" : "unknown",
    mergeMethods: ["merge", "squash"],
    autoMerge: null,
    autoMergeAllowed: capabilities.autoMerge,
    viewer: {
      login: null,
      canMerge: true,
      canUpdate: capabilities.edit,
      isAuthor: false,
      reviewState: null,
    },
    createdAt: snapshot.updatedAt,
  };
}
export function time(value?: string | null): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

type Fetch = typeof globalThis.fetch;
export interface RestHostOptions {
  account: CodeHostAccount;
  credentials: Pick<HostCredentials, "token">;
  emit(event: SourceControlChangedEvent): void;
  syncLinks(key: string): void;
  fetch?: Fetch;
}

/** Bounded requests with no credential-bearing redirects or remote-provided pagination URLs. */
export abstract class RestHostProvider implements CodeHostProvider {
  abstract readonly kind: CodeHostKind;
  readonly host: string;
  constructor(protected readonly options: RestHostOptions) {
    this.host = options.account.host;
  }
  protected abstract api: string;
  protected async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const token = await this.options.credentials.token(this.host);
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.api}/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `${this.kind === "forgejo" ? "token" : "Bearer"} ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => {
      throw new SourceControlError("host-unavailable", `Could not reach ${this.host}.`);
    });
    if (!response.ok) {
      // Never echo response bodies: hosts/proxies can reflect request secrets in their errors.
      throw new SourceControlError(
        response.status === 401
          ? "host-unauthenticated"
          : response.status === 409
            ? "merge-head-moved"
            : "host-unavailable",
        `${this.host} refused the request (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " Check the token and its repository permissions." : " Refresh before retrying."}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const reader = response.body?.getReader();
    if (!reader) return undefined as T;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 8 * 1024 * 1024)
          throw new SourceControlError("host-unavailable", "The code host response is too large.");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return size ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as T) : (undefined as T);
  }
  protected assertRef(ref: HostRepository & { number?: number }): void {
    if (
      ref.host !== this.host ||
      !repositoryPath(ref.repository) ||
      (ref.number !== undefined && (!Number.isSafeInteger(ref.number) || ref.number < 1))
    )
      throw new SourceControlError(
        "invalid-input",
        "The code host repository or request number is invalid.",
      );
  }
  protected changed(
    ref: PullRequestRef,
    reason: Extract<SourceControlChangedEvent, { type: "pull-request" }>["reason"],
  ): void {
    this.options.emit({ type: "pull-request", key: pullRequestKey(ref), reason });
    this.options.syncLinks(pullRequestKey(ref));
  }
  protected async after(
    ref: PullRequestRef,
    reason: Extract<SourceControlChangedEvent, { type: "pull-request" }>["reason"],
  ): Promise<PullRequestDetail> {
    this.changed(ref, reason);
    return this.detail(ref);
  }
  protected unsupported(): never {
    throw new SourceControlError(
      "unsupported-action",
      `This action is not supported for ${this.kind} in Palot yet. Open it on ${this.host}.`,
    );
  }
  abstract defaultBranch(repo: HostRepository): Promise<string>;
  abstract find(
    repo: HostRepository,
    branch: string,
    openOnly?: boolean,
  ): Promise<PullRequestRef | null>;
  abstract create(
    repo: HostRepository,
    branch: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef>;
  abstract search(input: PullRequestSearchInput): Promise<PullRequestSearchPage>;
  abstract detail(ref: PullRequestRef): Promise<PullRequestDetail>;
  snapshot(ref: PullRequestRef): Promise<PullRequestSnapshot> {
    return this.detail(ref);
  }
  abstract timeline(input: PullRequestTimelineInput): Promise<PullRequestTimelinePage>;
  abstract files(ref: PullRequestRef): Promise<PullRequestFiles>;
  abstract comment(input: PullRequestCommentInput): Promise<void>;
  abstract review(input: PullRequestReviewInput): Promise<void>;
  abstract merge(input: PullRequestMergeInput): Promise<PullRequestDetail>;
  async edit(_input: PullRequestEditInput): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async setState(_input: PullRequestStateInput): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async setDraft(_input: Parameters<HostReview["setDraft"]>[0]): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async setAutoMerge(_input: PullRequestAutoMergeInput): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async setFileViewed(_input: Parameters<HostReview["setFileViewed"]>[0]): Promise<void> {
    this.unsupported();
  }
  async reply(_input: Parameters<HostReview["reply"]>[0]): Promise<void> {
    this.unsupported();
  }
  async resolve(_input: Parameters<HostReview["resolve"]>[0]): Promise<void> {
    this.unsupported();
  }
  async requestReviewers(
    _input: Parameters<HostReview["requestReviewers"]>[0],
  ): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async labels(_input: PullRequestRef): Promise<Array<{ name: string; color: string }>> {
    return this.unsupported();
  }
  async setLabel(_input: Parameters<HostReview["setLabel"]>[0]): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async updateBranch(
    _input: Parameters<HostReview["updateBranch"]>[0],
  ): Promise<PullRequestDetail> {
    return this.unsupported();
  }
  async watch(ref: PullRequestRef): ReturnType<CodeHostProvider["watch"]> {
    const [snapshot, timeline] = await Promise.all([this.detail(ref), this.timeline(ref)]);
    return {
      snapshot,
      viewer: snapshot.viewer.login,
      detail: {
        headSha: snapshot.headOid,
        mergeable: snapshot.mergeable,
        baseBranch: snapshot.baseBranch,
        checks: snapshot.checkRuns.map((check) => ({
          name: check.name,
          status:
            check.status !== "completed"
              ? "pending"
              : check.conclusion === "success" ||
                  check.conclusion === "skipped" ||
                  check.conclusion === "neutral"
                ? "success"
                : "failure",
          required: check.required,
          conclusion: check.conclusion,
          url: check.url,
        })),
        checksComplete: snapshot.checksComplete,
        remarks: timeline.items.flatMap((item) =>
          item.kind === "comment"
            ? [
                {
                  id: item.id,
                  author: item.author?.login ?? null,
                  body: item.body,
                  activeAt: item.updatedAt,
                  url: item.url,
                  path: null,
                  reviewState: null,
                },
              ]
            : [],
        ),
        remarksComplete: timeline.nextCursor === null,
      },
    };
  }
}
