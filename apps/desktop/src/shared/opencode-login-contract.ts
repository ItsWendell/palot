export interface OpenCodeLoginStatus {
  manager: "systemd" | "launchd" | null;
  supported: boolean;
  enabled: boolean;
  owned: boolean;
  running: boolean;
  pid: number | null;
  binaryPath: string | null;
  configPath: string | null;
  reason: string | null;
}

export type OpenCodeLoginUpdateInput =
  | { enabled: false }
  | { enabled: true; installationID: string; version: string };
