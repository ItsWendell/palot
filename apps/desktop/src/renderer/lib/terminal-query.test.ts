import type { PersistentPtyInfo } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { openCodeKeys } from "./opencode-query";
import { syncTerminalInfo, terminalDisplayName } from "./terminal-query";

function terminal(id: string, title = "Terminal", userTitle: string | null = null) {
  return { id, sessionID: "ses_1", title, userTitle, status: "running" } as PersistentPtyInfo;
}

describe("terminal names", () => {
  it("prefers the user's title, then the automatic title, then a fallback", () => {
    expect(terminalDisplayName({ title: "zsh", userTitle: "build" })).toBe("build");
    expect(terminalDisplayName({ title: "zsh", userTitle: null })).toBe("zsh");
    expect(terminalDisplayName({ title: "", userTitle: null })).toBe("Terminal");
    expect(terminalDisplayName({ title: "", userTitle: null }, "bash -l")).toBe("bash -l");
  });

  it("replaces a listed terminal in place and re-reads a list that has not seen it", async () => {
    const client = new QueryClient();
    const key = openCodeKeys.sessionTerminals("connection", "ses_1");
    client.setQueryData(key, [terminal("a"), terminal("b")]);
    syncTerminalInfo(client, "connection", terminal("b", "build", "build"));
    expect(
      client.getQueryData<PersistentPtyInfo[]>(key)?.map((entry) => terminalDisplayName(entry)),
    ).toEqual(["Terminal", "build"]);

    syncTerminalInfo(client, "connection", terminal("c", "new", "new"));
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryData<PersistentPtyInfo[]>(key)).toHaveLength(2);

    // Another connection's list and unread sessions stay untouched.
    syncTerminalInfo(client, "other", terminal("a", "elsewhere", "elsewhere"));
    expect(client.getQueryData(openCodeKeys.sessionTerminals("other", "ses_1"))).toBeUndefined();
    client.clear();
  });
});
