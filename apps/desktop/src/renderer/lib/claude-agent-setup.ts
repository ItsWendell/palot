/**
 * Claude Agent setup state, derived from what OpenCode reports.
 *
 * OpenCode's built-in Claude Agent provider (2.2.4+) runs the `claude` CLI on the
 * OpenCode server. Its one connect method (`external`, id `claude-login`) only records
 * that the user chose Claude Code; the login itself belongs to `claude auth login`.
 * Connecting makes the server check `claude` again: a missing binary, a failed start or
 * a signed-out account is reported as a `needs_auth` status on the active connection
 * (`IntegrationInfo.connections[].status`). A passing check clears that status and may
 * update the provider's model list, but OpenCode sends no "check finished" signal, so
 * success is inferred from models plus the absence of a problem. Mirrors OpenCode
 * Desktop's `ClaudeAgentSetup` (anomalyco/opencode#60603).
 */

import type {
  PalotIntegration,
  PalotIntegrationConnection,
  PalotIntegrationConnectionStatus,
  PalotIntegrationMethod,
} from "../../shared";

/** The provider and integration ID of OpenCode's Claude Agent. */
export const CLAUDE_AGENT_ID = "claude-agent";
/** The method ID OpenCode 2.2.5 registers for the Claude Code login choice. */
const CLAUDE_AGENT_METHOD_ID = "claude-login";

/** One stable name for the connection each check replaces. */
export const CLAUDE_AGENT_CREDENTIAL_LABEL = "Claude Code";
export const CLAUDE_SIGN_IN_COMMAND = "claude auth login";
export const CLAUDE_UPDATE_COMMAND = "claude update";
export const CLAUDE_CODE_SETUP_URL = "https://code.claude.com/docs/en/setup";
export const CLAUDE_AGENT_DOCS_URL = "https://opencode.ai/v2/docs/claude-agent";

/** Claude Code's native installers, from its setup guide. */
export const CLAUDE_INSTALL_COMMANDS = {
  posix: {
    label: "macOS, Linux or WSL",
    command: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  windows: { label: "Windows PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
} as const;

/**
 * The server's own check allows 30 seconds for `claude` to start and 30 more to read
 * each model's context size, so a check that has shown no result by then has stalled.
 */
export const CLAUDE_AGENT_CHECK_TIMEOUT_MS = 65_000;
/**
 * A passing check of an unchanged model list changes nothing OpenCode reports. When the
 * models were already known, wait this long for a problem before calling the check
 * passed. A later problem still replaces the result.
 */
export const CLAUDE_AGENT_CHECK_SETTLE_MS = 10_000;

export function isClaudeAgent(id: string | null | undefined): boolean {
  return id === CLAUDE_AGENT_ID;
}

export type ClaudeAgentLoginMethod = PalotIntegrationMethod & { type: "external"; id: string };

/** The method that saves the Claude Code login choice, or null when OpenCode offers none. */
export function claudeAgentLoginMethod(
  integration: PalotIntegration | null | undefined,
): ClaudeAgentLoginMethod | null {
  const methods = (integration?.methods ?? []).filter(
    (method): method is ClaudeAgentLoginMethod => method.type === "external",
  );
  return methods.find((method) => method.id === CLAUDE_AGENT_METHOD_ID) ?? methods[0] ?? null;
}

/** The stored credential OpenCode uses, which carries the latest check. */
export function activeCredential(
  integration: PalotIntegration | null | undefined,
): (PalotIntegrationConnection & { id: string }) | null {
  const connection = integration?.connections.find((candidate) => candidate.active);
  return connection?.type === "credential" && connection.id
    ? (connection as PalotIntegrationConnection & { id: string })
    : null;
}

export function credentialIDs(integration: PalotIntegration | null | undefined): string[] {
  return (integration?.connections ?? []).flatMap((connection) =>
    connection.type === "credential" && connection.id ? [connection.id] : [],
  );
}

export type ClaudeAgentProblemKind = "not-installed" | "signed-out" | "failed";

export interface ClaudeAgentProblem {
  kind: ClaudeAgentProblemKind;
  /** OpenCode's message, shown verbatim: it already says what went wrong. */
  message: string;
  /** Where OpenCode says to fix it. */
  url: string | null;
}

/**
 * Connection.Status has one code (`needs_auth`) and free text, so the step it concerns
 * comes from OpenCode's wording ("is not installed", "is not logged in"). Unrecognized
 * text is a failed check with its message intact.
 */
export function claudeAgentProblem(
  status: PalotIntegrationConnectionStatus | null | undefined,
): ClaudeAgentProblem | null {
  if (!status) return null;
  const message = status.message.trim() || "Claude Code needs attention.";
  const url = status.url ?? null;
  const kind: ClaudeAgentProblemKind = /\bnot installed\b/i.test(message)
    ? "not-installed"
    : /\bnot (logged|signed) in\b|\bauth login\b/i.test(message)
      ? "signed-out"
      : url
        ? "not-installed"
        : "failed";
  return { kind, message, url };
}

export type ClaudeAgentStepState = "done" | "needed" | "unknown";

export interface ClaudeAgentSteps {
  install: ClaudeAgentStepState;
  signIn: ClaudeAgentStepState;
}

/** What each setup step is known to need. `verified` means the latest check passed. */
export function claudeAgentSteps(
  problem: ClaudeAgentProblem | null,
  verified: boolean,
): ClaudeAgentSteps {
  if (problem?.kind === "not-installed") return { install: "needed", signIn: "unknown" };
  // OpenCode only reports a signed-out account after `claude` started and answered.
  if (problem?.kind === "signed-out") return { install: "done", signIn: "needed" };
  if (!problem && verified) return { install: "done", signIn: "done" };
  return { install: "unknown", signIn: "unknown" };
}

export type ClaudeInstallPlatform = "posix" | "windows";

/**
 * Install commands for the machine that runs OpenCode. A remote server's platform is
 * unknown, so it gets both native installers.
 */
export function claudeInstallCommands(input: {
  platform: string | null | undefined;
  remote: boolean;
}): Array<(typeof CLAUDE_INSTALL_COMMANDS)[ClaudeInstallPlatform]> {
  if (input.remote || !input.platform) {
    return [CLAUDE_INSTALL_COMMANDS.posix, CLAUDE_INSTALL_COMMANDS.windows];
  }
  return [
    input.platform === "win32" ? CLAUDE_INSTALL_COMMANDS.windows : CLAUDE_INSTALL_COMMANDS.posix,
  ];
}

/** The Claude Agent model IDs OpenCode lists, as one comparable value. */
export function claudeAgentModelSignature(
  models: ReadonlyArray<{ providerID: string; id: string }>,
): string {
  return models
    .filter((model) => model.providerID === CLAUDE_AGENT_ID)
    .map((model) => model.id)
    .toSorted()
    .join("\n");
}

export type ClaudeAgentCheck =
  | { phase: "idle" }
  | { phase: "connecting"; previous: string[] }
  | {
      phase: "checking";
      /** Credentials replaced by this check; their old problems are not this check's result. */
      previous: string[];
      startedAt: number;
      /** The model signature when the check started. */
      models: string;
      confirm: "none" | "running" | "done";
    }
  | { phase: "timeout" };

export type ClaudeAgentCheckStep =
  | { type: "wait"; delay: number }
  | { type: "confirm" }
  | { type: "problem" }
  | { type: "ready" }
  | { type: "timeout" };

/**
 * The next step of a running check, from OpenCode's current state.
 *
 * - A problem on the credential this check created ends it.
 * - New or changed models mean the server's check answered. Its problem can arrive in a
 *   separate update, so the integration is read once more ("confirm") before the check
 *   counts as passed.
 * - Unchanged models give no signal, so they are confirmed after a settle delay.
 * - Without models or a problem the check times out like OpenCode Desktop's.
 */
export function claudeAgentCheckStep(input: {
  check: Extract<ClaudeAgentCheck, { phase: "checking" }>;
  integration: PalotIntegration | null | undefined;
  models: string;
  now: number;
}): ClaudeAgentCheckStep {
  const { check, models, now } = input;
  const active = activeCredential(input.integration);
  const current = active && !check.previous.includes(active.id) ? active : null;
  if (current?.status) return { type: "problem" };
  const elapsed = Math.max(0, now - check.startedAt);
  if (check.confirm === "done" && current) return { type: "ready" };
  if (elapsed >= CLAUDE_AGENT_CHECK_TIMEOUT_MS) return { type: "timeout" };
  const timeout = CLAUDE_AGENT_CHECK_TIMEOUT_MS - elapsed;
  if (check.confirm !== "none") return { type: "wait", delay: timeout };
  if (models) {
    if (models !== check.models || elapsed >= CLAUDE_AGENT_CHECK_SETTLE_MS) {
      return { type: "confirm" };
    }
    return { type: "wait", delay: Math.min(CLAUDE_AGENT_CHECK_SETTLE_MS - elapsed, timeout) };
  }
  return { type: "wait", delay: timeout };
}

export interface ClaudeCodeFailure {
  /** The failure asks for Claude Code to be installed or signed in. */
  signIn: boolean;
  /** The failure asks for a newer Claude Code (`claude update`). */
  update: boolean;
}

/**
 * Whether a failed reply came from Claude Code needing setup. OpenCode rewrites
 * Claude Code's "/login" hint to `claude auth login` and asks for `claude update` when
 * the installed version is too old; chats started without `claude` report "Install
 * Claude Code and run `claude auth login` first".
 */
export function claudeCodeFailure(text: string | null | undefined): ClaudeCodeFailure | null {
  if (!text) return null;
  const signIn =
    /\bclaude auth login\b/.test(text) ||
    /\bClaude Code is not (installed|logged in)\b/.test(text) ||
    /\bInstall Claude Code\b/.test(text);
  const update = /\bclaude update\b/.test(text);
  return signIn || update ? { signIn, update } : null;
}
