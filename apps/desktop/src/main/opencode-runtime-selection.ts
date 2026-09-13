import path from "node:path";
import { getOpenCodeInstallations } from "./opencode-local-installations";
import { getOpenCodeReleaseManager } from "./opencode-release-manager";
import {
  readExternalOpenCodeRuntimePolicy,
  verifyBundledOpenCodeBinary,
} from "./opencode-runtime-release";

/** After source selection, never re-enter PATH/OPENCODE_BIN discovery. */
export async function discoverBundledOpenCodeBinary(): Promise<{
  path: string;
  version: string;
} | null> {
  try {
    const directory = path.join(process.resourcesPath, "opencode");
    if (readExternalOpenCodeRuntimePolicy(directory)) return null;
    return await verifyBundledOpenCodeBinary({ directory });
  } catch (error) {
    throw new Error(
      `Bundled OpenCode runtime verification failed: ${error instanceof Error ? error.message : String(error)}. Prepare a Palot runtime in connection settings, reinstall Palot, or choose Installed OpenCode.`,
      { cause: error },
    );
  }
}

/** Discovery only: acquisition and service changes always require separate user actions. */
export async function discoverSelectedOpenCodeBinary(input?: { exactVersion?: string }) {
  const binary =
    (await getOpenCodeInstallations().discoverPreferredBinary(input)) ??
    (await getOpenCodeReleaseManager().discoverPreparedBinary()) ??
    (await discoverBundledOpenCodeBinary());
  if (input?.exactVersion && binary && binary.version !== input.exactVersion)
    throw new Error(
      `SSH authentication requires OpenCode ${input.exactVersion}, but the selected runtime is ${binary.version}. Select an installed matching CLI or explicitly download and select the matching official runtime in connection settings.`,
    );
  return binary;
}
