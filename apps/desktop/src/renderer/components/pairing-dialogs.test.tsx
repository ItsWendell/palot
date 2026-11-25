import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodePairImportResult, OpenCodeProfile } from "../../shared";
import { palot } from "../services/palot";
import {
  ConnectComputerDialog,
  PairingCredentialRow,
  ShareComputerDialog,
} from "./pairing-dialogs";

const toDataURL = vi.hoisted(() => vi.fn<(text: string) => Promise<string>>());
vi.mock("qrcode", () => ({ default: { toDataURL } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const payload = { urls: ["http://127.0.0.1:4096"], username: "opencode", password: "test-only" };
const credentialInfo = {
  mode: "credentials" as const,
  ...payload,
  payload: JSON.stringify(payload),
  name: null,
};
const code = "abcdefghijklmnop";
const linkInfo = {
  mode: "link" as const,
  urls: ["http://127.0.0.1:4096", "https://fallback.example"],
  code,
  expiresIn: 300,
  payload: `http://127.0.0.1:4096/auth/connect/${code}`,
  name: "studio",
};

function setup(info: typeof linkInfo | typeof credentialInfo = linkInfo) {
  vi.spyOn(palot, "openCodePairingInfo").mockResolvedValue(info);
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: { writeClipboardText: clipboard },
  });
  toDataURL.mockResolvedValue("data:image/png;base64,test");
  return clipboard;
}

const create = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create pairing code" }));
  });

describe("ShareComputerDialog", () => {
  it("creates a code only on request, shows the QR with the chosen name, and never prints the code", async () => {
    const clipboard = setup();
    render(<ShareComputerDialog open onOpenChange={() => {}} />);
    expect(palot.openCodePairingInfo).not.toHaveBeenCalled();
    await create();
    expect(
      await screen.findByRole("img", { name: "OpenCode one-time pairing QR code" }),
    ).toBeTruthy();
    expect(JSON.parse(toDataURL.mock.calls.at(-1)![0])).toEqual({
      code,
      urls: ["https://fallback.example"],
      name: "studio",
    });
    expect(document.body.textContent).not.toContain(code);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Name on the other device" }), {
        target: { value: "Studio Mac" },
      });
    });
    expect(JSON.parse(toDataURL.mock.calls.at(-1)![0]).name).toBe("Studio Mac");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy pairing code" }));
    });
    expect(JSON.parse(clipboard.mock.calls.at(-1)![0])).toEqual({
      code,
      urls: ["https://fallback.example"],
      name: "Studio Mac",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(clipboard).toHaveBeenLastCalledWith(`https://fallback.example/auth/connect/${code}`);
  });

  it("counts down, then drops the code and offers a new one", async () => {
    vi.useFakeTimers();
    setup();
    render(<ShareComputerDialog open onOpenChange={() => {}} />);
    await create();
    expect(screen.getByText("Expires in 5:00")).toBeTruthy();
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText("Expires in 3:59")).toBeTruthy();
    act(() => vi.advanceTimersByTime(240_000));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("That code expired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create new code" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy pairing code" })).toBeNull();
  });

  it("explains how to become reachable when only this computer's address exists", async () => {
    setup({ ...linkInfo, urls: ["http://127.0.0.1:4096"] });
    render(<ShareComputerDialog open onOpenChange={() => {}} />);
    await create();
    expect(screen.getByText("Other devices can’t reach this computer yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("opencode pair --remote")).toBeTruthy();
  });

  it("refuses a cleartext custom address and returns to the service addresses", async () => {
    setup();
    const user = userEvent.setup();
    render(<ShareComputerDialog open onOpenChange={() => {}} />);
    await create();
    await user.click(screen.getByRole("button", { name: "Use a different address…" }));
    await user.type(
      screen.getByRole("textbox", { name: "Address for pairing" }),
      "http://p.example",
    );
    expect(screen.getByRole("alert").textContent).toContain("Use HTTPS");
    expect(
      (screen.getByRole("button", { name: "Copy pairing code" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Use service addresses" }));
    expect(
      (screen.getByRole("button", { name: "Copy pairing code" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not restore a code after closing and reopening", async () => {
    setup();
    const view = render(<ShareComputerDialog open onOpenChange={() => {}} />);
    await create();
    view.rerender(<ShareComputerDialog open={false} onOpenChange={() => {}} />);
    view.rerender(<ShareComputerDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Create pairing code" })).toBeTruthy();
  });

  it("keeps legacy reusable credentials hidden until revealed", async () => {
    setup(credentialInfo);
    render(<ShareComputerDialog open onOpenChange={() => {}} />);
    await create();
    expect(screen.getByText("Username")).toBeTruthy();
    expect(screen.queryByText("test-only")).toBeNull();
  });
});

const success: OpenCodePairImportResult = {
  ok: true,
  snapshot: { activeProfileID: "local-default", profiles: [] },
  profileID: "p",
  name: "Anomaly Box",
  url: "https://device.example",
  version: "2.3.0",
  updated: false,
};

function paste(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Pairing code or link" }), {
    target: { value },
  });
}

describe("ConnectComputerDialog", () => {
  it("masks a pasted code, takes the name from the QR, and connects only on request", async () => {
    const user = userEvent.setup();
    const importPairing = vi.spyOn(palot, "importOpenCodePairing").mockResolvedValue(success);
    const onSaved = vi.fn();
    render(<ConnectComputerDialog open onOpenChange={() => {}} onSaved={onSaved} />);
    paste(JSON.stringify({ code, urls: ["https://device.example"], name: "Anomaly Box" }));
    expect(document.body.textContent).not.toContain(code);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name in Palot" }).value).toBe(
      "Anomaly Box",
    );
    expect(importPairing).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(importPairing).toHaveBeenCalledExactlyOnceWith({
      link: `https://device.example/auth/connect/${code}`,
      allowPlainHttp: false,
      name: "Anomaly Box",
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByText("Connected to Anomaly Box")).toBeTruthy();
    expect(screen.getByText("2.3.0")).toBeTruthy();
  });

  it("names an older payload by its address, and a typed name wins", async () => {
    const user = userEvent.setup();
    const importPairing = vi.spyOn(palot, "importOpenCodePairing").mockResolvedValue(success);
    render(<ConnectComputerDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    paste(`https://proxy.example/auth/connect/${code}`);
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Name in Palot" });
    expect(name.value).toBe("proxy.example");
    await user.clear(name);
    await user.type(name, "Work box");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(importPairing.mock.calls[0]![0].name).toBe("Work box");
  });

  it("offers to renew a server it already knows", () => {
    const profiles: OpenCodeProfile[] = [
      {
        id: "known",
        kind: "remote",
        name: "Old box",
        urls: ["https://device.example"],
        credentialID: "c",
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      },
    ];
    render(
      <ConnectComputerDialog open onOpenChange={() => {}} onSaved={() => {}} profiles={profiles} />,
    );
    paste(JSON.stringify({ code, urls: ["https://device.example"] }));
    expect(screen.getByText("You’ve connected to this server as Old box")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name in Palot" }).value).toBe(
      "Old box",
    );
  });

  it("says which step failed, and drops a code that was used", async () => {
    const user = userEvent.setup();
    const importPairing = vi.spyOn(palot, "importOpenCodePairing").mockResolvedValueOnce({
      ok: false,
      problem: { step: "address", title: "Nothing answered at device.example.", fix: "Start it." },
    });
    render(<ConnectComputerDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    paste(JSON.stringify({ code, urls: ["https://device.example"] }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Nothing answered at device.example.")).toBeTruthy();
    expect(screen.getByText("Failed at: Reaching the address")).toBeTruthy();
    // The code never arrived, so it can be tried again.
    importPairing.mockResolvedValueOnce({
      ok: false,
      problem: {
        step: "code",
        title: "The pairing code was already used.",
        fix: "New code.",
        codeSpent: true,
      },
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Failed at: Pairing code")).toBeTruthy();
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Pairing code or link" }).value,
    ).toBe("");
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("requires fresh consent for a cleartext target and resets after closing", async () => {
    const user = userEvent.setup();
    vi.spyOn(palot, "importOpenCodePairing").mockResolvedValue(success);
    const view = render(<ConnectComputerDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    paste(JSON.stringify({ code, urls: ["http://192.168.1.2:4096", "https://device.example"] }));
    const address = screen.getByRole("combobox", { name: "Redeem at this address" });
    expect((address as HTMLSelectElement).value).toBe("https://device.example");
    await user.selectOptions(address, "http://192.168.1.2:4096");
    const connect = screen.getByRole<HTMLButtonElement>("button", { name: "Connect" });
    expect(connect.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    expect(connect.disabled).toBe(false);
    await user.selectOptions(address, "https://device.example");
    await user.selectOptions(address, "http://192.168.1.2:4096");
    expect(connect.disabled).toBe(true);
    view.rerender(
      <ConnectComputerDialog open={false} onOpenChange={() => {}} onSaved={() => {}} />,
    );
    view.rerender(<ConnectComputerDialog open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Pairing code or link" }).value,
    ).toBe("");
  });

  it("rejects malformed links locally and locks the dialog while connecting", async () => {
    const pending = Promise.withResolvers<OpenCodePairImportResult>();
    const importPairing = vi.spyOn(palot, "importOpenCodePairing").mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ConnectComputerDialog open onOpenChange={onOpenChange} onSaved={() => {}} />);
    paste(`https://proxy.example/auth/connect/${code}?extra=1`);
    expect(screen.getByRole("alert").textContent).toContain("without extra parameters");
    paste(`https://proxy.example/auth/connect/${code}`);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(importPairing).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(success));
  });
});

describe("PairingCredentialRow", () => {
  it("copies the username and password independently", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(window, "palot", { configurable: true, value: { writeClipboardText } });
    render(
      <>
        <PairingCredentialRow label="Username" value="opencode" />
        <PairingCredentialRow label="Password" value="secret-value" concealed />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Copy username" }));
    await user.click(screen.getByRole("button", { name: "Copy password" }));
    expect(writeClipboardText).toHaveBeenNthCalledWith(1, "opencode");
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, "secret-value");
    expect(screen.queryByText("secret-value")).toBeNull();
  });
});
