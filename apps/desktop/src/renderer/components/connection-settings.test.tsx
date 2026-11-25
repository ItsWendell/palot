import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palot } from "../services/palot";
import { CredentialStorageNotice, LocalServiceSettings } from "./connection-settings";
import { Provider, createStore } from "jotai";
import { runtimeAtom } from "../atoms/workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LocalServiceSettings", () => {
  beforeEach(() => {
    vi.spyOn(palot, "getOpenCodeLoginStatus").mockResolvedValue({
      manager: "systemd",
      supported: true,
      enabled: false,
      owned: false,
      running: false,
      pid: null,
      binaryPath: null,
      configPath: null,
      reason: null,
    });
    vi.spyOn(palot, "inspectOpenCodeInstallations").mockResolvedValue({
      preference: "installed",
      selectedID: null,
      installations: [],
    });
  });
  it("blocks start and restart while an installed CLI upgrade is pending without restarting on completion", async () => {
    const user = userEvent.setup();
    const installation = {
      id: "installed",
      path: "/home/test/.bun/bin/opencode2",
      version: "2.0.2",
      compatible: true,
    };
    const status = {
      preference: "installed" as const,
      selectedID: installation.id,
      installations: [installation],
    };
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue(status);
    vi.spyOn(palot, "openCodeReleaseStatus").mockResolvedValue({
      channel: "stable",
      bundledVersion: "2.0.2",
      preparedVersion: null,
      checkedAt: 1000,
      offer: {
        channel: "stable",
        version: "2.0.3",
        tested: false,
        requiresConfirmation: false,
        size: 1024,
      },
    });
    const pending = Promise.withResolvers<typeof status>();
    const upgrade = vi.spyOn(palot, "upgradeOpenCodeInstallation").mockReturnValue(pending.promise);
    const connect = vi.spyOn(palot, "connectOpenCode");
    const onRestart = vi.fn();
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "error",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: "Unavailable",
      versionMismatch: null,
      canStartLocalService: true,
    });
    render(
      <Provider store={store}>
        <LocalServiceSettings
          info={
            { local: { available: false, restartAvailable: true } } as Parameters<
              typeof LocalServiceSettings
            >[0]["info"]
          }
          busy={false}
          onRefresh={() => {}}
          onRestart={onRestart}
        />
      </Provider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Update installed OpenCode to 2.0.3" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm installed update" }));
    expect(upgrade).toHaveBeenCalledExactlyOnceWith({
      id: "installed",
      currentVersion: "2.0.2",
      version: "2.0.3",
      method: "auto",
    });
    expect(
      (screen.getByRole("button", { name: "Start OpenCode" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("combobox", { name: "Preferred channel" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/bounded timeout/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enable login startup" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => pending.resolve(status));
    expect(onRestart).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
  it("keeps preparation separate from restart and disables lifecycle actions during preparation", async () => {
    const user = userEvent.setup();
    const status = {
      channel: "stable" as const,
      bundledVersion: "2.0.2",
      preparedVersion: null,
      checkedAt: 1000,
      offer: {
        channel: "stable" as const,
        version: "2.0.3",
        size: 1024,
        tested: false,
        requiresConfirmation: false,
      },
    };
    vi.spyOn(palot, "openCodeReleaseStatus").mockResolvedValue(status);
    const pending = Promise.withResolvers<typeof status>();
    const prepare = vi.spyOn(palot, "prepareOpenCodeRelease").mockReturnValue(pending.promise);
    const onRestart = vi.fn();
    render(
      <LocalServiceSettings
        info={
          { local: { available: true, restartAvailable: true } } as Parameters<
            typeof LocalServiceSettings
          >[0]["info"]
        }
        busy={false}
        onRefresh={() => {}}
        onRestart={onRestart}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Download Palot fallback 2.0.3" }));
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ version: "2.0.3" });
    expect(
      (screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => pending.resolve(status));
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restart service" }));
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("blocks runtime updates and restart while login startup is being confirmed or saved", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
      preference: "installed",
      selectedID: "cli",
      installations: [{ id: "cli", path: "/opt/opencode2", version: "2.0.2", compatible: true }],
    });
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof palot.updateOpenCodeLogin>>>();
    vi.spyOn(palot, "updateOpenCodeLogin").mockReturnValue(pending.promise);
    const onRestart = vi.fn();
    render(
      <LocalServiceSettings
        info={
          { local: { available: true, restartAvailable: true } } as Parameters<
            typeof LocalServiceSettings
          >[0]["info"]
        }
        busy={false}
        onRefresh={() => {}}
        onRestart={onRestart}
      />,
    );
    await screen.findByText("Disabled");
    const restart = screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement;
    const channel = (await screen.findByRole("combobox", {
      name: "Runtime source",
    })) as HTMLButtonElement;
    await user.click(screen.getByRole("button", { name: "Enable login startup" }));
    expect(restart.disabled).toBe(true);
    expect(channel.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Confirm enable" }));
    expect(restart.disabled).toBe(true);
    await act(async () =>
      pending.resolve({
        manager: "systemd",
        supported: true,
        enabled: true,
        owned: true,
        running: false,
        pid: null,
        binaryPath: "/opt/opencode2",
        configPath: null,
        reason: null,
      }),
    );
    expect(restart.disabled).toBe(false);
    expect(channel.disabled).toBe(false);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("confirms restart and does not offer startup without permission", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    render(
      <LocalServiceSettings
        info={
          { local: { available: true, restartAvailable: true } } as Parameters<
            typeof LocalServiceSettings
          >[0]["info"]
        }
        busy={false}
        onRefresh={() => {}}
        onRestart={onRestart}
      />,
    );
    expect(screen.queryByRole("button", { name: "Start OpenCode" })).toBeNull();
    // Lifecycle actions stay disabled until the installation and login checks settle; under a
    // loaded test run, clicking earlier would hit a disabled trigger and never open the dialog.
    const restart = screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement;
    await waitFor(() => expect(restart.disabled).toBe(false));
    await user.click(restart);
    expect(await screen.findByText(/may interrupt other OpenCode clients/)).toBeTruthy();
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restart service" }));
    await user.click(await screen.findByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("starts the local service explicitly and refreshes connection information", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const runtime = {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "error" as const,
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: "Unavailable",
      versionMismatch: null,
      canStartLocalService: true,
    };
    store.set(runtimeAtom, runtime);
    const connected = {
      ...runtime,
      connected: true,
      canStartLocalService: false,
      phase: "connected" as const,
    };
    const connect = vi.spyOn(palot, "connectOpenCode").mockResolvedValue(connected);
    const onRefresh = vi.fn();
    render(
      <Provider store={store}>
        <LocalServiceSettings info={null} busy={false} onRefresh={onRefresh} onRestart={() => {}} />
      </Provider>,
    );
    // Same as restart: wait for the installation and login checks to release the action.
    const start = screen.getByRole("button", { name: "Start OpenCode" }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    await user.click(start);
    expect(connect).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Start or recover" }));
    expect(connect).toHaveBeenCalledExactlyOnceWith({ startLocalService: true });
    expect(store.get(runtimeAtom)).toEqual(connected);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Start OpenCode" })).toBeNull();
    act(() =>
      store.set(runtimeAtom, { ...runtime, profileID: "remote", canStartLocalService: false }),
    );
    expect(screen.queryByRole("button", { name: "Start OpenCode" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Restart service" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("CredentialStorageNotice", () => {
  it("warns only when credentials fall back to Chromium's basic text storage", () => {
    const { rerender } = render(<CredentialStorageNotice protection="basic-text" />);
    expect(screen.getByText("Saved credentials are not encrypted")).toBeTruthy();
    expect(screen.getByText(/found no system keyring/)).toBeTruthy();

    for (const protection of ["encrypted", "unavailable", null] as const) {
      rerender(<CredentialStorageNotice protection={protection} />);
      expect(screen.queryByText("Saved credentials are not encrypted")).toBeNull();
    }
  });
});
