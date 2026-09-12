import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { app, shell } from "electron";
import Store from "electron-store";

import type {
  ExternalOpenInput,
  ExternalOpenResult,
  ExternalOpenTarget,
  ExternalOpenTargetID,
} from "../../shared/external-open-contract";
import { openCodeRuntime } from "../opencode-runtime";
import { EXTERNAL_OPEN_TARGETS, type ExternalOpenTargetDefinition } from "./targets";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface PersistedExternalOpenPreferences {
  preferredEditorID?: ExternalOpenTargetID | null;
}

interface DetectedTarget {
  definition: ExternalOpenTargetDefinition;
  appPath: string | null;
  iconDataUrl: string | null;
}

async function firstExistingPath(paths: readonly string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known install location.
    }
  }
  return null;
}

async function findBundle(bundleIDs: readonly string[]): Promise<{
  appPath: string;
} | null> {
  for (const bundleID of bundleIDs) {
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/mdfind",
        [`kMDItemCFBundleIdentifier == '${bundleID}'`],
        { timeout: 3_000, maxBuffer: 256 * 1024 },
      );
      const appPath = stdout
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value.endsWith(".app"));
      if (appPath) {
        await access(appPath);
        return { appPath };
      }
    } catch {
      // Spotlight can be disabled. Known paths and PATH remain available.
    }
  }
  return null;
}

async function iconDataUrl(
  appPath: string | null,
  targetID: ExternalOpenTargetID,
): Promise<string | null> {
  if (!appPath) return null;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleIconFile", "raw", "-o", "-", path.join(appPath, "Contents/Info.plist")],
      { timeout: 3_000, maxBuffer: 16 * 1024 },
    );
    const iconName = stdout.trim();
    if (!iconName) return null;
    const iconPath = path.join(
      appPath,
      "Contents/Resources",
      path.extname(iconName) ? iconName : `${iconName}.icns`,
    );
    await access(iconPath);
    const outputDirectory = path.join(app.getPath("temp"), "palot-external-open-icons");
    const outputPath = path.join(outputDirectory, `${targetID}.png`);
    await mkdir(outputDirectory, { recursive: true });
    await execFileAsync(
      "/usr/bin/sips",
      ["-z", "32", "32", "-s", "format", "png", iconPath, "--out", outputPath],
      { timeout: 5_000, maxBuffer: 64 * 1024 },
    );
    const png = await readFile(outputPath);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

async function detectTarget(
  definition: ExternalOpenTargetDefinition,
): Promise<DetectedTarget | null> {
  const bundle = await findBundle(definition.bundleIDs);
  const knownPath = bundle ? null : await firstExistingPath(definition.knownAppPaths);
  const appPath = bundle?.appPath ?? knownPath;
  if (!appPath) return null;
  return {
    definition,
    appPath,
    iconDataUrl: await iconDataUrl(appPath, definition.id),
  };
}

export class ExternalOpenService {
  private readonly store = new Store<PersistedExternalOpenPreferences>({
    name: "external-open",
    defaults: { preferredEditorID: null },
  });
  private cachedTargets: { expiresAt: number; value: DetectedTarget[] } | null = null;
  private discovery: Promise<DetectedTarget[]> | null = null;
  private discoveryGeneration = 0;

  constructor() {
    app.on("browser-window-focus", () => this.invalidate());
  }

  invalidate(): void {
    this.discoveryGeneration += 1;
    this.cachedTargets = null;
  }

  async getTargets(sessionID: string): Promise<ExternalOpenTarget[]> {
    await this.resolveSessionDirectory(sessionID);
    const detected = await this.detectTargets();
    const preferredID = this.preferredTarget(detected)?.definition.id ?? null;
    return detected.map(({ definition, iconDataUrl }) => ({
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      iconDataUrl,
      preferred: definition.id === preferredID,
    }));
  }

  async open(input: ExternalOpenInput): Promise<ExternalOpenResult> {
    const expectedConnectionID = openCodeRuntime.runtimeStatus().connectionID;
    this.assertSameLocalConnection(expectedConnectionID);
    const detected = await this.detectTargets();
    this.assertSameLocalConnection(expectedConnectionID);
    const target = input.targetID
      ? detected.find((candidate) => candidate.definition.id === input.targetID)
      : this.preferredTarget(detected);
    if (!target) throw new Error("No supported application is installed");

    if (input.resource.kind === "session-directory") {
      const { directory, connectionID } = await this.resolveSessionDirectory(
        input.resource.sessionID,
      );
      this.assertSameLocalConnection(connectionID);

      try {
        await this.launch(target, directory);
      } catch (error) {
        this.invalidate();
        throw error;
      }
    } else {
      const filePath = input.resource.path.startsWith("~")
        ? path.join(process.env.HOME ?? "", input.resource.path.slice(1))
        : input.resource.path;
      try {
        await this.launchFile(target, filePath, input.resource.line, input.resource.column);
      } catch (error) {
        this.invalidate();
        throw error;
      }
    }

    if (target.definition.kind === "editor") {
      this.store.set("preferredEditorID", target.definition.id);
    }
    return { openedTargetID: target.definition.id };
  }

  async getPreferredTargetInfo(): Promise<{ id: ExternalOpenTargetID; label: string } | null> {
    const detected = await this.detectTargets();
    const preferred = this.preferredTarget(detected);
    return preferred ? { id: preferred.definition.id, label: preferred.definition.label } : null;
  }

  async openFile(
    filePath: string,
    line?: number,
    column?: number,
    targetID?: ExternalOpenTargetID,
  ): Promise<ExternalOpenResult> {
    const detected = await this.detectTargets();
    const target = targetID
      ? detected.find((candidate) => candidate.definition.id === targetID)
      : this.preferredTarget(detected);
    const resolvedPath = filePath.startsWith("~")
      ? path.join(process.env.HOME ?? "", filePath.slice(1))
      : filePath;
    if (!target) {
      if (process.platform === "darwin") {
        await execFileAsync("/usr/bin/open", [resolvedPath], { timeout: 10_000 });
      }
      return { openedTargetID: "finder" };
    }

    try {
      await this.launchFile(target, resolvedPath, line, column);
    } catch (error) {
      this.invalidate();
      throw error;
    }

    if (target.definition.kind === "editor") {
      this.store.set("preferredEditorID", target.definition.id);
    }
    return { openedTargetID: target.definition.id };
  }

  private async resolveSessionDirectory(
    sessionID: string,
  ): Promise<{ directory: string; connectionID: string }> {
    const status = openCodeRuntime.runtimeStatus();
    if (!status.connected || status.capabilities?.localPathActions !== true) {
      throw new Error("Opening local applications is unavailable for the active OpenCode server");
    }
    const connectionID = status.connectionID;
    const session = await openCodeRuntime.withClient((client) =>
      client.session.get({ sessionID }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    );
    this.assertSameLocalConnection(connectionID);
    const directory = session.location.directory;
    if (!path.isAbsolute(directory) || !(await stat(directory)).isDirectory()) {
      throw new Error("The task checkout is not an available local directory");
    }
    return { directory, connectionID };
  }

  private assertSameLocalConnection(connectionID: string): void {
    const current = openCodeRuntime.runtimeStatus();
    if (
      !current.connected ||
      current.connectionID !== connectionID ||
      current.capabilities?.localPathActions !== true
    ) {
      throw new Error("The active OpenCode server changed before the application could open");
    }
  }

  private preferredTarget(targets: readonly DetectedTarget[]): DetectedTarget | undefined {
    const preferredID = this.store.get("preferredEditorID");
    return (
      targets.find(
        ({ definition }) => definition.kind === "editor" && definition.id === preferredID,
      ) ??
      targets.find(({ definition }) => definition.kind === "editor") ??
      targets.find(({ definition }) => definition.kind === "file-manager")
    );
  }

  private async detectTargets(): Promise<DetectedTarget[]> {
    if (process.platform !== "darwin") return [];
    if (this.cachedTargets && this.cachedTargets.expiresAt > Date.now()) {
      return this.cachedTargets.value;
    }
    if (this.discovery) return this.discovery;
    const generation = this.discoveryGeneration;
    this.discovery = Promise.all(EXTERNAL_OPEN_TARGETS.map(detectTarget))
      .then((targets) => targets.filter((target): target is DetectedTarget => target !== null))
      .then((targets) => {
        if (generation === this.discoveryGeneration) {
          this.cachedTargets = { expiresAt: Date.now() + CACHE_TTL_MS, value: targets };
        }
        return targets;
      })
      .finally(() => {
        this.discovery = null;
      });
    return this.discovery;
  }

  private async launch(target: DetectedTarget, directory: string): Promise<void> {
    if (target.definition.id === "finder") {
      await execFileAsync("/usr/bin/open", ["-R", directory], { timeout: 10_000 });
      return;
    }
    if (target.appPath) {
      await execFileAsync("/usr/bin/open", ["-a", target.appPath, directory], { timeout: 10_000 });
      return;
    }
    throw new Error(`${target.definition.label} is no longer installed`);
  }

  private async launchFile(
    target: DetectedTarget,
    filePath: string,
    line?: number,
    column?: number,
  ): Promise<void> {
    if (target.definition.id === "finder") {
      shell.showItemInFolder(filePath);
      return;
    }

    if (line !== undefined && line > 0) {
      const url = editorUrlScheme(target.definition.id, filePath, line, column);
      if (url) {
        try {
          await execFileAsync("/usr/bin/open", [url], { timeout: 10_000 });
          return;
        } catch {
          // Fall back to opening file with application bundle
        }
      }
    }

    if (target.appPath) {
      await execFileAsync("/usr/bin/open", ["-a", target.appPath, filePath], { timeout: 10_000 });
      return;
    }

    await execFileAsync("/usr/bin/open", [filePath], { timeout: 10_000 });
  }
}

function editorUrlScheme(
  targetID: ExternalOpenTargetID,
  filePath: string,
  line: number,
  column?: number,
): string | null {
  const lineSuffix = column ? `:${line}:${column}` : `:${line}`;
  const cleanPath = filePath.replace(/^\/+/, "");
  switch (targetID) {
    case "cursor":
      return `cursor://file/${cleanPath}${lineSuffix}`;
    case "vscode":
      return `vscode://file/${cleanPath}${lineSuffix}`;
    case "vscode-insiders":
      return `vscode-insiders://file/${cleanPath}${lineSuffix}`;
    case "vscodium":
      return `vscodium://file/${cleanPath}${lineSuffix}`;
    case "zed":
    case "zed-preview":
      return `zed://file/${cleanPath}${lineSuffix}`;
    case "windsurf":
      return `windsurf://file/${cleanPath}${lineSuffix}`;
    case "sublime-text":
      return `subl://open?url=file://${encodeURI(filePath)}&line=${line}${column ? `&column=${column}` : ""}`;
    default:
      return null;
  }
}

let service: ExternalOpenService | undefined;

export function externalOpenService(): ExternalOpenService {
  return (service ??= new ExternalOpenService());
}
