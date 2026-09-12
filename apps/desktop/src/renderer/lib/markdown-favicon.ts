const DUCKDUCKGO_FAVICON_ORIGIN = "https://icons.duckduckgo.com";
const SPECIAL_USE_SUFFIXES = [
  ".alt",
  ".corp",
  ".example",
  ".home",
  ".home.arpa",
  ".internal",
  ".invalid",
  ".intranet",
  ".lan",
  ".local",
  ".localdomain",
  ".localhost",
  ".onion",
  ".private",
  ".test",
];

export function duckDuckGoFaviconUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!isPublicHostname(hostname)) return null;
    return `${DUCKDUCKGO_FAVICON_ORIGIN}/ip9/${encodeURIComponent(hostname)}.ico`;
  } catch {
    return null;
  }
}

function isPublicHostname(hostname: string): boolean {
  if (!hostname.includes(".") || hostname.startsWith("[") || isIPv4Address(hostname)) return false;
  return !SPECIAL_USE_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

function isIPv4Address(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}
