/**
 * Measures how much of a transcript's wire size is inline media (base64 attachment bodies and
 * `data:` URLs), reading it the way Palot hydrates a task: newest-first message pages of 20, then
 * the session inbox. Read-only.
 *
 * Run against an isolated service only, for example a retained E2E run's
 * `home/.local/state/opencode/service.json`. The script refuses the default service registration
 * on this machine and that service's URL.
 *
 *   bun apps/desktop/scripts/measure-transcript-media.ts --service-file <service.json> [--session <id>...] [--json]
 *   bun apps/desktop/scripts/measure-transcript-media.ts --url <url> [--password <pw>] [--session <id>...] [--json]
 *   bun apps/desktop/scripts/measure-transcript-media.ts --dir <directory of exported session JSON> [--json]
 *
 * `--media-refs` reads with the `experimental-media-uri` capability, as Palot does, to compare
 * against a server that stores media separately (`experimental.media_blob`).
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { OpenCode, withMediaRefs } from "@opencode/client";
import { Service } from "@opencode/client/service";

const PAGE_LIMIT = 20;

export type MediaTally = {
  /** UTF-8 bytes of the JSON as read. */
  totalBytes: number;
  /** Bytes of inline media strings inside that JSON. */
  mediaBytes: number;
  imageBytes: number;
  items: number;
  /** `media:<hash>` references, present when the server already returns them. */
  refs: number;
};

const empty = (): MediaTally => ({
  totalBytes: 0,
  mediaBytes: 0,
  imageBytes: 0,
  items: 0,
  refs: 0,
});

function add(into: MediaTally, from: MediaTally) {
  into.totalBytes += from.totalBytes;
  into.mediaBytes += from.mediaBytes;
  into.imageBytes += from.imageBytes;
  into.items += from.items;
  into.refs += from.refs;
}

const DATA_URL = /^data:([^;,]*)[^,]*;base64,/;

/** Counts inline media in a parsed transcript payload. `totalBytes` is left to the caller. */
export function tallyMedia(value: unknown, tally: MediaTally = empty()): MediaTally {
  if (Array.isArray(value)) {
    for (const item of value) tallyMedia(item, tally);
    return tally;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (value.startsWith("media:")) tally.refs++;
      const match = DATA_URL.exec(value);
      if (match) count(tally, value.length, match[1] ?? "");
    }
    return tally;
  }
  const record = value as Record<string, unknown>;
  // An attachment body: `{ data: <base64>, mime }` on prompt files and generated images.
  const body = typeof record.mime === "string" && typeof record.data === "string";
  for (const [key, item] of Object.entries(record)) {
    if (body && key === "data") {
      const data = item as string;
      if (data.startsWith("media:")) tally.refs++;
      else count(tally, data.length, record.mime as string);
      continue;
    }
    tallyMedia(item, tally);
  }
  return tally;
}

function count(tally: MediaTally, bytes: number, mime: string) {
  tally.mediaBytes += bytes;
  tally.items++;
  if (mime.startsWith("image/")) tally.imageBytes += bytes;
}

function measureBody(text: string): MediaTally {
  const tally = tallyMedia(JSON.parse(text));
  tally.totalBytes = Buffer.byteLength(text);
  return tally;
}

/** The default registration of the machine's own OpenCode service, which must never be measured. */
function defaultServiceFile() {
  const state = process.env.XDG_STATE_HOME || path.join(homedir(), ".local/state");
  return path.resolve(state, "opencode/service.json");
}

async function defaultServiceURL(): Promise<string | undefined> {
  try {
    const info = JSON.parse(await readFile(defaultServiceFile(), "utf8")) as { url?: unknown };
    return typeof info.url === "string" ? new URL(info.url).origin : undefined;
  } catch {
    return undefined;
  }
}

type SessionReport = { sessionID: string; title: string; messages: MediaTally; inbox: MediaTally };

async function measureService(
  endpoint: { url: string; headers?: Record<string, string> },
  sessionIDs: string[],
  mediaRefs = false,
): Promise<SessionReport[]> {
  if (new URL(endpoint.url).origin === (await defaultServiceURL()))
    throw new Error("Refusing to measure this machine's own OpenCode service.");
  let last: MediaTally | undefined;
  const base = OpenCode.make({
    baseUrl: endpoint.url,
    headers: endpoint.headers,
    // Measures the exact bytes the server sent before the client decodes them.
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const text = await response.clone().text();
      last = response.ok ? measureBody(text) : undefined;
      return response;
    },
  });
  const client = mediaRefs ? withMediaRefs(base) : base;
  const take = () => {
    const tally = last ?? empty();
    last = undefined;
    return tally;
  };
  const ids =
    sessionIDs.length > 0
      ? sessionIDs
      : (await client.session.list({ limit: 200 })).data.map((session) => session.id);
  const reports: SessionReport[] = [];
  for (const sessionID of ids) {
    const info = await client.session.get({ sessionID });
    const messages = empty();
    let cursor: string | undefined;
    const seen = new Set<string>();
    while (true) {
      const page = await client.message.list({
        sessionID,
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : { order: "desc" as const }),
      });
      add(messages, take());
      const next = page.cursor.next ?? undefined;
      if (page.data.length < PAGE_LIMIT || !next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
    await client.session.inbox.list({ sessionID });
    reports.push({ sessionID, title: info.title ?? "", messages, inbox: take() });
  }
  return reports;
}

async function measureDirectory(directory: string): Promise<SessionReport[]> {
  const reports: SessionReport[] = [];
  for (const name of (await readdir(directory)).filter((file) => file.endsWith(".json")).sort()) {
    const transfer = JSON.parse(await readFile(path.join(directory, name), "utf8")) as {
      info?: { id?: string; title?: string };
      messages?: unknown[];
    };
    if (!Array.isArray(transfer.messages)) continue;
    reports.push({
      sessionID: transfer.info?.id ?? name,
      title: transfer.info?.title ?? "",
      messages: measureBody(JSON.stringify(transfer.messages)),
      inbox: empty(),
    });
  }
  return reports;
}

const share = (tally: MediaTally) =>
  tally.totalBytes === 0 ? 0 : (tally.mediaBytes / tally.totalBytes) * 100;

function print(reports: SessionReport[]) {
  const total = empty();
  const header = [
    "session",
    "total bytes",
    "media bytes",
    "image bytes",
    "items",
    "refs",
    "media %",
  ];
  const row = (label: string, tally: MediaTally) => [
    label,
    String(tally.totalBytes),
    String(tally.mediaBytes),
    String(tally.imageBytes),
    String(tally.items),
    String(tally.refs),
    share(tally).toFixed(1),
  ];
  const rows = reports.map((report) => {
    const tally = empty();
    add(tally, report.messages);
    add(tally, report.inbox);
    add(total, tally);
    return row(`${report.sessionID} ${report.title}`.trim(), tally);
  });
  const footer = row(`TOTAL (${reports.length} sessions)`, total);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...[...rows, footer].map((line) => line[index]!.length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, index) => (index ? cell.padStart(widths[index]!) : cell.padEnd(widths[index]!)))
      .join("  ");
  console.log(format(header));
  for (const line of rows) console.log(format(line));
  console.log(format(widths.map((width) => "-".repeat(width))));
  console.log(format(footer));
  console.log(
    "\nBytes are UTF-8 response bodies of message pages (newest first, 20 per page) plus the inbox.\nmedia: base64 attachment bodies and data: URLs; image: the image/* part of media.",
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      "service-file": { type: "string" },
      url: { type: "string" },
      password: { type: "string" },
      session: { type: "string", multiple: true },
      dir: { type: "string" },
      json: { type: "boolean" },
      "media-refs": { type: "boolean" },
    },
  });
  let reports: SessionReport[];
  if (values.dir) {
    reports = await measureDirectory(values.dir);
  } else if (values["service-file"]) {
    const file = path.resolve(values["service-file"]);
    if (file === defaultServiceFile())
      throw new Error("Refusing the default service registration; pass an isolated one.");
    const endpoint = await Service.discover({ file });
    if (!endpoint) throw new Error(`No healthy service registered in ${file}`);
    reports = await measureService(
      { url: endpoint.url, headers: Service.headers(endpoint) },
      values.session ?? [],
      values["media-refs"],
    );
  } else if (values.url) {
    const headers = values.password
      ? {
          authorization: `Basic ${Buffer.from(`opencode:${values.password}`).toString("base64")}`,
        }
      : undefined;
    reports = await measureService(
      { url: values.url, headers },
      values.session ?? [],
      values["media-refs"],
    );
  } else {
    throw new Error("Pass --service-file, --url, or --dir.");
  }
  if (values.json) console.log(JSON.stringify(reports, null, 2));
  else print(reports);
}

if (import.meta.main) await main();
