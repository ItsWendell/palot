import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenCodeRuntimeStatus,
  PalotIntegration,
  PalotIntegrationConnection,
  PalotModel,
} from "../../shared";
import { palot } from "../services/palot";
import { ProviderConnectionDialog } from "./provider-connection-dialog";

const snapshot = vi.hoisted(() => ({
  integrations: [] as PalotIntegration[],
  models: [] as Array<Pick<PalotModel, "id" | "providerID">>,
  refetch: vi.fn(async () => []),
}));

vi.mock("../hooks/use-settings-owner", () => ({ useSettingsOwner: () => null }));
vi.mock("../hooks/use-settings-snapshot", () => ({
  useSettingsSnapshot: () => ({
    data: { integrations: snapshot.integrations, catalog: { models: snapshot.models } },
    refetch: snapshot.refetch,
  }),
}));
vi.mock("../services/palot", () => ({
  palot: { connectIntegrationExternal: vi.fn(), removeCredential: vi.fn() },
}));

const SIGNED_OUT = {
  status: "needs_auth" as const,
  message: "Claude Code is not logged in. Run `claude auth login` in a terminal.",
  url: null,
};
const NOT_INSTALLED = {
  status: "needs_auth" as const,
  message: "Claude Code is not installed. Install it, then run `claude auth login`.",
  url: "https://code.claude.com/docs/en/setup#install",
};

const owner = {
  connectionID: "server-a",
  connected: true,
  topology: "same-machine",
} as OpenCodeRuntimeStatus;

function claudeAgent(...connections: PalotIntegrationConnection[]): PalotIntegration {
  return {
    id: "claude-agent",
    name: "Claude Agent",
    methods: [
      {
        id: "claude-login",
        type: "external",
        label: "Claude Code login (claude auth login)",
        form: [],
      },
    ],
    connections: connections.map((connection, index) => ({ ...connection, active: index === 0 })),
  };
}

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

function setup(integration: PalotIntegration, runtime: OpenCodeRuntimeStatus = owner) {
  snapshot.integrations = [integration];
  const props = {
    integration,
    owner: runtime,
    projectID: "project-1",
    location: { directory: "/repo" },
    onOpenChange: vi.fn(),
    onComplete: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<ProviderConnectionDialog {...props} />);
  return {
    props,
    /** OpenCode reports new state; the settings queries re-render the dialog. */
    update(next: PalotIntegration, models = snapshot.models) {
      snapshot.integrations = [next];
      snapshot.models = models;
      view.rerender(<ProviderConnectionDialog {...props} />);
    },
  };
}

beforeEach(() => {
  snapshot.models = [];
  vi.mocked(palot.connectIntegrationExternal).mockResolvedValue(undefined);
  vi.mocked(palot.removeCredential).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Claude Agent setup", () => {
  it("guides through install and sign-in with copyable commands before connecting", () => {
    setup(claudeAgent());
    const dialog = screen.getByRole("dialog", { name: "Set up Claude Agent" });
    const steps = within(dialog).getByRole("list", { name: "Claude Agent setup" });
    const install = within(steps).getByRole("listitem", { name: "Install Claude Code" });
    expect(
      within(install).getByText("curl -fsSL https://claude.ai/install.sh | bash"),
    ).toBeTruthy();
    expect(
      within(install)
        .getByRole("link", { name: /Install guide/ })
        .getAttribute("href"),
    ).toBe("https://code.claude.com/docs/en/setup");
    const signIn = within(steps).getByRole("listitem", { name: "Sign in to Claude Code" });
    expect(within(signIn).getByText("claude auth login")).toBeTruthy();
    expect(within(signIn).getByRole("button", { name: /Copy Sign-in command/ })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe(
      "https://opencode.ai/v2/docs/claude-agent",
    );
    // Nothing is connected or run until the user asks for a check.
    expect(palot.connectIntegrationExternal).not.toHaveBeenCalled();
    expect(within(dialog).queryByText("Not found")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Check connection" })).toBeTruthy();
  });

  it("connects through OpenCode and shows the sign-in problem its check reports", async () => {
    const user = userEvent.setup();
    const view = setup(claudeAgent());
    await user.click(screen.getByRole("button", { name: "Check connection" }));
    expect(palot.connectIntegrationExternal).toHaveBeenCalledExactlyOnceWith({
      connectionID: "server-a",
      projectID: "project-1",
      directory: "/repo",
      integrationID: "claude-agent",
      methodID: "claude-login",
      answer: {},
      label: "Claude Code",
    });
    expect(screen.getByRole("status").textContent).toContain("Checking Claude Code");
    expect(view.props.onComplete).toHaveBeenCalledOnce();

    act(() => view.update(claudeAgent(credential("cred-1", SIGNED_OUT))));
    const result = await screen.findByRole("alert");
    expect(result.textContent).toContain("Claude Code isn't signed in");
    // OpenCode's message, with its quoted command shown as code.
    expect(result.textContent).toContain(SIGNED_OUT.message.replaceAll("`", ""));
    expect(within(result).getByText("claude auth login").tagName).toBe("CODE");
    const install = screen.getByRole("listitem", { name: "Install Claude Code" });
    expect(within(install).getByText("Installed")).toBeTruthy();
    const signIn = screen.getByRole("listitem", { name: "Sign in to Claude Code" });
    expect(within(signIn).getByText("Not signed in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(palot.removeCredential).not.toHaveBeenCalled();
  });

  it("links to OpenCode's install page when Claude Code is missing", () => {
    setup(claudeAgent(credential("cred-1", NOT_INSTALLED)));
    expect(screen.getByRole("alert").textContent).toContain("Claude Code isn't installed");
    const install = screen.getByRole("listitem", { name: "Install Claude Code" });
    expect(within(install).getByText("Not found")).toBeTruthy();
    expect(
      within(install)
        .getByRole("link", { name: /Install guide/ })
        .getAttribute("href"),
    ).toBe(NOT_INSTALLED.url);
  });

  it("replaces the old credential and reports ready once the new check passes", async () => {
    const user = userEvent.setup();
    snapshot.models = [{ providerID: "claude-agent", id: "opus" }];
    const view = setup(claudeAgent(credential("cred-1", SIGNED_OUT)));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(palot.removeCredential).toHaveBeenCalledExactlyOnceWith({
      connectionID: "server-a",
      projectID: "project-1",
      directory: "/repo",
      credentialID: "cred-1",
    });
    // The replaced credential's old problem is not this check's result.
    expect(screen.queryByRole("alert")).toBeNull();

    // Signing in changed what Claude Code lists, so OpenCode reloaded the provider.
    act(() =>
      view.update(claudeAgent(credential("cred-2")), [
        { providerID: "claude-agent", id: "opus" },
        { providerID: "claude-agent", id: "sonnet" },
      ]),
    );
    expect(await screen.findByText("Claude Agent is ready")).toBeTruthy();
    expect(snapshot.refetch).toHaveBeenCalled();
    const signIn = screen.getByRole("listitem", { name: "Sign in to Claude Code" });
    expect(within(signIn).getByText("Signed in")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(view.props.onOpenChange).toHaveBeenCalledWith(false);

    // A problem found later still replaces the result.
    act(() => view.update(claudeAgent(credential("cred-2", SIGNED_OUT))));
    expect((await screen.findByRole("alert")).textContent).toContain("isn't signed in");
  });

  it("waits for a problem before calling an unchanged model list ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    snapshot.models = [{ providerID: "claude-agent", id: "opus" }];
    const view = setup(claudeAgent(credential("cred-1")));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    act(() => view.update(claudeAgent(credential("cred-2"))));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByText("Claude Agent is ready")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Checking Claude Code");
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText("Claude Agent is ready")).toBeTruthy();
  });

  it("says when OpenCode never reports a result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = setup(claudeAgent());
    await user.click(screen.getByRole("button", { name: "Check connection" }));
    act(() => view.update(claudeAgent(credential("cred-1"))));
    await act(() => vi.advanceTimersByTimeAsync(65_000));
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't confirm Claude Code is ready",
    );
    expect(screen.getByRole("button", { name: "Check again" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("explains that Claude Code belongs on a remote OpenCode server", () => {
    setup(claudeAgent(), { ...owner, topology: "remote-machine" });
    expect(screen.getByText("Run these commands on the OpenCode server")).toBeTruthy();
    expect(screen.getByText("curl -fsSL https://claude.ai/install.sh | bash")).toBeTruthy();
    expect(screen.getByText("irm https://claude.ai/install.ps1 | iex")).toBeTruthy();
  });

  it("keeps a failed connect request retryable", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(palot.connectIntegrationExternal).mockRejectedValueOnce(new Error("Offline"));
    setup(claudeAgent());
    await user.click(screen.getByRole("button", { name: "Check connection" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Check connection" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});
