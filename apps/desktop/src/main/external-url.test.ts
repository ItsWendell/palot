// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const electron = vi.hoisted(() => ({
  getApplicationNameForProtocol: vi.fn(),
  openExternal: vi.fn(),
  getPath: vi.fn(),
}));

const filesystem = vi.hoisted(() => ({
  open: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ open: filesystem.open }));

vi.mock("electron", () => ({
  app: {
    getApplicationNameForProtocol: electron.getApplicationNameForProtocol,
    getPath: electron.getPath,
  },
  shell: { openExternal: electron.openExternal },
}));

import { openExternalUrl, slackDeepLink } from "./external-url";

describe("slackDeepLink", () => {
  it.each([
    ["https://app.slack.com/client/T123ABC/C456DEF", "slack://channel?team=T123ABC&id=C456DEF"],
    [
      "https://slack.com/app_redirect?team=T123ABC&channel=D456DEF",
      "slack://channel?team=T123ABC&id=D456DEF",
    ],
    [
      "https://slack.com/app_redirect?team=T123ABC&app=A456DEF",
      "slack://app?team=T123ABC&id=A456DEF",
    ],
    [
      "https://app.slack.com/client/T123ABC/C456DEF/1712345678.123456",
      "slack://channel?team=T123ABC&id=C456DEF&message=1712345678.123456",
    ],
    [
      "https://acme.slack.com/archives/C456DEF/p1712345678123456?team=T123ABC",
      "slack://channel?team=T123ABC&id=C456DEF&message=1712345678.123456",
    ],
  ])("converts known-ID Slack destinations: %s", (url, expected) => {
    expect(slackDeepLink(url)).toBe(expected);
  });

  it.each([
    "https://acme.slack.com/archives/C456DEF/p1712345678123456",
    "https://slack.com/app_redirect?team=acme&channel=C456DEF",
    "https://slack.com/app_redirect?team=T123ABC&channel=general",
    "https://slack.com/app_redirect?channel=C456DEF",
    "https://app.slack.com/client/T123ABC/C456DEF/unsupported",
    "https://slack.com/help/articles/123",
    "https://slack.com/",
    "https://slack.com.attacker.example/client/T123ABC/C456DEF",
    "https://fake-slack.com/client/T123ABC/C456DEF",
    "https://user:secret@app.slack.com/client/T123ABC/C456DEF",
    "https://app.slack.com:444/client/T123ABC/C456DEF",
    "http://app.slack.com/client/T123ABC/C456DEF",
    "slack://channel?team=T123ABC&id=C456DEF",
    "not a URL",
  ])("does not invent a deep link for %s", (url) => {
    expect(slackDeepLink(url)).toBeNull();
  });

  it("uses a resolved ID for archive links and preserves reply context", () => {
    expect(
      slackDeepLink(
        "https://acme.slack.com/archives/C456DEF/p1712345678123456?thread_ts=1712345600.000001&cid=C456DEF",
        "T123ABC",
      ),
    ).toBe(
      "slack://channel?team=T123ABC&id=C456DEF&message=1712345678.123456&thread_ts=1712345600.000001",
    );
    expect(slackDeepLink("https://acme.slack.com/archives/C456DEF", "acme")).toBeNull();
  });
});

describe("openExternalUrl", () => {
  const webUrl = "https://app.slack.com/client/T123ABC/C456DEF";
  const nativeUrl = "slack://channel?team=T123ABC&id=C456DEF";

  beforeEach(() => {
    electron.getApplicationNameForProtocol.mockReset().mockReturnValue("Slack");
    electron.openExternal.mockReset().mockResolvedValue(undefined);
    electron.getPath.mockReset().mockReturnValue("/mock-app-data");
    filesystem.open.mockReset().mockRejectedValue(new Error("ENOENT"));
    filesystem.read.mockReset();
    filesystem.stat.mockReset();
    filesystem.close.mockReset().mockResolvedValue(undefined);
  });

  it("opens a supported Slack destination directly without opening the browser", async () => {
    expect(await openExternalUrl(webUrl)).toBe(true);
    expect(electron.getApplicationNameForProtocol).toHaveBeenCalledWith(nativeUrl);
    expect(electron.openExternal.mock.calls).toEqual([[nativeUrl]]);
  });

  it("opens the original URL when Slack is not installed", async () => {
    electron.getApplicationNameForProtocol.mockReturnValue("");
    expect(await openExternalUrl(webUrl)).toBe(true);
    expect(electron.openExternal.mock.calls).toEqual([[webUrl]]);
  });

  it("opens the original URL when handler detection throws", async () => {
    electron.getApplicationNameForProtocol.mockImplementation(() => {
      throw new Error("Protocol lookup unavailable");
    });
    expect(await openExternalUrl(webUrl)).toBe(true);
    expect(electron.openExternal.mock.calls).toEqual([[webUrl]]);
  });

  it("falls back after the native launch fails", async () => {
    electron.openExternal.mockRejectedValueOnce(new Error("Slack was uninstalled"));
    expect(await openExternalUrl(webUrl)).toBe(true);
    expect(electron.openExternal.mock.calls).toEqual([[nativeUrl], [webUrl]]);
  });

  it.each(["https://example.com/docs?q=1", "http://localhost:3000/"])(
    "keeps the original browser destination for %s",
    async (url) => {
      expect(await openExternalUrl(url)).toBe(true);
      expect(electron.getApplicationNameForProtocol).not.toHaveBeenCalled();
      expect(electron.openExternal.mock.calls).toEqual([[url]]);
    },
  );

  it.each([
    "slack://open",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@acme.slack.com/archives/C456DEF",
    `https://example.com/${"x".repeat(8_192)}`,
    "not a URL",
  ])("rejects disallowed external input without launching anything: %s", async (url) => {
    expect(await openExternalUrl(url)).toBe(false);
    expect(electron.getApplicationNameForProtocol).not.toHaveBeenCalled();
    expect(electron.openExternal).not.toHaveBeenCalled();
    expect(filesystem.open).not.toHaveBeenCalled();
  });

  it("reports failure without an unhandled rejection if the browser also fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      electron.openExternal.mockRejectedValue(new Error("No application can open the URL"));
      expect(await openExternalUrl(webUrl)).toBe(false);
      expect(electron.openExternal.mock.calls).toEqual([[nativeUrl], [webUrl]]);
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith("[external-url] Could not open link");
    } finally {
      warning.mockRestore();
    }
  });

  describe("local workspace resolution", () => {
    const permalink =
      "https://acme.slack.com/archives/C456DEF/p1712345678123456?thread_ts=1712345600.000001&cid=C456DEF";
    const replyLink =
      "slack://channel?team=T123ABC&id=C456DEF&message=1712345678.123456&thread_ts=1712345600.000001";

    function workspaceState(contents: string, size?: number) {
      const bytes = Buffer.from(contents);
      filesystem.open.mockResolvedValue({
        stat: filesystem.stat,
        read: filesystem.read,
        close: filesystem.close,
      });
      filesystem.stat.mockResolvedValue({ isFile: () => true, size: size ?? bytes.length });
      filesystem.read.mockImplementation(
        async (buffer: Buffer, offset: number, length: number, position: number) => ({
          bytesRead: bytes.copy(buffer, offset, position, position + length),
          buffer,
        }),
      );
    }

    function directory(url = "https://acme.slack.com/", id = "T123ABC", key = id) {
      return JSON.stringify({ workspaces: { [key]: { id, url, domain: "acme" } } });
    }

    it("reads only the known Slack metadata file after handler detection and opens the reply directly", async () => {
      workspaceState(directory());
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(electron.getPath).toHaveBeenCalledWith("appData");
      expect(filesystem.open).toHaveBeenCalledWith(
        path.join("/mock-app-data", "Slack", "storage", "root-state.json"),
        "r",
      );
      expect(electron.getApplicationNameForProtocol.mock.invocationCallOrder[0]).toBeLessThan(
        filesystem.open.mock.invocationCallOrder[0]!,
      );
      expect(filesystem.close).toHaveBeenCalledOnce();
      expect(electron.openExternal.mock.calls).toEqual([[replyLink]]);
    });

    it("does not read local metadata without a registered Slack handler", async () => {
      electron.getApplicationNameForProtocol.mockReturnValue("");
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(filesystem.open).not.toHaveBeenCalled();
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it("does not read local metadata if handler detection fails", async () => {
      electron.getApplicationNameForProtocol.mockImplementation(() => {
        throw new Error("Unavailable");
      });
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(filesystem.open).not.toHaveBeenCalled();
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it("preserves the original reply URL when metadata is absent", async () => {
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it.each([
      "not JSON",
      "null",
      JSON.stringify({ workspaces: [] }),
      JSON.stringify({ workspaces: { T123ABC: { id: "T123ABC", domain: "acme" } } }),
      directory("https://other.slack.com/"),
      directory("https://acme.slack.com.attacker.example/"),
      directory("https://acme.slack.com@other.slack.com/"),
      directory("https://user:secret@acme.slack.com/"),
      directory("https://acme.slack.com:444/"),
      directory("https://acme.slack.com/redirect"),
      directory("https://acme.slack.com/", "acme"),
      directory("https://acme.slack.com/", "T123ABC", "T999ABC"),
      JSON.stringify({
        workspaces: {
          T123ABC: { id: "T123ABC", url: "https://acme.slack.com/" },
          T999ABC: { id: "T999ABC", url: "https://acme.slack.com/" },
        },
      }),
    ])("falls back for malformed, mismatched or ambiguous metadata: %#", async (contents) => {
      workspaceState(contents);
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
      expect(filesystem.close).toHaveBeenCalledOnce();
    });

    it("rejects oversized state without reading its contents", async () => {
      workspaceState(directory(), 4 * 1024 * 1024 + 1);
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(filesystem.read).not.toHaveBeenCalled();
      expect(filesystem.close).toHaveBeenCalledOnce();
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it("closes the metadata file and preserves the original URL when reading fails", async () => {
      workspaceState(directory());
      filesystem.read.mockRejectedValue(new Error("Read failed"));
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(filesystem.close).toHaveBeenCalledOnce();
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it("bounds the read even if Slack's file grows after stat", async () => {
      workspaceState(" ".repeat(4 * 1024 * 1024 + 2), 1);
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(filesystem.read).toHaveBeenCalledOnce();
      expect(filesystem.read.mock.calls[0]?.[2]).toBe(4 * 1024 * 1024 + 1);
      expect(filesystem.close).toHaveBeenCalledOnce();
      expect(electron.openExternal.mock.calls).toEqual([[permalink]]);
    });

    it("falls back to the unmodified reply URL if launching Slack fails", async () => {
      workspaceState(directory());
      electron.openExternal.mockRejectedValueOnce(new Error("Launch failed"));
      expect(await openExternalUrl(permalink)).toBe(true);
      expect(electron.openExternal.mock.calls).toEqual([[replyLink], [permalink]]);
    });

    it("does not keep stale mappings between clicks", async () => {
      workspaceState(directory());
      await openExternalUrl(permalink);
      workspaceState(directory("https://renamed.slack.com/"));
      await openExternalUrl(permalink);
      expect(electron.openExternal.mock.calls).toEqual([[replyLink], [permalink]]);
    });

    it.each([
      webUrl,
      "https://acme.slack.com/archives/C456DEF?team=T123ABC",
      "https://acme.slack.com/archives/C456DEF?team=acme",
      "https://acme.slack.com/archives/C456DEF/not-a-message",
      "https://acme.slack.com/help/articles/123",
      "https://acme.slack.com.attacker.example/archives/C456DEF",
      "http://acme.slack.com/archives/C456DEF",
    ])(
      "never reads metadata when resolution isn't needed or the URL isn't an eligible archive: %s",
      async (url) => {
        await openExternalUrl(url);
        expect(filesystem.open).not.toHaveBeenCalled();
      },
    );
  });
});
