import { describe, expect, it } from "vitest";
import { fitPath } from "./fit-path";

const within = (limit: number) => (text: string) => text.length <= limit;

describe("fitPath", () => {
  const path = "/Users/me/Projects/clients/acme/web-app";

  it("keeps a path that fits", () => {
    expect(fitPath(path, within(100))).toBe(path);
  });

  it("keeps as many leading folders as fit, then the last two", () => {
    expect(fitPath(path, within(33))).toBe("/Users/me/Projects/…/acme/web-app");
    expect(fitPath(path, within(24))).toBe("/Users/me/…/acme/web-app");
    expect(fitPath(path, within(22))).toBe("/Users/…/acme/web-app");
  });

  it("drops the root, then the parent, so the final folder survives", () => {
    expect(fitPath(path, within(20))).toBe("…/acme/web-app");
    expect(fitPath(path, within(5))).toBe("…/web-app");
    expect(fitPath("C:\\Users\\me\\code\\acme\\web-app", within(16))).toBe("…\\acme\\web-app");
  });

  it("keeps the final folder of a short path that doesn't fit", () => {
    expect(fitPath("/tmp/app", within(2))).toBe("…/app");
    expect(fitPath("app", within(2))).toBe("app");
  });
});
