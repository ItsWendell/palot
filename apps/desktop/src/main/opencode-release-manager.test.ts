// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { deflateRawSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenCodeReleaseManager,
  type OpenCodeReleaseDependencies,
} from "./opencode-release-manager";
import { SUPPORTED_OPENCODE_VERSION } from "./opencode-version";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error("Tests must supply isolated userData.");
    }),
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    constructor() {
      throw new Error("Tests must inject preferences.");
    }
  },
}));

const directories: string[] = [];
interface FeedMetadata {
  channel: string;
  name: string;
  distribution: string;
  version: string;
  metadata: { files: Record<string, { url: string; sha256: string; size: number }> };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function tar(
  entries = [
    {
      name: "opencode-linux-x64-baseline/bin/opencode",
      type: "0",
      data: Buffer.from("fake executable"),
    },
  ],
) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0);
    header.write("0000700\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${entry.data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(entry.type, 156);
    header.write("ustar\0", 257);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

function zip(name = "opencode-darwin-arm64/bin/opencode", mode = 0x81c0) {
  const bytes = Buffer.from("fake mac executable");
  const compressed = deflateRawSync(bytes);
  const encodedName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(encodedName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(encodedName.length, 28);
  central.writeUInt32LE((mode * 65536) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + encodedName.length, 12);
  end.writeUInt32LE(local.length + encodedName.length + compressed.length, 16);
  return Buffer.concat([local, encodedName, compressed, central, encodedName, end]);
}

async function harness(
  options: {
    archive?: Buffer;
    platform?: string;
    arch?: string;
    version?: string;
    saved?: unknown;
  } = {},
) {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/release-manager-");
  directories.push(directory);
  const archive = options.archive ?? tar();
  const platform = options.platform ?? "linux";
  const arch = options.arch ?? "x64";
  const filename = `opencode-${platform}-${arch}${arch === "x64" ? "-baseline" : ""}.${platform === "linux" ? "tar.gz" : "zip"}`;
  let version = options.version ?? "2.0.7";
  let saved = options.saved;
  let edit: (value: ReturnType<typeof metadata>) => unknown = (value) => value;
  const metadata = (channel: string) => ({
    channel,
    name: "cli",
    distribution: "opencode",
    version,
    metadata: {
      files: {
        [filename]: {
          url: `https://opencode.ai/files/bin/${version}/${filename}`,
          sha256: digest(archive),
          size: archive.length,
        },
      },
    },
  });
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("/update/")) {
      return new Response(
        JSON.stringify(edit(metadata(String(url).includes("/beta/") ? "beta" : "latest"))),
      );
    }
    return new Response(new Uint8Array(archive));
  });
  const verifyVersion = vi.fn(async (_binary: string) => version);
  const write = vi.fn((value: unknown) => {
    saved = structuredClone(value);
  });
  const deps: OpenCodeReleaseDependencies = {
    bundledVersion: () => SUPPORTED_OPENCODE_VERSION,
    cacheDirectory: directory,
    platform,
    arch,
    fetch: fetcher,
    now: () => 123456,
    preferences: { read: () => saved, write },
    verifyVersion,
  };
  const manager = new OpenCodeReleaseManager(deps);
  return {
    manager,
    deps,
    directory,
    fetcher,
    verifyVersion,
    archive,
    filename,
    write,
    saved: () => saved,
    edit: (fn: typeof edit) => {
      edit = fn;
    },
    version: (value: string) => {
      version = value;
    },
  };
}

describe("OpenCode release manager", () => {
  it("reports no bundled runtime before download and after reset without acquiring anything", async () => {
    const h = await harness();
    h.deps.bundledVersion = () => null;
    expect(h.manager.status()).toMatchObject({ bundledVersion: null, preparedVersion: null });
    expect(h.manager.reset()).toMatchObject({ bundledVersion: null, preparedVersion: null });
    expect(await h.manager.discoverPreparedBinary()).toBeNull();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });
  it("defaults to stable without network, store creation, runtime execution or service side effects", async () => {
    const h = await harness();
    expect(h.manager.status()).toEqual({
      channel: "stable",
      bundledVersion: SUPPORTED_OPENCODE_VERSION,
      preparedVersion: null,
      checkedAt: null,
      offer: null,
    });
    h.manager.setChannel("beta");
    h.manager.setChannel("stable");
    expect(await h.manager.discoverPreparedBinary()).toBeNull();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.verifyVersion).not.toHaveBeenCalled();
    expect(h.saved()).toEqual({ channel: "stable", prepared: null });
  });

  it("uses only official binary feeds and exposes no URLs, paths or checksums", async () => {
    const h = await harness({ version: SUPPORTED_OPENCODE_VERSION });
    const status = await h.manager.check();
    expect(h.fetcher).toHaveBeenCalledWith(
      "https://opencode.ai/update/api/latest/cli/opencode",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(status.offer).toEqual({
      channel: "stable",
      version: SUPPORTED_OPENCODE_VERSION,
      tested: true,
      requiresConfirmation: false,
      size: h.archive.length,
    });
    expect(status.checkedAt).toBe(123456);
    status.offer!.version = "tampered";
    expect(h.manager.status().offer!.version).toBe(SUPPORTED_OPENCODE_VERSION);
    h.manager.setChannel("beta");
    h.version("2.0.10");
    expect((await h.manager.check()).offer).toMatchObject({
      channel: "beta",
      version: "2.0.10",
      tested: false,
      requiresConfirmation: false,
    });
  });

  it.each([
    [
      "V1",
      (m: FeedMetadata) => {
        m.version = "1.18.0";
      },
    ],
    [
      "unknown major",
      (m: FeedMetadata) => {
        m.version = "3.0.0";
      },
    ],
    [
      "path version",
      (m: FeedMetadata) => {
        m.version = "../../2.0.7";
      },
    ],
    [
      "wrong channel",
      (m: FeedMetadata) => {
        m.channel = "beta";
      },
    ],
    [
      "npm distribution",
      (m: FeedMetadata) => {
        m.distribution = "npm";
      },
    ],
    [
      "non-HTTPS",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.url = "http://opencode.ai/evil";
      },
    ],
    [
      "other origin",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.url = "https://evil.example/opencode";
      },
    ],
    [
      "wrong artifact",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.url += "?redirect=evil";
      },
    ],
    [
      "invalid checksum",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.sha256 = "bad";
      },
    ],
    [
      "oversized",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.size = 300 * 1024 * 1024;
      },
    ],
    [
      "negative size",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.size = -1;
      },
    ],
    [
      "fractional size",
      (m: FeedMetadata) => {
        Object.values(m.metadata.files)[0]!.size = 1.5;
      },
    ],
  ])("rejects %s metadata without downloading or executing", async (_name, mutate) => {
    const h = await harness();
    h.edit((m) => {
      mutate(m);
      return m;
    });
    await expect(h.manager.check()).rejects.toThrow("Could not check");
    expect(h.manager.status().offer).toBeNull();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("rejects unavailable, oversized and malformed feed responses", async () => {
    const h = await harness();
    for (const response of [
      new Response("offline", { status: 503 }),
      new Response("not JSON"),
      new Response("x", { headers: { "content-length": "2000000" } }),
      new Response("x".repeat(1024 * 1024 + 1)),
    ]) {
      h.fetcher.mockResolvedValueOnce(response);
      await expect(h.manager.check()).rejects.toThrow("Could not check");
    }
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("requires a current checked offer and explicit untested consent", async () => {
    const version = "0.0.0-beta-19508";
    const h = await harness({ version });
    await expect(h.manager.prepare({ version, allowUntested: true })).rejects.toThrow("stale");
    h.manager.setChannel("beta");
    await h.manager.check();
    await expect(h.manager.prepare({ version })).rejects.toThrow("consent");
    await expect(h.manager.prepare({ version: "2.0.7", allowUntested: true })).rejects.toThrow(
      "stale",
    );
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await h.manager.prepare({ version, allowUntested: true });
    expect(h.manager.acceptsPreparedVersion(version)).toBe(true);
    expect(h.manager.acceptsPreparedVersion("2.0.0")).toBe(false);
    const fresh = new OpenCodeReleaseManager(h.deps);
    expect(fresh.acceptsPreparedVersion(version)).toBe(true);
    const saved = h.saved() as { prepared: { acceptedForSdk: string } };
    saved.prepared.acceptedForSdk = "obsolete-sdk";
    const changedSdk = new OpenCodeReleaseManager({
      ...h.deps,
      preferences: { ...h.deps.preferences, read: () => saved },
    });
    expect(changedSdk.acceptsPreparedVersion(version)).toBe(false);
    await expect(changedSdk.discoverPreparedBinary()).rejects.toThrow("consent expired");
  });

  it.each(["2.0.8", "2.10.7", "2.0.7"])(
    "prepares compatible %s without a confirmation or persisted exception",
    async (version) => {
      const h = await harness({ version });
      h.manager.setChannel("beta");
      expect((await h.manager.check()).offer?.requiresConfirmation).toBe(false);
      await h.manager.prepare({ version });
      expect((await h.manager.discoverPreparedBinary())?.version).toBe(version);
      expect(h.manager.acceptsPreparedVersion(version)).toBe(false);
    },
  );

  it("accepts only explicit consent for canonical OpenCode 2 prereleases", async () => {
    const version = "2.1.0-beta.1";
    const h = await harness({ version });
    expect((await h.manager.check()).offer).toMatchObject({
      tested: false,
      requiresConfirmation: true,
    });
    await expect(h.manager.prepare({ version })).rejects.toThrow("consent");
    const pending = h.manager.prepare({ version, allowUntested: true });
    await expect(h.manager.prepare({ version })).rejects.toThrow("consent");
    await pending;
    expect(h.manager.acceptsPreparedVersion(version)).toBe(true);
  });

  it("streams, verifies, stages atomically and revalidates on discovery without feed requests", async () => {
    const h = await harness();
    await h.manager.check();
    expect((await h.manager.prepare({ version: "2.0.7" })).preparedVersion).toBe("2.0.7");
    const prepared = await h.manager.discoverPreparedBinary();
    expect(prepared?.version).toBe("2.0.7");
    expect(await readFile(prepared!.path, "utf8")).toBe("fake executable");
    expect(h.verifyVersion).toHaveBeenCalledTimes(2);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.manager.acceptsPreparedVersion("2.0.7")).toBe(false);
    expect(await readdir(h.directory)).toEqual(["2.0.7"]);
    h.manager.setChannel("beta");
    expect(h.manager.status()).toMatchObject({ preparedVersion: "2.0.7", offer: null });
    expect((await h.manager.discoverPreparedBinary())?.version).toBe("2.0.7");
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses cached binary tampering before executing it", async () => {
    const h = await harness();
    await h.manager.check();
    await h.manager.prepare({ version: "2.0.7" });
    const prepared = await h.manager.discoverPreparedBinary();
    h.verifyVersion.mockClear();
    await writeFile(prepared!.path, "tampered");
    await expect(h.manager.discoverPreparedBinary()).rejects.toThrow("SHA-256");
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("refuses a cached symlink even if its target has the expected hash", async () => {
    const h = await harness();
    await h.manager.check();
    await h.manager.prepare({ version: "2.0.7" });
    const prepared = await h.manager.discoverPreparedBinary();
    const bytes = await readFile(prepared!.path);
    await rm(prepared!.path);
    await writeFile(`${prepared!.path}.target`, bytes);
    await symlink(`${prepared!.path}.target`, prepared!.path);
    h.verifyVersion.mockClear();
    await expect(h.manager.discoverPreparedBinary()).rejects.toThrow("Invalid cached executable");
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("refuses archive checksum mismatch and short/oversized downloads, cleaning partials", async () => {
    const h = await harness();
    await h.manager.check();
    for (const bytes of [
      Buffer.alloc(h.archive.length, 1),
      h.archive.subarray(0, 10),
      Buffer.concat([h.archive, Buffer.from("extra")]),
    ]) {
      h.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
      await expect(h.manager.prepare({ version: "2.0.7" })).rejects.toThrow(/checksum|size/);
      expect(await readdir(h.directory)).toEqual([]);
    }
    expect(h.verifyVersion).not.toHaveBeenCalled();
    expect(h.manager.status().preparedVersion).toBeNull();
  });

  it("retains the previous selection after offline, wrong version, and persistence failures", async () => {
    const h = await harness();
    await h.manager.check();
    await h.manager.prepare({ version: "2.0.7" });
    h.fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(h.manager.check()).rejects.toThrow("offline");
    expect(h.manager.status().preparedVersion).toBe("2.0.7");
    expect(h.manager.status().offer).toBeNull();
    h.version("2.0.8");
    await h.manager.check();
    h.verifyVersion.mockResolvedValueOnce("1.0.0");
    await expect(h.manager.prepare({ version: "2.0.8", allowUntested: true })).rejects.toThrow(
      "different OpenCode version",
    );
    expect(h.manager.status().preparedVersion).toBe("2.0.7");
    h.write.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(h.manager.prepare({ version: "2.0.8", allowUntested: true })).rejects.toThrow(
      "disk full",
    );
    expect(h.manager.status().preparedVersion).toBe("2.0.7");
    expect((await readdir(h.directory)).some((entry) => entry.startsWith(".prepare-"))).toBe(false);
  });

  it("deduplicates concurrent checks and preparations", async () => {
    const h = await harness();
    const first = h.manager.check();
    expect(h.manager.check()).toBe(first);
    await first;
    const preparing = h.manager.prepare({ version: "2.0.7" });
    expect(h.manager.prepare({ version: "2.0.7" })).toBe(preparing);
    await preparing;
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.verifyVersion).toHaveBeenCalledTimes(1);
  });

  it("does not publish results from a check whose channel changed", async () => {
    const h = await harness();
    const checking = h.manager.check();
    h.manager.setChannel("beta");
    await expect(checking).rejects.toThrow("channel changed");
    expect(h.manager.status().offer).toBeNull();
    expect((await h.manager.check()).offer?.channel).toBe("beta");
  });

  it.each(["channel", "reset", "recheck"])(
    "prevents %s races from committing a prepared selection",
    async (operation) => {
      const h = await harness();
      await h.manager.check();
      let release!: (version: string) => void;
      let entered!: () => void;
      const verifying = new Promise<void>((resolve) => {
        entered = resolve;
      });
      h.verifyVersion.mockImplementationOnce(() => {
        entered();
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      });
      const preparing = h.manager.prepare({ version: "2.0.7" });
      await verifying;
      if (operation === "channel") h.manager.setChannel("beta");
      else if (operation === "reset") h.manager.reset();
      else await h.manager.check();
      release("2.0.7");
      await expect(preparing).rejects.toThrow("changed during preparation");
      expect(h.manager.status().preparedVersion).toBeNull();
      expect(await readdir(h.directory)).toEqual([]);
    },
  );

  it("reset drops selection and consent, preserves preferred channel/offer and performs no network", async () => {
    const version = "0.0.0-beta-19508";
    const h = await harness({ version });
    h.manager.setChannel("beta");
    await h.manager.check();
    await h.manager.prepare({ version, allowUntested: true });
    const offer = h.manager.status().offer;
    expect(h.manager.reset()).toMatchObject({ channel: "beta", preparedVersion: null, offer });
    expect(h.manager.acceptsPreparedVersion(version)).toBe(false);
    expect(await h.manager.discoverPreparedBinary()).toBeNull();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["traversal", [{ name: "../opencode", type: "0", data: Buffer.from("bad") }]],
    ["symlink", [{ name: "opencode", type: "2", data: Buffer.from("target") }]],
    [
      "duplicate",
      [
        { name: "opencode", type: "0", data: Buffer.from("one") },
        { name: "nested/opencode", type: "0", data: Buffer.from("two") },
      ],
    ],
    ["missing binary", [{ name: "readme", type: "0", data: Buffer.from("doc") }]],
  ])("refuses %s tar entries before execution", async (_name, entries) => {
    const h = await harness({ archive: tar(entries) });
    await h.manager.check();
    await expect(h.manager.prepare({ version: "2.0.7" })).rejects.toThrow("Could not prepare");
    expect(h.verifyVersion).not.toHaveBeenCalled();
    expect(await readdir(h.directory)).toEqual([]);
  });

  it("extracts the inspected regular binary entry from a mac zip", async () => {
    const h = await harness({ archive: zip(), platform: "darwin", arch: "arm64" });
    await h.manager.check();
    await h.manager.prepare({ version: "2.0.7" });
    const binary = await h.manager.discoverPreparedBinary();
    expect(await readFile(binary!.path, "utf8")).toBe("fake mac executable");
  });

  it("cleans up interrupted network streams before executing or committing", async () => {
    const h = await harness();
    await h.manager.check();
    h.fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(h.archive.subarray(0, 10)));
            controller.error(new Error("connection interrupted"));
          },
        }),
      ),
    );
    await expect(h.manager.prepare({ version: "2.0.7" })).rejects.toThrow("connection interrupted");
    expect(await readdir(h.directory)).toEqual([]);
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("reports corrupted gzip data as an extraction error without unhandled stream failures", async () => {
    const archive = tar();
    archive[archive.length - 8] = archive[archive.length - 8]! ^ 0xff;
    const h = await harness({ archive });
    await h.manager.check();
    await expect(h.manager.prepare({ version: "2.0.7" })).rejects.toThrow("Could not prepare");
    expect(h.verifyVersion).not.toHaveBeenCalled();
    expect(await readdir(h.directory)).toEqual([]);
  });

  it.each([
    null,
    { channel: "malicious", prepared: { version: "../../outside" } },
    {
      channel: "beta",
      prepared: { version: "1.0.0", sha256: "a".repeat(64), platform: "linux", arch: "x64" },
    },
  ])("ignores corrupt persisted selections: %j", async (saved) => {
    const h = await harness({ saved });
    expect(h.manager.status().preparedVersion).toBeNull();
    expect(await h.manager.discoverPreparedBinary()).toBeNull();
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it.each([
    ["../opencode", 0x81c0],
    ["opencode", 0xa1c0],
    ["not-opencode", 0x81c0],
  ])("refuses unsafe zip entry %s/%d", async (name, mode) => {
    const h = await harness({ archive: zip(name, mode), platform: "darwin", arch: "arm64" });
    await h.manager.check();
    await expect(h.manager.prepare({ version: "2.0.7" })).rejects.toThrow("Could not prepare");
    expect(h.verifyVersion).not.toHaveBeenCalled();
  });

  it("rejects unsupported platforms before requesting the feed", async () => {
    const h = await harness({ platform: "win32" });
    await expect(h.manager.check()).rejects.toThrow("not supported");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
