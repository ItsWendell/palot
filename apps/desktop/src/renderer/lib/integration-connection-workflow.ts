import type { FormValue } from "@opencode/client";
import type {
  ConnectIntegrationKeyInput,
  ConnectIntegrationCommandInput,
  ConnectIntegrationOAuthInput,
  CompleteIntegrationOAuthInput,
  IntegrationAttemptInput,
  PalotIntegration,
  PalotIntegrationAttemptStatus,
  PalotIntegrationCommandAttempt,
  PalotIntegrationMethod,
  PalotIntegrationOAuthAttempt,
  SettingsLocationInput,
} from "../../shared";

export interface IntegrationConnectionAttempt {
  type: "oauth" | "command";
  id: string;
  status: "pending" | "complete" | "failed" | "expired";
  message: string | null;
  url: string | null;
  instructions: string | null;
  mode: "auto" | "code" | null;
}

export interface IntegrationConnectionPalotAdapter {
  connectIntegrationKey(input: ConnectIntegrationKeyInput): Promise<void>;
  connectIntegrationOAuth(
    input: ConnectIntegrationOAuthInput,
  ): Promise<PalotIntegrationOAuthAttempt>;
  integrationOAuthStatus(input: IntegrationAttemptInput): Promise<PalotIntegrationAttemptStatus>;
  completeIntegrationOAuth(input: CompleteIntegrationOAuthInput): Promise<void>;
  cancelIntegrationOAuth(input: IntegrationAttemptInput): Promise<void>;
  connectIntegrationCommand(
    input: ConnectIntegrationCommandInput,
  ): Promise<PalotIntegrationCommandAttempt>;
  integrationCommandStatus(input: IntegrationAttemptInput): Promise<PalotIntegrationAttemptStatus>;
  cancelIntegrationCommand(input: IntegrationAttemptInput): Promise<void>;
}

export interface IntegrationConnectionCallbacks {
  setAttempt(attempt: IntegrationConnectionAttempt | null): void;
  setBusy(busy: boolean): void;
  showError(title: string, cause: unknown): void;
  showSuccess(title: string): void;
  close(): void;
  invalidate(): Promise<void>;
}

interface StartInput extends SettingsLocationInput {
  integration: PalotIntegration;
  method: Exclude<PalotIntegrationMethod, { type: "env" }>;
  key: string;
  label: string;
  answer: Record<string, FormValue>;
}

interface ActiveAttempt {
  generation: number;
  integrationName: string;
  attempt: IntegrationConnectionAttempt;
  input: IntegrationAttemptInput;
  callbacks: IntegrationConnectionCallbacks;
}

interface TimerAdapter {
  set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
}

const timers: TimerAdapter = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer),
};

export class IntegrationConnectionWorkflow {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: ActiveAttempt | null = null;

  constructor(
    private readonly palot: IntegrationConnectionPalotAdapter,
    private readonly timerAdapter: TimerAdapter = timers,
    private readonly pollInterval = 1_000,
  ) {}

  async start(input: StartInput, callbacks: IntegrationConnectionCallbacks): Promise<void> {
    const generation = this.replaceActive();
    callbacks.setAttempt(null);
    callbacks.setBusy(true);
    const common = {
      integrationID: input.integration.id,
      projectID: input.projectID,
      directory: input.directory,
      ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
      ...(input.label.trim() ? { label: input.label.trim() } : {}),
    };
    const attemptInput = {
      integrationID: input.integration.id,
      projectID: input.projectID,
      directory: input.directory,
      ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
    };

    try {
      if (input.method.type === "key") {
        await this.palot.connectIntegrationKey({
          ...common,
          key: input.key,
          answer: input.answer,
        });
        if (generation !== this.generation) return;
        await this.succeed(input.integration.name, callbacks);
        return;
      }

      if (input.method.type === "oauth") {
        const value = await this.palot.connectIntegrationOAuth({
          ...common,
          methodID: input.method.id,
          answer: input.answer,
        });
        const attempt = oauthAttempt(value);
        if (generation !== this.generation) {
          await this.cancelStale("oauth", { ...attemptInput, attemptID: value.attemptID });
          return;
        }
        this.activate(generation, input.integration.name, attempt, attemptInput, callbacks);
        return;
      }

      const value = await this.palot.connectIntegrationCommand({
        ...common,
        methodID: input.method.id,
        command: [...input.method.command],
      });
      const attempt = commandAttempt(value);
      if (generation !== this.generation) {
        await this.cancelStale("command", { ...attemptInput, attemptID: value.attemptID });
        return;
      }
      this.activate(generation, input.integration.name, attempt, attemptInput, callbacks);
    } catch (cause) {
      if (generation === this.generation) {
        callbacks.showError(`Could not connect ${input.integration.name}`, cause);
      }
    } finally {
      if (generation === this.generation) callbacks.setBusy(false);
    }
  }

  async completeOAuth(code: string, callbacks: IntegrationConnectionCallbacks): Promise<void> {
    const active = this.active;
    if (!active || active.attempt.type !== "oauth") return;
    callbacks.setBusy(true);
    try {
      await this.palot.completeIntegrationOAuth({
        ...active.input,
        ...(active.attempt.mode === "code" ? { code: code.trim() } : {}),
      });
    } catch (cause) {
      if (active.generation === this.generation) {
        callbacks.showError(`Could not complete ${active.integrationName} authorization`, cause);
      }
    } finally {
      if (active.generation === this.generation) callbacks.setBusy(false);
    }
  }

  async close(callbacks: IntegrationConnectionCallbacks): Promise<void> {
    const active = this.active;
    const generation = ++this.generation;
    this.clearTimer();
    this.active = null;
    if (!active || active.attempt.status !== "pending") {
      callbacks.close();
      return;
    }

    try {
      await this.cancel(active.attempt.type, active.input);
      if (generation === this.generation) callbacks.close();
    } catch (cause) {
      if (generation !== this.generation) return;
      callbacks.showError(`Could not cancel ${active.integrationName} connection`, cause);
      active.generation = generation;
      this.active = active;
      this.schedulePoll(active);
    }
  }

  dispose(): void {
    ++this.generation;
    this.clearTimer();
    const active = this.active;
    this.active = null;
    if (active?.attempt.status === "pending") {
      void this.cancel(active.attempt.type, active.input).catch(() => undefined);
    }
  }

  private replaceActive(): number {
    ++this.generation;
    this.clearTimer();
    const active = this.active;
    this.active = null;
    if (active?.attempt.status === "pending") {
      void this.cancel(active.attempt.type, active.input).catch(() => undefined);
    }
    return this.generation;
  }

  private activate(
    generation: number,
    integrationName: string,
    attempt: IntegrationConnectionAttempt,
    input: Omit<IntegrationAttemptInput, "attemptID">,
    callbacks: IntegrationConnectionCallbacks,
  ): void {
    const active = {
      generation,
      integrationName,
      attempt,
      input: { ...input, attemptID: attempt.id },
      callbacks,
    };
    this.active = active;
    callbacks.setAttempt(attempt);
    this.schedulePoll(active);
  }

  private schedulePoll(active: ActiveAttempt): void {
    this.clearTimer();
    this.timer = this.timerAdapter.set(() => {
      this.timer = null;
      void this.poll(active);
    }, this.pollInterval);
  }

  private async poll(active: ActiveAttempt): Promise<void> {
    if (!this.current(active)) return;
    try {
      const value =
        active.attempt.type === "oauth"
          ? await this.palot.integrationOAuthStatus(active.input)
          : await this.palot.integrationCommandStatus(active.input);
      if (!this.current(active)) return;
      if (value.status === "complete") {
        this.active = null;
        await this.succeed(active.integrationName, active.callbacks);
        return;
      }
      active.attempt = { ...active.attempt, status: value.status, message: value.message };
      active.callbacks.setAttempt(active.attempt);
      if (value.status !== "pending") {
        this.active = null;
        return;
      }
    } catch (cause) {
      if (!this.current(active)) return;
      active.callbacks.showError(`Could not check ${active.integrationName} connection`, cause);
    }
    if (this.current(active)) this.schedulePoll(active);
  }

  private async succeed(
    integrationName: string,
    callbacks: IntegrationConnectionCallbacks,
  ): Promise<void> {
    const generation = ++this.generation;
    this.clearTimer();
    this.active = null;
    try {
      await callbacks.invalidate();
      if (generation !== this.generation) return;
      callbacks.showSuccess(`${integrationName} connected`);
      callbacks.close();
    } catch (cause) {
      if (generation !== this.generation) return;
      callbacks.showError(`Could not refresh ${integrationName} connection`, cause);
    }
  }

  private current(active: ActiveAttempt): boolean {
    return this.active === active && active.generation === this.generation;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timerAdapter.clear(this.timer);
    this.timer = null;
  }

  private cancel(type: "oauth" | "command", input: IntegrationAttemptInput): Promise<void> {
    return type === "oauth"
      ? this.palot.cancelIntegrationOAuth(input)
      : this.palot.cancelIntegrationCommand(input);
  }

  private async cancelStale(
    type: "oauth" | "command",
    input: IntegrationAttemptInput,
  ): Promise<void> {
    try {
      await this.cancel(type, input);
    } catch {
      // A superseded workflow must not report into the current dialog.
    }
  }
}

function oauthAttempt(value: PalotIntegrationOAuthAttempt): IntegrationConnectionAttempt {
  return {
    type: "oauth",
    id: value.attemptID,
    status: "pending",
    message: null,
    url: value.url,
    instructions: value.instructions,
    mode: value.mode,
  };
}

function commandAttempt(value: PalotIntegrationCommandAttempt): IntegrationConnectionAttempt {
  return {
    type: "command",
    id: value.attemptID,
    status: "pending",
    message: null,
    url: null,
    instructions: null,
    mode: null,
  };
}
