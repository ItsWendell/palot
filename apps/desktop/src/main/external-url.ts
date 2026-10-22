import { app, shell } from "electron";
import { allowedExternalUrl } from "./external-url-policy";
import { localSlackTeamID } from "./slack-workspaces";

const TEAM_ID = /^T[A-Z0-9]+$/;
const CHANNEL_ID = /^[CDG][A-Z0-9]+$/;
const ARCHIVE_PATH = /^\/archives\/([CDG][A-Z0-9]+)(?:\/p(\d{10})(\d{6}))?\/?$/;

function slackWebUrl(input: string): URL | null {
  const allowed = allowedExternalUrl(input);
  if (!allowed) return null;
  const url = new URL(allowed);
  return url.protocol === "https:" &&
    !url.port &&
    (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"))
    ? url
    : null;
}

function unresolvedArchiveHostname(input: string): string | null {
  const url = slackWebUrl(input);
  if (!url || url.searchParams.has("team") || !ARCHIVE_PATH.test(url.pathname)) return null;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.slack\.com$/.test(url.hostname) ? url.hostname : null;
}

/** Only synthesize Slack commands from validated web URLs with actual Slack IDs. */
export function slackDeepLink(input: string, resolvedTeamID?: string): string | null {
  const url = slackWebUrl(input);
  if (!url) return null;

  // https://docs.slack.dev/interactivity/deep-linking/ requires IDs, not subdomains.
  // Archive links need either an explicit ID or a locally resolved workspace ID.
  const client = url.pathname.match(
    /^\/client\/(T[A-Z0-9]+)\/([CDG][A-Z0-9]+)(?:\/(\d+\.\d+))?\/?$/,
  );
  const archive = url.pathname.match(ARCHIVE_PATH);
  let team = client?.[1] ?? url.searchParams.get("team") ?? (archive ? resolvedTeamID : undefined);
  let channel = client?.[2] ?? archive?.[1];
  let message = client?.[3];
  if (archive?.[2]) message = `${archive[2]}.${archive[3]}`;

  if (url.pathname === "/app_redirect") {
    team = url.searchParams.get("team") ?? undefined;
    channel = url.searchParams.get("channel") ?? undefined;
    const application = url.searchParams.get("app");
    if (team && TEAM_ID.test(team) && application && /^A[A-Z0-9]+$/.test(application) && !channel) {
      return `slack://app?${new URLSearchParams({ team, id: application })}`;
    }
  } else if (!client && !archive) {
    return null;
  }

  if (!team || !TEAM_ID.test(team) || !channel || !CHANNEL_ID.test(channel)) return null;
  const query = new URLSearchParams({ team, id: channel });
  // Slack's own web bootstrap (https://app.slack.com/client) passes `message`
  // alongside `cmd: channel`, `team` and `id` when handing a message to desktop.
  if (message) query.set("message", message);
  // Preserve a copied reply's parent-thread context as well as its message.
  // Slack forwards these query arguments to its channel deep-link handler.
  const thread = url.searchParams.get("thread_ts");
  if (thread !== null) {
    if (!/^\d{10}\.\d{6}$/.test(thread)) return null;
    query.set("thread_ts", thread);
  }
  return `slack://channel?${query}`;
}

/** The renderer boundary stays HTTP(S)-only; custom schemes are generated here. */
export async function openExternalUrl(input: string): Promise<boolean> {
  const url = allowedExternalUrl(input);
  if (!url) return false;

  let slack = slackDeepLink(url);
  const archiveHostname = unresolvedArchiveHostname(url);
  if (slack || archiveHostname) {
    try {
      // An absent/broken handler must not produce a protocol chooser or swallow
      // the click. Electron reports an empty name if the scheme has no handler.
      if (app.getApplicationNameForProtocol(slack ?? "slack://open")) {
        if (!slack && archiveHostname) {
          const team = await localSlackTeamID(app.getPath("appData"), archiveHostname);
          if (team) slack = slackDeepLink(url, team);
        }
        if (slack) {
          await shell.openExternal(slack);
          return true;
        }
      }
    } catch {
      // Detection and native launch failures both fall back to the original URL.
    }
  }

  try {
    await shell.openExternal(url);
    return true;
  } catch {
    console.warn("[external-url] Could not open link");
    return false;
  }
}
