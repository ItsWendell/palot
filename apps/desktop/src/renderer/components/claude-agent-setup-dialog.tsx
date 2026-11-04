import type { LocationRef } from "@opencode/client";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OpenCodeRuntimeStatus, PalotIntegration } from "../../shared";
import { useSettingsOwner } from "../hooks/use-settings-owner";
import { useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import {
  activeCredential,
  CLAUDE_AGENT_CREDENTIAL_LABEL,
  CLAUDE_AGENT_DOCS_URL,
  CLAUDE_CODE_SETUP_URL,
  CLAUDE_SIGN_IN_COMMAND,
  claudeAgentCheckStep,
  claudeAgentLoginMethod,
  claudeAgentModelSignature,
  claudeAgentProblem,
  claudeAgentSteps,
  claudeInstallCommands,
  credentialIDs,
  type ClaudeAgentCheck,
  type ClaudeAgentProblem,
  type ClaudeAgentStepState,
} from "../lib/claude-agent-setup";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { Badge } from "./ui/badge";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { CopyField } from "./ui/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ProviderIcon } from "./ui/provider-icon";

const PROBLEM_TITLE: Record<ClaudeAgentProblem["kind"], string> = {
  "not-installed": "Claude Code isn't installed",
  "signed-out": "Claude Code isn't signed in",
  failed: "Claude Code check failed",
};

/**
 * Guided setup for OpenCode's Claude Agent provider: install Claude Code, sign in with
 * `claude auth login`, then let OpenCode check it. Palot never runs these commands;
 * "Check connection" saves the Claude Code login choice through OpenCode's external
 * connect method, which makes the server check `claude` again.
 */
export function ClaudeAgentSetupDialog({
  integration: initial,
  projectID,
  location,
  onOpenChange,
  onComplete,
  owner,
}: {
  integration: PalotIntegration;
  projectID: string;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
  owner?: OpenCodeRuntimeStatus | null;
}) {
  const selectedRuntime = useSettingsOwner();
  const runtime = owner === undefined ? selectedRuntime : owner;
  const connected = Boolean(runtime?.connected);
  // The same per-capability queries as Settings → Providers, so OpenCode's
  // integration and provider events keep this dialog current.
  const snapshot = useSettingsSnapshot(
    {
      projectID,
      directory: location.directory,
      ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      capabilities: ["integrations", "catalog"],
    },
    connected,
    runtime ?? null,
  );
  const integration =
    snapshot.data?.integrations.find((candidate) => candidate.id === initial.id) ?? initial;
  const models = claudeAgentModelSignature(snapshot.data?.catalog.models ?? []);
  const method = claudeAgentLoginMethod(integration);
  const credential = activeCredential(integration);
  const [check, setCheck] = useState<ClaudeAgentCheck>({ phase: "idle" });
  const [verified, setVerified] = useState(false);
  const [wake, setWake] = useState(0);
  const refetch = useRef(snapshot.refetch);
  refetch.current = snapshot.refetch;
  const running = check.phase === "connecting" || check.phase === "checking";
  // While a check runs, older credentials may still show their old problem.
  const problem = running ? null : claudeAgentProblem(credential?.status);
  const steps = claudeAgentSteps(problem, verified);
  const remote = runtime?.topology === "remote-machine";
  const install = claudeInstallCommands({
    platform: typeof window === "undefined" ? undefined : window.palot?.platform,
    remote,
  });

  useEffect(() => {
    if (problem && verified) setVerified(false);
  }, [problem, verified]);

  useEffect(() => {
    if (check.phase !== "checking") return;
    const step = claudeAgentCheckStep({ check, integration, models, now: Date.now() });
    if (step.type === "problem") {
      setCheck({ phase: "idle" });
      return;
    }
    if (step.type === "ready") {
      setCheck({ phase: "idle" });
      setVerified(true);
      return;
    }
    if (step.type === "timeout") {
      setCheck({ phase: "timeout" });
      return;
    }
    if (step.type === "confirm") {
      const started = check.startedAt;
      setCheck({ ...check, confirm: "running" });
      void refetch
        .current()
        .finally(() =>
          setCheck((current) =>
            current.phase === "checking" && current.startedAt === started
              ? { ...current, confirm: "done" }
              : current,
          ),
        );
      return;
    }
    const timer = window.setTimeout(() => setWake((value) => value + 1), step.delay);
    return () => window.clearTimeout(timer);
  }, [check, integration, models, wake]);

  async function runCheck() {
    if (!method || !runtime?.connected || running) return;
    const previous = credentialIDs(integration);
    const input = {
      connectionID: runtime.connectionID,
      projectID,
      directory: location.directory,
      ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
    };
    setVerified(false);
    setCheck({ phase: "connecting", previous });
    try {
      // Connecting is what makes OpenCode check `claude` again.
      await palot.connectIntegrationExternal({
        ...input,
        integrationID: integration.id,
        methodID: method.id,
        answer: {},
        // Without a label OpenCode numbers each replacement ("Claude Agent 2").
        label: CLAUDE_AGENT_CREDENTIAL_LABEL,
      });
    } catch (cause) {
      setCheck({ phase: "idle" });
      showErrorToast("Could not connect Claude Agent", cause);
      return;
    }
    setCheck({ phase: "checking", previous, startedAt: Date.now(), models, confirm: "none" });
    // Each connect saves a new credential, so drop the ones this check replaces.
    await Promise.all(
      previous.map((credentialID) =>
        palot.removeCredential({ ...input, credentialID }).catch(() => undefined),
      ),
    );
    await onComplete().catch(() => undefined);
  }

  const checkLabel = credential ? "Check again" : "Check connection";

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-lg" aria-busy={running}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderIcon id={integration.id} className="size-5" />
            Set up {integration.name}
          </DialogTitle>
          <DialogDescription>
            Use your Claude plan or another Claude Code login. Claude Agent runs Claude Code where
            OpenCode runs, and your login stays with Claude Code.{" "}
            <a href={CLAUDE_AGENT_DOCS_URL} target="_blank" rel="noreferrer">
              Learn more
            </a>
          </DialogDescription>
        </DialogHeader>

        {remote ? (
          <Banner status="info" title="Run these commands on the OpenCode server">
            This connection uses OpenCode on another computer. Claude Code must be installed and
            signed in there, not on this one.
          </Banner>
        ) : null}
        {!method ? (
          <Banner status="warning" title="Claude Code login isn't available">
            This OpenCode server doesn't offer a Claude Code login method. Update OpenCode, or
            connect Claude Agent from the OpenCode CLI.
          </Banner>
        ) : null}

        <ol className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Claude Agent setup">
          <SetupStep
            index={1}
            title="Install Claude Code"
            state={steps.install}
            doneLabel="Installed"
            neededLabel="Not found"
          >
            {install.map((entry) => (
              <CopyField
                key={entry.label}
                label={install.length > 1 ? entry.label : undefined}
                valueName={`${entry.label} install command`}
                value={entry.command}
              />
            ))}
            <p className="m-0 text-meta text-muted-foreground">
              Version 2.1.248 or later. Homebrew, WinGet and npm work too.{" "}
              <a
                className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-3"
                href={
                  problem?.kind === "not-installed" && problem.url
                    ? problem.url
                    : CLAUDE_CODE_SETUP_URL
                }
                target="_blank"
                rel="noreferrer"
              >
                Install guide
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </p>
          </SetupStep>
          <SetupStep
            index={2}
            title="Sign in to Claude Code"
            state={steps.signIn}
            doneLabel="Signed in"
            neededLabel="Not signed in"
          >
            <CopyField valueName="Sign-in command" value={CLAUDE_SIGN_IN_COMMAND} />
            <p className="m-0 text-meta text-muted-foreground">
              Run it in a terminal, then finish in your browser. A Claude subscription, Console
              account or cloud provider login all work.
            </p>
          </SetupStep>
          <SetupStep
            index={3}
            title="Check the connection"
            state={
              verified && !problem
                ? "done"
                : problem?.kind === "failed" || check.phase === "timeout"
                  ? "needed"
                  : "unknown"
            }
          >
            <CheckResult
              check={check}
              problem={problem}
              verified={verified}
              connected={connected}
              hasCredential={Boolean(credential)}
            />
          </SetupStep>
        </ol>

        <DialogFooter>
          <Button
            type="button"
            variant={verified && !problem ? "default" : "outline"}
            onClick={() => onOpenChange(false)}
          >
            {verified && !problem ? "Done" : "Cancel"}
          </Button>
          {verified && !problem ? null : (
            <Button
              type="button"
              disabled={!method || !connected || running}
              onClick={() => void runCheck()}
            >
              {running ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              ) : null}
              {checkLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupStep({
  index,
  title,
  state,
  doneLabel,
  neededLabel,
  children,
}: {
  index: number;
  title: string;
  state: ClaudeAgentStepState;
  doneLabel?: string;
  neededLabel?: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3" aria-label={title}>
      <span
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full text-micro font-medium tabular-nums",
          state === "done"
            ? "bg-success/15 text-success"
            : state === "needed"
              ? "bg-warning/15 text-warning"
              : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {state === "done" ? <Check className="size-3" /> : index}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="m-0 text-sm font-medium">{title}</h3>
          {state === "done" && doneLabel ? (
            <Badge variant="success" size="sm">
              {doneLabel}
            </Badge>
          ) : state === "needed" && neededLabel ? (
            <Badge variant="warning" size="sm">
              {neededLabel}
            </Badge>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function CheckResult({
  check,
  problem,
  verified,
  connected,
  hasCredential,
}: {
  check: ClaudeAgentCheck;
  problem: ClaudeAgentProblem | null;
  verified: boolean;
  connected: boolean;
  hasCredential: boolean;
}) {
  if (check.phase === "connecting" || check.phase === "checking") {
    return (
      <p role="status" className="m-0 flex items-center gap-2 text-compact text-muted-foreground">
        <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Checking Claude Code… This can take up to a minute.
      </p>
    );
  }
  if (problem) {
    return (
      <Banner status="warning" title={PROBLEM_TITLE[problem.kind]}>
        <p className="m-0">
          <CommandText text={problem.message} />
        </p>
        <p className="m-0 mt-1 text-muted-foreground">
          {problem.kind === "failed"
            ? "Fix the problem, then check again."
            : "Finish the step above, then check again."}
        </p>
      </Banner>
    );
  }
  if (check.phase === "timeout") {
    return (
      <Banner status="warning" title="Couldn't confirm Claude Code is ready">
        OpenCode didn't report a result. Make sure Claude Code is installed and signed in, then
        check again.
      </Banner>
    );
  }
  if (verified) {
    return (
      <Banner status="success" title="Claude Agent is ready">
        Claude Code is installed and signed in. Its models are available in the model picker.
      </Banner>
    );
  }
  if (!connected) {
    return (
      <p className="m-0 text-compact text-muted-foreground">
        Connect to OpenCode to check Claude Code.
      </p>
    );
  }
  return (
    <p className="m-0 text-compact text-muted-foreground">
      {hasCredential
        ? "Claude Agent is connected and OpenCode hasn't reported a problem. Check again after signing in or switching accounts."
        : "When both steps are done, OpenCode checks that Claude Code starts and is signed in. No message is sent."}
    </p>
  );
}

/** OpenCode's messages quote commands in backticks; show those as code. */
export function CommandText({ text }: { text: string }) {
  return text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="font-mono text-code-compact">
        {part}
      </code>
    ) : (
      part
    ),
  );
}
