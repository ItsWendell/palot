import { describe, expect, it } from "vitest";
import { parseTerminalFileUrl, terminalFileLinkHostAllowed } from "./terminal-file-url";

const parse = (url: string) => parseTerminalFileUrl(url);

describe("terminal file URLs", () => {
  it("reads the path, decoded, for this machine", () => {
    expect(parse("file:///home/me/repo/src/app.ts")).toEqual({ path: "/home/me/repo/src/app.ts" });
    expect(parse("file://localhost/home/me/My%20Notes.md")).toEqual({
      path: "/home/me/My Notes.md",
    });
    // `rg --hyperlink-format default` writes the machine's name as the host.
    expect(parse("file://Workstation./home/me/repo/a.ts")).toEqual({
      path: "/home/me/repo/a.ts",
      host: "workstation",
    });
    expect(parse("file:///C:/Users/me/a.ts")).toEqual({ path: "C:/Users/me/a.ts" });
  });

  it("reads a line from the fragment or a path suffix", () => {
    expect(parse("file:///repo/a.ts#L12")).toEqual({ path: "/repo/a.ts", line: 12 });
    expect(parse("file:///repo/a.ts#L12C3")).toEqual({ path: "/repo/a.ts", line: 12, column: 3 });
    expect(parse("file:///repo/a.ts#L12-L20")).toEqual({ path: "/repo/a.ts", line: 12 });
    // rg's `kitty` format: `file://{host}{path}#{line}`.
    expect(parse("file://workstation/repo/a.ts#12")).toEqual({
      path: "/repo/a.ts",
      host: "workstation",
      line: 12,
    });
    expect(parse("file:///repo/a.ts#12:4")).toEqual({ path: "/repo/a.ts", line: 12, column: 4 });
    expect(parse("file:///repo/a.ts:7:2")).toEqual({ path: "/repo/a.ts", line: 7, column: 2 });
    // Other fragments point into the document.
    expect(parse("file:///repo/README.md#install")).toEqual({ path: "/repo/README.md" });
    // `%23` is part of the name, not a fragment.
    expect(parse("file:///repo/issue%2312.md")).toEqual({ path: "/repo/issue#12.md" });
  });

  it("accepts a host only when it is the terminal's server", () => {
    expect(terminalFileLinkHostAllowed({}, null)).toBe(true);
    expect(terminalFileLinkHostAllowed({ host: "devbox" }, "DevBox")).toBe(true);
    expect(terminalFileLinkHostAllowed({ host: "devbox" }, "devbox.")).toBe(true);
    expect(terminalFileLinkHostAllowed({ host: "fileserver" }, "devbox")).toBe(false);
    expect(terminalFileLinkHostAllowed({ host: "devbox" }, undefined)).toBe(false);
    expect(terminalFileLinkHostAllowed({ host: "devbox" }, "")).toBe(false);
  });

  it("refuses credentials, schemes and unsafe paths", () => {
    expect(parse("file://user:pw@localhost/a.ts")).toBeNull();
    expect(parse("https://example.com/a.ts")).toBeNull();
    expect(parse("file:///")).toBeNull();
    expect(parse("file:notes.md")).toBeNull();
    expect(parse("file:///repo/a%0A.ts")).toBeNull();
    expect(parse("file:///repo/%E0%A4%A")).toBeNull();
    expect(parse(`file:///${"a".repeat(9_000)}`)).toBeNull();
  });
});
