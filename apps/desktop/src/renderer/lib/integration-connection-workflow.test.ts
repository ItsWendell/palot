import { describe, expect, it, vi } from "vitest";
import type { PalotIntegration, PalotIntegrationMethod } from "../../shared";
import {
  IntegrationConnectionWorkflow,
  type IntegrationConnectionCallbacks,
  type IntegrationConnectionPalotAdapter,
} from "./integration-connection-workflow";

const oauth: PalotIntegrationMethod = {
  id: "browser",
  type: "oauth",
  label: "Browser",
  form: [],
};
const command: PalotIntegrationMethod = {
  id: "cli",
  type: "command",
  label: "CLI",
  command: ["example", "login"],
  form: [],
};
const key: PalotIntegrationMethod = {
  id: null,
  type: "key",
  label: "API key",
  form: [],
};
const integration: PalotIntegration = {
  id: "example",
  name: "Example",
  methods: [oauth, command, key],
  connections: [],
};
const location = { connectionID: "server-a", projectID: "project", directory: "/project" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup() {
  const scheduled: Array<() => void> = [];
  const palot: IntegrationConnectionPalotAdapter = {
    connectIntegrationKey: vi.fn().mockResolvedValue(undefined),
    connectIntegrationOAuth: vi.fn().mockResolvedValue({
      attemptID: "oauth-1",
      url: "https://example.com/auth",
      instructions: "Authorize",
      mode: "auto",
      createdAt: 1,
      expiresAt: 2,
    }),
    integrationOAuthStatus: vi.fn().mockResolvedValue({
      status: "pending",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    }),
    completeIntegrationOAuth: vi.fn().mockResolvedValue(undefined),
    cancelIntegrationOAuth: vi.fn().mockResolvedValue(undefined),
    connectIntegrationCommand: vi.fn().mockResolvedValue({
      attemptID: "command-1",
      createdAt: 1,
      expiresAt: 2,
    }),
    integrationCommandStatus: vi.fn().mockResolvedValue({
      status: "pending",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    }),
    cancelIntegrationCommand: vi.fn().mockResolvedValue(undefined),
  };
  const events: string[] = [];
  const callbacks: IntegrationConnectionCallbacks = {
    setAttempt: vi.fn(),
    setBusy: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn((title) => events.push(`toast:${title}`)),
    close: vi.fn(() => events.push("close")),
    invalidate: vi.fn(async () => {
      events.push("invalidate");
    }),
  };
  const workflow = new IntegrationConnectionWorkflow(
    palot,
    {
      set(callback) {
        scheduled.push(callback);
        return callback as unknown as ReturnType<typeof setTimeout>;
      },
      clear(timer) {
        const index = scheduled.indexOf(timer as unknown as () => void);
        if (index >= 0) scheduled.splice(index, 1);
      },
    },
    0,
  );
  return { workflow, palot, callbacks, scheduled, events };
}

describe("integration connection workflow", () => {
  it("keeps cancellation and late cleanup on the original server when another attempt starts", async () => {
    const { workflow, palot, callbacks } = setup();
    const pending = deferred<Awaited<ReturnType<typeof palot.connectIntegrationOAuth>>>();
    vi.mocked(palot.connectIntegrationOAuth).mockReturnValueOnce(pending.promise);
    const first = workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    await workflow.start(
      {
        ...location,
        connectionID: "server-b",
        integration,
        method: command,
        key: "",
        label: "",
        answer: {},
      },
      callbacks,
    );
    pending.resolve({
      attemptID: "late-a",
      url: "https://example.com/auth",
      instructions: "Authorize",
      mode: "auto",
      createdAt: 1,
      expiresAt: 2,
    });
    await first;
    expect(palot.cancelIntegrationOAuth).toHaveBeenCalledWith({
      ...location,
      integrationID: integration.id,
      attemptID: "late-a",
    });
    workflow.dispose();
    expect(palot.cancelIntegrationCommand).toHaveBeenCalledWith({
      ...location,
      connectionID: "server-b",
      integrationID: integration.id,
      attemptID: "command-1",
    });
  });

  it("branches key connections and refreshes before toast and close", async () => {
    const { workflow, palot, callbacks, events } = setup();

    await workflow.start(
      { ...location, integration, method: key, key: "secret", label: "work", answer: {} },
      callbacks,
    );

    expect(palot.connectIntegrationKey).toHaveBeenCalledWith({
      ...location,
      integrationID: "example",
      key: "secret",
      label: "work",
      answer: {},
    });
    expect(events).toEqual(["invalidate", "toast:Example connected", "close"]);
  });

  it("polls the matching method once at a time and completes in terminal order", async () => {
    const { workflow, palot, callbacks, scheduled, events } = setup();
    vi.mocked(palot.integrationOAuthStatus).mockResolvedValue({
      status: "complete",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    });

    await workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    await vi.waitFor(() => expect(palot.integrationOAuthStatus).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(events).toEqual(["invalidate", "toast:Example connected", "close"]),
    );
    expect(palot.integrationCommandStatus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("completes command connections through the command status endpoint", async () => {
    const { workflow, palot, callbacks, scheduled, events } = setup();
    vi.mocked(palot.integrationCommandStatus).mockResolvedValue({
      status: "complete",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    });

    await workflow.start(
      { ...location, integration, method: command, key: "", label: "", answer: {} },
      callbacks,
    );
    scheduled.shift()!();

    await vi.waitFor(() => expect(palot.integrationCommandStatus).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(events).toEqual(["invalidate", "toast:Example connected", "close"]),
    );
    expect(palot.integrationOAuthStatus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("submits a code-mode OAuth code and completes after the next status check", async () => {
    const { workflow, palot, callbacks, scheduled, events } = setup();
    vi.mocked(palot.connectIntegrationOAuth).mockResolvedValue({
      attemptID: "oauth-code",
      url: "https://example.com/auth",
      instructions: "Paste the code",
      mode: "code",
      createdAt: 1,
      expiresAt: 2,
    });
    vi.mocked(palot.integrationOAuthStatus).mockResolvedValue({
      status: "complete",
      message: null,
      createdAt: 1,
      expiresAt: 2,
    });

    await workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    await workflow.completeOAuth("  authorization-code  ", callbacks);
    scheduled.shift()!();

    expect(palot.completeIntegrationOAuth).toHaveBeenCalledWith({
      ...location,
      integrationID: "example",
      attemptID: "oauth-code",
      code: "authorization-code",
    });
    await vi.waitFor(() =>
      expect(events).toEqual(["invalidate", "toast:Example connected", "close"]),
    );
  });

  it("cancels a pending command before closing", async () => {
    const { workflow, palot, callbacks } = setup();

    await workflow.start(
      { ...location, integration, method: command, key: "", label: "", answer: {} },
      callbacks,
    );
    await workflow.close(callbacks);

    expect(palot.cancelIntegrationCommand).toHaveBeenCalledWith({
      ...location,
      integrationID: "example",
      attemptID: "command-1",
    });
    expect(callbacks.close).toHaveBeenCalledOnce();
  });

  it.each([
    { status: "failed" as const, message: "Login failed" },
    { status: "expired" as const, message: null },
  ])("stops polling a terminal $status attempt", async (terminal) => {
    const { workflow, palot, callbacks, scheduled } = setup();
    vi.mocked(palot.integrationCommandStatus).mockResolvedValue({
      ...terminal,
      createdAt: 1,
      expiresAt: 2,
    });

    await workflow.start(
      { ...location, integration, method: command, key: "", label: "", answer: {} },
      callbacks,
    );
    scheduled.shift()!();
    await vi.waitFor(() =>
      expect(callbacks.setAttempt).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: terminal.status, message: terminal.message }),
      ),
    );

    expect(scheduled).toHaveLength(0);
    expect(callbacks.showSuccess).not.toHaveBeenCalled();
  });

  it("ignores stale poll responses after cancellation", async () => {
    const { workflow, palot, callbacks, scheduled } = setup();
    const status = deferred<Awaited<ReturnType<typeof palot.integrationOAuthStatus>>>();
    vi.mocked(palot.integrationOAuthStatus).mockReturnValue(status.promise);

    await workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    scheduled.shift()!();
    await vi.waitFor(() => expect(palot.integrationOAuthStatus).toHaveBeenCalledOnce());
    await workflow.close(callbacks);
    status.resolve({ status: "complete", message: null, createdAt: 1, expiresAt: 2 });
    await status.promise;

    expect(callbacks.showSuccess).not.toHaveBeenCalled();
    expect(callbacks.invalidate).not.toHaveBeenCalled();
  });

  it("ignores a completed connection after the dialog is disposed during refresh", async () => {
    const { workflow, callbacks } = setup();
    const invalidated = deferred<void>();
    vi.mocked(callbacks.invalidate).mockReturnValue(invalidated.promise);

    const start = workflow.start(
      { ...location, integration, method: key, key: "secret", label: "", answer: {} },
      callbacks,
    );
    await vi.waitFor(() => expect(callbacks.invalidate).toHaveBeenCalledOnce());
    workflow.dispose();
    invalidated.resolve();
    await start;

    expect(callbacks.showSuccess).not.toHaveBeenCalled();
    expect(callbacks.close).not.toHaveBeenCalled();
    expect(callbacks.showError).not.toHaveBeenCalled();
  });

  it("cancels attempts created by stale start responses", async () => {
    const { workflow, palot, callbacks } = setup();
    const started = deferred<Awaited<ReturnType<typeof palot.connectIntegrationOAuth>>>();
    vi.mocked(palot.connectIntegrationOAuth).mockReturnValue(started.promise);

    const start = workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    await workflow.close(callbacks);
    started.resolve({
      attemptID: "late",
      url: "https://example.com/auth",
      instructions: "Authorize",
      mode: "auto",
      createdAt: 1,
      expiresAt: 2,
    });
    await start;

    expect(palot.cancelIntegrationOAuth).toHaveBeenCalledWith({
      ...location,
      integrationID: "example",
      attemptID: "late",
    });
    expect(callbacks.setAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ id: "late" }));
  });

  it("suppresses cleanup cancellation failures when disposed", async () => {
    const { workflow, palot, callbacks } = setup();
    vi.mocked(palot.cancelIntegrationOAuth).mockRejectedValue(new Error("offline"));

    await workflow.start(
      { ...location, integration, method: oauth, key: "", label: "", answer: {} },
      callbacks,
    );
    workflow.dispose();
    await Promise.resolve();

    expect(palot.cancelIntegrationOAuth).toHaveBeenCalledOnce();
    expect(callbacks.showError).not.toHaveBeenCalled();
  });
});
