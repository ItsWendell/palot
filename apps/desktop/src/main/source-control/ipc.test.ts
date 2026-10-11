// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_CONTROL_IPC_CHANNELS } from "../../shared/source-control-contract";

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
const { registerSourceControlIpc } = await import("./ipc");

const RENDERER = "file:///palot/out/renderer/index.html";

function sender(url = RENDERER) {
  const mainFrame = { url };
  return { mainFrame };
}

function trustedWindow() {
  const window = { isDestroyed: () => false };
  registerWindowRole(window as never, "main");
  return window;
}

describe("source control IPC", () => {
  let window: ReturnType<typeof trustedWindow>;
  const ok = () => vi.fn(async () => ({ ok: true, value: null }));
  const service = {
    gitStage: ok(),
    linkPullRequest: ok(),
    mergePullRequest: ok(),
    submitPullRequestReview: ok(),
    pullRequestTimeline: ok(),
    searchPullRequests: ok(),
  };

  beforeEach(() => {
    electron.handlers.clear();
    electron.windows.clear();
    window = trustedWindow();
    registerSourceControlIpc(
      (channel, handler) =>
        registerTrustedIpcHandler(
          channel,
          { expectedWindow: () => window as never, expectedUrl: RENDERER, expectedRole: "main" },
          handler,
        ),
      () => service as never,
    );
  });

  function invoke(
    event: { sender: ReturnType<typeof sender>; senderFrame: unknown },
    input: unknown,
  ) {
    return electron.handlers.get(SOURCE_CONTROL_IPC_CHANNELS.gitStage)!(event, input);
  }

  const input = { profileID: "local", directory: "/repo", paths: ["a.txt"] };

  it("registers every source control request channel through the trusted registrar", () => {
    const requests = Object.values(SOURCE_CONTROL_IPC_CHANNELS).filter(
      (channel) => channel !== SOURCE_CONTROL_IPC_CHANNELS.sourceControlChanged,
    );
    expect([...electron.handlers.keys()].toSorted()).toEqual(requests.toSorted());
  });

  it("serves the trusted main window's main frame", async () => {
    const trusted = sender();
    electron.windows.set(trusted, window);
    await invoke({ sender: trusted, senderFrame: trusted.mainFrame }, input);
    expect(service.gitStage).toHaveBeenCalledWith(input);
  });

  it("rejects subframes, foreign documents and other windows before touching Git", () => {
    const subframe = sender();
    electron.windows.set(subframe, window);
    expect(() => invoke({ sender: subframe, senderFrame: { url: RENDERER } }, input)).toThrow(
      "trusted Palot main window",
    );

    const foreign = sender("https://attacker.invalid/");
    electron.windows.set(foreign, window);
    expect(() => invoke({ sender: foreign, senderFrame: foreign.mainFrame }, input)).toThrow(
      "trusted Palot main window",
    );

    const other = sender();
    electron.windows.set(other, { isDestroyed: () => false });
    expect(() => invoke({ sender: other, senderFrame: other.mainFrame }, input)).toThrow(
      "trusted Palot main window",
    );
    expect(service.gitStage).not.toHaveBeenCalled();
  });

  it("validates input before calling the service", () => {
    const trusted = sender();
    electron.windows.set(trusted, window);
    const event = { sender: trusted, senderFrame: trusted.mainFrame };
    expect(() => invoke(event, { ...input, paths: [] })).toThrow();
    expect(() => invoke(event, { ...input, extra: true })).toThrow();
    expect(() =>
      electron.handlers.get(SOURCE_CONTROL_IPC_CHANNELS.pullRequestLink)!(event, {
        profileID: "local",
      }),
    ).toThrow();
    expect(service.gitStage).not.toHaveBeenCalled();
    expect(service.linkPullRequest).not.toHaveBeenCalled();
  });

  const HEAD = "a".repeat(40);
  const ref = { host: "github.com", repository: "acme/web", number: 7 };

  function call(
    channel: string,
    event: { sender: ReturnType<typeof sender>; senderFrame: unknown },
    value: unknown,
  ) {
    return electron.handlers.get(channel)!(event, value);
  }

  it("guards the review workspace channels with the same trust check", () => {
    const subframe = sender();
    electron.windows.set(subframe, window);
    const untrusted = { sender: subframe, senderFrame: { url: RENDERER } };
    for (const [channel, value] of [
      [
        SOURCE_CONTROL_IPC_CHANNELS.pullRequestMerge,
        { ...ref, method: "merge", expectedHeadOid: HEAD },
      ],
      [SOURCE_CONTROL_IPC_CHANNELS.pullRequestDetail, ref],
      [
        SOURCE_CONTROL_IPC_CHANNELS.pullRequestReview,
        { ...ref, event: "approve", body: "", commitOid: HEAD, comments: [] },
      ],
    ] as const)
      expect(() => call(channel, untrusted, value)).toThrow("trusted Palot main window");
    expect(service.mergePullRequest).not.toHaveBeenCalled();
  });

  it("validates review workspace input before calling the service", async () => {
    const trusted = sender();
    electron.windows.set(trusted, window);
    const event = { sender: trusted, senderFrame: trusted.mainFrame };
    const merge = SOURCE_CONTROL_IPC_CHANNELS.pullRequestMerge;
    expect(() =>
      call(merge, event, { ...ref, method: "merge", expectedHeadOid: "main" }),
    ).toThrow();
    expect(() =>
      call(merge, event, { ...ref, method: "octopus", expectedHeadOid: HEAD }),
    ).toThrow();
    expect(() =>
      call(merge, event, { ...ref, number: 0, method: "merge", expectedHeadOid: HEAD }),
    ).toThrow();
    expect(() =>
      call(SOURCE_CONTROL_IPC_CHANNELS.pullRequestReview, event, {
        ...ref,
        event: "approve",
        body: "",
        commitOid: HEAD,
        comments: [{ path: "a.ts", line: 0, side: "RIGHT", body: "x" }],
      }),
    ).toThrow();
    expect(service.mergePullRequest).not.toHaveBeenCalled();
    expect(service.submitPullRequestReview).not.toHaveBeenCalled();

    await call(merge, event, { ...ref, method: "squash", expectedHeadOid: HEAD });
    expect(service.mergePullRequest).toHaveBeenCalledWith({
      ...ref,
      method: "squash",
      expectedHeadOid: HEAD,
    });
    // The renderer hook sends an explicit `limit: undefined` and a null first cursor.
    await call(SOURCE_CONTROL_IPC_CHANNELS.pullRequestTimeline, event, {
      ...ref,
      cursor: null,
      limit: undefined,
    });
    expect(service.pullRequestTimeline).toHaveBeenCalled();
    await call(SOURCE_CONTROL_IPC_CHANNELS.pullRequestSearch, event, {
      list: "mentioned",
      query: "repo:acme/web",
    });
    expect(service.searchPullRequests).toHaveBeenCalledWith({
      list: "mentioned",
      query: "repo:acme/web",
    });
  });
});
