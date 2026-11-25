import type { ModelRef } from "@opencode/client";
import type { ReactNode } from "react";
import type { PalotMessage, PalotModel, PalotSession } from "../../../shared";
import type { ProviderLimit } from "../../../shared/provider-limit";
import { lastAssistantActivityAt } from "../../lib/context-usage";
import { sameLimit } from "../../lib/usage-limit-reset";
import type { ApprovalPreset } from "../../lib/session-permissions";
import type { PendingRequestView } from "../../lib/view-models";
import type { ComposerGuests, ComposerRequest } from "./composer-requests";
import type { ComposerRunningWorkAtom, ComposerStandingTab } from "./composer-standing";

export interface NewSessionComposerOptions {
  approvalMode: ApprovalPreset;
  agent: string | null;
  model: ModelRef | null;
  title?: string;
  deferNavigation?: boolean;
}

export interface ComposerProps {
  session: PalotSession;
  messages: PalotMessage[];
  isWorking: boolean;
  onMessageAdmitted?(): void;
  onModelsChange?(models: PalotModel[]): void;
  onCreateSession?(options: NewSessionComposerOptions): Promise<PalotSession | null>;
  onOpenCreatedSession?(sessionID: string): void;
  onCreateSessionError?(error: unknown): void;
  contextBar?: ReactNode;
  pendingInputs?: PendingRequestView[];
  /**
   * The task's running work, as a stable atom: its tab, its panel and a waiting steer read it,
   * so a change there does not re-render the composer.
   */
  runningWork?: ComposerRunningWorkAtom;
  /** Standing context for the tabs on the card's top edge, in order. */
  standing?: ComposerStandingTab[];
  /**
   * Pending permissions, questions and forms for the request panel: the task's, its subagents'
   * and location-wide MCP forms. Permissions shown beside their tool call in the transcript
   * are left out by the caller.
   */
  requests?: ComposerRequest[];
  /** Guest messages waiting to be passed to the agent. */
  guests?: ComposerGuests | null;
  /** The provider limit that failed the last turn, if one did. */
  usageLimit?: ProviderLimit | null;
  /** A subagent session's agent name, for "From explore subagent" on its requests. */
  agentOf?(sessionID: string): string | null;
  onNavigateToNewTask?(): void;
}

/**
 * The composer re-renders for what it shows or sends: streaming output, tool parts and other
 * churn in the transcript must not reach it.
 */
export function sameComposerProps(previous: ComposerProps, next: ComposerProps): boolean {
  return (
    sameComposerSession(previous.session, next.session) &&
    sameComposerMessages(previous.messages, next.messages) &&
    previous.isWorking === next.isWorking &&
    previous.onMessageAdmitted === next.onMessageAdmitted &&
    previous.onModelsChange === next.onModelsChange &&
    previous.onCreateSession === next.onCreateSession &&
    previous.onOpenCreatedSession === next.onOpenCreatedSession &&
    previous.onCreateSessionError === next.onCreateSessionError &&
    previous.contextBar === next.contextBar &&
    previous.pendingInputs === next.pendingInputs &&
    previous.runningWork === next.runningWork &&
    previous.standing === next.standing &&
    previous.requests === next.requests &&
    previous.guests === next.guests &&
    previous.agentOf === next.agentOf &&
    sameLimit(previous.usageLimit ?? null, next.usageLimit ?? null) &&
    previous.onNavigateToNewTask === next.onNavigateToNewTask
  );
}

function sameComposerSession(left: PalotSession, right: PalotSession): boolean {
  return (
    left.id === right.id &&
    left.parentID === right.parentID &&
    left.projectID === right.projectID &&
    left.agent === right.agent &&
    left.permissions === right.permissions &&
    left.model?.id === right.model?.id &&
    left.model?.providerID === right.model?.providerID &&
    left.model?.variant === right.model?.variant &&
    left.location.directory === right.location.directory &&
    left.location.workspaceID === right.location.workspaceID &&
    left.revert?.messageID === right.revert?.messageID &&
    tokenTotal(left.tokens) === tokenTotal(right.tokens) &&
    left.cost === right.cost
  );
}

function sameComposerMessages(left: PalotMessage[], right: PalotMessage[]): boolean {
  if (left === right) return true;
  const leftUsers = left.filter((message) => message.type === "user");
  const rightUsers = right.filter((message) => message.type === "user");
  if (
    leftUsers.length !== rightUsers.length ||
    leftUsers.some((message, index) => message !== rightUsers[index])
  ) {
    return false;
  }
  // Shell history only needs new commands; streaming output must not re-render the composer.
  const leftShellIDs = left.filter((message) => message.type === "shell").map(({ id }) => id);
  const rightShellIDs = right.filter((message) => message.type === "shell").map(({ id }) => id);
  if (
    leftShellIDs.length !== rightShellIDs.length ||
    leftShellIDs.some((id, index) => id !== rightShellIDs[index])
  ) {
    return false;
  }
  const leftContext = lastContextMessage(left);
  const rightContext = lastContextMessage(right);
  return (
    tokenTotal(leftContext?.tokens ?? EMPTY_TOKENS) ===
      tokenTotal(rightContext?.tokens ?? EMPTY_TOKENS) &&
    leftContext?.model?.id === rightContext?.model?.id &&
    leftContext?.model?.providerID === rightContext?.model?.providerID &&
    // The context meter and compact-before-send read compaction state and idle time.
    compactionSignature(left) === compactionSignature(right) &&
    lastAssistantActivityAt(left) === lastAssistantActivityAt(right)
  );
}

function compactionSignature(messages: PalotMessage[]): string {
  const compaction = messages.findLast((message) => message.type === "compaction");
  return compaction ? `${compaction.id}:${compaction.completedAt ?? "running"}` : "";
}

const EMPTY_TOKENS: PalotSession["tokens"] = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

function lastContextMessage(messages: PalotMessage[]): PalotMessage | undefined {
  return messages.findLast(
    (message) => message.type === "assistant" && tokenTotal(message.tokens ?? EMPTY_TOKENS) > 0,
  );
}

function tokenTotal(tokens: PalotSession["tokens"]): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}
