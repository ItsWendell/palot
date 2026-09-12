// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { OpenCodeInstallMethod } from "../shared/opencode-installation-contract";
import type { OpenCodeReleaseStatus } from "../shared/opencode-release-contract";
import {
  localOpenCodeCandidatePaths,
  OpenCodeInstallations,
  type OpenCodeInstallationDependencies,
} from "./opencode-local-installations";

vi.mock("electron", () => ({
  app: {
    getPath: () => {
      throw new Error("Inject isolated preferences");
    },
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    constructor() {
      throw new Error("Inject isolated preferences");
    }
  },
}));

function harness(
  options: {
    saved?: unknown;
    versions?: Record<string, string>;
    override?: string;
    aliases?: Record<string, string>;
  } = {},
) {
  let saved = options.saved;
  const versions: Record<string, string> = options.versions ?? { "/usr/bin/opencode": "2.0.2" };
  const aliases: Record<string, string> = options.aliases ?? {};
  const release: OpenCodeReleaseStatus = {
    channel: "stable",
    bundledVersion: "2.0.2",
    preparedVersion: null,
    checkedAt: 1,
    offer: {
      version: "2.0.3",
      channel: "stable",
      tested: false,
      requiresConfirmation: false,
      size: 100,
    },
  };
  const deps: OpenCodeInstallationDependencies = {
    preferences: {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    candidates: () => [...Object.keys(aliases), ...Object.keys(versions)],
    override: () => options.override,
    excludedDirectories: ["/palot/resources", "/palot/data"],
    realpath: async (file) => aliases[file] ?? file,
    executable: async (file) => file in versions,
    run: vi.fn(async (file, args) => {
      if (args[0] === "--version")
        return { code: 0, stdout: `opencode v${versions[file]}`, stderr: "" };
      versions[file] = args[1];
      return { code: 0, stdout: "", stderr: "" };
    }),
    releaseStatus: () => release,
  };
  const manager = new OpenCodeInstallations(deps);
  return { manager, deps, versions, aliases, release, saved: () => saved };
}

describe("local OpenCode installations", () => {
  it("does not execute on construction, cached status, or preference changes", () => {
    const h = harness();
    expect(h.manager.status()).toMatchObject({ preference: "installed", installations: [] });
    h.manager.setPreference("palot");
    expect(h.manager.status().preference).toBe("palot");
    expect(h.deps.run).not.toHaveBeenCalled();
  });

  it("only discovers absolute paths without invoking shell or package-manager lookup", () => {
    const candidates = localOpenCodeCandidatePaths(
      { PATH: ":.:./node_modules/.bin:/usr/bin" },
      "/home/alice",
      "linux",
    );
    expect(candidates.slice(0, 2)).toEqual(["/usr/bin/opencode", "/usr/bin/opencode2"]);
    expect(candidates).toContain("/home/alice/.opencode/bin/opencode");
    expect(candidates.some((candidate) => candidate.includes("node_modules"))).toBe(false);
  });

  it("deduplicates canonical aliases, excludes app-owned files, and recognizes V2 compatibility", async () => {
    const h = harness({
      versions: {
        "/usr/bin/opencode": "2.0.2",
        "/old/opencode": "1.4.0",
        "/beta/opencode": "0.0.0-beta-19507",
        "/new-beta/opencode": "0.0.0-beta-99999",
        "/palot/data/opencode": "2.0.3",
        "/palot/resources/opencode": "2.0.3",
      },
      aliases: {
        "/usr/bin/opencode2": "/usr/bin/opencode",
        "/other/opencode": "/palot/data/opencode",
      },
    });
    const result = await h.manager.inspect();
    expect(result.installations.map((entry) => [entry.version, entry.compatible])).toEqual([
      ["2.0.2", true],
      ["1.4.0", false],
      ["0.0.0-beta-19507", true],
      ["0.0.0-beta-99999", false],
    ]);
    expect(
      vi
        .mocked(h.deps.run)
        .mock.calls.every(([, args]) => args.length === 1 && args[0] === "--version"),
    ).toBe(true);
    const cached = h.manager.status();
    cached.installations[0]!.path = "/injected";
    expect(h.manager.status().installations[0]!.path).toBe("/usr/bin/opencode");
  });

  it("preserves explicit override priority and refuses invalid overrides without falling back", async () => {
    const h = harness({
      override: "/custom/opencode",
      versions: { "/usr/bin/opencode": "2.0.2", "/custom/opencode": "2.0.1" },
    });
    await h.manager.inspect();
    expect(() => h.manager.select(h.manager.status().installations[1]!.id)).toThrow(
      "OPENCODE_BIN controls",
    );
    expect(h.manager.status().selectedID).toBe(h.manager.status().installations[0]!.id);
    expect(await h.manager.discoverPreferredBinary()).toEqual({
      path: "/custom/opencode",
      version: "2.0.1",
    });
    const invalid = harness({ override: "opencode; echo secret" });
    expect((await invalid.manager.inspect()).error).toContain("OPENCODE_BIN");
    await expect(invalid.manager.discoverPreferredBinary()).rejects.toThrow("OPENCODE_BIN");
    invalid.manager.setPreference("palot");
    expect(await invalid.manager.discoverPreferredBinary()).toBeNull();
  });

  it("prefers selection, persists it, and refuses missing or changed selected installations", async () => {
    const h = harness({
      versions: { "/usr/bin/opencode": "2.0.2", "/home/alice/.bun/bin/opencode": "2.0.1" },
    });
    const inspected = await h.manager.inspect();
    h.manager.select(inspected.installations[1]!.id);
    expect(await h.manager.discoverPreferredBinary()).toEqual({
      path: "/home/alice/.bun/bin/opencode",
      version: "2.0.1",
    });
    h.versions["/home/alice/.bun/bin/opencode"] = "2.0.3";
    await expect(h.manager.discoverPreferredBinary()).rejects.toThrow("changed");
    delete h.versions["/home/alice/.bun/bin/opencode"];
    await h.manager.inspect();
    await expect(h.manager.discoverPreferredBinary()).rejects.toThrow("no longer available");
    expect(new OpenCodeInstallations(h.deps).status().selectedID).toBe(
      inspected.installations[1]!.id,
    );
  });

  it("deduplicates concurrent inspection and bounds candidates and process concurrency", async () => {
    const h = harness({
      versions: Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [`/bin-${index}/opencode`, "2.0.2"]),
      ),
    });
    let active = 0;
    let maximum = 0;
    h.deps.run = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return { code: 0, stdout: "2.0.2", stderr: "" };
    });
    const first = h.manager.inspect();
    expect(h.manager.inspect()).toBe(first);
    expect((await first).installations).toHaveLength(32);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(h.deps.run).toHaveBeenCalledTimes(32);
  });

  it.each<OpenCodeInstallMethod>(["auto", "npm", "bun", "pnpm", "yarn", "curl"])(
    "uses the official exact-version upgrade command for %s without service commands",
    async (method) => {
      const h = harness();
      const id = (await h.manager.inspect()).installations[0]!.id;
      const result = await h.manager.upgrade({
        id,
        currentVersion: "2.0.2",
        version: "2.0.3",
        method,
      });
      expect(result.installations[0]!.version).toBe("2.0.3");
      expect(vi.mocked(h.deps.run).mock.calls.map(([, args]) => args)).toEqual([
        ["--version"],
        ["--version"],
        ["upgrade", "2.0.3", ...(method === "auto" ? [] : ["--method", method])],
        ["--version"],
      ]);
      expect(vi.mocked(h.deps.run).mock.calls[2]![2]).toEqual({
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
      });
    },
  );

  it("rejects unknown/path-shaped IDs without executing them", async () => {
    const h = harness();
    await h.manager.inspect();
    vi.mocked(h.deps.run).mockClear();
    expect(() => h.manager.select("/tmp/opencode")).toThrow("no longer available");
    await expect(
      h.manager.upgrade({
        id: "/tmp/opencode",
        currentVersion: "2.0.2",
        version: "2.0.3",
        method: "auto",
      }),
    ).rejects.toThrow("no longer available");
    expect(h.deps.run).not.toHaveBeenCalled();
  });

  it.each([
    "1.2.3",
    "3.0.0",
    "https://evil/installer",
    "../../opencode",
    "2.0.3; touch /tmp/bad",
    "2.0.3\n",
  ])("rejects unsupported or injected targets even if offered: %s", async (version) => {
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    h.release.offer!.version = version;
    await expect(
      h.manager.upgrade({
        id,
        currentVersion: "2.0.2",
        version,
        method: "auto",
        allowUntested: true,
      }),
    ).rejects.toThrow("OpenCode 2");
    expect(h.deps.run).toHaveBeenCalledTimes(1);
  });

  it("rejects V1 existing runtimes, unsupported methods, and stale offers", async () => {
    const old = harness({ versions: { "/usr/bin/opencode": "1.0.0" } });
    const oldID = (await old.manager.inspect()).installations[0]!.id;
    await expect(
      old.manager.upgrade({ id: oldID, currentVersion: "1.0.0", version: "2.0.3", method: "auto" }),
    ).rejects.toThrow("compatible existing");
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    await expect(
      h.manager.upgrade({
        id,
        currentVersion: "2.0.2",
        version: "2.0.3",
        method: "sudo" as OpenCodeInstallMethod,
      }),
    ).rejects.toThrow("Unsupported");
    await expect(
      h.manager.upgrade({ id, currentVersion: "2.0.2", version: "2.0.4", method: "auto" }),
    ).rejects.toThrow("release changed");
    h.release.channel = "beta";
    await expect(
      h.manager.upgrade({ id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" }),
    ).rejects.toThrow("release changed");
    expect(h.deps.run).toHaveBeenCalledTimes(1);
  });

  it("requires exact-offer consent for unreviewed Beta but not reviewed Beta", async () => {
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    h.release.channel = "beta";
    Object.assign(h.release.offer!, { channel: "beta", version: "0.0.0-beta-99999" });
    await expect(
      h.manager.upgrade({
        id,
        currentVersion: "2.0.2",
        version: "0.0.0-beta-99999",
        method: "auto",
      }),
    ).rejects.toThrow("Confirm this exact");
    h.release.offer!.version = "0.0.0-beta-99998";
    await expect(
      h.manager.upgrade({
        id,
        currentVersion: "2.0.2",
        version: "0.0.0-beta-99999",
        method: "auto",
        allowUntested: true,
      }),
    ).rejects.toThrow("release changed");
    h.release.offer!.version = "0.0.0-beta-19507";
    expect(
      (
        await h.manager.upgrade({
          id,
          currentVersion: "2.0.2",
          version: "0.0.0-beta-19507",
          method: "auto",
        })
      ).installations[0]!.version,
    ).toBe("0.0.0-beta-19507");
    h.release.offer!.version = "0.0.0-beta-99999";
    expect(
      (
        await h.manager.upgrade({
          id,
          currentVersion: "0.0.0-beta-19507",
          version: "0.0.0-beta-99999",
          method: "auto",
          allowUntested: true,
        })
      ).installations[0]!.version,
    ).toBe("0.0.0-beta-99999");
  });

  it("rejects an older dialog's installed-version consent after another inspection refreshes the same ID", async () => {
    const h = harness({ versions: { "/usr/bin/opencode": "2.0.1" } });
    h.release.offer!.version = "2.0.2";
    const dialogInstallation = (await h.manager.inspect()).installations[0]!;
    h.versions[dialogInstallation.path] = "2.0.3";
    const refreshed = (await h.manager.inspect()).installations[0]!;
    expect(refreshed.id).toBe(dialogInstallation.id);
    expect(refreshed.version).toBe("2.0.3");
    vi.mocked(h.deps.run).mockClear();

    await expect(
      h.manager.upgrade({
        id: dialogInstallation.id,
        currentVersion: dialogInstallation.version,
        version: "2.0.2",
        method: "auto",
      }),
    ).rejects.toThrow("confirm the current version before updating");
    expect(h.deps.run).not.toHaveBeenCalled();
    expect(h.versions[dialogInstallation.path]).toBe("2.0.3");
  });

  it.each(["version", "symlink", "offer"])(
    "rechecks %s before updating, refusing stale inspection",
    async (change) => {
      const h = harness({ aliases: { "/usr/local/bin/opencode": "/usr/bin/opencode" } });
      const id = (await h.manager.inspect()).installations[0]!.id;
      if (change === "version") h.versions["/usr/bin/opencode"] = "2.0.1";
      if (change === "symlink") h.aliases["/usr/local/bin/opencode"] = "/different/opencode";
      if (change === "offer") {
        const run = h.deps.run;
        h.deps.run = vi.fn(async (...args: Parameters<OpenCodeInstallationDependencies["run"]>) => {
          h.release.offer = null;
          return run(...args);
        });
      }
      await expect(
        h.manager.upgrade({ id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" }),
      ).rejects.toThrow("changed");
      expect(vi.mocked(h.deps.run).mock.calls.some(([, args]) => args[0] === "upgrade")).toBe(
        false,
      );
    },
  );

  it("deduplicates updates and blocks selection/preference changes or competing updates", async () => {
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = h.deps.run;
    h.deps.run = vi.fn(async (...args: Parameters<OpenCodeInstallationDependencies["run"]>) => {
      if (args[1][0] === "upgrade") await wait;
      return run(...args);
    });
    const input = { id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" as const };
    const pending = h.manager.upgrade(input);
    expect(h.manager.upgrade(input)).toBe(pending);
    expect(h.manager.inspect()).toBe(pending);
    expect(() => h.manager.setPreference("palot")).toThrow("in progress");
    expect(() => h.manager.select(id)).toThrow("in progress");
    await expect(h.manager.upgrade({ ...input, method: "npm" })).rejects.toThrow("in progress");
    await expect(h.manager.upgrade({ ...input, currentVersion: "2.0.1" })).rejects.toThrow(
      "in progress",
    );
    await expect(h.manager.discoverPreferredBinary()).rejects.toThrow("in progress");
    release();
    await pending;
    h.manager.setPreference("palot");
    expect(
      vi.mocked(h.deps.run).mock.calls.filter(([, args]) => args[0] === "upgrade"),
    ).toHaveLength(1);
  });

  it("does not claim success when upstream updated the wrong installation", async () => {
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    h.deps.run = vi.fn(async () => ({ code: 0, stdout: "2.0.2", stderr: "" }));
    await expect(
      h.manager.upgrade({ id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" }),
    ).rejects.toThrow("Another installation");
    expect(h.manager.status().installations[0]!.version).toBe("2.0.2");
    expect(h.manager.status().error).toContain("does not report");
  });

  it("never exposes subprocess output containing credentials on failures", async () => {
    const h = harness();
    const id = (await h.manager.inspect()).installations[0]!.id;
    const run = h.deps.run;
    h.deps.run = vi.fn(async (...args: Parameters<OpenCodeInstallationDependencies["run"]>) =>
      args[1][0] === "upgrade"
        ? {
            code: 1,
            stdout: "secret-token",
            stderr: "https://user:password@registry.invalid Authorization: Bearer secret-token",
          }
        : run(...args),
    );
    const failure = await h.manager
      .upgrade({ id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" })
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("permissions and network");
    expect(String(failure)).not.toMatch(/secret-token|password|registry.invalid/);
  });

  it("keeps approved installed Beta launchable with exact installation/version/SDK consent", async () => {
    const h = harness({ versions: { "/usr/bin/opencode": "2.0.2", "/other/opencode": "2.0.1" } });
    const result = await h.manager.inspect();
    const id = result.installations[0]!.id;
    h.manager.select(id);
    h.release.channel = "beta";
    Object.assign(h.release.offer!, { version: "0.0.0-beta-99999", channel: "beta" });
    await h.manager.upgrade({
      id,
      currentVersion: "2.0.2",
      version: "0.0.0-beta-99999",
      method: "auto",
      allowUntested: true,
    });
    expect(h.manager.acceptsInstalledVersion("0.0.0-beta-99999")).toBe(true);
    expect(h.manager.acceptsInstalledVersion("0.0.0-beta-99998")).toBe(false);
    expect(await h.manager.discoverPreferredBinary()).toEqual({
      path: "/usr/bin/opencode",
      version: "0.0.0-beta-99999",
    });
    const restored = new OpenCodeInstallations(h.deps);
    expect((await restored.discoverPreferredBinary())?.version).toBe("0.0.0-beta-99999");
    h.manager.select(result.installations[1]!.id);
    expect(h.manager.acceptsInstalledVersion("0.0.0-beta-99999")).toBe(false);
    h.manager.select(id);
    h.manager.setPreference("palot");
    expect(h.manager.acceptsInstalledVersion("0.0.0-beta-99999")).toBe(false);
    const saved = h.saved() as { accepted: { sdkVersion: string } };
    saved.accepted.sdkVersion = "obsolete-sdk";
    const expired = new OpenCodeInstallations(h.deps);
    expired.setPreference("installed");
    await expect(expired.discoverPreferredBinary()).rejects.toThrow("incompatible");
  });

  it("never adopts an existing unreviewed Beta without consent", async () => {
    const h = harness({ versions: { "/beta/opencode": "0.0.0-beta-99999" } });
    const id = (await h.manager.inspect()).installations[0]!.id;
    expect(h.manager.acceptsInstalledVersion("0.0.0-beta-99999")).toBe(false);
    expect(await h.manager.discoverPreferredBinary()).toBeNull();
    h.manager.select(id);
    await expect(h.manager.discoverPreferredBinary()).rejects.toThrow("incompatible");
  });

  it("preserves approved selection when an official upgrade retargets its symlink", async () => {
    const h = harness({
      aliases: { "/usr/local/bin/opencode": "/package-v1/opencode" },
      versions: { "/package-v1/opencode": "2.0.2" },
    });
    const id = (await h.manager.inspect()).installations[0]!.id;
    h.manager.select(id);
    const run = h.deps.run;
    h.deps.run = vi.fn(async (...args: Parameters<OpenCodeInstallationDependencies["run"]>) => {
      if (args[1][0] !== "upgrade") return run(...args);
      h.aliases["/usr/local/bin/opencode"] = "/package-v2/opencode";
      h.versions["/package-v2/opencode"] = "2.0.3";
      delete h.versions["/package-v1/opencode"];
      return { code: 0, stdout: "", stderr: "" };
    });
    const updated = await h.manager.upgrade({
      id,
      currentVersion: "2.0.2",
      version: "2.0.3",
      method: "pnpm",
    });
    expect(updated.selectedID).not.toBe(id);
    expect(await h.manager.discoverPreferredBinary()).toEqual({
      path: "/package-v2/opencode",
      version: "2.0.3",
    });
  });

  it("does not let missing PATH entries exhaust the executable probe budget", async () => {
    const h = harness();
    h.deps.candidates = () => [
      ...Array.from({ length: 60 }, (_, index) => `/missing-${index}/opencode`),
      "/usr/bin/opencode",
    ];
    expect((await h.manager.inspect()).installations[0]!.version).toBe("2.0.2");
    expect(h.deps.run).toHaveBeenCalledTimes(1);
  });

  it.each(["timedOut", "outputExceeded"] as const)(
    "surfaces actionable %s failures without raw subprocess details",
    async (failure) => {
      const h = harness();
      const id = (await h.manager.inspect()).installations[0]!.id;
      const run = h.deps.run;
      h.deps.run = vi.fn(async (...args: Parameters<OpenCodeInstallationDependencies["run"]>) =>
        args[1][0] === "upgrade"
          ? { code: 1, stdout: "secret", stderr: "password", [failure]: true }
          : run(...args),
      );
      await expect(
        h.manager.upgrade({ id, currentVersion: "2.0.2", version: "2.0.3", method: "auto" }),
      ).rejects.toThrow(failure === "timedOut" ? "five minutes" : "output limit");
      h.manager.setPreference("palot");
    },
  );
});
