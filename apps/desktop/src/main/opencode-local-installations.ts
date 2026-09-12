import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { app } from "electron";
import Store from "electron-store";
import type {
  OpenCodeInstallation,
  OpenCodeInstallationStatus,
  OpenCodeInstallationUpgradeInput,
  OpenCodeRuntimePreference,
} from "../shared/opencode-installation-contract";
import type { OpenCodeReleaseStatus } from "../shared/opencode-release-contract";
import { getOpenCodeReleaseManager } from "./opencode-release-manager";
import { runOpenCodeInstallationCommand } from "./opencode-installation-process";
import {
  canContinueOpenCodeVersionMismatch,
  isStableOpenCodeV2,
  isSupportedOpenCodeVersion,
  parseOpenCodeVersionOutput,
  SUPPORTED_OPENCODE_VERSION,
} from "./opencode-version";

const MAX_CANDIDATES = 32;
const MAX_PATHS = 256;
const CONCURRENCY = 4;
const METHODS = ["auto", "npm", "bun", "pnpm", "yarn", "curl"];
interface Preferences {
  preference: OpenCodeRuntimePreference;
  selectedID: string | null;
  accepted?: { id: string; version: string; sdkVersion: string };
}
interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  outputExceeded?: boolean;
}
export interface OpenCodeInstallationDependencies {
  preferences: { read(): unknown; write(value: Preferences): void };
  /** Absolute PATH/known user paths only. The override is handled separately. */
  candidates(): string[];
  override(): string | undefined;
  excludedDirectories: string[];
  realpath(file: string): Promise<string>;
  executable(file: string): Promise<boolean>;
  run(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
  ): Promise<ProcessResult>;
  releaseStatus(): OpenCodeReleaseStatus;
}
interface Snapshot {
  installation: OpenCodeInstallation;
  source: string;
}

/** No shell lookup, package-manager queries, recursive scans, or project-relative PATH entries. */
export function localOpenCodeCandidatePaths(
  environment: NodeJS.ProcessEnv,
  home: string,
  platform: string,
): string[] {
  const directories = [
    ...(environment.PATH ?? "").split(platform === "win32" ? ";" : ":"),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".yarn", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  const names =
    platform === "win32" ? ["opencode.exe", "opencode2.exe"] : ["opencode", "opencode2"];
  return [...new Set(directories.filter((directory) => path.isAbsolute(directory)))].flatMap(
    (directory) => names.map((name) => path.join(directory, name)),
  );
}

function defaults(): OpenCodeInstallationDependencies {
  const directory = app.getPath("userData");
  const store = new Store<{ installation: Preferences }>({
    name: "opencode-installation",
    cwd: directory,
  });
  return {
    preferences: {
      read: () => store.get("installation"),
      write: (value) => store.set("installation", value),
    },
    candidates: () => localOpenCodeCandidatePaths(process.env, homedir(), process.platform),
    override: () => process.env.OPENCODE_BIN,
    excludedDirectories: [directory, process.resourcesPath, app.getAppPath()].filter(Boolean),
    realpath,
    executable: async (file) => {
      const info = await stat(file);
      if (!info.isFile()) return false;
      await access(file, constants.X_OK);
      return true;
    },
    run: runOpenCodeInstallationCommand,
    releaseStatus: () => getOpenCodeReleaseManager().status(),
  };
}

function preferences(value: unknown): Preferences {
  const record = value && typeof value === "object" ? (value as Partial<Preferences>) : {};
  const accepted = record.accepted;
  return {
    preference: record.preference === "palot" ? "palot" : "installed",
    selectedID:
      typeof record.selectedID === "string" && /^[a-f0-9]{64}$/.test(record.selectedID)
        ? record.selectedID
        : null,
    ...(accepted &&
    typeof accepted === "object" &&
    typeof accepted.id === "string" &&
    /^[a-f0-9]{64}$/.test(accepted.id) &&
    typeof accepted.version === "string" &&
    canContinueOpenCodeVersionMismatch(accepted.version) &&
    accepted.sdkVersion === SUPPORTED_OPENCODE_VERSION
      ? { accepted: { ...accepted } }
      : {}),
  };
}
function inside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

/** Local discovery and official CLI updates only. This class never operates on a service. */
export class OpenCodeInstallations {
  private readonly deps: OpenCodeInstallationDependencies;
  private preferences: Preferences;
  private snapshots: Snapshot[] = [];
  private inspected = false;
  private error: string | null = null;
  private overrideFailed = false;
  private inspecting: Promise<OpenCodeInstallationStatus> | null = null;
  private upgrading: { key: string; promise: Promise<OpenCodeInstallationStatus> } | null = null;

  constructor(dependencies?: OpenCodeInstallationDependencies) {
    this.deps = dependencies ?? defaults();
    this.preferences = preferences(this.deps.preferences.read());
  }

  status(): OpenCodeInstallationStatus {
    const override = this.deps.override();
    const overridden = override
      ? this.snapshots.find((entry) => entry.source === override)
      : undefined;
    return {
      preference: this.preferences.preference,
      selectedID: overridden?.installation.id ?? this.preferences.selectedID,
      installations: this.snapshots.map(({ installation }) => ({
        ...installation,
        ...(this.accepted(installation.id, installation.version) ? { approved: true } : {}),
      })),
      error: this.error,
    };
  }

  private accepted(id: string, version: string): boolean {
    const accepted = this.preferences.accepted;
    return (
      !!accepted &&
      accepted.id === id &&
      accepted.version === version &&
      accepted.sdkVersion === SUPPORTED_OPENCODE_VERSION &&
      canContinueOpenCodeVersionMismatch(version)
    );
  }

  /** Only the chosen local runtime may reuse exact-version consent, never a remote service. */
  acceptsInstalledVersion(version: string): boolean {
    if (this.preferences.preference !== "installed" || this.overrideFailed) return false;
    const override = this.deps.override();
    const snapshot = override
      ? this.snapshots.find((entry) => entry.source === override)
      : this.preferences.selectedID
        ? this.snapshots.find(({ installation }) => installation.id === this.preferences.selectedID)
        : this.snapshots.find(
            ({ installation }) =>
              installation.compatible || this.accepted(installation.id, installation.version),
          );
    return (
      !!snapshot &&
      snapshot.installation.version === version &&
      this.accepted(snapshot.installation.id, version)
    );
  }

  private assertIdle(): void {
    if (this.upgrading) throw new Error("An OpenCode installation update is already in progress.");
  }

  setPreference(preference: OpenCodeRuntimePreference): OpenCodeInstallationStatus {
    this.assertIdle();
    if (preference !== "installed" && preference !== "palot")
      throw new Error("Invalid OpenCode runtime preference.");
    this.save({ ...this.preferences, preference });
    return this.status();
  }

  select(id: string): OpenCodeInstallationStatus {
    this.assertIdle();
    const selected = this.known(id);
    const override = this.deps.override();
    if (override && selected.source !== override)
      throw new Error(
        "OPENCODE_BIN controls the local executable. Change or remove it before selecting another installation.",
      );
    this.save({ ...this.preferences, selectedID: id });
    return this.status();
  }

  private save(value: Preferences): void {
    this.deps.preferences.write(value);
    this.preferences = value;
  }

  private known(id: string): Snapshot {
    const snapshot = this.snapshots.find(({ installation }) => installation.id === id);
    if (!snapshot)
      throw new Error(
        "This OpenCode installation is no longer available. Inspect local installations and select it again.",
      );
    return snapshot;
  }

  private async roots(): Promise<string[]> {
    return Promise.all(
      this.deps.excludedDirectories.map(async (directory) => {
        try {
          return await this.deps.realpath(directory);
        } catch {
          return path.resolve(directory);
        }
      }),
    );
  }

  private async canonical(source: string, roots: string[]): Promise<string | null> {
    if (
      !path.isAbsolute(source) ||
      source.includes("\0") ||
      roots.some((root) => inside(source, root))
    )
      return null;
    try {
      const canonical = await this.deps.realpath(source);
      if (
        !path.isAbsolute(canonical) ||
        roots.some((root) => inside(canonical, root)) ||
        !(await this.deps.executable(canonical))
      )
        return null;
      return canonical;
    } catch {
      return null;
    }
  }

  private async probe(file: string): Promise<string | null> {
    try {
      const result = await this.deps.run(file, ["--version"], {
        timeout: 5_000,
        maxBuffer: 16 * 1024,
      });
      return result.code === 0 ? parseOpenCodeVersionOutput(result.stdout) : null;
    } catch {
      return null;
    }
  }

  inspect(): Promise<OpenCodeInstallationStatus> {
    if (this.upgrading) return this.upgrading.promise;
    if (this.inspecting) return this.inspecting;
    const pending = this.scan().finally(() => {
      if (this.inspecting === pending) this.inspecting = null;
    });
    this.inspecting = pending;
    return pending;
  }

  private async scan(): Promise<OpenCodeInstallationStatus> {
    const roots = await this.roots();
    const override = this.deps.override();
    const candidates = [
      ...new Set([...(override ? [override] : []), ...this.deps.candidates()]),
    ].slice(0, MAX_PATHS);
    const canonical = await Promise.all(candidates.map((source) => this.canonical(source, roots)));
    const unique = candidates
      .flatMap((source, index) => {
        const file = canonical[index];
        return file && canonical.indexOf(file) === index ? [{ source, file }] : [];
      })
      .slice(0, MAX_CANDIDATES);
    const snapshots: (Snapshot | null)[] = Array.from({ length: unique.length }, () => null);
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < unique.length) {
          const index = next++;
          const candidate = unique[index]!;
          const version = await this.probe(candidate.file);
          if (version)
            snapshots[index] = {
              source: candidate.source,
              installation: {
                id: createHash("sha256").update(candidate.file).digest("hex"),
                path: candidate.file,
                version,
                compatible: isSupportedOpenCodeVersion(version),
              },
            };
        }
      }),
    );
    this.snapshots = snapshots.filter((snapshot): snapshot is Snapshot => snapshot !== null);
    this.inspected = true;
    this.overrideFailed =
      !!override &&
      !this.snapshots.some(
        (snapshot) =>
          snapshot.source === override &&
          (snapshot.installation.compatible ||
            this.accepted(snapshot.installation.id, snapshot.installation.version)),
      );
    this.error = this.overrideFailed
      ? "OPENCODE_BIN does not identify an accessible, compatible OpenCode 2 installation. Fix or remove the override before starting a local service."
      : null;
    if (
      this.preferences.selectedID &&
      !this.snapshots.some(({ installation }) => installation.id === this.preferences.selectedID)
    ) {
      this.error ??=
        "The selected OpenCode installation is missing. Inspect local installations and select another runtime explicitly.";
    }
    return this.status();
  }

  async discoverPreferredBinary(): Promise<{ path: string; version: string } | null> {
    this.assertIdle();
    if (this.preferences.preference === "palot") return null;
    if (!this.inspected || this.inspecting) await this.inspect();
    this.assertIdle();
    if (this.overrideFailed) throw new Error(this.error ?? "Invalid OPENCODE_BIN override.");
    const override = this.deps.override();
    const snapshot = override
      ? this.snapshots.find((entry) => entry.source === override)
      : this.preferences.selectedID
        ? this.known(this.preferences.selectedID)
        : this.snapshots.find(
            ({ installation }) =>
              installation.compatible || this.accepted(installation.id, installation.version),
          );
    if (!snapshot) {
      if (override) throw new Error("OPENCODE_BIN changed. Inspect local installations again.");
      return null;
    }
    const current = await this.canonical(snapshot.source, await this.roots());
    if (
      !current ||
      current !== snapshot.installation.path ||
      (await this.probe(current)) !== snapshot.installation.version ||
      (!snapshot.installation.compatible &&
        !this.accepted(snapshot.installation.id, snapshot.installation.version))
    ) {
      throw new Error(
        "The selected OpenCode installation changed or is incompatible. Inspect local installations and select it again.",
      );
    }
    return { path: current, version: snapshot.installation.version };
  }

  upgrade(input: OpenCodeInstallationUpgradeInput): Promise<OpenCodeInstallationStatus> {
    input = { ...input };
    const key = JSON.stringify([
      input.id,
      input.currentVersion,
      input.version,
      input.method,
      input.allowUntested === true,
    ]);
    if (this.upgrading)
      return this.upgrading.key === key
        ? this.upgrading.promise
        : Promise.reject(new Error("An OpenCode installation update is already in progress."));
    if (this.inspecting)
      return Promise.reject(
        new Error("Wait for local installation inspection to finish before updating."),
      );
    const pending = this.performUpgrade(input).finally(() => {
      if (this.upgrading?.promise === pending) this.upgrading = null;
    });
    this.upgrading = { key, promise: pending };
    return pending;
  }

  private validateOffer(input: OpenCodeInstallationUpgradeInput): void {
    const status = this.deps.releaseStatus();
    const offer = status.offer;
    if (!offer || offer.version !== input.version || offer.channel !== status.channel)
      throw new Error(
        "The checked OpenCode release changed. Check for updates and confirm the current release again.",
      );
    if (!METHODS.includes(input.method))
      throw new Error("Unsupported OpenCode installation method.");
    if (
      typeof input.version !== "string" ||
      input.version.length > 80 ||
      !canContinueOpenCodeVersionMismatch(input.version) ||
      (offer.channel === "stable" && !isStableOpenCodeV2(input.version))
    )
      throw new Error(
        "Only official OpenCode 2 stable or supported Beta releases can be installed.",
      );
    if (!isSupportedOpenCodeVersion(input.version) && input.allowUntested !== true)
      throw new Error("Confirm this exact untested OpenCode Beta release before updating.");
  }

  private async performUpgrade(
    input: OpenCodeInstallationUpgradeInput,
  ): Promise<OpenCodeInstallationStatus> {
    const snapshot = this.known(input.id);
    if (input.currentVersion !== snapshot.installation.version)
      throw new Error(
        "The installed OpenCode version changed since confirmation. Inspect it again and confirm the current version before updating.",
      );
    this.validateOffer(input);
    const channel = this.deps.releaseStatus().offer!.channel;
    if (
      !snapshot.installation.compatible &&
      !this.accepted(snapshot.installation.id, snapshot.installation.version)
    )
      throw new Error(
        "Only compatible existing OpenCode 2 installations can be updated by Palot. Install OpenCode 2 using its official installer first.",
      );
    const roots = await this.roots();
    const file = await this.canonical(snapshot.source, roots);
    if (
      !file ||
      file !== snapshot.installation.path ||
      (await this.probe(file)) !== snapshot.installation.version
    )
      throw new Error(
        "The OpenCode installation changed since inspection. Inspect it again before updating.",
      );
    this.validateOffer(input);
    if (this.deps.releaseStatus().offer!.channel !== channel)
      throw new Error(
        "The checked OpenCode release channel changed. Confirm the current release again.",
      );
    const args = [
      "upgrade",
      input.version,
      ...(input.method === "auto" ? [] : ["--method", input.method]),
    ];
    let result: ProcessResult;
    try {
      result = await this.deps.run(file, args, { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });
    } catch {
      throw new Error(
        "Could not run the official OpenCode updater. Check the installation and its permissions, then inspect again.",
      );
    }
    if (result.code !== 0) {
      // Upstream output may contain registry credentials. Never log or return raw subprocess output.
      if (result.outputExceeded)
        throw new Error(
          "The OpenCode updater exceeded the output limit. Inspect the installation before retrying in your terminal.",
        );
      if (result.timedOut)
        throw new Error(
          "The OpenCode updater exceeded five minutes. Inspect the installation before retrying in your terminal.",
        );
      throw new Error(
        "The official OpenCode updater failed. Check your package-manager permissions and network access. If automatic detection picked the wrong installation, select its installation method explicitly or update in your terminal. Palot never requests administrator privileges.",
      );
    }
    await this.scan();
    const updated = this.snapshots.find((entry) => entry.source === snapshot.source);
    if (!updated || updated.installation.version !== input.version) {
      this.error =
        "The updater exited successfully, but the selected installation does not report the requested version. Another installation may have been updated; inspect the installation method before retrying.";
      throw new Error(this.error);
    }
    this.save({
      ...this.preferences,
      selectedID:
        this.preferences.selectedID === input.id
          ? updated.installation.id
          : this.preferences.selectedID,
      accepted:
        !isSupportedOpenCodeVersion(input.version) && input.allowUntested === true
          ? {
              id: updated.installation.id,
              version: input.version,
              sdkVersion: SUPPORTED_OPENCODE_VERSION,
            }
          : undefined,
    });
    this.overrideFailed =
      !!this.deps.override() &&
      !this.snapshots.some(
        (snapshot) =>
          snapshot.source === this.deps.override() &&
          (snapshot.installation.compatible ||
            this.accepted(snapshot.installation.id, snapshot.installation.version)),
      );
    this.error = null;
    return this.status();
  }
}

let singleton: OpenCodeInstallations | null = null;
export function getOpenCodeInstallations(): OpenCodeInstallations {
  singleton ??= new OpenCodeInstallations();
  return singleton;
}
