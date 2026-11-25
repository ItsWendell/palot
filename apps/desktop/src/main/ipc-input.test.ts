// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAttachmentPaths,
  parseAttentionSnapshot,
  parseCredential,
  parseOpenCodeRequest,
  parsePairImport,
  parseProfileCreate,
  parseProfileUpdate,
} from "./ipc-input";

const request = {
  id: "request-1",
  rendererStartedAt: 12.5,
  path: "/session",
  method: "GET",
  headers: { accept: "application/json" },
  body: null,
};

describe("parseOpenCodeRequest", () => {
  it("returns the request with string headers and an ArrayBuffer body", () => {
    const body = new ArrayBuffer(4);
    expect(
      parseOpenCodeRequest({
        ...request,
        method: "POST",
        profileID: "profile-1",
        connectionID: "connection-1",
        body,
        extra: "dropped",
      }),
    ).toEqual({
      id: "request-1",
      profileID: "profile-1",
      connectionID: "connection-1",
      rendererStartedAt: 12.5,
      path: "/session",
      method: "POST",
      headers: { accept: "application/json" },
      body,
    });
  });

  it("leaves optional profile and connection IDs undefined", () => {
    const parsed = parseOpenCodeRequest(request);
    expect(parsed.profileID).toBeUndefined();
    expect(parsed.connectionID).toBeUndefined();
    expect(parsed.body).toBeNull();
  });

  it.each([
    ["null", null],
    ["a string", "/session"],
    ["a numeric id", { ...request, id: 1 }],
    ["a missing start time", { ...request, rendererStartedAt: undefined }],
    ["an infinite start time", { ...request, rendererStartedAt: Number.POSITIVE_INFINITY }],
    ["a NaN start time", { ...request, rendererStartedAt: Number.NaN }],
    ["a missing path", { ...request, path: undefined }],
    ["a non-string method", { ...request, method: 1 }],
    ["missing headers", { ...request, headers: undefined }],
    ["header pairs as an array", { ...request, headers: [["accept", "text/plain"]] }],
    ["a non-string header value", { ...request, headers: { "content-length": 3 } }],
    ["an undefined body", { ...request, body: undefined }],
    ["a string body", { ...request, body: "text" }],
    ["a typed-array body", { ...request, body: new Uint8Array(2) }],
    ["an empty profile ID", { ...request, profileID: "" }],
    ["an oversized connection ID", { ...request, connectionID: "x".repeat(513) }],
    ["a method the client never sends", { ...request, method: "TRACE" }],
    ["HEAD", { ...request, method: "HEAD" }],
    ["a lowercase method", { ...request, method: "get" }],
    ["an id over 200 characters", { ...request, id: "x".repeat(201) }],
    ["a path over 8,192 characters", { ...request, path: `/${"x".repeat(8_192)}` }],
    [
      "more than 64 headers",
      {
        ...request,
        headers: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`x-${index}`, "1"])),
      },
    ],
    ["a header name over 256 characters", { ...request, headers: { ["x".repeat(257)]: "1" } }],
    ["a header value over 8,192 characters", { ...request, headers: { a: "x".repeat(8_193) } }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseOpenCodeRequest(input)).toThrow();
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("accepts %s", (method) => {
    expect(parseOpenCodeRequest({ ...request, method }).method).toBe(method);
  });

  it("accepts values at every size limit", () => {
    const headers = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`${index}`.padEnd(256, "x"), "v".repeat(8_192)]),
    );
    const parsed = parseOpenCodeRequest({
      ...request,
      id: "i".repeat(200),
      path: `/${"p".repeat(8_191)}`,
      headers,
    });
    expect(parsed.id).toHaveLength(200);
    expect(parsed.path).toHaveLength(8_192);
    expect(parsed.headers).toEqual(headers);
  });

  // Paths are checked where they are resolved: the request proxy rejects any path that is not
  // relative to the connected service or that escapes it.
});

describe("parseCredential", () => {
  it.each([
    [{ type: "none", token: "dropped" }, { type: "none" }],
    [
      { type: "basic", username: "alice", password: "secret", token: "dropped" },
      { type: "basic", username: "alice", password: "secret" },
    ],
    [
      { type: "bearer", token: "abc" },
      { type: "bearer", token: "abc" },
    ],
    [
      { type: "headers", headers: { "x-api-key": "abc" } },
      { type: "headers", headers: { "x-api-key": "abc" } },
    ],
  ])("accepts %j", (input, expected) => {
    expect(parseCredential(input)).toEqual(expected);
  });

  it.each([
    ["undefined", undefined],
    ["an unknown type", { type: "oauth", token: "abc" }],
    ["basic without a password", { type: "basic", username: "alice" }],
    ["basic with a numeric password", { type: "basic", username: "alice", password: 1 }],
    ["bearer without a token", { type: "bearer" }],
    ["headers as an array", { type: "headers", headers: [["x-api-key", "abc"]] }],
    ["headers set to null", { type: "headers", headers: null }],
    ["a non-string header value", { type: "headers", headers: { "x-api-key": 1 } }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseCredential(input)).toThrow();
  });
});

const remoteProfile = {
  kind: "remote",
  name: "Office",
  urls: ["https://opencode.example.com"],
  credential: { type: "bearer", token: "abc" },
  allowPlainHttp: false,
};

describe("parseProfileCreate", () => {
  it("accepts local, SSH and remote profiles", () => {
    expect(parseProfileCreate({ kind: "local", name: "Laptop", urls: ["dropped"] })).toEqual({
      kind: "local",
      name: "Laptop",
    });
    expect(
      parseProfileCreate({ kind: "ssh", name: "Dev box", ssh: { target: "alice@dev.example" } }),
    ).toEqual({ kind: "ssh", name: "Dev box", ssh: { target: "alice@dev.example" } });
    expect(parseProfileCreate(remoteProfile)).toEqual(remoteProfile);
  });

  it.each([
    ["null", null],
    ["an empty name", { kind: "local", name: "" }],
    ["a name over 120 characters", { kind: "local", name: "x".repeat(121) }],
    ["an unknown kind", { kind: "cloud", name: "Cloud" }],
    ["SSH without a config", { kind: "ssh", name: "Dev box" }],
    ["SSH with an option as target", { kind: "ssh", name: "Dev", ssh: { target: "-oX=y" } }],
    ["remote without URLs", { ...remoteProfile, urls: undefined }],
    ["remote with URLs as a string", { ...remoteProfile, urls: "https://example.com" }],
    ["remote with a non-string URL", { ...remoteProfile, urls: [1] }],
    ["remote without a credential", { ...remoteProfile, credential: undefined }],
    ["remote without allowPlainHttp", { ...remoteProfile, allowPlainHttp: undefined }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseProfileCreate(input)).toThrow();
  });
});

describe("parseProfileUpdate", () => {
  it("keeps an omitted remote credential as an explicit undefined", () => {
    const parsed = parseProfileUpdate({ ...remoteProfile, id: "profile-1", credential: undefined });
    expect(parsed).toEqual({ ...remoteProfile, id: "profile-1", credential: undefined });
    expect(Object.hasOwn(parsed, "credential")).toBe(true);
  });

  it("keeps a provided remote credential", () => {
    expect(parseProfileUpdate({ ...remoteProfile, id: "profile-1" })).toEqual({
      ...remoteProfile,
      id: "profile-1",
    });
  });

  it("adds the id to non-remote profiles", () => {
    expect(parseProfileUpdate({ id: "profile-1", kind: "local", name: "Laptop" })).toEqual({
      id: "profile-1",
      kind: "local",
      name: "Laptop",
    });
  });

  it.each([
    ["a missing id", { kind: "local", name: "Laptop" }],
    ["an oversized id", { id: "x".repeat(513), kind: "local", name: "Laptop" }],
    ["an invalid profile", { id: "profile-1", kind: "cloud", name: "Cloud" }],
    ["an invalid credential", { ...remoteProfile, id: "profile-1", credential: { type: "x" } }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseProfileUpdate(input)).toThrow();
  });
});

const pairPayload = {
  urls: ["https://opencode.example.com"],
  username: "palot",
  password: "secret",
};

describe("parsePairImport", () => {
  it("accepts a pairing link", () => {
    expect(
      parsePairImport({ link: "palot://pair?token=abc", allowPlainHttp: true, extra: 1 }),
    ).toEqual({ link: "palot://pair?token=abc", allowPlainHttp: true });
  });

  it("accepts reusable credentials", () => {
    expect(
      parsePairImport({ payload: { ...pairPayload, extra: 1 }, allowPlainHttp: false }),
    ).toEqual({ payload: pairPayload, allowPlainHttp: false });
  });

  it.each([
    ["null", null],
    [
      "both a link and credentials",
      { link: "palot://pair", payload: pairPayload, allowPlainHttp: false },
    ],
    ["an empty link", { link: "", allowPlainHttp: false }],
    ["a link over 2048 characters", { link: "x".repeat(2_049), allowPlainHttp: false }],
    ["a link without allowPlainHttp", { link: "palot://pair" }],
    ["neither a link nor credentials", { allowPlainHttp: false }],
    [
      "credentials without URLs",
      { payload: { ...pairPayload, urls: undefined }, allowPlainHttp: false },
    ],
    [
      "credentials with a non-string URL",
      { payload: { ...pairPayload, urls: [1] }, allowPlainHttp: false },
    ],
    [
      "credentials with an empty username",
      { payload: { ...pairPayload, username: "" }, allowPlainHttp: false },
    ],
    [
      "credentials with an empty password",
      { payload: { ...pairPayload, password: "" }, allowPlainHttp: false },
    ],
    ["credentials without allowPlainHttp", { payload: pairPayload }],
  ])("rejects %s", (_name, input) => {
    expect(() => parsePairImport(input)).toThrow();
  });
});

describe("parseAttentionSnapshot", () => {
  it("returns the connection and the sessions as given", () => {
    const sessions = [{ id: "session-1", projectID: "project-1", title: "Kept" }];
    expect(parseAttentionSnapshot({ connectionID: "connection-1", sessions })).toEqual({
      connectionID: "connection-1",
      sessions,
    });
  });

  it("accepts exactly 2,000 sessions", () => {
    const sessions = Array.from({ length: 2_000 }, (_, index) => ({
      id: `session-${index}`,
      projectID: "project-1",
    }));
    expect(
      parseAttentionSnapshot({ connectionID: "connection-1", sessions }).sessions,
    ).toHaveLength(2_000);
  });

  it.each([
    ["null", null],
    ["missing sessions", { connectionID: "connection-1" }],
    ["sessions as an object", { connectionID: "connection-1", sessions: {} }],
    [
      "more than 2,000 sessions",
      {
        connectionID: "connection-1",
        sessions: Array.from({ length: 2_001 }, () => ({ id: "s", projectID: "p" })),
      },
    ],
    ["a null session", { connectionID: "connection-1", sessions: [null] }],
    ["a session without an id", { connectionID: "connection-1", sessions: [{ projectID: "p" }] }],
    [
      "a numeric project ID",
      { connectionID: "connection-1", sessions: [{ id: "s", projectID: 1 }] },
    ],
    ["a missing connection ID", { sessions: [] }],
    ["an empty connection ID", { connectionID: "", sessions: [] }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseAttentionSnapshot(input)).toThrow();
  });

  // Only id and projectID are checked, deliberately. The renderer's own mapper builds the other
  // fields and main only displays them; a stricter schema would risk dropping sessions.
});

describe("parseAttachmentPaths", () => {
  const posix = { limit: 3, pathApi: path.posix };

  it("returns absolute paths once each", () => {
    expect(
      parseAttachmentPaths({ paths: ["/a/one.ts", "/b/two.zip", "/a/one.ts"] }, posix),
    ).toEqual(["/a/one.ts", "/b/two.zip"]);
    expect(
      parseAttachmentPaths(
        { paths: ["C:\\Users\\me\\shot.png"] },
        { limit: 3, pathApi: path.win32 },
      ),
    ).toEqual(["C:\\Users\\me\\shot.png"]);
  });

  it.each([
    ["null", null],
    ["no paths", {}],
    ["paths as a string", { paths: "/a/one.ts" }],
    ["an empty list", { paths: [] }],
    ["a relative path", { paths: ["notes/one.ts"] }],
    ["a dot path", { paths: ["./one.ts"] }],
    ["an empty path", { paths: [""] }],
    ["a number", { paths: [1] }],
    ["an object", { paths: [{ path: "/a/one.ts" }] }],
    ["a NUL byte", { paths: ["/a/one.ts\0.png"] }],
    ["an overlong path", { paths: [`/${"a".repeat(16_384)}`] }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseAttachmentPaths(input, posix)).toThrow();
  });

  it("rejects more paths than one attachment allows", () => {
    expect(() => parseAttachmentPaths({ paths: ["/1", "/2", "/3", "/4"] }, posix)).toThrow(
      "Attach up to 3 files at a time.",
    );
  });

  it.each(["\\\\attacker\\share\\x.png", "//attacker/share/x.png", "notes\\x.png"])(
    "rejects the Windows path %s that is not a local absolute path",
    (value) => {
      expect(() =>
        parseAttachmentPaths({ paths: [value] }, { limit: 3, pathApi: path.win32 }),
      ).toThrow();
    },
  );
});
