import type { Session, WebContents } from "electron";

export interface PermissionPolicyOptions {
  /**
   * Whether `contents` may capture audio for voice chat. Only trusted Palot workspace
   * windows should pass; webview guests, overlays and unknown contents must not.
   */
  allowMicrophone: (contents: WebContents | null) => boolean;
}

/** Microphone-only `media` request: audio requested, video not. */
export function isAudioOnlyMediaRequest(details: { mediaTypes?: readonly string[] }): boolean {
  const types = details.mediaTypes ?? [];
  return types.includes("audio") && !types.includes("video");
}

/**
 * Denies every Chromium permission on the app session except microphone capture for
 * trusted top-level Palot documents. The browser pane keeps its own deny-all policy.
 */
export function installPermissionPolicy(target: Session, options: PermissionPolicyOptions): void {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      permission === "media" &&
        details.isMainFrame &&
        isAudioOnlyMediaRequest(details as { mediaTypes?: readonly string[] }) &&
        options.allowMicrophone(contents),
    );
  });
  target.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === "media" &&
      details.isMainFrame &&
      details.mediaType === "audio" &&
      options.allowMicrophone(contents),
  );
  target.setDevicePermissionHandler(() => false);
}
