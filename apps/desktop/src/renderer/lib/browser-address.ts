export type BrowserSearchEngine = "google" | "duckduckgo" | "bing";

/** Browser localhost belongs to the task server unless the connection is same-machine. */
export function isLocalBrowserURL(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]" ||
    /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/.test(host)
  );
}

const searchPages: Record<BrowserSearchEngine, string> = {
  google: "https://www.google.com/search",
  duckduckgo: "https://duckduckgo.com/",
  bing: "https://www.bing.com/search",
};

function bareHost(value: string): { host: string; local: boolean } | undefined {
  const authority = value.split(/[/?#]/, 1)[0] ?? "";
  const match = authority.match(/^(\[[^\]]+\]|[^:]+)(?::(.*))?$/);
  if (!match) return;
  const host = match[1] ?? "";
  const port = match[2];
  const ipv6 = host.startsWith("[") && host.endsWith("]");
  const numeric = /^[\d.]+$/.test(host);
  const ipv4 =
    numeric &&
    host.split(".").length === 4 &&
    host.split(".").every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 255);
  const normalizedHost = host.toLowerCase().replace(/\.$/, "");
  const local =
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost === "0.0.0.0" ||
    (ipv4 && normalizedHost.startsWith("127.")) ||
    normalizedHost === "[::1]" ||
    normalizedHost === "[::]";
  const labels = host.replace(/\.$/, "").split(".");
  const domain =
    labels.length >= 2 &&
    /[a-z]/i.test(labels.at(-1) ?? "") &&
    labels.every((label) => /^(?=.{1,63}$)[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
  if (!local && !ipv6 && !ipv4 && !domain) {
    if (
      (numeric && host.includes(".")) ||
      host.startsWith("[") ||
      (host.includes(".") && !host.includes("@") && /[a-z]$/i.test(host))
    )
      throw new Error("Invalid browser address");
    return;
  }
  if (port !== undefined && !/^\d+$/.test(port)) throw new Error("Invalid browser address port");
  return { host, local };
}

/** Classify human-entered text; the main process remains authoritative for navigation policy. */
export function resolveBrowserAddress(text: string, engine: BrowserSearchEngine): string {
  const value = text.trim();
  if (!value || value === "about:blank") return "about:blank";

  if (/^(?:https?|file):\/\//i.test(value)) {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname)
      throw new Error("Invalid browser URL");
    return value;
  }

  if (!/\s/.test(value)) {
    const host = bareHost(value);
    if (host) return new URL(`${host.local ? "http" : "https"}://${value}`).href;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error("Unsupported browser URL scheme");

  const search = new URL(searchPages[engine]);
  search.searchParams.set("q", value);
  return search.href;
}
