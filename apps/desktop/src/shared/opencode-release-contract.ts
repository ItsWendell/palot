/** Release preferences are independent of the currently running OpenCode service. */
export type OpenCodeReleaseChannel = "stable" | "beta";

/** Shipped in resources/opencode/policy.json only when no CLI is redistributed. */
export interface ExternalOpenCodeRuntimePolicy {
  schemaVersion: 1;
  bundled: false;
}

export interface OpenCodeReleaseOffer {
  version: string;
  channel: OpenCodeReleaseChannel;
  tested: boolean;
  requiresConfirmation: boolean;
  size: number;
}

export interface OpenCodeReleaseStatus {
  channel: OpenCodeReleaseChannel;
  bundledVersion: string | null;
  preparedVersion: string | null;
  checkedAt: number | null;
  offer: OpenCodeReleaseOffer | null;
}
