import { describe, expect, it, vi } from "vitest";
import { createMarkdownSessionOpener } from "./markdown-session-links";

describe("Markdown session ownership", () => {
  it("retains the originating profile even when navigation's focused default changes", () => {
    let focused = "origin";
    const destinations: string[] = [];
    const navigation = vi.fn((_id: string, search?: { profileID: string }) => {
      destinations.push(search?.profileID ?? focused);
    });
    const open = createMarkdownSessionOpener(
      { profileID: "origin", connectionID: "connection-origin" },
      navigation,
    )!;
    focused = "other";
    open("ses_0123456789abcdefghijklmnop");
    expect(destinations).toEqual(["origin"]);
    expect(navigation).toHaveBeenCalledWith("ses_0123456789abcdefghijklmnop", {
      profileID: "origin",
    });
    open("ses_partial");
    expect(navigation).toHaveBeenCalledOnce();
  });
  it("never creates an opener without explicit ownership", () => {
    expect(createMarkdownSessionOpener(null, vi.fn())).toBeUndefined();
    expect(
      createMarkdownSessionOpener({ profileID: "", connectionID: "server" }, vi.fn()),
    ).toBeUndefined();
  });
});
