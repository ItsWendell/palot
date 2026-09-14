import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { resolveBuildIdentity, PALOT_BUILD_CHANNELS } from "../src/shared/build-identity.ts";

const profileNames = new Set(
  PALOT_BUILD_CHANNELS.map(
    (configuredChannel) =>
      resolveBuildIdentity({ development: false, configuredChannel }).userDataName,
  ),
);

/** Copy only appearance, never a user-data directory or live profile reference. */
export async function seedDemoAppearance({
  destination,
  appData = hostAppData(),
  source = process.env.PALOT_DEMO_APPEARANCE,
}: {
  destination: string;
  appData?: string;
  source?: string;
}): Promise<string | null> {
  source ??= await latestAppearance(appData);
  if (!source) return null;
  const stored: unknown = JSON.parse(await readFile(source, "utf8"));
  if (
    !stored ||
    typeof stored !== "object" ||
    !("preferences" in stored) ||
    !stored.preferences ||
    typeof stored.preferences !== "object" ||
    Array.isArray(stored.preferences)
  ) {
    throw new Error(
      `Invalid demo appearance file: ${source}. Expected an appearance.json preferences object.`,
    );
  }
  // The normal appearance service validates/migrates the copied preferences.
  // Its saved Omarchy palette remains usable without exposing the real HOME.
  await writeFile(destination, JSON.stringify({ preferences: stored.preferences }), {
    mode: 0o600,
  });
  return source;
}

async function latestAppearance(appData: string): Promise<string | undefined> {
  const entries = await readdir(appData, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (profileNames.has(entry.name) || /^Palot \(Dev\) \([a-z0-9]+\)$/.test(entry.name)),
      )
      .map(async (entry) => {
        const file = path.join(appData, entry.name, "appearance.json");
        const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        return info?.isFile() ? { file, modified: info.mtimeMs } : null;
      }),
  );
  return candidates
    .filter((value) => value !== null)
    .sort((a, b) => b.modified - a.modified || a.file.localeCompare(b.file))[0]?.file;
}

function hostAppData(): string {
  if (process.platform === "darwin") return path.join(homedir(), "Library/Application Support");
  if (process.platform === "win32")
    return process.env.APPDATA ?? path.join(homedir(), "AppData/Roaming");
  return process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
}
