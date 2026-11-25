import { describe, expect, it, vi } from "vitest";
import { routeWindowOpen } from "./window-open-route";

function route() {
  return { openExternal: vi.fn(), openFileLink: vi.fn() };
}

describe("window.open from a Palot window", () => {
  it("hands a terminal's file link back to its window, never outside Palot", () => {
    const target = route();
    routeWindowOpen("file://workstation/repo/src/app.ts#L3", target);
    // The terminal decides whether the host is its server's.
    expect(target.openFileLink).toHaveBeenCalledWith({
      path: "/repo/src/app.ts",
      host: "workstation",
      line: 3,
    });
    expect(target.openExternal).not.toHaveBeenCalled();
  });

  it("drops file links that aren't absolute paths", () => {
    const target = route();
    routeWindowOpen("FILE:relative.txt", target);
    routeWindowOpen("file://user:pw@host/app.ts", target);
    expect(target.openFileLink).not.toHaveBeenCalled();
    expect(target.openExternal).not.toHaveBeenCalled();
  });

  it("leaves other URLs to the external URL policy", () => {
    const target = route();
    routeWindowOpen("https://example.com/", target);
    expect(target.openExternal).toHaveBeenCalledWith("https://example.com/");
    expect(target.openFileLink).not.toHaveBeenCalled();
  });
});
