// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_SCRIPTS_IPC_CHANNELS } from "../../shared/project-scripts-contract";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  windows: new Map<unknown, unknown>(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: (sender: unknown) => electron.windows.get(sender) ?? null },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
}));

const { registerTrustedIpcHandler, registerWindowRole } = await import("../ipc-security");
const { registerProjectScriptsIpc } = await import("./ipc");

const RENDERER = "file:///palot/out/renderer/index.html";
const channels = PROJECT_SCRIPTS_IPC_CHANNELS;
const target = { profileID: "local", projectID: "project-1" };
const script = { name: "test", command: "bun test", runOnSettle: true, timeoutSeconds: 60 };

function sender(url = RENDERER) {
  return { mainFrame: { url } };
}

describe("project scripts IPC", () => {
  let window: { isDestroyed(): boolean };
  const service = { load: vi.fn(), save: vi.fn(), remove: vi.fn() };

  beforeEach(() => {
    electron.handlers.clear();
    electron.windows.clear();
    for (const method of Object.values(service)) method.mockReset();
    window = { isDestroyed: () => false };
    registerWindowRole(window as never, "main");
    registerProjectScriptsIpc(
      (channel, handler) =>
        registerTrustedIpcHandler(
          channel,
          { expectedWindow: () => window as never, expectedUrl: RENDERER, expectedRole: "main" },
          handler,
        ),
      () => service as never,
    );
  });

  const call = (
    channel: string,
    event: { sender: ReturnType<typeof sender>; senderFrame: unknown },
    value: unknown,
  ) => electron.handlers.get(channel)!(event, value);

  function trusted() {
    const value = sender();
    electron.windows.set(value, window);
    return { sender: value, senderFrame: value.mainFrame };
  }

  it("registers every request channel through the trusted registrar", () => {
    const requests = Object.values(channels).filter(
      (channel) => channel !== channels.projectScriptRunFinished,
    );
    expect([...electron.handlers.keys()].toSorted()).toEqual(requests.toSorted());
  });

  it("rejects subframes, foreign documents and other windows before touching scripts", () => {
    const subframe = sender();
    electron.windows.set(subframe, window);
    const foreign = sender("https://attacker.invalid/");
    electron.windows.set(foreign, window);
    const other = sender();
    electron.windows.set(other, { isDestroyed: () => false });
    for (const event of [
      { sender: subframe, senderFrame: { url: RENDERER } },
      { sender: foreign, senderFrame: foreign.mainFrame },
      { sender: other, senderFrame: other.mainFrame },
    ])
      expect(() => call(channels.projectScriptsSave, event, { ...target, script })).toThrow(
        "trusted Palot main window",
      );
    expect(service.save).not.toHaveBeenCalled();
  });

  it("validates input before calling the service", () => {
    const event = trusted();
    for (const value of [
      { ...target, script: { ...script, timeoutSeconds: 1 } },
      { ...target, script: { ...script, timeoutSeconds: 10.5 } },
      { ...target, script: { ...script, cwd: "/" } },
      { ...target, script, extra: true },
      { profileID: "local", script },
    ])
      expect(() => call(channels.projectScriptsSave, event, value)).toThrow();
    expect(() => call(channels.projectScriptsRemove, event, target)).toThrow();
    expect(service.save).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();

    call(channels.projectScriptsSave, event, { ...target, script });
    expect(service.save).toHaveBeenCalledWith({ ...target, script });
    call(channels.projectScriptsLoad, event, target);
    expect(service.load).toHaveBeenCalledWith(target);
  });
});
