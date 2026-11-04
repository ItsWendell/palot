// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  artifactAccessOrigin,
  artifactViewURL,
  createArtifactAccess,
  viewedArtifact,
} from "./artifact-access";

const origin = "http://127.0.0.1:4096";
const id = "art_019a3b2c4d5eAbCdEfGhIjKlMn";
const other = "art_019a3b2c4d5fZyXwVuTsRqPoNm";
const page = (url: string) => ({ getURL: () => url });

describe("OpenCode-hosted artifacts in the task browser", () => {
  it("only trusts a loopback endpoint on this computer", () => {
    expect(artifactAccessOrigin("http://127.0.0.1:4096/", true)).toBe(origin);
    expect(artifactAccessOrigin("http://localhost:4096", true)).toBe("http://localhost:4096");
    // The task browser tunnels through the server: a forwarded or remote address resolves there.
    expect(artifactAccessOrigin("http://127.0.0.1:4096", false)).toBeUndefined();
    expect(artifactAccessOrigin("https://opencode.example.test", true)).toBeUndefined();
    expect(artifactAccessOrigin("http://user:pass@127.0.0.1:4096", true)).toBeUndefined();
  });

  it("recognizes only an artifact's own view path on the connection origin", () => {
    expect(artifactViewURL(origin, id)).toBe(`${origin}/api/experimental/artifacts/${id}/view/`);
    expect(() => artifactViewURL(origin, "../session")).toThrow("invalid");
    expect(viewedArtifact(`${origin}/api/experimental/artifacts/${id}/view/a/b.js`, origin)).toBe(
      id,
    );
    expect(viewedArtifact(`${origin}/api/experimental/artifacts/${id}/view`, origin)).toBe(id);
    expect(viewedArtifact(`${origin}/api/experimental/artifacts/${id}`, origin)).toBeUndefined();
    expect(viewedArtifact(`${origin}/api/session`, origin)).toBeUndefined();
    expect(
      viewedArtifact(`http://127.0.0.1:9999/api/experimental/artifacts/${id}/view/`, origin),
    ).toBeUndefined();
    // Dot segments are resolved by the URL parser before matching.
    expect(
      viewedArtifact(`${origin}/api/experimental/artifacts/${id}/view/../../../session`, origin),
    ).toBeUndefined();
    expect(
      viewedArtifact(`${origin}/api/experimental/artifacts/${id}/view/..%2f..%2fsession`, origin),
    ).toBeUndefined();
  });

  it("adds the credential only for opened artifacts and their own requests", () => {
    const access = createArtifactAccess({ origin, authorization: "Basic secret" });
    const entry = `${origin}/api/experimental/artifacts/${id}/view/`;
    const asset = `${entry}assets/app.js`;
    const request = (url: string, resourceType: string, from?: string, method = "GET") =>
      access.authorization({
        url,
        method,
        resourceType,
        webContents: from ? page(from) : undefined,
      });

    expect(request(entry, "mainFrame")).toBeUndefined();
    expect(access.grant(id)).toBe(entry);
    expect(request(entry, "mainFrame")).toBe("Basic secret");
    expect(request(asset, "script", entry)).toBe("Basic secret");
    // Another site in the same task browser cannot read the artifact.
    expect(request(asset, "xhr", "https://example.test/")).toBeUndefined();
    expect(request(asset, "xhr")).toBeUndefined();
    // An opened artifact cannot read one the person has not opened, or write anything.
    const otherEntry = `${origin}/api/experimental/artifacts/${other}/view/`;
    expect(request(otherEntry, "mainFrame")).toBeUndefined();
    expect(request(otherEntry, "xhr", entry)).toBeUndefined();
    access.grant(other);
    expect(request(otherEntry, "xhr", entry)).toBeUndefined();
    expect(request(entry, "mainFrame", undefined, "POST")).toBeUndefined();
    expect(request(`${origin}/api/session`, "xhr", entry)).toBeUndefined();
  });

  it("sends nothing extra to a server without a password", () => {
    const access = createArtifactAccess({ origin });
    const entry = access.grant(id);
    expect(access.authorization({ url: entry, method: "GET", resourceType: "mainFrame" })).toBe(
      undefined,
    );
  });
});
