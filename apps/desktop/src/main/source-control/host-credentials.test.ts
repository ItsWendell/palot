// @vitest-environment node
import { expect, it, vi } from "vitest";
import { HostCredentials } from "./host-credentials";
function fixture(env: NodeJS.ProcessEnv = {}) {
  let hosts: Array<{
    url: string;
    kind: "gitlab" | "forgejo" | "bitbucket";
    credentialID: string;
  }> = [];
  const vault = {
    storeCredential: vi.fn(() => "encrypted-id"),
    headers: vi.fn(() => ({ authorization: "Bearer saved-secret" })),
    delete: vi.fn(),
  };
  const store = {
    get: () => hosts,
    set: (_key: "hosts", value: typeof hosts) => {
      hosts = value;
    },
  };
  const glab = vi.fn(async () => "cli-secret");
  const credentials = new HostCredentials(store, vault, () => env, glab);
  return { credentials, store, vault, glab };
}
it("stores only a vault reference in host settings, returns no token, and deletes replaced secrets", async () => {
  const { credentials, store, vault } = fixture();
  credentials.save({ url: "https://gitlab.example", kind: "gitlab", token: "new-secret" });
  expect(JSON.stringify(store.get())).not.toContain("new-secret");
  expect(JSON.stringify(credentials.accounts())).not.toContain("secret");
  expect(await credentials.token("gitlab.example")).toBe("saved-secret");
  credentials.remove("gitlab.example");
  expect(vault.delete).toHaveBeenCalledWith("encrypted-id");
});
it("scopes env tokens and CLI discovery to configured hosts only", async () => {
  const { credentials, glab } = fixture({
    GITLAB_HOST: "gitlab.example",
    GITLAB_TOKEN: "env-secret",
  });
  expect(await credentials.token("gitlab.example")).toBe("env-secret");
  await expect(credentials.token("evil.example")).rejects.toMatchObject({
    code: "unsupported-remote",
  });
  expect(glab).not.toHaveBeenCalled();
});
it("uses glab only after saved and environment tokens and rejects unsafe host URLs", async () => {
  const { credentials, glab } = fixture();
  expect(await credentials.token("gitlab.com")).toBe("cli-secret");
  expect(glab).toHaveBeenCalledWith("gitlab.com");
  for (const url of [
    "http://gitlab.example",
    "https://user:pass@gitlab.example",
    "https://gitlab.example/subpath",
    "https://bitbucket.org/?token=x",
  ])
    expect(() => credentials.save({ url, kind: "gitlab", token: "secret" })).toThrow();
});
it("does not retain host metadata when secure storage refuses a token", () => {
  const { credentials, vault, store } = fixture();
  vault.storeCredential.mockImplementation(() => {
    throw new Error("Secure credential storage is unavailable");
  });
  expect(() =>
    credentials.save({ url: "https://gitlab.example", kind: "gitlab", token: "secret" }),
  ).toThrow("Secure credential");
  expect(store.get()).toEqual([]);
});
