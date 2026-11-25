/** Longest server name Palot keeps, matching the profile name limit with room to spare. */
export const SERVER_NAME_MAX_LENGTH = 80;

// Control characters, and bidirectional overrides that can make a name read as another one.
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * A server name from a pairing QR code, a machine's hostname or a person: trimmed with inner
 * whitespace collapsed. Returns null for anything that is not a usable name, so callers fall back
 * to the address. Names travel only inside pairing details the owner chooses to share.
 */
export function normalizeServerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (UNSAFE.test(value.replace(/[\t\n\r]/g, " "))) return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || [...name].length > SERVER_NAME_MAX_LENGTH) return null;
  return name;
}

/** A machine hostname as a friendly default ("studio.local" → "studio"). */
export function serverNameFromHostname(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  return normalizeServerName(hostname.replace(/\.(?:local|lan|home|localdomain)\.?$/i, ""));
}

/** Pick a name no other connection uses: "Studio", then "Studio (2)". */
export function uniqueServerName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((value) => value.toLocaleLowerCase()));
  if (!used.has(name.toLocaleLowerCase())) return name;
  for (let index = 2; ; index += 1) {
    const candidate = `${name} (${index})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
