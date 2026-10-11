import type { OpenCodeClient } from "@opencode/client";
import { BrowserWindow } from "electron";
import log from "electron-log/main";
import type { SourceControlChangedEvent } from "../../shared/source-control-contract";
import { SOURCE_CONTROL_IPC_CHANNELS } from "../../shared/source-control-contract";
import { palotDatabase } from "../database/client";
import { classifyOpenCodeProfile } from "../opencode-connections/capabilities";
import { openCodeRuntime } from "../opencode-runtime";
import { sessionTriageStore } from "../session-triage-store";
import { refreshTrayMenu } from "../tray";
import { SourceControlError } from "./errors";
import { latestUserMessageAt, USER_MESSAGE_PAGE_SIZE } from "./session-activity";
import { GitHubClient } from "./github-client";
import { GitHubCredentials } from "./github-credentials";
import { GitHubQuota } from "./github-quota";
import { GitRunner } from "./git";
import {
  PullRequestService,
  SOURCE_CONTROL_PROMPT_METADATA_KEY,
  type SourceControlSessions,
  type SourceControlTriage,
} from "./pull-request-service";
import { PullRequestRepository } from "./pull-request-repository";
import { PullRequestReviewService } from "./pull-request-review";
import { SourceControlService } from "./source-control-service";

const REQUEST_TIMEOUT_MS = 30_000;
/** Prompts Palot queued itself; they are not the user's own words. */
const PALOT_PROMPT_METADATA_KEYS = [SOURCE_CONTROL_PROMPT_METADATA_KEY, "palot.automation"];
const sourceControlLog = log.scope("source-control");

function isLocalProfile(profileID: string): boolean | null {
  const profile = openCodeRuntime
    .profileSnapshot()
    .profiles.find((candidate) => candidate.id === profileID);
  return profile ? classifyOpenCodeProfile(profile).capabilities.localPathActions : null;
}

async function withProfileClient<T>(
  profileID: string,
  operation: (client: OpenCodeClient) => Promise<T>,
): Promise<T> {
  const runtime = openCodeRuntime
    .listRuntimes()
    .find((candidate) => candidate.profileID === profileID && candidate.connected);
  if (!runtime)
    throw new SourceControlError("not-connected", "Connect to the task's OpenCode server first.");
  return openCodeRuntime.scopedConnection(runtime.connectionID).withClient(operation);
}

const sessions: SourceControlSessions = {
  connected: (profileID) =>
    openCodeRuntime
      .listRuntimes()
      .some((runtime) => runtime.profileID === profileID && runtime.connected),
  directory: (profileID, sessionID) =>
    withProfileClient(profileID, async (client) => {
      const session = await client.session.get(
        { sessionID },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      return session.location.directory;
    }),
  activity: (profileID, sessionID) =>
    withProfileClient(profileID, async (client) => {
      const session = await client.session.get(
        { sessionID },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      // The server rejects a cursor combined with `order`; the cursor carries the order.
      const latest = await latestUserMessageAt(
        (cursor) =>
          client.message.list(
            cursor
              ? { sessionID, type: "user", limit: USER_MESSAGE_PAGE_SIZE, cursor }
              : { sessionID, type: "user", limit: USER_MESSAGE_PAGE_SIZE, order: "desc" },
            { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
          ),
        PALOT_PROMPT_METADATA_KEYS,
      );
      return {
        lastUserMessageAt: latest.at,
        complete: latest.complete,
        createdAt: session.time.created,
        updatedAt: session.time.updated,
      };
    }),
  prompt: (profileID, sessionID, text, metadata) =>
    withProfileClient(profileID, async (client) => {
      await client.session.prompt(
        {
          sessionID,
          text,
          metadata: metadata as Record<string, import("@opencode/client").JsonValue>,
          delivery: "queue",
        },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    }),
};

const triage: SourceControlTriage = {
  record: (profileID, sessionID) =>
    sessionTriageStore()
      .load(profileID)
      .sessions.find((record) => record.sessionID === sessionID) ?? null,
  settle: (profileID, sessionID, through, at) => {
    sessionTriageStore().dispatch({ type: "settle", profileID, sessionID, at, through });
    refreshTrayMenu();
  },
};

function emit(event: SourceControlChangedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.webContents.send(SOURCE_CONTROL_IPC_CHANNELS.sourceControlChanged, event);
  }
}

let service: SourceControlService | null = null;

export function sourceControlService(): SourceControlService {
  if (service) return service;
  const quota = new GitHubQuota();
  const github = new GitHubClient({ credentials: new GitHubCredentials(), quota });
  const git = new GitRunner();
  const pullRequests = new PullRequestService({
    repository: new PullRequestRepository(palotDatabase()),
    github,
    sessions,
    triage,
    isLocalProfile,
    repositoryOf: (directory) => git.remoteAndBranch(directory),
    emit,
    log: sourceControlLog,
  });
  const review = new PullRequestReviewService({
    github,
    emit,
    syncLinks: (key) => void pullRequests.syncKey(key),
  });
  service = new SourceControlService({ pullRequests, review, git, github, isLocalProfile, emit });
  return service;
}

export async function shutdownSourceControlService(): Promise<void> {
  const current = service;
  service = null;
  await current?.stop();
}
