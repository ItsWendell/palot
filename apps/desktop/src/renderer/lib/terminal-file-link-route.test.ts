import { describe, expect, it, vi } from "vitest";
import {
  armTerminalFileLink,
  claimTerminalFileLink,
  resolveTerminalFileLink,
  terminalFileLinkReference,
  terminalServerHostname,
} from "./terminal-file-link-route";

describe("terminal file link claims", () => {
  it("lets only the terminal that saw the Ctrl/Cmd press open the link, once", () => {
    armTerminalFileLink("terminal-a", 1_000);
    expect(claimTerminalFileLink("terminal-b", 1_100)).toBe(false);
    expect(claimTerminalFileLink("terminal-a", 1_100)).toBe(true);
    expect(claimTerminalFileLink("terminal-a", 1_200)).toBe(false);
  });

  it("ignores a link that arrives long after the press", () => {
    armTerminalFileLink("terminal-a", 1_000);
    expect(claimTerminalFileLink("terminal-a", 7_000)).toBe(false);
  });

  it("opens the path at its line and column", () => {
    expect(terminalFileLinkReference({ path: "/repo/a.ts", line: 4, column: 2 })).toEqual({
      path: "/repo/a.ts",
      line: 4,
      column: 2,
    });
  });
});

describe("terminal file links on a remote server", () => {
  it("opens a link that names the terminal's server and refuses other hosts", async () => {
    const server = async () => "devbox";
    await expect(
      resolveTerminalFileLink({ path: "/srv/repo/a.ts", host: "devbox", line: 2 }, server),
    ).resolves.toEqual({ path: "/srv/repo/a.ts", line: 2 });
    await expect(
      resolveTerminalFileLink({ path: "/share/a.ts", host: "laptop" }, server),
    ).resolves.toBeNull();
    // Without a known server only host-less links open.
    await expect(
      resolveTerminalFileLink({ path: "/srv/a.ts", host: "devbox" }, async () => null),
    ).resolves.toBeNull();
  });

  it("does not ask the server for a link without a host", async () => {
    const server = vi.fn(async () => "devbox");
    await expect(resolveTerminalFileLink({ path: "/srv/a.ts" }, server)).resolves.toEqual({
      path: "/srv/a.ts",
    });
    expect(server).not.toHaveBeenCalled();
  });

  it("reads each connection's hostname once and retries after a failure", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("devbox");
    await expect(terminalServerHostname("conn-a", read)).resolves.toBeNull();
    await expect(terminalServerHostname("conn-a", read)).resolves.toBe("devbox");
    await expect(terminalServerHostname("conn-a", read)).resolves.toBe("devbox");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
