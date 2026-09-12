import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionPty, preparePtyConnection, PtyTransport } from "./opencode-pty";

afterEach(() => {
  vi.useRealTimers();
});

describe("preparePtyConnection", () => {
  it("attaches read-only persistent terminals as observers without takeover", async () => {
    const target = await preparePtyConnection(
      { ...input(), transport: "persistent", readOnly: true },
      {
        withClient: (operation) =>
          operation(
            {
              experimental: {
                persistentPty: {
                  connectToken: async () => ({ ticket: "observer-ticket", expires_in: 15 }),
                },
              },
            } as never,
            false,
          ),
        requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1:4096" } }),
      },
    );
    const url = new URL(target.url);
    expect(url.searchParams.get("role")).toBe("observer");
    expect(url.searchParams.get("takeover")).toBe("false");
  });
  it("mints a ticketed websocket URL without exposing OpenCode credentials", async () => {
    const token = vi.fn(async () => ({ data: { ticket: "single-use", expires_in: 15 } }));
    const target = await preparePtyConnection(
      {
        ptyID: "pty-1",
        location: { directory: "/repo path", workspaceID: "wrk_1" },
        cursor: 42,
        transport: "legacy",
      },
      {
        withClient: (operation) => operation({ pty: { connect: { token } } } as never, true),
        requestConnection: async () => ({ endpoint: { url: "https://127.0.0.1:4096" } }),
      },
    );

    expect(token).toHaveBeenCalledWith({
      ptyID: "pty-1",
      location: { directory: "/repo path", workspace: "wrk_1" },
      "x-opencode-ticket": "1",
    });
    expect(new URL(target.url)).toMatchObject({
      protocol: "wss:",
      pathname: "/api/pty/pty-1/connect",
    });
    expect(new URL(target.url).searchParams.get("location[directory]")).toBe("/repo path");
    expect(new URL(target.url).searchParams.get("location[workspace]")).toBe("wrk_1");
    expect(new URL(target.url).searchParams.get("cursor")).toBe("42");
    expect(new URL(target.url).searchParams.get("ticket")).toBe("single-use");
    expect(target.expiresAt).toBeGreaterThan(Date.now());
    expect(target.url).not.toContain("authorization");
  });

  it("mints a persistent PTY URL without location-scoped legacy parameters", async () => {
    const connectToken = vi.fn(async () => ({ ticket: "persistent-ticket", expires_in: 15 }));
    const target = await preparePtyConnection(
      {
        ptyID: "pty_persistent_1",
        location: { directory: "/repo" },
        cursor: 128,
        transport: "persistent",
      },
      {
        withClient: (operation) =>
          operation({ experimental: { persistentPty: { connectToken } } } as never, false),
        requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1:4096" } }),
      },
    );

    const url = new URL(target.url);
    expect(url.pathname).toBe("/api/experimental/persistent-pty/pty_persistent_1/connect");
    expect(url.searchParams.get("cursor")).toBe("128");
    expect(url.searchParams.get("takeover")).toBe("true");
    expect(url.searchParams.get("input_protocol")).toBe("1");
    expect(url.searchParams.has("location[directory]")).toBe(false);
  });
});

describe("createSessionPty", () => {
  it("lets remote hosts choose their shell without sending local process environment", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: { id: "remote-pty", title: "Terminal", status: "running" } });
    const persistent = vi.fn();
    const pty = await createSessionPty(
      {
        sessionID: "remote-task",
        location: { directory: "/srv/project", workspaceID: "worktree-1" },
      },
      {
        withClient: (operation) =>
          operation(
            { pty: { create }, experimental: { persistentPty: { create: persistent } } } as never,
            true,
          ),
        requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1:54321" } }),
      },
    );
    expect(create).toHaveBeenCalledWith({
      location: { directory: "/srv/project", workspace: "worktree-1" },
      cwd: "/srv/project",
      title: "Terminal",
    });
    expect(persistent).not.toHaveBeenCalled();
    expect(pty.transport).toBe("legacy");
  });
  it("creates a session-owned persistent PTY", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "pty_persistent_1",
      title: "Terminal",
      status: "running",
    });

    await expect(
      createSessionPty(
        { sessionID: "session-1", location: { directory: "/repo" } },
        {
          withClient: (operation) =>
            operation({ experimental: { persistentPty: { create } } } as never, false),
          requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1" } }),
        },
      ),
    ).resolves.toMatchObject({ id: "pty_persistent_1", transport: "persistent" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        cwd: "/repo",
        title: "Terminal",
        env: expect.objectContaining({ TERM: expect.any(String), COLORTERM: expect.any(String) }),
      }),
    );
  });

  it("falls back to the stable PTY when the persistent daemon is unavailable", async () => {
    const legacy = vi.fn().mockResolvedValue({
      data: { id: "pty-legacy", title: "Terminal", status: "running" },
    });
    const persistent = vi.fn().mockRejectedValue(new Error("daemon unavailable"));

    await expect(
      createSessionPty(
        { sessionID: "session-1", location: { directory: "/repo" } },
        {
          withClient: (operation) =>
            operation(
              {
                experimental: { persistentPty: { create: persistent } },
                pty: { create: legacy },
              } as never,
              false,
            ),
          requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1" } }),
        },
      ),
    ).resolves.toMatchObject({ id: "pty-legacy", transport: "legacy" });
  });

  it("does not hide authentication or network failures behind the legacy PTY", async () => {
    const legacy = vi.fn();
    const persistent = vi.fn().mockRejectedValue(new Error("Unauthorized"));

    await expect(
      createSessionPty(
        { sessionID: "session-1", location: { directory: "/repo" } },
        {
          withClient: (operation) =>
            operation(
              {
                experimental: { persistentPty: { create: persistent } },
                pty: { create: legacy },
              } as never,
              false,
            ),
          requestConnection: async () => ({ endpoint: { url: "http://127.0.0.1" } }),
        },
      ),
    ).rejects.toThrow("Unauthorized");
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe("PtyTransport", () => {
  it("rejects in-flight tickets when the active profile changes", async () => {
    let finish!: (value: { url: string; expiresAt: number }) => void;
    const createSocket = vi.fn(() => fakeSocket());
    const transport = new PtyTransport(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      createSocket,
    );
    const connecting = transport.connect(fakeSender(), input());
    transport.closeAll();
    finish({ url: "ws://old-host/terminal", expiresAt: Date.now() + 10_000 });
    await expect(connecting).rejects.toThrow("profile changed");
    expect(createSocket).not.toHaveBeenCalled();
  });

  it("reattaches using a fresh ticket and the current SSH tunnel endpoint", async () => {
    let port = 49001;
    let ticket = 0;
    const createSocket = vi.fn((_url: string) => fakeSocket());
    const transport = new PtyTransport(
      (request) =>
        preparePtyConnection(request, {
          withClient: (operation) =>
            operation(
              {
                pty: {
                  connect: {
                    token: async () => ({ data: { ticket: `ticket-${++ticket}`, expires_in: 15 } }),
                  },
                },
              } as never,
              true,
            ),
          requestConnection: async () => ({ endpoint: { url: `http://127.0.0.1:${port}` } }),
        }),
      createSocket,
    );
    const sender = fakeSender();
    const first = await transport.connect(sender, input());
    transport.start(sender, first);
    transport.disconnect(sender, first);
    port = 49002;
    const second = await transport.connect(sender, { ...input(), cursor: 42 });
    transport.start(sender, second);
    const firstUrl = new URL(createSocket.mock.calls[0]![0]);
    const secondUrl = new URL(createSocket.mock.calls[1]![0]);
    expect(firstUrl.port).toBe("49001");
    expect(secondUrl.port).toBe("49002");
    expect(secondUrl.searchParams.get("ticket")).toBe("ticket-2");
    expect(secondUrl.searchParams.get("cursor")).toBe("42");
    transport.closeAll();
  });
  it.each(["legacy", "persistent"] as const)(
    "blocks observer input and resize frames for %s",
    async (kind) => {
      const socket = fakeSocket();
      const transport = new PtyTransport(
        async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
        () => socket,
      );
      const sender = fakeSender();
      const connectionID = await transport.connect(sender, {
        ...input(),
        transport: kind,
        readOnly: true,
      });
      transport.start(sender, connectionID);
      Object.assign(socket, { readyState: WebSocket.OPEN });
      transport.write(sender, connectionID, "pwd\n", { cols: 80, rows: 24 });
      transport.write(sender, connectionID, "", { cols: 100, rows: 30 }, true);
      expect(socket.send).not.toHaveBeenCalled();
      transport.disconnect(sender, connectionID);
    },
  );
  it("opens the websocket only after the renderer starts the connection", async () => {
    const createSocket = vi.fn(() => fakeSocket());
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      createSocket,
    );
    const sender = fakeSender();

    const connectionID = await transport.connect(sender, input());

    expect(createSocket).not.toHaveBeenCalled();
    transport.start(sender, connectionID);
    expect(createSocket).toHaveBeenCalledWith("ws://127.0.0.1/terminal");
    transport.disconnect(sender, connectionID);
  });

  it("expires unstarted connections and limits them per renderer", async () => {
    vi.useFakeTimers();
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      () => fakeSocket(),
      100,
    );
    const sender = fakeSender();
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => transport.connect(sender, input())),
    );

    await expect(transport.connect(sender, input())).rejects.toThrow(
      "Too many terminal connections are open",
    );
    vi.advanceTimersByTime(100);
    expect(() => transport.start(sender, ids[0]!)).toThrow("Terminal connection is unavailable");
  });

  it("rejects an expired connection ticket before opening a websocket", async () => {
    const createSocket = vi.fn(() => fakeSocket());
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() - 1 }),
      createSocket,
    );
    const sender = fakeSender();
    const connectionID = await transport.connect(sender, input());

    expect(() => transport.start(sender, connectionID)).toThrow("token expired");
    expect(createSocket).not.toHaveBeenCalled();
    expect(() => transport.start(sender, connectionID)).toThrow("unavailable");
  });

  it("forwards socket lifecycle and normalizes data for the owning renderer", async () => {
    const socket = fakeSocket();
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      () => socket,
    );
    const sender = fakeSender();
    const connectionID = await transport.connect(sender, input());

    transport.start(sender, connectionID);
    socket.dispatchEvent(new Event("open"));
    Object.assign(socket, { readyState: WebSocket.OPEN });
    transport.write(sender, connectionID, "pwd\n", { cols: 80, rows: 24 });
    socket.dispatchEvent(new MessageEvent("message", { data: "output" }));
    socket.dispatchEvent(new MessageEvent("message", { data: new Uint8Array([1, 2, 3]) }));

    expect(socket.send).toHaveBeenCalledWith("pwd\n");
    expect(sender.send).toHaveBeenCalledWith(expect.any(String), { connectionID, type: "open" });
    expect(sender.send).toHaveBeenCalledWith(expect.any(String), {
      connectionID,
      type: "data",
      data: "output",
    });
    expect(sender.send).toHaveBeenCalledWith(expect.any(String), {
      connectionID,
      type: "data",
      data: new Uint8Array([1, 2, 3]).buffer,
    });
  });

  it("translates persistent PTY replay frames into terminal output and cursor metadata", async () => {
    const socket = fakeSocket();
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      () => socket,
    );
    const sender = fakeSender();
    const connectionID = await transport.connect(sender, {
      ...input(),
      ptyID: "pty_persistent_1",
      transport: "persistent",
    });

    transport.start(sender, connectionID);
    Object.assign(socket, { readyState: WebSocket.OPEN });
    transport.write(sender, connectionID, "pwd\n", { cols: 120, rows: 32 });
    transport.write(sender, connectionID, "", { cols: 100, rows: 28 }, true);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "attached",
          replay: { availableOffset: 10 },
        }),
      }),
    );
    socket.dispatchEvent(
      new MessageEvent("message", { data: new TextEncoder().encode("hello").buffer }),
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "replay_complete", endOffset: 15 }),
      }),
    );

    expect(sender.send).toHaveBeenCalledWith(expect.any(String), {
      connectionID,
      type: "data",
      data: "hello",
    });
    const inputFrame = vi.mocked(socket.send).mock.calls[0]?.[0];
    expect(inputFrame).toBeInstanceOf(Uint8Array);
    const inputBytes = inputFrame as Uint8Array;
    const inputView = new DataView(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength);
    expect(inputBytes[0]).toBe(1);
    expect(inputView.getUint16(1)).toBe(120);
    expect(inputView.getUint16(3)).toBe(32);
    expect(new TextDecoder().decode(inputBytes.subarray(5))).toBe("pwd\n");
    const controlFrame = vi.mocked(socket.send).mock.calls[1]?.[0];
    expect(controlFrame).toBeInstanceOf(Uint8Array);
    const controlBytes = controlFrame as Uint8Array;
    const controlView = new DataView(
      controlBytes.buffer,
      controlBytes.byteOffset,
      controlBytes.byteLength,
    );
    expect(controlBytes[0]).toBe(0);
    expect(controlView.getUint16(1)).toBe(100);
    expect(controlView.getUint16(3)).toBe(28);
    expect(controlBytes).toHaveLength(5);
    const cursorEvents = vi
      .mocked(sender.send)
      .mock.calls.map(([, event]) => event)
      .filter(
        (event): event is { data: ArrayBuffer } =>
          typeof event === "object" &&
          event !== null &&
          "data" in event &&
          event.data instanceof ArrayBuffer,
      );
    const latest = cursorEvents.at(-1)?.data;
    expect(latest).toBeInstanceOf(ArrayBuffer);
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(latest!).subarray(1)))).toEqual({
      cursor: 15,
    });
  });

  it("rejects cross-renderer ownership and suppresses events after disconnect", async () => {
    const socket = fakeSocket();
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      () => socket,
    );
    const owner = fakeSender();
    const other = { ...fakeSender(), id: 2 } as unknown as WebContents;
    const connectionID = await transport.connect(owner, input());

    expect(() => transport.start(other, connectionID)).toThrow("unavailable");
    transport.start(owner, connectionID);
    expect(() => transport.write(other, connectionID, "nope", { cols: 80, rows: 24 })).toThrow(
      "unavailable",
    );
    transport.disconnect(other, connectionID);
    expect(socket.close).not.toHaveBeenCalled();

    transport.disconnect(owner, connectionID);
    socket.dispatchEvent(new MessageEvent("message", { data: "late" }));

    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(owner.send).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: "data" }),
    );
  });

  it("closes every owned websocket when the renderer is destroyed", async () => {
    const allSockets = [fakeSocket(), fakeSocket()];
    const sockets = [...allSockets];
    const transport = new PtyTransport(
      async () => ({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 }),
      () => sockets.shift()!,
    );
    const sender = fakeSender();
    const first = await transport.connect(sender, input());
    const second = await transport.connect(sender, input());
    transport.start(sender, first);
    transport.start(sender, second);

    sender.destroy();

    for (const socket of allSockets) expect(socket.close).toHaveBeenCalledWith(1000);
    expect(() => transport.start(sender, first)).toThrow("unavailable");
    expect(() => transport.start(sender, second)).toThrow("unavailable");
  });

  it("does not retain a connection when the renderer is destroyed during preparation", async () => {
    let finishPreparation: ((target: { url: string; expiresAt: number }) => void) | undefined;
    const transport = new PtyTransport(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        }),
      () => fakeSocket(),
    );
    const sender = fakeSender();
    const connecting = transport.connect(sender, input());

    sender.destroy();
    finishPreparation?.({ url: "ws://127.0.0.1/terminal", expiresAt: Date.now() + 10_000 });

    await expect(connecting).rejects.toThrow("renderer is unavailable");
  });
});

function input() {
  return {
    ptyID: "pty-1",
    location: { directory: "/repo" },
    cursor: 0,
    transport: "legacy" as const,
  };
}

function fakeSender(): WebContents & { destroy(): void } {
  let destroyed: (() => void) | undefined;
  let isDestroyed = false;
  return {
    id: 1,
    isDestroyed: () => isDestroyed,
    once: vi.fn((event: string, callback: () => void) => {
      if (event === "destroyed") destroyed = callback;
      return undefined;
    }),
    send: vi.fn(),
    destroy: () => {
      isDestroyed = true;
      destroyed?.();
    },
  } as unknown as WebContents & { destroy(): void };
}

function fakeSocket(): WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const target = new EventTarget();
  return Object.assign(target, {
    binaryType: "blob",
    readyState: WebSocket.CONNECTING,
    close: vi.fn(),
    send: vi.fn(),
  }) as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}
