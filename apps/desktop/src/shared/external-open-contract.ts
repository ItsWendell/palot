export const EXTERNAL_OPEN_TARGET_IDS = [
  "cursor",
  "vscode",
  "vscode-insiders",
  "vscodium",
  "zed",
  "zed-preview",
  "windsurf",
  "sublime-text",
  "intellij-idea",
  "webstorm",
  "pycharm",
  "goland",
  "clion",
  "rider",
  "android-studio",
  "finder",
] as const;

export type ExternalOpenTargetID = (typeof EXTERNAL_OPEN_TARGET_IDS)[number];

export interface ExternalOpenTarget {
  id: ExternalOpenTargetID;
  label: string;
  kind: "editor" | "file-manager";
  iconDataUrl: string | null;
  preferred: boolean;
}

export interface ExternalOpenSessionResource {
  kind: "session-directory";
  sessionID: string;
}

export interface ExternalOpenFileResource {
  kind: "file";
  path: string;
  line?: number;
  column?: number;
  sessionID?: string;
}

export type ExternalOpenResource = ExternalOpenSessionResource | ExternalOpenFileResource;

export interface ExternalOpenInput {
  resource: ExternalOpenResource;
  targetID?: ExternalOpenTargetID;
}

export interface ExternalOpenResult {
  openedTargetID: ExternalOpenTargetID;
}
