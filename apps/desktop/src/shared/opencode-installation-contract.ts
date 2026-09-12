export type OpenCodeInstallMethod = "auto" | "npm" | "bun" | "pnpm" | "yarn" | "curl";
export type OpenCodeRuntimePreference = "installed" | "palot";

export interface OpenCodeInstallation {
  /** Opaque main-owned identity; never accepted as an executable path. */
  id: string;
  path: string;
  version: string;
  compatible: boolean;
  /** Exact installed beta was explicitly accepted for the current Palot client. */
  approved?: boolean;
}

export interface OpenCodeInstallationStatus {
  preference: OpenCodeRuntimePreference;
  selectedID: string | null;
  installations: OpenCodeInstallation[];
  error?: string | null;
}

export interface OpenCodeInstallationUpgradeInput {
  id: string;
  /** Installed version shown in the update confirmation. */
  currentVersion: string;
  version: string;
  method: OpenCodeInstallMethod;
  /** Consent applies only to the exact currently checked release offer. */
  allowUntested?: boolean;
}
