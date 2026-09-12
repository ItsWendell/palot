// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devControlFile, discoverDevInstance, type DevControlInfo } from "./dev-control";

describe("development instance discovery", () => {
  let appRoot: string;
  let server: Server;
  let info: DevControlInfo;
  let healthStatus: number;
  let targets: unknown[];

  beforeEach(async () => {
    appRoot = await mkdtemp(path.join(tmpdir(), "palot-dev-discovery-"));
    healthStatus = 200;
    targets = [];
    server = createServer((request, response) => {
      if (request.url === "/health") {
        response
          .writeHead(request.headers.authorization === "Bearer test-token" ? healthStatus : 401)
          .end();
      } else if (request.url === "/json/list") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(targets));
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    info = {
      version: 2,
      pid: 123,
      electronPid: 456,
      url: `http://127.0.0.1:${address.port}`,
      token: "test-token",
      rendererUrl: "http://127.0.0.1:14200",
      cdpPort: address.port,
      dataRoot: path.join(appRoot, "data"),
    };
    await writeFile(devControlFile(appRoot), JSON.stringify(info), { mode: 0o600 });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(devControlFile(appRoot), { force: true });
    await rm(appRoot, { recursive: true, force: true });
  });

  it("selects this worktree's renderer rather than DevTools or another page, without exposing the token", async () => {
    targets = [
      {
        type: "page",
        url: "devtools://devtools/bundled/inspector.html",
        webSocketDebuggerUrl: "ws://wrong",
      },
      { type: "page", url: "http://127.0.0.1:14201/", webSocketDebuggerUrl: "ws://other-worktree" },
      {
        type: "page",
        url: "http://127.0.0.1:14200/#/sessions/test",
        webSocketDebuggerUrl: "ws://renderer",
      },
    ];

    const result = await discoverDevInstance(appRoot);

    expect(result.pageWebSocketUrl).toBe("ws://renderer");
    expect(result.logDirectory).toBe(path.join(appRoot, "data/logs"));
    expect(result.electronPid).toBe(456);
    expect(JSON.stringify(result)).not.toContain("test-token");
    expect(result).not.toHaveProperty("token");
  });

  it("rejects a stale manifest when its supervisor no longer answers health checks", async () => {
    healthStatus = 404;
    await expect(discoverDevInstance(appRoot)).rejects.toThrow("Start it with bun run dev");
  });

  it("reports startup separately when Electron has not exposed the matching renderer", async () => {
    targets = [{ type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" }];
    await expect(discoverDevInstance(appRoot)).rejects.toThrow("Retry bun run dev:info");
  });

  it("reports an absent manifest without starting a supervisor", async () => {
    await rm(devControlFile(appRoot));
    await expect(discoverDevInstance(appRoot)).rejects.toThrow("Start it with bun run dev");
  });
});
