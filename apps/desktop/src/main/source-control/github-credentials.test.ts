// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_MISSING_TTL_MS,
  GITHUB_TOKEN_TTL_MS,
  GitHubCredentialError,
  GitHubCredentials,
  environmentToken,
  ghEnvironment,
} from "./github-credentials";

function setup(env: Record<string, string | undefined> = {}) {
  let now = 1_000;
  const readGh = vi.fn(async (_host: string) => "gh-token");
  const credentials = new GitHubCredentials({ env: () => env, readGh, now: () => now });
  return { credentials, readGh, advance: (ms: number) => (now += ms) };
}

describe("GitHub credential resolution", () => {
  it("prefers GH_TOKEN, then GITHUB_TOKEN, then gh", async () => {
    const both = setup({ GH_TOKEN: "gh-env", GITHUB_TOKEN: "github-env" });
    await expect(both.credentials.get("github.com")).resolves.toMatchObject({
      token: "gh-env",
      source: "env",
    });
    const github = setup({ GITHUB_TOKEN: "github-env" });
    await expect(github.credentials.get("GitHub.com")).resolves.toMatchObject({
      host: "github.com",
      token: "github-env",
    });
    const cli = setup();
    await expect(cli.credentials.get("github.com")).resolves.toMatchObject({
      token: "gh-token",
      source: "gh",
    });
    expect(both.readGh).not.toHaveBeenCalled();
    expect(cli.readGh).toHaveBeenCalledWith("github.com");
  });

  it("sends the enterprise token only to the host GH_HOST names", () => {
    const env = { GH_HOST: "ghe.example.com", GH_ENTERPRISE_TOKEN: "enterprise" };
    expect(environmentToken("ghe.example.com", env)).toBe("enterprise");
    expect(environmentToken("evil.example.com", env)).toBeNull();
    expect(environmentToken("github.com", env)).toBeNull();
  });

  it("caches a gh token for five minutes and shares concurrent lookups", async () => {
    const { credentials, readGh, advance } = setup();
    await Promise.all([credentials.get("github.com"), credentials.get("github.com")]);
    advance(GITHUB_TOKEN_TTL_MS - 1);
    await credentials.get("github.com");
    expect(readGh).toHaveBeenCalledTimes(1);
    advance(2);
    await credentials.get("github.com");
    expect(readGh).toHaveBeenCalledTimes(2);
  });

  it("remembers a missing login for ten seconds but retries gh failures at once", async () => {
    const { credentials, readGh, advance } = setup();
    readGh.mockRejectedValue(new GitHubCredentialError("not-signed-in", "github.com"));
    await expect(credentials.get("github.com")).rejects.toMatchObject({ code: "not-signed-in" });
    advance(GITHUB_MISSING_TTL_MS - 1);
    await expect(credentials.get("github.com")).rejects.toMatchObject({ code: "not-signed-in" });
    expect(readGh).toHaveBeenCalledTimes(1);
    advance(2);
    readGh.mockResolvedValue("fresh");
    await expect(credentials.get("github.com")).resolves.toMatchObject({ token: "fresh" });

    const failing = setup();
    failing.readGh.mockRejectedValueOnce(new GitHubCredentialError("gh-failed", "github.com"));
    await expect(failing.credentials.get("github.com")).rejects.toMatchObject({
      code: "gh-failed",
    });
    await expect(failing.credentials.get("github.com")).resolves.toMatchObject({
      token: "gh-token",
    });
    expect(failing.readGh).toHaveBeenCalledTimes(2);
  });

  it("asks gh again after a refused token is invalidated, without exposing it", async () => {
    const { credentials, readGh } = setup();
    const credential = await credentials.get("github.com");
    expect(credential.fingerprint).not.toContain("gh-token");
    credentials.invalidate("github.com");
    await credentials.get("github.com");
    expect(readGh).toHaveBeenCalledTimes(2);
  });

  it("never lets gh answer with an environment token", () => {
    const env = ghEnvironment({
      PATH: "/usr/bin",
      GH_TOKEN: "a",
      GITHUB_TOKEN: "b",
      GH_ENTERPRISE_TOKEN: "c",
      GITHUB_ENTERPRISE_TOKEN: "d",
      GH_HOST: "ghe.b.example",
    });
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      GH_HOST: "ghe.b.example",
      GH_PROMPT_DISABLED: "1",
    });
    for (const name of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GH_ENTERPRISE_TOKEN",
      "GITHUB_ENTERPRISE_TOKEN",
    ])
      expect(env).not.toHaveProperty(name);
  });

  it("refuses hosts other than github.com and GH_HOST before asking gh", async () => {
    const { credentials, readGh } = setup({
      GH_HOST: "ghe.b.example",
      GH_ENTERPRISE_TOKEN: "enterprise-b",
    });
    for (const host of ["ghe.a.example", "tenant.ghe.com"])
      await expect(credentials.get(host)).rejects.toMatchObject({ code: "unsupported-host" });
    expect(readGh).not.toHaveBeenCalled();
    await expect(credentials.get("ghe.b.example")).resolves.toMatchObject({
      token: "enterprise-b",
    });
  });
});
