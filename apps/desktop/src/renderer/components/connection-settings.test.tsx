import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palot } from "../services/palot";
import { LocalServiceSettings, PairDialog, PairingCredentialRow } from "./connection-settings";
import { Provider, createStore } from "jotai";
import { runtimeAtom } from "../atoms/workspace";

const toDataURL = vi.hoisted(() => vi.fn<(text: string) => Promise<string>>());
vi.mock("qrcode", () => ({ default: { toDataURL } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const payload = { urls: ["http://127.0.0.1:4096"], username: "opencode", password: "test-only" };
const pairingInfo = { ...payload, payload: JSON.stringify(payload) };

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
    await user.click(screen.getByRole("button", { name: "Restart service" }));
    expect(await screen.findByText(/may interrupt other OpenCode clients/)).toBeTruthy();
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRestart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restart service" }));
    await user.click(await screen.findByRole("button", { name: "Restart", exact: true }));
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
    await user.click(screen.getByRole("button", { name: "Start OpenCode" }));
    expect(connect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start or recover" }));
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

function setupPairing() {
  vi.spyOn(palot, "openCodePairingInfo").mockResolvedValue(pairingInfo);
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: { writeClipboardText: clipboard },
  });
  toDataURL.mockResolvedValue("data:image/png;base64,test");
  return clipboard;
}

describe("PairDialog", () => {
  it("copies and renders a credential-bearing proxy payload and can return to service addresses", async () => {
    const clipboard = setupPairing();
    const user = userEvent.setup();
    render(
      <PairDialog open onOpenChange={() => {}} suggestedAddress="https://device.tailnet.example" />,
    );
    expect(palot.openCodePairingInfo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reveal pairing credentials" }));
    await user.click(screen.getByRole("button", { name: "Copy pairing JSON" }));
    expect(JSON.parse(clipboard.mock.calls[0]![0])).toEqual({
      ...payload,
      urls: ["https://device.tailnet.example"],
    });
    await user.click(screen.getByRole("button", { name: "Show QR" }));
    expect(JSON.parse(toDataURL.mock.calls.at(-1)![0])).toEqual({
      ...payload,
      urls: ["https://device.tailnet.example"],
    });
    expect(screen.getByRole("img", { name: "OpenCode pairing QR code" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use service addresses" }));
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy pairing JSON" }));
    expect(JSON.parse(clipboard.mock.calls.at(-1)![0])).toEqual(payload);
  });

  it("blocks exporting credentials with an insecure custom address", async () => {
    setupPairing();
    const user = userEvent.setup();
    render(<PairDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Reveal pairing credentials" }));
    await user.type(
      screen.getByRole("textbox", { name: "Address for pairing" }),
      "http://proxy.example",
    );
    expect(screen.getByRole("alert").textContent).toContain("Use HTTPS");
    expect((screen.getByRole("button", { name: "Show QR" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Copy pairing JSON" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("discards a QR generated for an address that changed while rendering", async () => {
    setupPairing();
    let resolveQr!: (value: string) => void;
    toDataURL.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveQr = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<PairDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Reveal pairing credentials" }));
    await user.click(screen.getByRole("button", { name: "Show QR" }));
    await user.type(
      screen.getByRole("textbox", { name: "Address for pairing" }),
      "https://proxy.example",
    );
    await act(async () => {
      resolveQr("data:image/png;base64,stale");
    });
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show QR" }));
    expect(JSON.parse(toDataURL.mock.calls.at(-1)![0]).urls).toEqual(["https://proxy.example"]);
  });

  it("expires credentials without extending their lifetime when the address changes", async () => {
    vi.useFakeTimers();
    setupPairing();
    let resolveQr!: (value: string) => void;
    toDataURL.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveQr = resolve;
      }),
    );
    render(<PairDialog open onOpenChange={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal pairing credentials" }));
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Address for pairing" }), {
      target: { value: "https://proxy.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show QR" }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      resolveQr("data:image/png;base64,expired");
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy pairing JSON" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reveal pairing credentials" })).toBeTruthy();
  });

  it("does not restore credentials or a pending QR after closing and reopening", async () => {
    setupPairing();
    let resolveQr!: (value: string) => void;
    toDataURL.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveQr = resolve;
      }),
    );
    const user = userEvent.setup();
    const view = render(<PairDialog open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Reveal pairing credentials" }));
    await user.click(screen.getByRole("button", { name: "Show QR" }));
    view.rerender(<PairDialog open={false} onOpenChange={() => {}} />);
    await act(async () => {
      resolveQr("data:image/png;base64,closed");
    });
    view.rerender(<PairDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy pairing JSON" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reveal pairing credentials" })).toBeTruthy();
  });
});

describe("PairingCredentialRow", () => {
  afterEach(cleanup);

  it("copies the username and password independently", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { writeClipboardText },
    });

    render(
      <>
        <PairingCredentialRow label="Username" value="opencode" />
        <PairingCredentialRow label="Password" value="secret-value" concealed />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Copy username" }));
    expect(screen.getByRole("button", { name: "Username copied" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy password" }));

    expect(writeClipboardText).toHaveBeenNthCalledWith(1, "opencode");
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, "secret-value");
    expect(screen.queryByText("secret-value")).toBeNull();
  });
});
