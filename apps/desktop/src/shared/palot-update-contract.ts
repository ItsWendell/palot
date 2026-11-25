/**
 * Opt-in notice that a newer stable Palot release exists. Palot only reads the latest
 * release from GitHub; it never downloads or installs anything.
 */

export const PALOT_UPDATE_IPC_CHANNELS = {
  palotUpdateStatus: "palot:palot-update:status",
  palotUpdateSetEnabled: "palot:palot-update:set-enabled",
  palotUpdateCheck: "palot:palot-update:check",
  palotUpdateDismiss: "palot:palot-update:dismiss",
  palotUpdateTakeAnnouncement: "palot:palot-update:take-announcement",
} as const;

export interface PalotUpdateRelease {
  version: string;
  /** The release page on GitHub. */
  url: string;
}

export interface PalotUpdateStatus {
  /** False on Dev, Nightly and Beta builds: checks cover stable releases only. */
  supported: boolean;
  enabled: boolean;
  currentVersion: string;
  /** Time of the last successful check, in milliseconds since the epoch. */
  checkedAt: number | null;
  /** The latest stable release when it is newer than this build and checks are on. */
  available: PalotUpdateRelease | null;
  dismissedVersion: string | null;
}

export interface PalotUpdateApi {
  status(): Promise<PalotUpdateStatus>;
  setEnabled(enabled: boolean): Promise<PalotUpdateStatus>;
  /** Asks GitHub now. Rejects while checks are off or on a non-stable build. */
  check(): Promise<PalotUpdateStatus>;
  /** Hides the notice and toast for this version. A later version shows again. */
  dismiss(version: string): Promise<PalotUpdateStatus>;
  /** The newer release to announce, once per version across windows, or null. */
  takeAnnouncement(): Promise<PalotUpdateRelease | null>;
}
