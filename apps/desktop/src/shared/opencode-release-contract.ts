/** Release preferences are independent of the currently running OpenCode service. */
export type OpenCodeReleaseChannel = "stable" | "beta";

export interface OpenCodeReleaseOffer {
  version: string;
  channel: OpenCodeReleaseChannel;
  tested: boolean;
  requiresConfirmation: boolean;
  size: number;
}

export interface OpenCodeReleaseStatus {
  channel: OpenCodeReleaseChannel;
  bundledVersion: string;
  preparedVersion: string | null;
  checkedAt: number | null;
  offer: OpenCodeReleaseOffer | null;
}
