// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LATEST_RELEASE_URL,
  PalotUpdateChecker,
  checksUpdates,
  fetchLatestRelease,
  isNewerVersion,
  type PalotUpdateDependencies,
  type StoredPalotUpdate,
} from "./palot-update-check";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error("Tests must inject the store.");
    }),
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    constructor() {
      throw new Error("Tests must inject the store.");
    }
  },
}));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

afterEach(() => vi.useRealTimers());

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, ...init });
}

function release(tag: string, extra: Record<string, unknown> = {}) {
  return { tag_name: tag, draft: false, prerelease: false, html_url: "ignored", ...extra };
}

describe("version comparison", () => {
  it("compares stable versions numerically", () => {
    expect(isNewerVersion("0.24.0", "0.23.0")).toBe(true);
    expect(isNewerVersion("v0.23.1", "0.23.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.23.0", "0.23.0")).toBe(false);
    expect(isNewerVersion("0.22.9", "0.23.0")).toBe(false);
  });

  it("ignores prerelease and malformed versions", () => {
    expect(isNewerVersion("0.24.0-beta.1", "0.23.0")).toBe(false);
    expect(isNewerVersion("0.24.0-nightly.20261104125353", "0.23.0")).toBe(false);
    expect(isNewerVersion("latest", "0.23.0")).toBe(false);
    expect(isNewerVersion("0.24", "0.23.0")).toBe(false);
    expect(isNewerVersion("01.0.0", "0.23.0")).toBe(false);
  });

  it("checks only stable builds with a stable version", () => {
    expect(checksUpdates("stable", "0.23.0")).toBe(true);
    expect(checksUpdates("nightly", "0.22.0-nightly.20261104125353")).toBe(false);
    expect(checksUpdates("dev", "0.23.0")).toBe(false);
    expect(checksUpdates("beta", "0.23.0")).toBe(false);
    expect(checksUpdates("stable", "0.23.0-test")).toBe(false);
  });
});

describe("fetchLatestRelease", () => {
  it("requests only the latest-release endpoint, anonymously, without following redirects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(release("v0.24.0")));
    await expect(fetchLatestRelease(fetcher, { userAgent: "Palot/0.23.0" })).resolves.toEqual({
      tag: "v0.24.0",
      version: "0.24.0",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/ItsWendell/palot/releases/latest");
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe("Palot/0.23.0");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });

  it("refuses a redirect to another host", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://example.com/latest" } }),
    );
    await expect(fetchLatestRelease(fetcher, { userAgent: "Palot/0.23.0" })).rejects.toThrow(
      /redirect/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("times out", async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(
      fetchLatestRelease(fetcher, { userAgent: "Palot/0.23.0", timeoutMs: 10 }),
    ).rejects.toThrow(/timed out|aborted/i);
  });

  it("rejects HTTP errors but treats 404 as no stable release", async () => {
    await expect(
      fetchLatestRelease(async () => json({ message: "rate limited" }, { status: 403 }), {
        userAgent: "Palot/0.23.0",
      }),
    ).rejects.toThrow("GitHub returned HTTP 403.");
    await expect(
      fetchLatestRelease(async () => json({ message: "Not Found" }, { status: 404 }), {
        userAgent: "Palot/0.23.0",
      }),
    ).resolves.toBeNull();
  });

  it("rejects oversized responses, by header and by streamed size", async () => {
    await expect(
      fetchLatestRelease(
        async () => json(release("v0.24.0"), { headers: { "content-length": "2000000" } }),
        { userAgent: "Palot/0.23.0" },
      ),
    ).rejects.toThrow(/allowed size/);
    const large = JSON.stringify(release("v0.24.0", { body: "x".repeat(1024 * 1024) }));
    await expect(
      fetchLatestRelease(async () => new Response(large), { userAgent: "Palot/0.23.0" }),
    ).rejects.toThrow(/allowed size/);
  });

  it("rejects the wrong shape and ignores prerelease or malformed tags", async () => {
    const options = { userAgent: "Palot/0.23.0" };
    await expect(
      fetchLatestRelease(async () => json([release("v1.0.0")]), options),
    ).rejects.toThrow(/unexpected release format/);
    await expect(fetchLatestRelease(async () => new Response("<html>"), options)).rejects.toThrow(
      /not JSON/,
    );
    await expect(
      fetchLatestRelease(async () => json(release("v1.0.0", { prerelease: true })), options),
    ).resolves.toBeNull();
    await expect(
      fetchLatestRelease(async () => json(release("v1.0.0-beta.1")), options),
    ).resolves.toBeNull();
    await expect(
      fetchLatestRelease(async () => json(release("nightly")), options),
    ).resolves.toBeNull();
  });
});

function checker(overrides: Partial<PalotUpdateDependencies> = {}, initial?: StoredPalotUpdate) {
  let saved: unknown = initial;
  let now = Date.UTC(2026, 10, 10);
  const fetcher = vi.fn<typeof fetch>(async () => json(release("v0.24.0")));
  const updates = new PalotUpdateChecker({
    channel: "stable",
    currentVersion: "0.23.0",
    store: { read: () => saved, write: (value) => (saved = structuredClone(value)) },
    fetch: fetcher,
    now: () => now,
    ...overrides,
  });
  return {
    updates,
    fetcher,
    saved: () => saved as StoredPalotUpdate,
    advance: (ms: number) => (now += ms),
  };
}

/** Lets the launch-time scheduled check run, as it does about a minute after start. */
async function scheduledCheck(updates: PalotUpdateChecker) {
  vi.useFakeTimers();
  updates.start();
  await vi.advanceTimersByTimeAsync(60 * 1000);
  updates.stop();
  vi.useRealTimers();
}

describe("PalotUpdateChecker", () => {
  it("is off by default and never contacts GitHub while off", async () => {
    const { updates, fetcher } = checker();
    expect(updates.status()).toMatchObject({ enabled: false, supported: true, available: null });
    await expect(updates.check()).rejects.toThrow(/turned off/);
    expect(updates.due()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never checks on Nightly or Dev builds", async () => {
    for (const build of [
      { channel: "nightly" as const, currentVersion: "0.22.0-nightly.20261104125353" },
      { channel: "dev" as const, currentVersion: "0.23.0" },
    ]) {
      const { updates, fetcher } = checker(build);
      updates.setEnabled(true);
      expect(updates.status().supported).toBe(false);
      expect(updates.due()).toBe(false);
      await expect(updates.check()).rejects.toThrow(/stable releases/);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("reports a newer release, persists the check, and announces each version once", async () => {
    const { updates, saved } = checker();
    updates.setEnabled(true);
    expect(updates.due()).toBe(true);
    // A scheduled check found it: the first window to ask shows the toast.
    await scheduledCheck(updates);
    expect(updates.status().available).toEqual({
      version: "0.24.0",
      url: "https://github.com/ItsWendell/palot/releases/tag/v0.24.0",
    });
    expect(saved()).toMatchObject({ enabled: true, latest: { version: "0.24.0" } });
    expect(updates.takeAnnouncement()?.version).toBe("0.24.0");
    expect(updates.takeAnnouncement()).toBeNull();
    expect(updates.due()).toBe(false);
  });

  it("does not announce a version the user checked for or dismissed", async () => {
    const { updates } = checker();
    updates.setEnabled(true);
    const status = await updates.check();
    expect(status.available?.version).toBe("0.24.0");
    expect(updates.takeAnnouncement()).toBeNull();

    const other = checker();
    other.updates.setEnabled(true);
    await scheduledCheck(other.updates);
    other.updates.dismiss("0.24.0");
    expect(other.updates.takeAnnouncement()).toBeNull();
    expect(other.saved().dismissedVersion).toBe("0.24.0");
  });

  it("restores saved state and reports up to date once the app reaches that version", () => {
    const stored: StoredPalotUpdate = {
      enabled: true,
      checkedAt: 1,
      latest: { tag: "v0.24.0", version: "0.24.0" },
      dismissedVersion: null,
      announcedVersion: null,
    };
    expect(checker({}, stored).updates.status().available?.version).toBe("0.24.0");
    expect(checker({ currentVersion: "0.24.0" }, stored).updates.status().available).toBeNull();
    expect(checker({}, { ...stored, enabled: false }).updates.status().available).toBeNull();
  });

  it("waits a day after any attempt, including a failed one", async () => {
    const { updates, fetcher, advance } = checker();
    fetcher.mockResolvedValueOnce(json({}, { status: 500 }));
    updates.setEnabled(true);
    await expect(updates.check()).rejects.toThrow(
      "Could not check for Palot updates: GitHub returned HTTP 500.",
    );
    expect(updates.due()).toBe(false);
    advance(23 * 60 * 60 * 1000);
    expect(updates.due()).toBe(false);
    advance(60 * 60 * 1000);
    expect(updates.due()).toBe(true);
  });

  it("runs the scheduled check shortly after launch only when enabled", async () => {
    vi.useFakeTimers();
    const off = checker();
    off.updates.start();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(off.fetcher).not.toHaveBeenCalled();
    off.updates.stop();

    const on = checker();
    on.updates.setEnabled(true);
    on.updates.start();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(on.fetcher).toHaveBeenCalledTimes(1);
    expect(on.fetcher.mock.calls[0]![0]).toBe(LATEST_RELEASE_URL);
    on.updates.stop();
  });
});
