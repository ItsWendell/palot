import { describe, expect, it } from "vitest";
import type { PalotIntegration, PalotIntegrationConnection } from "../../shared";
import {
  CLAUDE_AGENT_CHECK_SETTLE_MS,
  CLAUDE_AGENT_CHECK_TIMEOUT_MS,
  CLAUDE_INSTALL_COMMANDS,
  claudeAgentCheckStep,
  claudeAgentLoginMethod,
  claudeAgentModelSignature,
  claudeAgentProblem,
  claudeAgentSteps,
  claudeCodeFailure,
  claudeInstallCommands,
  type ClaudeAgentCheck,
} from "./claude-agent-setup";

// OpenCode 2.2.5's wording (packages/core/src/plugin/provider/claude-agent/integration.ts).
const NOT_INSTALLED = {
  status: "needs_auth" as const,
  message: "Claude Code is not installed. Install it, then run `claude auth login`.",
  url: "https://code.claude.com/docs/en/setup",
};
const SIGNED_OUT = {
  status: "needs_auth" as const,
  message: "Claude Code is not logged in. Run `claude auth login` in a terminal.",
  url: null,
};

function credential(
  id: string,
  status?: PalotIntegrationConnection["status"],
): PalotIntegrationConnection {
  return {
    type: "credential",
    id,
    label: "Claude Code login",
    active: false,
    method: "external",
    ...(status ? { status } : {}),
  };
}

function integration(...connections: PalotIntegrationConnection[]): PalotIntegration {
  return {
    id: "claude-agent",
    name: "Claude Agent",
    methods: [{ id: "claude-login", type: "external", label: "Claude Code login", form: [] }],
    // OpenCode lists the active connection first.
    connections: connections.map((connection, index) => ({ ...connection, active: index === 0 })),
  };
}

function checking(
  overrides: Partial<Extract<ClaudeAgentCheck, { phase: "checking" }>> = {},
): Extract<ClaudeAgentCheck, { phase: "checking" }> {
  return {
    phase: "checking",
    previous: [],
    startedAt: 0,
    models: "",
    confirm: "none",
    ...overrides,
  };
}

describe("claudeAgentProblem", () => {
  it("names the setup step OpenCode's message concerns and keeps the message verbatim", () => {
    expect(claudeAgentProblem(NOT_INSTALLED)).toEqual({
      kind: "not-installed",
      message: NOT_INSTALLED.message,
      url: NOT_INSTALLED.url,
    });
    expect(claudeAgentProblem(SIGNED_OUT)).toMatchObject({ kind: "signed-out", url: null });
    expect(
      claudeAgentProblem({
        status: "needs_auth",
        message: "claude did not start within 30 seconds",
        url: null,
      }),
    ).toMatchObject({ kind: "failed", message: "claude did not start within 30 seconds" });
    // Only the missing-binary problem carries a setup link in 2.2.5.
    expect(
      claudeAgentProblem({ status: "needs_auth", message: "Unavailable", url: NOT_INSTALLED.url }),
    ).toMatchObject({ kind: "not-installed" });
    expect(claudeAgentProblem(undefined)).toBeNull();
  });

  it("marks only the steps the problem proves", () => {
    expect(claudeAgentSteps(claudeAgentProblem(NOT_INSTALLED), false)).toEqual({
      install: "needed",
      signIn: "unknown",
    });
    // A signed-out answer means `claude` started, so it is installed.
    expect(claudeAgentSteps(claudeAgentProblem(SIGNED_OUT), false)).toEqual({
      install: "done",
      signIn: "needed",
    });
    expect(claudeAgentSteps(null, true)).toEqual({ install: "done", signIn: "done" });
    expect(claudeAgentSteps(null, false)).toEqual({ install: "unknown", signIn: "unknown" });
    // A later problem wins over an earlier passing check.
    expect(claudeAgentSteps(claudeAgentProblem(SIGNED_OUT), true).signIn).toBe("needed");
  });
});

describe("claudeAgentCheckStep", () => {
  it("ignores problems still shown on the credentials a check replaces", () => {
    const step = claudeAgentCheckStep({
      check: checking({ previous: ["old"] }),
      integration: integration(credential("old", SIGNED_OUT)),
      models: "",
      now: 1_000,
    });
    expect(step).toEqual({ type: "wait", delay: CLAUDE_AGENT_CHECK_TIMEOUT_MS - 1_000 });
  });

  it("ends with the problem OpenCode reports on the new credential", () => {
    expect(
      claudeAgentCheckStep({
        check: checking({ previous: ["old"] }),
        integration: integration(credential("new", NOT_INSTALLED), credential("old")),
        models: "",
        now: 500,
      }),
    ).toEqual({ type: "problem" });
  });

  it("confirms as soon as the server's check changes the model list", () => {
    expect(
      claudeAgentCheckStep({
        check: checking(),
        integration: integration(credential("new")),
        models: "opus\nsonnet",
        now: 2_000,
      }),
    ).toEqual({ type: "confirm" });
  });

  it("waits for a problem before confirming an unchanged model list", () => {
    const input = {
      check: checking({ models: "opus" }),
      integration: integration(credential("new")),
      models: "opus",
    };
    expect(claudeAgentCheckStep({ ...input, now: 3_000 })).toEqual({
      type: "wait",
      delay: CLAUDE_AGENT_CHECK_SETTLE_MS - 3_000,
    });
    expect(claudeAgentCheckStep({ ...input, now: CLAUDE_AGENT_CHECK_SETTLE_MS })).toEqual({
      type: "confirm",
    });
  });

  it("passes only after a confirming read still shows the new credential without a problem", () => {
    const base = { integration: integration(credential("new")), models: "opus", now: 4_000 };
    expect(claudeAgentCheckStep({ ...base, check: checking({ confirm: "running" }) })).toEqual({
      type: "wait",
      delay: CLAUDE_AGENT_CHECK_TIMEOUT_MS - 4_000,
    });
    expect(claudeAgentCheckStep({ ...base, check: checking({ confirm: "done" }) })).toEqual({
      type: "ready",
    });
    expect(
      claudeAgentCheckStep({
        ...base,
        integration: integration(credential("new", SIGNED_OUT)),
        check: checking({ confirm: "done" }),
      }),
    ).toEqual({ type: "problem" });
    // The read did not include the new credential yet.
    expect(
      claudeAgentCheckStep({
        ...base,
        integration: integration(credential("old")),
        check: checking({ previous: ["old"], confirm: "done" }),
      }).type,
    ).toBe("wait");
  });

  it("times out when OpenCode reports neither models nor a problem", () => {
    expect(
      claudeAgentCheckStep({
        check: checking({ startedAt: 10 }),
        integration: integration(credential("new")),
        models: "",
        now: 10 + CLAUDE_AGENT_CHECK_TIMEOUT_MS,
      }),
    ).toEqual({ type: "timeout" });
  });
});

describe("Claude Agent presentation", () => {
  it("offers the installer for the machine that runs OpenCode", () => {
    expect(claudeInstallCommands({ platform: "darwin", remote: false })).toEqual([
      CLAUDE_INSTALL_COMMANDS.posix,
    ]);
    expect(claudeInstallCommands({ platform: "win32", remote: false })).toEqual([
      CLAUDE_INSTALL_COMMANDS.windows,
    ]);
    // A remote server's platform is unknown.
    expect(claudeInstallCommands({ platform: "darwin", remote: true })).toEqual([
      CLAUDE_INSTALL_COMMANDS.posix,
      CLAUDE_INSTALL_COMMANDS.windows,
    ]);
  });

  it("prefers OpenCode's Claude Code login method", () => {
    const value = integration();
    value.methods = [
      { id: "other", type: "external", label: "Other", form: [] },
      { id: "claude-login", type: "external", label: "Claude Code login", form: [] },
    ];
    expect(claudeAgentLoginMethod(value)?.id).toBe("claude-login");
    expect(claudeAgentLoginMethod({ ...value, methods: [] })).toBeNull();
  });

  it("compares only Claude Agent models, regardless of order", () => {
    expect(
      claudeAgentModelSignature([
        { providerID: "claude-agent", id: "sonnet" },
        { providerID: "anthropic", id: "claude-opus" },
        { providerID: "claude-agent", id: "opus" },
      ]),
    ).toBe("opus\nsonnet");
  });

  it("recognizes reply failures that Claude Code setup fixes", () => {
    expect(claudeCodeFailure("Install Claude Code and run `claude auth login` first")).toEqual({
      signIn: true,
      update: false,
    });
    expect(
      claudeCodeFailure("Invalid API key · Run `claude auth login` in a terminal"),
    ).toMatchObject({ signIn: true });
    expect(
      claudeCodeFailure(
        "Claude Code 2.1.100 is too old; 2.1.248 or later is required. Run `claude update`.",
      ),
    ).toEqual({ signIn: false, update: true });
    expect(claudeCodeFailure("Anthropic is overloaded (529).")).toBeNull();
    expect(claudeCodeFailure(null)).toBeNull();
  });
});
