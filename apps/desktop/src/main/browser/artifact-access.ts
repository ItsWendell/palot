// OpenCode's experimental artifacts (2.2.4+, `experimental.artifacts`) serve the local provider's
// files from the OpenCode API at /api/experimental/artifacts/<id>/view/, behind the server's
// credential. The task browser never receives that credential as a cookie, URL, or page value:
// main adds it to individual requests, only for artifacts the person opened from the transcript,
// only on the connection's own origin, and only for the artifact's own page and what it loads.
// Electron-free so it stays unit-testable.

const ARTIFACT_ID = /^art_[0-9A-Za-z]{1,64}$/;
const VIEW_PATH = /^\/api\/experimental\/artifacts\/(art_[0-9A-Za-z]{1,64})\/view(?:\/|$)/;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

export function isArtifactID(value: unknown): value is string {
  return typeof value === "string" && ARTIFACT_ID.test(value);
}

/** The entry page of a local-provider artifact on the connection's origin. */
export function artifactViewURL(origin: string, artifactID: string): string {
  if (!isArtifactID(artifactID)) throw new Error("Artifact ID is invalid");
  return `${origin}/api/experimental/artifacts/${artifactID}/view/`;
}

/** Which artifact a URL shows on `origin`, if any. */
export function viewedArtifact(input: string | undefined, origin: string): string | undefined {
  if (!input || !URL.canParse(input)) return;
  const url = new URL(input);
  if (url.origin !== origin || url.username || url.password) return;
  // The server router and Chromium may disagree about encoded separators; never guess.
  if (/%(?:2f|5c)/i.test(url.pathname)) return;
  return VIEW_PATH.exec(url.pathname)?.[1];
}

/**
 * The browser partition tunnels pages through the OpenCode server, so a destination resolves on
 * that machine. Only a loopback endpoint on this computer is the same server from both sides; an
 * SSH forward or another host could deliver the credential to a different listener.
 */
export function artifactAccessOrigin(endpoint: string, sameMachine: boolean): string | undefined {
  if (!sameMachine || !URL.canParse(endpoint)) return;
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.username || url.password || !LOOPBACK.test(url.hostname)) return;
  return url.origin;
}

export interface ArtifactRequest {
  url: string;
  method: string;
  resourceType: string;
  webContents?: { getURL(): string } | null;
}

export type ArtifactAccess = ReturnType<typeof createArtifactAccess>;

export function createArtifactAccess(options: { origin: string; authorization?: string }) {
  const granted = new Set<string>();
  return {
    origin: options.origin,
    /** Allows the task browser to load one artifact; returns its entry page. */
    grant(artifactID: string): string {
      const url = artifactViewURL(options.origin, artifactID);
      granted.add(artifactID);
      return url;
    },
    /** The credential for one request in the task's partition, or undefined to send it unchanged. */
    authorization(request: ArtifactRequest): string | undefined {
      if (!options.authorization) return;
      if (request.method !== "GET" && request.method !== "HEAD") return;
      const id = viewedArtifact(request.url, options.origin);
      if (!id || !granted.has(id)) return;
      // A top-level load is the artifact's own document. Anything else must come from a page
      // showing that same artifact, so other sites and other artifacts in the task can't read it.
      if (request.resourceType === "mainFrame") return options.authorization;
      return viewedArtifact(request.webContents?.getURL(), options.origin) === id
        ? options.authorization
        : undefined;
    },
  };
}
