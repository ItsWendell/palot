// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  OpenCodeProfileStore,
  isLoopbackOpenCodeUrl,
  normalizeOpenCodeUrl,
  normalizeOpenCodeUrls,
} from "./profile-store";

class MemoryStore {
  constructor(private readonly values: Record<string, unknown>) {}

  get(key: string): never {
    return this.values[key] as never;
  }

  set(key: string, value: unknown): void {
    this.values[key] = value;
  }
}

describe("OpenCode server URL normalization", () => {
  it("normalizes and deduplicates HTTP server origins", () => {
    expect(normalizeOpenCodeUrls(["http://server:4096/", "http://server:4096"])).toEqual([
      "http://server:4096",
    ]);
  });

  it("rejects credentials and unsupported schemes", () => {
    expect(() => normalizeOpenCodeUrl("https://user:secret@example.com")).toThrow(
      "cannot contain credentials",
    );
    expect(() => normalizeOpenCodeUrl("ssh://example.com")).toThrow("HTTP or HTTPS");
    expect(() => normalizeOpenCodeUrl("https://example.com/opencode")).toThrow(
      "cannot contain a path",
    );
  });

  it("recognizes loopback without classifying LAN addresses as loopback", () => {
    expect(isLoopbackOpenCodeUrl("http://localhost:4096")).toBe(true);
    expect(isLoopbackOpenCodeUrl("http://127.0.0.1:4096")).toBe(true);
    expect(isLoopbackOpenCodeUrl("http://192.168.1.10:4096")).toBe(false);
  });
});

describe("OpenCode profile persistence", () => {
  it("repairs persisted data once and keeps subsequent reads write-free", () => {
    const backend = new MemoryStore({ schemaVersion: 0, activeProfileID: "missing", profiles: [] });
    const set = vi.spyOn(backend, "set");
    const store = new OpenCodeProfileStore(backend);
    store.snapshot();
    expect(set).toHaveBeenCalledTimes(3);
    set.mockClear();
    store.snapshot();
    store.get("local-default");
    expect(set).not.toHaveBeenCalled();
  });

  it("writes only changed connection metadata and persists focus independently", () => {
    const backend = new MemoryStore({ profiles: [], activeProfileID: "local-default" });
    const store = new OpenCodeProfileStore(backend);
    const profile = store.create(
      {
        kind: "remote",
        name: "Remote",
        urls: ["https://server.example", "https://other.example"],
        credential: { type: "none" },
        allowPlainHttp: false,
      },
      null,
    ).profiles[1]!;
    store.recordConnection(profile.id, "https://server.example", 123);
    const set = vi.spyOn(backend, "set");
    store.recordConnection(profile.id, "https://server.example", 123);
    expect(set).not.toHaveBeenCalled();
    store.activate(profile.id);
    expect(set).toHaveBeenCalledExactlyOnceWith("activeProfileID", profile.id);
    expect(new OpenCodeProfileStore(backend).snapshot().activeProfileID).toBe(profile.id);
    set.mockClear();
    store.activate(profile.id);
    store.recordConnection(profile.id, "https://server.example", 124);
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.get(profile.id)).toMatchObject({ lastConnectedAt: 124 });
    set.mockClear();
    store.recordConnection(profile.id, "https://other.example", 124);
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.get(profile.id)).toMatchObject({ lastSuccessfulUrl: "https://other.example" });
  });

  it("roundtrips only SSH configuration and replaces it on update", () => {
    const backend = new MemoryStore({ profiles: [], activeProfileID: "local-default" });
    const store = new OpenCodeProfileStore(backend);
    const input = {
      kind: "ssh" as const,
      name: "Dev",
      ssh: {
        target: "user@host",
        port: 22,
        identityFile: "~/.ssh/work key",
        password: "secret",
        endpoint: "http://localhost:1234",
      },
      password: "secret",
    };
    const created = store.create(input, "must-not-persist").profiles[1]!;
    expect(created).toEqual({
      id: expect.any(String),
      kind: "ssh",
      name: "Dev",
      ssh: { target: "user@host", port: 22, identityFile: "~/.ssh/work key" },
    });
    store.activate(created.id);
    store.recordConnection(created.id, "http://localhost:1234", 123);
    expect(new OpenCodeProfileStore(backend).get(created.id)).toEqual(created);
    store.update(
      { id: created.id, kind: "ssh", name: "Other", ssh: { target: "other" } },
      "ignore-me",
    );
    expect(new OpenCodeProfileStore(backend).get(created.id)).toEqual({
      id: created.id,
      kind: "ssh",
      name: "Other",
      ssh: { target: "other" },
    });
    expect(JSON.stringify(backend.get("profiles"))).not.toMatch(
      /secret|endpoint|credential|localhost/,
    );
    expect(() => store.update({ id: created.id, kind: "local", name: "Local" })).toThrow(
      "kind cannot be changed",
    );
    expect(() =>
      store.update({ id: created.id, kind: "ssh", name: "Bad", ssh: { target: "host;evil" } }),
    ).toThrow("SSH target");
    expect(store.get(created.id).name).toBe("Other");
  });

  it("drops corrupted SSH entries and strips persisted secrets from valid ones", () => {
    const backend = new MemoryStore({
      activeProfileID: "bad",
      profiles: [
        { id: "bad", name: "Bad", kind: "ssh", ssh: { target: "-oProxyCommand=evil" } },
        { id: "missing", name: "Missing", kind: "ssh" },
        {
          id: "valid",
          name: "Valid",
          kind: "ssh",
          credentialID: "secret",
          password: "secret",
          endpoint: "http://localhost:1234",
          ssh: { target: "host", password: "secret" },
        },
      ],
    });
    expect(new OpenCodeProfileStore(backend).snapshot()).toEqual({
      activeProfileID: "local-default",
      profiles: [
        { id: "local-default", kind: "local", name: "Local OpenCode" },
        { id: "valid", kind: "ssh", name: "Valid", ssh: { target: "host" } },
      ],
    });
  });

  it("drops malformed persisted profiles and restores the local default", () => {
    const store = new MemoryStore({
      schemaVersion: 0,
      activeProfileID: "broken",
      profiles: [{ id: "broken", kind: "remote", name: "Broken", urls: ["ssh://server"] }],
    });

    expect(new OpenCodeProfileStore(store).snapshot()).toEqual({
      activeProfileID: "local-default",
      profiles: [{ id: "local-default", kind: "local", name: "Local OpenCode" }],
    });
    expect(store.get("schemaVersion")).toBe(1);
  });

  it("persists the acknowledgement supplied with replacement credentials", () => {
    const store = new MemoryStore({
      schemaVersion: 1,
      activeProfileID: "local-default",
      profiles: [
        { id: "local-default", kind: "local", name: "Local OpenCode" },
        {
          id: "remote",
          kind: "remote",
          name: "Remote",
          urls: ["http://server:4096"],
          credentialID: "old",
          allowPlainHttp: true,
          lastSuccessfulUrl: "http://server:4096",
          lastConnectedAt: 10,
        },
      ],
    });
    const profiles = new OpenCodeProfileStore(store);

    const result = profiles.update(
      {
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["http://server:4096"],
        allowPlainHttp: true,
      },
      "new",
    );

    expect(result.profiles.find((profile) => profile.id === "remote")).toMatchObject({
      credentialID: "new",
      allowPlainHttp: true,
    });
  });
});
