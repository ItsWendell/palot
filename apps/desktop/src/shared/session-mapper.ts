/** Maps OpenCode sessions to Palot's session contract, shared by the main process and renderer. */

import type { PermissionRuleset, SessionInfo, TokenUsageInfo } from "@opencode/client";
import type { PalotSession } from "./opencode-contract";

export function mapTokenUsage(tokens: TokenUsageInfo): TokenUsageInfo {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { ...tokens.cache },
  };
}

function copyPermissions(rules: PermissionRuleset): PermissionRuleset {
  return rules.map((rule) => ({ ...rule }));
}

export interface SessionMapperOptions {
  /** Lets callers reuse mapped permission rules across session snapshots. */
  mapPermissions?: (rules: PermissionRuleset) => PermissionRuleset;
}

export function mapSessionInfo(
  session: SessionInfo,
  { mapPermissions = copyPermissions }: SessionMapperOptions = {},
): PalotSession {
  return {
    id: session.id,
    parentID: session.parentID ?? null,
    projectID: session.projectID,
    title: session.title ?? null,
    agent: session.agent ?? null,
    model: session.model ? { ...session.model } : null,
    ...(session.metadata === undefined ? {} : { metadata: { ...session.metadata } }),
    ...(session.permissions === undefined
      ? {}
      : { permissions: mapPermissions(session.permissions) }),
    location: { ...session.location },
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    ...(session.time.busy === undefined ? {} : { busyAt: session.time.busy }),
    ...(session.time.idle === undefined ? {} : { idleAt: session.time.idle }),
    ...(session.time.viewed === undefined ? {} : { viewedAt: session.time.viewed }),
    ...(session.outcome ? { outcome: session.outcome } : {}),
    archivedAt: session.time.archived ?? null,
    cost: typeof session.cost === "number" ? session.cost : null,
    tokens: mapTokenUsage(session.tokens),
    ...(session.fork ? { forkedFrom: session.fork.sessionID } : {}),
    ...(session.revert
      ? {
          revert: {
            messageID: session.revert.messageID,
            ...(session.revert.partID ? { partID: session.revert.partID } : {}),
            ...(session.revert.snapshot ? { snapshot: session.revert.snapshot } : {}),
            ...(session.revert.files
              ? { files: session.revert.files.map((file) => ({ ...file })) }
              : {}),
          },
        }
      : {}),
  };
}
