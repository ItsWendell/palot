import type { Session, WebContents } from "electron";
import type {
  PalotBrowserMediaKind,
  PalotBrowserPermissionGrant,
  PalotBrowserPermissionRequest,
} from "../../shared/browser-contract";

/** An unanswered prompt is refused, so a page left in the background cannot wait forever. */
export const PERMISSION_PROMPT_TIMEOUT_MS = 60_000;

type Decision = "allow" | "block";

interface Pending extends PalotBrowserPermissionRequest {
  callbacks: Array<(granted: boolean) => void>;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserPermissionsOptions {
  /** The browser tab a guest page belongs to, or null for contents this task does not own. */
  tabFor(contents: WebContents | null): PalotBrowserPermissionRequest["tabID"] | null;
  /** Called whenever prompts or grants change. */
  notify(state: {
    requests: PalotBrowserPermissionRequest[];
    grants: PalotBrowserPermissionGrant[];
  }): void;
  /** Asks the operating system for device access (macOS); resolves true elsewhere. */
  systemAccess(kind: PalotBrowserMediaKind): Promise<boolean>;
  /** Reloads this task's pages showing `origin`, which ends any capture after a revoke. */
  reloadOrigin(origin: string): void;
  timeoutMs?: number;
}

/**
 * Microphone and camera access for one task's browser, decided only by the person through
 * Palot's own UI. Pages and agents can request access but never answer: the prompt is drawn by
 * Palot outside the page. Answers are remembered per site for this browser attachment, whose
 * partition is in memory. Every other permission stays refused.
 */
export function installBrowserPermissions(target: Session, options: BrowserPermissionsOptions) {
  const grants = new Map<string, Partial<Record<PalotBrowserMediaKind, Decision>>>();
  const pending = new Map<string, Pending>();
  let disposed = false;

  const snapshot = () => ({
    requests: [...pending.values()].map(({ id, tabID, origin, kinds }) => ({
      id,
      tabID,
      origin,
      kinds,
    })),
    grants: [...grants].map(([origin, decisions]) => ({ origin, ...decisions })),
  });
  const notify = () => {
    if (!disposed) options.notify(snapshot());
  };

  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    const tabID = options.tabFor(contents);
    const kinds = mediaKinds((details as { mediaTypes?: readonly string[] }).mediaTypes);
    const origin = siteOrigin(details.requestingUrl);
    if (disposed || permission !== "media" || !details.isMainFrame || !tabID || !kinds || !origin)
      return callback(false);
    const decided = grants.get(origin) ?? {};
    if (kinds.some((kind) => decided[kind] === "block")) return callback(false);
    if (kinds.every((kind) => decided[kind] === "allow")) {
      void allowed(kinds).then(callback);
      return;
    }
    const existing = [...pending.values()].find(
      (request) =>
        request.tabID === tabID &&
        request.origin === origin &&
        request.kinds.join() === kinds.join(),
    );
    if (existing) {
      existing.callbacks.push(callback);
      return;
    }
    const id = crypto.randomUUID();
    pending.set(id, {
      id,
      tabID,
      origin,
      kinds,
      callbacks: [callback],
      timer: setTimeout(() => settle(id, false), options.timeoutMs ?? PERMISSION_PROMPT_TIMEOUT_MS),
    });
    notify();
  });
  target.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (disposed || permission !== "media" || !details.isMainFrame || !options.tabFor(contents))
      return false;
    const kind =
      details.mediaType === "audio"
        ? "microphone"
        : details.mediaType === "video"
          ? "camera"
          : null;
    const origin = siteOrigin(details.requestingUrl ?? details.securityOrigin);
    return Boolean(kind && origin && grants.get(origin)?.[kind] === "allow");
  });
  target.setDevicePermissionHandler(() => false);
  // Screen capture is not offered: an empty answer refuses it.
  target.setDisplayMediaRequestHandler((_request, callback) => callback({}));

  async function allowed(kinds: PalotBrowserMediaKind[]) {
    for (const kind of kinds) if (!(await options.systemAccess(kind))) return false;
    return true;
  }

  function settle(id: string, granted: boolean) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    for (const callback of request.callbacks) callback(granted);
    notify();
  }

  return {
    /** The person's answer to a prompt shown in Palot. */
    async decide(id: string, decision: Decision) {
      const request = pending.get(id);
      if (!request) throw new Error("This permission request is no longer waiting");
      const decided = grants.get(request.origin) ?? {};
      for (const kind of request.kinds) decided[kind] = decision;
      grants.set(request.origin, decided);
      settle(id, decision === "allow" && (await allowed(request.kinds)));
      // Other prompts from the same site follow the same answer.
      for (const other of pending.values())
        if (other.origin === request.origin && other.kinds.every((kind) => decided[kind]))
          settle(
            other.id,
            other.kinds.every((kind) => decided[kind] === "allow"),
          );
    },
    /** Forgets a site's answers and reloads its pages so any capture stops. */
    revoke(origin: string) {
      if (!grants.delete(origin)) return;
      notify();
      options.reloadOrigin(origin);
    },
    state: snapshot,
    dispose() {
      disposed = true;
      for (const id of pending.keys()) settle(id, false);
      grants.clear();
    },
  };
}

export type BrowserPermissions = ReturnType<typeof installBrowserPermissions>;

/** Microphone and/or camera for a `media` request; null for anything else (screen capture). */
function mediaKinds(types: readonly string[] | undefined): PalotBrowserMediaKind[] | null {
  if (!types?.length || types.some((type) => type !== "audio" && type !== "video")) return null;
  return (["audio", "video"] as const)
    .filter((type) => types.includes(type))
    .map((type) => (type === "audio" ? "microphone" : "camera"));
}

/** Only web sites can be granted access; file:, data: and opaque origins cannot. */
export function siteOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
