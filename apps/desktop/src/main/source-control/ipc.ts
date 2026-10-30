import type { IpcMainInvokeEvent } from "electron";
import * as v from "valibot";
import { SOURCE_CONTROL_IPC_CHANNELS } from "../../shared/source-control-contract";
import type { SourceControlService } from "./source-control-service";

type Register = (
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const directory = v.pipe(v.string(), v.minLength(1), v.maxLength(16_384));
const pullRequestKey = v.pipe(v.string(), v.minLength(1), v.maxLength(1_024));
const session = { profileID: identifier, sessionID: identifier };
const gitTarget = { profileID: identifier, directory };
const ref = {
  host: v.pipe(v.string(), v.minLength(1), v.maxLength(253)),
  repository: v.pipe(v.string(), v.minLength(3), v.maxLength(201)),
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
};
/** GitHub's own body limit is 65,536 characters. */
const text = v.pipe(v.string(), v.maxLength(65_536));
const filePath = v.pipe(v.string(), v.minLength(1), v.maxLength(4_096));
const lineNumber = v.pipe(v.number(), v.integer(), v.minValue(1));

export const sourceControlSchemas = {
  status: v.optional(identifier),
  links: v.optional(
    v.strictObject({ profileID: v.optional(identifier), sessionID: v.optional(identifier) }),
    {},
  ),
  link: v.strictObject({
    ...session,
    url: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2_048))),
  }),
  prepare: v.strictObject({ ...session, base: v.optional(identifier) }),
  create: v.strictObject({
    ...session,
    base: identifier,
    title: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    body: text,
    draft: v.optional(v.boolean()),
  }),
  unlink: v.strictObject({ ...session, key: pullRequestKey }),
  refresh: v.strictObject({ profileID: identifier, sessionID: v.optional(identifier) }),
  watch: v.strictObject({ ...session, key: pullRequestKey, watching: v.boolean() }),
  search: v.strictObject({
    host: v.optional(identifier),
    list: v.picklist([
      "review-requested",
      "authored",
      "assigned",
      "mentioned",
      "recently-merged",
      "others",
    ]),
    cursor: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1_024)))),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
    // Sanitized and capped in main; this bound only rejects absurd payloads.
    query: v.optional(v.pipe(v.string(), v.maxLength(4_096))),
  }),
  pullRequest: v.strictObject(ref),
  timeline: v.strictObject({
    ...ref,
    cursor: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(4_096)))),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))),
  }),
  fileViewed: v.strictObject({ ...ref, path: filePath, viewed: v.boolean() }),
  review: v.strictObject({
    ...ref,
    event: v.picklist(["approve", "request-changes", "comment"]),
    body: text,
    commitOid: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/i)),
    comments: v.pipe(
      v.array(
        v.strictObject({
          path: filePath,
          line: lineNumber,
          startLine: v.optional(lineNumber),
          side: v.picklist(["LEFT", "RIGHT"]),
          body: v.pipe(text, v.minLength(1)),
        }),
      ),
      v.maxLength(500),
    ),
  }),
  comment: v.strictObject({ ...ref, body: v.pipe(text, v.minLength(1)) }),
  threadReply: v.strictObject({ ...ref, threadID: identifier, body: v.pipe(text, v.minLength(1)) }),
  threadResolve: v.strictObject({ ...ref, threadID: identifier, resolved: v.boolean() }),
  merge: v.strictObject({
    ...ref,
    method: v.picklist(["merge", "squash", "rebase"]),
    expectedHeadOid: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/i)),
    commitTitle: v.optional(v.pipe(v.string(), v.maxLength(1_024))),
    commitBody: v.optional(text),
  }),
  state: v.strictObject({ ...ref, state: v.picklist(["open", "closed"]) }),
  draft: v.strictObject({ ...ref, draft: v.boolean() }),
  reviewers: v.strictObject({
    ...ref,
    reviewers: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
      v.minLength(1),
      v.maxLength(100),
    ),
  }),
  gitTarget: v.strictObject(gitTarget),
  gitBranch: v.strictObject({
    ...gitTarget,
    action: v.picklist(["switch", "create", "rename"]),
    name: identifier,
    base: v.optional(identifier),
  }),
  edit: v.strictObject({
    ...ref,
    title: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    body: text,
  }),
  label: v.strictObject({
    ...ref,
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
    add: v.boolean(),
  }),
  autoMerge: v.strictObject({
    ...ref,
    enabled: v.boolean(),
    method: v.picklist(["merge", "squash", "rebase"]),
  }),
  updateBranch: v.strictObject({
    ...ref,
    expectedHeadOid: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/i)),
  }),
  gitPush: v.strictObject({ ...gitTarget, confirmDefaultBranch: v.optional(v.boolean()) }),
  gitPull: v.strictObject({
    ...gitTarget,
    strategy: v.optional(v.picklist(["ff-only", "rebase", "merge"])),
  }),
  gitSync: v.strictObject({
    ...gitTarget,
    strategy: v.optional(v.picklist(["ff-only", "rebase", "merge"])),
    confirmDefaultBranch: v.optional(v.boolean()),
  }),
  gitPaths: v.strictObject({
    ...gitTarget,
    paths: v.pipe(
      v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(4_096))),
      v.minLength(1),
      v.maxLength(2_000),
    ),
  }),
  gitCommit: v.strictObject({
    ...gitTarget,
    message: v.pipe(v.string(), v.minLength(1), v.maxLength(100_000)),
  }),
};

/**
 * Registers the source control channels through the caller's trusted registrar, so they share
 * the main-window, main-frame and renderer-document checks of every other Palot handler.
 */
export function registerSourceControlIpc(
  register: Register,
  service: () => SourceControlService,
): void {
  const channels = SOURCE_CONTROL_IPC_CHANNELS;
  const schemas = sourceControlSchemas;
  register(channels.codeHosts, () => service().codeHosts());
  register(channels.saveCodeHost, (_event, input) =>
    service().saveCodeHost(
      v.parse(
        v.strictObject({
          url: v.pipe(v.string(), v.maxLength(2_048)),
          kind: v.picklist(["gitlab", "forgejo", "bitbucket"]),
          token: v.pipe(v.string(), v.minLength(1), v.maxLength(16_384)),
        }),
        input,
      ),
    ),
  );
  register(channels.removeCodeHost, (_event, input) =>
    service().removeCodeHost(v.parse(identifier, input)),
  );
  register(channels.gitBranch, (_event, input) =>
    service().gitBranch(v.parse(schemas.gitBranch, input)),
  );
  register(channels.pullRequestEdit, (_event, input) =>
    service().editPullRequest(v.parse(schemas.edit, input)),
  );
  register(channels.pullRequestLabels, (_event, input) =>
    service().pullRequestLabels(v.parse(schemas.pullRequest, input)),
  );
  register(channels.pullRequestLabel, (_event, input) =>
    service().setPullRequestLabel(v.parse(schemas.label, input)),
  );
  register(channels.pullRequestAutoMerge, (_event, input) =>
    service().setPullRequestAutoMerge(v.parse(schemas.autoMerge, input)),
  );
  register(channels.pullRequestUpdateBranch, (_event, input) =>
    service().updatePullRequestBranch(v.parse(schemas.updateBranch, input)),
  );
  register(channels.sourceControlStatus, (_event, input) =>
    service().status(v.parse(schemas.status, input)),
  );
  register(channels.pullRequestLinks, (_event, input) =>
    service().listPullRequestLinks(v.parse(schemas.links, input)),
  );
  register(channels.pullRequestLink, (_event, input) =>
    service().linkPullRequest(v.parse(schemas.link, input)),
  );
  register(channels.pullRequestPrepare, (_event, input) =>
    service().preparePullRequest(v.parse(schemas.prepare, input)),
  );
  register(channels.pullRequestCreate, (_event, input) =>
    service().createPullRequest(v.parse(schemas.create, input)),
  );
  register(channels.pullRequestUnlink, (_event, input) =>
    service().unlinkPullRequest(v.parse(schemas.unlink, input)),
  );
  register(channels.pullRequestRefresh, (_event, input) =>
    service().refreshPullRequests(v.parse(schemas.refresh, input)),
  );
  register(channels.pullRequestWatch, (_event, input) =>
    service().watchPullRequest(v.parse(schemas.watch, input)),
  );
  register(channels.pullRequestSearch, (_event, input) =>
    service().searchPullRequests(v.parse(schemas.search, input)),
  );
  register(channels.pullRequestDetail, (_event, input) =>
    service().pullRequestDetail(v.parse(schemas.pullRequest, input)),
  );
  register(channels.pullRequestTimeline, (_event, input) =>
    service().pullRequestTimeline(v.parse(schemas.timeline, input)),
  );
  register(channels.pullRequestFiles, (_event, input) =>
    service().pullRequestFiles(v.parse(schemas.pullRequest, input)),
  );
  register(channels.pullRequestFileViewed, (_event, input) =>
    service().setPullRequestFileViewed(v.parse(schemas.fileViewed, input)),
  );
  register(channels.pullRequestReview, (_event, input) =>
    service().submitPullRequestReview(v.parse(schemas.review, input)),
  );
  register(channels.pullRequestComment, (_event, input) =>
    service().addPullRequestComment(v.parse(schemas.comment, input)),
  );
  register(channels.pullRequestThreadReply, (_event, input) =>
    service().replyToPullRequestThread(v.parse(schemas.threadReply, input)),
  );
  register(channels.pullRequestThreadResolve, (_event, input) =>
    service().resolvePullRequestThread(v.parse(schemas.threadResolve, input)),
  );
  register(channels.pullRequestMerge, (_event, input) =>
    service().mergePullRequest(v.parse(schemas.merge, input)),
  );
  register(channels.pullRequestState, (_event, input) =>
    service().setPullRequestState(v.parse(schemas.state, input)),
  );
  register(channels.pullRequestDraft, (_event, input) =>
    service().setPullRequestDraft(v.parse(schemas.draft, input)),
  );
  register(channels.pullRequestReviewers, (_event, input) =>
    service().requestPullRequestReviewers(v.parse(schemas.reviewers, input)),
  );
  register(channels.gitStatus, (_event, input) =>
    service().gitStatus(v.parse(schemas.gitTarget, input)),
  );
  register(channels.gitStage, (_event, input) =>
    service().gitStage(v.parse(schemas.gitPaths, input)),
  );
  register(channels.gitUnstage, (_event, input) =>
    service().gitUnstage(v.parse(schemas.gitPaths, input)),
  );
  register(channels.gitCommit, (_event, input) =>
    service().gitCommit(v.parse(schemas.gitCommit, input)),
  );
  register(channels.gitPush, (_event, input) => service().gitPush(v.parse(schemas.gitPush, input)));
  register(channels.gitFetch, (_event, input) =>
    service().gitFetch(v.parse(schemas.gitTarget, input)),
  );
  register(channels.gitPull, (_event, input) => service().gitPull(v.parse(schemas.gitPull, input)));
  register(channels.gitSync, (_event, input) => service().gitSync(v.parse(schemas.gitSync, input)));
}
