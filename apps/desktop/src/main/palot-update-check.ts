import { app, type IpcMainInvokeEvent } from "electron";
import log from "electron-log/main";
import Store from "electron-store";
import * as v from "valibot";
import { resolveBuildIdentity, type PalotBuildChannel } from "../shared/build-identity";
import {
  PALOT_UPDATE_IPC_CHANNELS,
  type PalotUpdateRelease,
  type PalotUpdateStatus,
} from "../shared/palot-update-contract";

/** The repository in apps/desktop/package.json. Releases are read from it and nowhere else. */
const REPOSITORY = "ItsWendell/palot";
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_RESPONSE = 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;
const DAY = 24 * 60 * 60 * 1000;
const TICK = 60 * 60 * 1000;
// The first scheduled check waits so it never competes with startup work.
const STARTUP_DELAY = 60 * 1000;

const NUMBER = "(0|[1-9]\\d{0,8})";
const STABLE_TAG = new RegExp(`^v?${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);

type Version = readonly [number, number, number];

/** A plain `MAJOR.MINOR.PATCH` version, with an optional leading `v`. Prereleases are not stable. */
export function parseStableVersion(value: string): Version | null {
  const match = STABLE_TAG.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseStableVersion(candidate);
  const now = parseStableVersion(current);
  if (!next || !now) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== now[index]) return next[index]! > now[index]!;
  }
  return false;
}

/** Only stable builds with a stable version compare against stable releases. */
export function checksUpdates(channel: PalotBuildChannel, currentVersion: string): boolean {
  return channel === "stable" && parseStableVersion(currentVersion) !== null;
}

export interface LatestRelease {
  tag: string;
  version: string;
}

const releaseSchema = v.object({
  tag_name: v.pipe(v.string(), v.maxLength(128)),
  draft: v.boolean(),
  prerelease: v.boolean(),
});

/**
 * Reads the latest non-prerelease release. Returns null when there is none or its tag is not
 * a stable version. Throws on network errors, timeouts, redirects, HTTP errors, oversized or
 * malformed responses.
 */
export async function fetchLatestRelease(
  fetcher: typeof globalThis.fetch,
  options: { userAgent: string; timeoutMs?: number },
): Promise<LatestRelease | null> {
  const response = await fetcher(LATEST_RELEASE_URL, {
    // Redirects are refused rather than followed, so no other URL is ever contacted.
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT),
    cache: "no-store",
    // No token or other identifier: an anonymous request with the app name and version.
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": options.userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel();
    throw new Error("GitHub redirected the request. Palot does not follow redirects.");
  }
  // GitHub answers 404 when the repository has no stable release yet.
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  const body = await responseText(response, MAX_RESPONSE);
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("GitHub returned a response that is not JSON.");
  }
  const parsed = v.safeParse(releaseSchema, data);
  if (!parsed.success) throw new Error("GitHub returned an unexpected release format.");
  const { tag_name: tag, draft, prerelease } = parsed.output;
  if (draft || prerelease) return null;
  const version = parseStableVersion(tag);
  return version ? { tag, version: version.join(".") } : null;
}

async function responseText(response: Response, maximum: number): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body.cancel();
    throw new Error("GitHub's response exceeds the allowed size.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("GitHub's response exceeds the allowed size.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface StoredPalotUpdate {
  enabled: boolean;
  checkedAt: number | null;
  latest: LatestRelease | null;
  dismissedVersion: string | null;
  announcedVersion: string | null;
}

const EMPTY: StoredPalotUpdate = {
  enabled: false,
  checkedAt: null,
  latest: null,
  dismissedVersion: null,
  announcedVersion: null,
};

const versionSchema = v.pipe(
  v.string(),
  v.maxLength(32),
  v.check((value) => parseStableVersion(value) !== null),
);
const storedSchema = v.object({
  enabled: v.boolean(),
  checkedAt: v.nullable(v.pipe(v.number(), v.finite())),
  latest: v.nullable(
    v.object({ tag: v.pipe(v.string(), v.maxLength(128)), version: versionSchema }),
  ),
  dismissedVersion: v.nullable(versionSchema),
  announcedVersion: v.nullable(versionSchema),
});

function readStored(value: unknown): StoredPalotUpdate {
  const parsed = v.safeParse(storedSchema, value);
  return parsed.success ? parsed.output : EMPTY;
}

export interface PalotUpdateDependencies {
  channel: PalotBuildChannel;
  currentVersion: string;
  store: { read(): unknown; write(value: StoredPalotUpdate): void };
  fetch: typeof globalThis.fetch;
  now: () => number;
  timeoutMs?: number;
}

function defaults(): PalotUpdateDependencies {
  // Constructed lazily, after index.ts sets the worktree/E2E userData directory.
  const store = new Store<{ state: StoredPalotUpdate }>({
    name: "palot-update",
    cwd: app.getPath("userData"),
  });
  return {
    channel: resolveBuildIdentity({
      development: !app.isPackaged,
      configuredChannel: __PALOT_BUILD_CHANNEL__,
    }).channel,
    currentVersion: app.getVersion(),
    store: { read: () => store.get("state"), write: (value) => store.set("state", value) },
    fetch: globalThis.fetch,
    now: Date.now,
  };
}

function releaseUrl(tag: string): string {
  return `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;
}

/** Main-owned, off by default. Never downloads or installs a release. */
export class PalotUpdateChecker {
  private readonly deps: PalotUpdateDependencies;
  private state: StoredPalotUpdate;
  private checking: Promise<PalotUpdateStatus> | null = null;
  private lastAttemptAt: number | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(dependencies?: PalotUpdateDependencies) {
    this.deps = dependencies ?? defaults();
    this.state = readStored(this.deps.store.read());
  }

  private get supported(): boolean {
    return checksUpdates(this.deps.channel, this.deps.currentVersion);
  }

  private write(next: StoredPalotUpdate) {
    this.deps.store.write(next);
    this.state = next;
  }

  private available(): PalotUpdateRelease | null {
    const latest = this.state.latest;
    if (!this.state.enabled || !this.supported || !latest) return null;
    if (!isNewerVersion(latest.version, this.deps.currentVersion)) return null;
    return { version: latest.version, url: releaseUrl(latest.tag) };
  }

  status(): PalotUpdateStatus {
    return {
      supported: this.supported,
      enabled: this.state.enabled,
      currentVersion: this.deps.currentVersion,
      checkedAt: this.state.checkedAt,
      available: this.available(),
      dismissedVersion: this.state.dismissedVersion,
    };
  }

  setEnabled(enabled: boolean): PalotUpdateStatus {
    this.write({ ...this.state, enabled });
    return this.status();
  }

  dismiss(version: string): PalotUpdateStatus {
    if (!parseStableVersion(version)) throw new Error("Invalid Palot version.");
    this.write({ ...this.state, dismissedVersion: version });
    return this.status();
  }

  /** "Check now": the user sees the result in About, so it is not announced again. */
  async check(): Promise<PalotUpdateStatus> {
    const status = await this.request();
    if (status.available) this.write({ ...this.state, announcedVersion: status.available.version });
    return status;
  }

  takeAnnouncement(): PalotUpdateRelease | null {
    const available = this.available();
    if (
      !available ||
      available.version === this.state.dismissedVersion ||
      available.version === this.state.announcedVersion
    )
      return null;
    this.write({ ...this.state, announcedVersion: available.version });
    return available;
  }

  /** Checks at most once a day while enabled: shortly after launch, then hourly when due. */
  start(): void {
    if (this.timers.length) return;
    const tick = () => {
      if (!this.due()) return;
      this.request().catch((error: unknown) =>
        log.warn("Palot update check failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    this.timers = [setTimeout(tick, STARTUP_DELAY), setInterval(tick, TICK)];
    for (const timer of this.timers) timer.unref?.();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  due(): boolean {
    if (!this.state.enabled || !this.supported || this.checking) return false;
    // Failed attempts count too, so an unreachable GitHub is not retried every hour.
    const last = Math.max(this.state.checkedAt ?? 0, this.lastAttemptAt ?? 0);
    return this.deps.now() - last >= DAY;
  }

  private request(): Promise<PalotUpdateStatus> {
    if (!this.supported) return Promise.reject(new Error("Update checks cover stable releases."));
    if (!this.state.enabled) return Promise.reject(new Error("Update checks are turned off."));
    if (this.checking) return this.checking;
    this.lastAttemptAt = this.deps.now();
    const promise = fetchLatestRelease(this.deps.fetch, {
      userAgent: `Palot/${this.deps.currentVersion}`,
      ...(this.deps.timeoutMs === undefined ? {} : { timeoutMs: this.deps.timeoutMs }),
    })
      .then((latest) => {
        this.write({ ...this.state, latest, checkedAt: this.deps.now() });
        return this.status();
      })
      .catch((error: unknown) => {
        throw new Error(
          `Could not check for Palot updates: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      })
      .finally(() => {
        if (this.checking === promise) this.checking = null;
      });
    this.checking = promise;
    return promise;
  }
}

let checker: PalotUpdateChecker | undefined;
export function getPalotUpdateChecker(): PalotUpdateChecker {
  return (checker ??= new PalotUpdateChecker());
}

const enabledSchema = v.boolean();

/** Registers through the caller's trusted registrar and starts the daily schedule. */
export function registerPalotUpdateIpc(
  register: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => void,
): void {
  const updates = getPalotUpdateChecker();
  register(PALOT_UPDATE_IPC_CHANNELS.palotUpdateStatus, () => updates.status());
  register(PALOT_UPDATE_IPC_CHANNELS.palotUpdateSetEnabled, (_event, input) =>
    updates.setEnabled(v.parse(enabledSchema, input)),
  );
  register(PALOT_UPDATE_IPC_CHANNELS.palotUpdateCheck, () => updates.check());
  register(PALOT_UPDATE_IPC_CHANNELS.palotUpdateDismiss, (_event, input) =>
    updates.dismiss(v.parse(versionSchema, input)),
  );
  register(PALOT_UPDATE_IPC_CHANNELS.palotUpdateTakeAnnouncement, () => updates.takeAnnouncement());
  updates.start();
}
