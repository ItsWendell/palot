export const SUPPORTED_OPENCODE_VERSION = "2.0.3";

// Published contracts used by Palot were compared across these exact releases.
// A channel name is not a compatibility guarantee (Beta can even lag Stable).
export const TESTED_OPENCODE_VERSIONS = [SUPPORTED_OPENCODE_VERSION, "0.0.0-beta-19507"] as const;

/** Native V2 releases print `opencode v2.x.y`; older previews can print only the version. */
export function parseOpenCodeVersionOutput(output: string): string | null {
  return (
    output.trim().match(/^(?:opencode(?:2)?\s+)?v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/)?.[1] ??
    null
  );
}

export function isSupportedOpenCodeVersion(version: string): boolean {
  return isStableOpenCodeV2(version) || isTestedOpenCodeVersion(version);
}

export function isTestedOpenCodeVersion(version: string): boolean {
  return TESTED_OPENCODE_VERSIONS.some((tested) => tested === version);
}

export function isStableOpenCodeV2(version: string): boolean {
  // Official client docs demonstrate major-family compatibility predicates.
  // 2.0.0's published contracts cover all APIs currently used by Palot.
  // Prereleases are deliberately separate, even when their major is 2.
  return version === version.trim() && /^2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version);
}

export function supportedOpenCodeVersionLabel(): string {
  return SUPPORTED_OPENCODE_VERSION;
}

export function shouldReuseOpenCodeService(version: string): boolean {
  return isSupportedOpenCodeVersion(version);
}

export function canContinueOpenCodeVersionMismatch(version: string): boolean {
  return (
    version === version.trim() &&
    /^(?:2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-beta[.-](?:0|[1-9]\d*))?|0\.0\.0-beta-[1-9]\d*)$/.test(
      version,
    )
  );
}

export function buildAllowsOpenCodeVersionMismatch(
  _channel: string,
  _developmentOverride: boolean,
): boolean {
  // Consent belongs to the detected upstream version, not Palot's release channel.
  // This only makes the confirmation available; it never opts the user in.
  return true;
}
