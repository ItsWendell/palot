import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip, createInflateRaw } from "node:zlib";
import { app } from "electron";
import Store from "electron-store";
import { readExternalOpenCodeRuntimePolicy } from "./opencode-runtime-release";
import type {
  OpenCodeReleaseChannel,
  OpenCodeReleaseOffer,
  OpenCodeReleaseStatus,
} from "../shared/opencode-release-contract";
import {
  canContinueOpenCodeVersionMismatch,
  isSupportedOpenCodeVersion,
  isTestedOpenCodeVersion,
  parseOpenCodeVersionOutput,
  SUPPORTED_OPENCODE_VERSION,
} from "./opencode-version";

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_BINARY = 512 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const execFileAsync = promisify(execFile);

interface PreparedRelease {
  version: string;
  platform: string;
  arch: string;
  sha256: string;
  /** Consent expires when Palot's generated client contract changes. */
  acceptedForSdk?: string;
}

interface Preferences {
  channel: OpenCodeReleaseChannel;
  prepared: PreparedRelease | null;
}

export interface OpenCodeReleaseDependencies {
  bundledVersion(): string | null;
  preferences: { read(): unknown; write(value: Preferences): void };
  cacheDirectory: string;
  platform: string;
  arch: string;
  fetch: typeof globalThis.fetch;
  now: () => number;
  /** Test seam: production only executes the hash-verified file with --version. */
  verifyVersion: (binary: string) => Promise<string>;
}

interface CheckedOffer extends OpenCodeReleaseOffer {
  url: string;
  sha256: string;
  filename: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid OpenCode release metadata.");
  }
  return value as Record<string, unknown>;
}

function supportedVersion(version: unknown): version is string {
  return (
    typeof version === "string" &&
    version.length < 80 &&
    canContinueOpenCodeVersionMismatch(version)
  );
}

function filenameFor(platform: string, arch: string): string {
  if ((platform !== "linux" && platform !== "darwin") || !["x64", "arm64"].includes(arch)) {
    throw new Error(`OpenCode release downloads are not supported on ${platform}/${arch}.`);
  }
  const target = `${platform}-${arch}${arch === "x64" ? "-baseline" : ""}`;
  return `opencode-${target}.${platform === "linux" ? "tar.gz" : "zip"}`;
}

function parseOffer(
  value: unknown,
  channel: OpenCodeReleaseChannel,
  filename: string,
): CheckedOffer {
  const data = record(value);
  const feed = channel === "stable" ? "latest" : "beta";
  if (data.channel !== feed || data.name !== "cli" || data.distribution !== "opencode") {
    throw new Error("The official update feed returned the wrong release channel or distribution.");
  }
  if (!supportedVersion(data.version)) {
    throw new Error(
      "This release is not a supported OpenCode 2 version. V1 and unknown majors are refused.",
    );
  }
  const file = record(record(record(data.metadata).files)[filename]);
  const url = `https://opencode.ai/files/bin/${data.version}/${filename}`;
  if (
    file.url !== url ||
    typeof file.sha256 !== "string" ||
    !SHA256.test(file.sha256) ||
    !Number.isSafeInteger(file.size) ||
    (file.size as number) <= 0 ||
    (file.size as number) > MAX_ARCHIVE
  ) {
    throw new Error("Invalid official OpenCode binary URL, SHA-256 checksum, or archive size.");
  }
  return {
    channel,
    version: data.version,
    tested: isTestedOpenCodeVersion(data.version),
    requiresConfirmation: !isSupportedOpenCodeVersion(data.version),
    filename,
    url,
    sha256: file.sha256,
    size: file.size as number,
  };
}

function publicOffer(offer: CheckedOffer | null): OpenCodeReleaseOffer | null {
  if (!offer) return null;
  const { channel, version, tested, requiresConfirmation, size } = offer;
  return { channel, version, tested, requiresConfirmation, size };
}

function readPreferences(value: unknown): Preferences {
  try {
    const data = record(value);
    const channel = data.channel === "beta" ? "beta" : "stable";
    if (!data.prepared) return { channel, prepared: null };
    const prepared = record(data.prepared);
    if (
      !supportedVersion(prepared.version) ||
      !["linux", "darwin"].includes(String(prepared.platform)) ||
      !["x64", "arm64"].includes(String(prepared.arch)) ||
      typeof prepared.sha256 !== "string" ||
      !SHA256.test(prepared.sha256)
    ) {
      return { channel, prepared: null };
    }
    return {
      channel,
      prepared: {
        version: prepared.version,
        platform: String(prepared.platform),
        arch: String(prepared.arch),
        sha256: prepared.sha256,
        ...(typeof prepared.acceptedForSdk === "string"
          ? { acceptedForSdk: prepared.acceptedForSdk }
          : {}),
      },
    };
  } catch {
    return { channel: "stable", prepared: null };
  }
}

function defaults(): OpenCodeReleaseDependencies {
  // Constructed lazily, after index.ts sets the worktree/E2E userData directory.
  const directory = app.getPath("userData");
  const store = new Store<{ release: Preferences }>({ name: "opencode-release", cwd: directory });
  return {
    bundledVersion: () =>
      readExternalOpenCodeRuntimePolicy(path.join(process.resourcesPath, "opencode"))
        ? null
        : SUPPORTED_OPENCODE_VERSION,
    preferences: {
      read: () => store.get("release"),
      write: (value) => store.set("release", value),
    },
    cacheDirectory: path.join(directory, "opencode-releases"),
    platform: process.platform,
    arch: process.arch,
    fetch: globalThis.fetch,
    now: Date.now,
    verifyVersion: async (binary) => {
      const { stdout } = await execFileAsync(binary, ["--version"], {
        cwd: path.dirname(binary),
        timeout: 15_000,
        maxBuffer: 16 * 1024,
        windowsHide: true,
      });
      const version = parseOpenCodeVersionOutput(stdout);
      if (!version) throw new Error("The verified binary did not report a recognizable version.");
      return version;
    },
  };
}

/** Main-owned, user-triggered downloader. Never starts or stops an OpenCode service. */
export class OpenCodeReleaseManager {
  private readonly deps: OpenCodeReleaseDependencies;
  private preferences: Preferences;
  private offer: CheckedOffer | null = null;
  private checkedAt: number | null = null;
  private generation = 0;
  private checking: { generation: number; promise: Promise<OpenCodeReleaseStatus> } | null = null;
  private preparing: { offer: CheckedOffer; promise: Promise<OpenCodeReleaseStatus> } | null = null;

  constructor(dependencies?: OpenCodeReleaseDependencies) {
    this.deps = dependencies ?? defaults();
    this.preferences = readPreferences(this.deps.preferences.read());
  }

  status(): OpenCodeReleaseStatus {
    return {
      channel: this.preferences.channel,
      bundledVersion: this.deps.bundledVersion(),
      preparedVersion: this.preferences.prepared?.version ?? null,
      checkedAt: this.checkedAt,
      offer: publicOffer(this.offer),
    };
  }

  setChannel(channel: OpenCodeReleaseChannel): OpenCodeReleaseStatus {
    if (channel !== "stable" && channel !== "beta")
      throw new Error("Invalid OpenCode release channel.");
    const next = { ...this.preferences, channel };
    this.deps.preferences.write(next);
    this.preferences = next;
    this.generation++;
    this.offer = null;
    this.checkedAt = null;
    return this.status();
  }

  reset(): OpenCodeReleaseStatus {
    const next = { ...this.preferences, prepared: null };
    this.deps.preferences.write(next);
    this.preferences = next;
    this.generation++;
    return this.status();
  }

  check(): Promise<OpenCodeReleaseStatus> {
    if (this.checking?.generation === this.generation) return this.checking.promise;
    const generation = this.generation;
    const channel = this.preferences.channel;
    // A failed recheck must not leave an older offer looking newly checked.
    this.offer = null;
    this.checkedAt = null;
    const promise = this.checkRelease(channel, generation).finally(() => {
      if (this.checking?.promise === promise) this.checking = null;
    });
    this.checking = { generation, promise };
    return promise;
  }

  private async checkRelease(channel: OpenCodeReleaseChannel, generation: number) {
    try {
      const filename = filenameFor(this.deps.platform, this.deps.arch);
      const feed = channel === "stable" ? "latest" : "beta";
      const response = await this.deps.fetch(
        `https://opencode.ai/update/api/${feed}/cli/opencode`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        },
      );
      const body = await responseBytes(response, MAX_METADATA);
      const offer = parseOffer(JSON.parse(body.toString("utf8")), channel, filename);
      if (generation !== this.generation)
        throw new Error("The release channel changed; check again.");
      this.offer = offer;
      this.checkedAt = this.deps.now();
      return this.status();
    } catch (error) {
      throw new Error(
        `Could not check OpenCode releases: ${message(error)} Prepared runtime is unchanged.`,
        {
          cause: error,
        },
      );
    }
  }

  prepare(input: { version: string; allowUntested?: boolean }): Promise<OpenCodeReleaseStatus> {
    const offer = this.offer;
    if (!offer || offer.version !== input.version || offer.channel !== this.preferences.channel) {
      return Promise.reject(
        new Error("This release offer is stale. Check the selected channel again."),
      );
    }
    if (offer.requiresConfirmation && input.allowUntested !== true) {
      return Promise.reject(
        new Error("This OpenCode version is untested with Palot. Explicit consent is required."),
      );
    }
    if (this.preparing) {
      if (this.preparing.offer === offer) return this.preparing.promise;
      return Promise.reject(
        new Error("Another release is being prepared. Wait for it to finish, then try again."),
      );
    }
    const generation = this.generation;
    const promise = this.prepareRelease(offer, generation).finally(() => {
      if (this.preparing?.promise === promise) this.preparing = null;
    });
    this.preparing = { offer, promise };
    return promise;
  }

  private async prepareRelease(offer: CheckedOffer, generation: number) {
    let staging: string | undefined;
    try {
      await mkdir(this.deps.cacheDirectory, { recursive: true, mode: 0o700 });
      await chmod(this.deps.cacheDirectory, 0o700);
      staging = await mkdtemp(path.join(this.deps.cacheDirectory, ".prepare-"));
      const archive = path.join(staging, "archive");
      const binary = path.join(staging, "opencode");
      await downloadArchive(this.deps.fetch, offer, archive);
      await extractBinary(archive, binary, offer.filename);
      await chmod(binary, 0o700);
      const sha256 = await hashBinary(binary);
      const prepared: PreparedRelease = {
        version: offer.version,
        platform: this.deps.platform,
        arch: this.deps.arch,
        sha256,
        ...(offer.requiresConfirmation ? { acceptedForSdk: SUPPORTED_OPENCODE_VERSION } : {}),
      };
      // Hash immediately before execution, both here and on every later discovery.
      await this.verifyBinary(binary, prepared);
      this.assertCurrentOffer(offer, generation);
      const target = this.binaryPath(prepared);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await rename(binary, target);
      this.assertCurrentOffer(offer, generation);
      const next = { ...this.preferences, prepared };
      // Atomic electron-store write is the commit point. Never discard a working
      // prepared selection on network, integrity, extraction, execution or disk errors.
      this.deps.preferences.write(next);
      this.preferences = next;
      return this.status();
    } catch (error) {
      throw new Error(
        `Could not prepare OpenCode: ${message(error)} Previous prepared runtime is unchanged.`,
        {
          cause: error,
        },
      );
    } finally {
      // Cleanup must not turn an already committed selection into a reported
      // failure. An interrupted/locked staging directory is never discoverable.
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  private assertCurrentOffer(offer: CheckedOffer, generation: number) {
    if (this.offer !== offer || this.generation !== generation) {
      throw new Error(
        "The release channel or checked offer changed during preparation; check again.",
      );
    }
  }

  acceptsPreparedVersion(version: string): boolean {
    const prepared = this.preferences.prepared;
    return Boolean(
      prepared &&
      prepared.version === version &&
      !isSupportedOpenCodeVersion(version) &&
      prepared.acceptedForSdk === SUPPORTED_OPENCODE_VERSION,
    );
  }

  async discoverPreparedBinary(): Promise<{ path: string; version: string } | null> {
    const prepared = this.preferences.prepared;
    if (!prepared) return null;
    if (prepared.platform !== this.deps.platform || prepared.arch !== this.deps.arch)
      throw new Error(
        "Prepared OpenCode runtime is for another architecture. Download it again or choose Installed OpenCode.",
      );
    if (
      !isSupportedOpenCodeVersion(prepared.version) &&
      !this.acceptsPreparedVersion(prepared.version)
    )
      throw new Error(
        "Prepared beta consent expired after the Palot update. Check and approve that release again, or choose Installed OpenCode.",
      );
    const binary = this.binaryPath(prepared);
    try {
      await this.verifyBinary(binary, prepared);
      // Do not return a selection replaced while --version was running.
      if (this.preferences.prepared !== prepared)
        throw new Error(
          "The selected OpenCode runtime changed during verification. Retry the action.",
        );
      return { path: binary, version: prepared.version };
    } catch (error) {
      throw new Error(
        `Prepared OpenCode runtime failed verification: ${message(error)} Check and prepare it again.`,
        {
          cause: error,
        },
      );
    }
  }

  private binaryPath(prepared: PreparedRelease) {
    return path.join(
      this.deps.cacheDirectory,
      prepared.version,
      `${prepared.platform}-${prepared.arch}`,
      `opencode-${prepared.sha256}`,
    );
  }

  private async verifyBinary(binary: string, prepared: PreparedRelease) {
    if ((await hashBinary(binary)) !== prepared.sha256)
      throw new Error("Binary SHA-256 checksum mismatch.");
    if ((await this.deps.verifyVersion(binary)) !== prepared.version) {
      throw new Error("The verified binary reports a different OpenCode version.");
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseBytes(response: Response, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of responseChunks(response, maximum)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function* responseChunks(response: Response, maximum: number): AsyncGenerator<Buffer> {
  if (!response.ok || !response.body)
    throw new Error(`Official download returned HTTP ${response.status}.`);
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body.cancel();
    throw new Error("Official response exceeds the allowed size.");
  }
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Official response exceeds the allowed size.");
      yield Buffer.from(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function downloadArchive(fetcher: typeof fetch, offer: CheckedOffer, destination: string) {
  const response = await fetcher(offer.url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  const hash = createHash("sha256");
  let size = 0;
  async function* chunks() {
    for await (const chunk of responseChunks(response, offer.size)) {
      hash.update(chunk);
      size += chunk.length;
      yield chunk;
    }
  }
  await pipeline(
    Readable.from(chunks()),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  if (size !== offer.size || hash.digest("hex") !== offer.sha256) {
    throw new Error("Archive size or SHA-256 checksum mismatch. Nothing was executed.");
  }
}

async function hashBinary(binary: string): Promise<string> {
  const info = await lstat(binary);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_BINARY)
    throw new Error("Invalid cached executable.");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(binary)) {
    size += chunk.length;
    if (size > MAX_BINARY) throw new Error("Cached executable exceeds the allowed size.");
    hash.update(chunk);
  }
  if (size !== info.size) throw new Error("Cached executable changed during verification.");
  return hash.digest("hex");
}

/** Archives are parsed, never unpacked to paths supplied by an archive. Only the
 * single regular opencode entry is streamed to our own private destination. */
async function extractBinary(archive: string, destination: string, filename: string) {
  if (filename.endsWith(".zip")) await extractZip(archive, destination);
  else await extractTar(archive, destination);
}

function entryIsBinary(name: string): boolean {
  const normalized = name.startsWith("./") ? name.slice(2) : name;
  if (
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.split("/").some((part) => part === ".." || part === ".") ||
    !/^[a-zA-Z0-9._/-]+$/.test(normalized)
  )
    throw new Error("Unsafe path in OpenCode archive.");
  return normalized.split("/").at(-1) === "opencode";
}

function byteLimit(maximum: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(
        total > maximum ? new Error("Expanded OpenCode archive exceeds the allowed size.") : null,
        chunk,
      );
    },
  });
}

async function extractTar(archive: string, destination: string) {
  const stream = createReadStream(archive)
    .compose(createGunzip())
    .compose(byteLimit(MAX_BINARY + MAX_METADATA));
  const iterator = stream[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  async function read(size: number): Promise<Buffer> {
    const result = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw new Error("Truncated OpenCode tar archive.");
        pending = Buffer.from(next.value);
      }
      const length = Math.min(size - offset, pending.length);
      pending.copy(result, offset, 0, length);
      pending = pending.subarray(length);
      offset += length;
    }
    return result;
  }
  let found = false;
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    while (true) {
      const header = await read(512);
      if (header.every((byte) => byte === 0)) break;
      const text = (start: number, size: number) =>
        header
          .subarray(start, start + size)
          .toString("utf8")
          .split("\0")[0]!;
      const octal = (start: number, size: number) => {
        const value = text(start, size).trim();
        if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar entry size/checksum.");
        return Number.parseInt(value, 8);
      };
      const checksum = octal(148, 8);
      let actual = 0;
      for (let i = 0; i < header.length; i++) actual += i >= 148 && i < 156 ? 32 : header[i]!;
      if (actual !== checksum) throw new Error("Invalid tar header checksum.");
      const prefix = text(345, 155);
      const name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
      const binary = entryIsBinary(name);
      const type = text(156, 1);
      const size = octal(124, 12);
      if (size > MAX_BINARY || !["", "0", "5"].includes(type)) {
        throw new Error("Unsupported tar entry (links and extended headers are refused).");
      }
      if (binary) {
        if (found || type === "5" || size === 0)
          throw new Error("Expected a single regular opencode archive entry.");
        found = true;
        output = await open(destination, "wx", 0o600);
      }
      let remaining = size;
      while (remaining > 0) {
        const chunk = await read(Math.min(64 * 1024, remaining));
        if (binary) await output!.writeFile(chunk);
        remaining -= chunk.length;
      }
      if (size % 512) await read(512 - (size % 512));
      if (output) {
        await output.close();
        output = undefined;
      }
    }
    // Only zero padding may follow the terminator. Drain to validate the gzip
    // trailer, detect hidden/concatenated entries, and enforce expansion limits.
    if (!pending.every((byte) => byte === 0))
      throw new Error("Unexpected data after tar terminator.");
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      if (!Buffer.from(chunk).every((byte) => byte === 0))
        throw new Error("Unexpected data after tar terminator.");
    }
    if (!found) throw new Error("No regular opencode executable found in archive.");
  } finally {
    await output?.close();
    stream.destroy();
  }
}

async function extractZip(archive: string, destination: string) {
  const file = await open(archive, "r");
  try {
    const size = (await file.stat()).size;
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, size - tailSize);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error("Invalid OpenCode zip directory.");
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (
      tail.readUInt16LE(end + 4) !== 0 ||
      tail.readUInt16LE(end + 6) !== 0 ||
      tail.readUInt16LE(end + 8) !== count ||
      count > 1024 ||
      directorySize > MAX_METADATA ||
      directoryOffset + directorySize > size - tailSize + end
    )
      throw new Error("Unsupported OpenCode zip directory.");
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    let offset = 0;
    let selected:
      | { compressed: number; expanded: number; method: number; local: number; name: string }
      | undefined;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50)
        throw new Error("Invalid zip entry.");
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const compressed = directory.readUInt32LE(offset + 20);
      const expanded = directory.readUInt32LE(offset + 24);
      const nameSize = directory.readUInt16LE(offset + 28);
      const next =
        offset +
        46 +
        nameSize +
        directory.readUInt16LE(offset + 30) +
        directory.readUInt16LE(offset + 32);
      if (next > directory.length) throw new Error("Truncated zip entry.");
      const name = directory.subarray(offset + 46, offset + 46 + nameSize).toString("utf8");
      if (entryIsBinary(name)) {
        const mode = directory.readUInt32LE(offset + 38) >>> 16;
        if (
          selected ||
          (mode & 0xf000) !== 0x8000 ||
          flags & 1 ||
          ![0, 8].includes(method) ||
          expanded <= 0 ||
          expanded > MAX_BINARY
        ) {
          throw new Error("Expected a single regular, unencrypted opencode zip entry.");
        }
        selected = {
          compressed,
          expanded,
          method,
          local: directory.readUInt32LE(offset + 42),
          name,
        };
      }
      offset = next;
    }
    if (!selected || offset !== directory.length)
      throw new Error("No regular opencode executable found in zip archive.");
    const local = Buffer.alloc(30);
    await file.read(local, 0, 30, selected.local);
    if (
      local.readUInt32LE(0) !== 0x04034b50 ||
      local.readUInt16LE(8) !== selected.method ||
      local.readUInt16LE(6) & 1
    )
      throw new Error("Invalid zip local header.");
    const nameSize = local.readUInt16LE(26);
    const name = Buffer.alloc(nameSize);
    await file.read(name, 0, nameSize, selected.local + 30);
    if (name.toString("utf8") !== selected.name) throw new Error("Zip entry names disagree.");
    const start = selected.local + 30 + nameSize + local.readUInt16LE(28);
    if (selected.compressed <= 0 || start + selected.compressed > directoryOffset)
      throw new Error("Invalid zip compressed size.");
    const input = createReadStream(archive, { start, end: start + selected.compressed - 1 });
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    if (selected.method === 8)
      await pipeline(input, createInflateRaw(), byteLimit(selected.expanded), output);
    else await pipeline(input, byteLimit(selected.expanded), output);
    if ((await lstat(destination)).size !== selected.expanded)
      throw new Error("Expanded zip size mismatch.");
  } finally {
    await file.close();
  }
}

let manager: OpenCodeReleaseManager | undefined;
export function getOpenCodeReleaseManager(): OpenCodeReleaseManager {
  return (manager ??= new OpenCodeReleaseManager());
}
