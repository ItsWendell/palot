import type { OpenCodePairingInfo, OpenCodeWebAccessInfo } from "../../shared";
import { normalizeServerName } from "../../shared/server-name";
import { isLocalBrowserURL } from "./browser-address";

/** Prefer an encrypted, reachable address without changing the server's advertised origins. */
export function preferredPairingAddress(urls: string[]): string | undefined {
  return (
    urls.find(
      (address) => address.startsWith("https://") && !isLocalBrowserURL(new URL(address)),
    ) ??
    urls.find((address) => !isLocalBrowserURL(new URL(address))) ??
    urls[0]
  );
}

/** Addresses another device can reach. A scanning device's localhost is not this computer. */
export function reachablePairingAddresses(info: OpenCodePairingInfo): string[] {
  return info.urls.filter((address) => !isLocalBrowserURL(new URL(address)));
}

/**
 * The QR payload: OpenCode's `{"code","urls","name"?}` JSON (OpenCode's app reads `name` since
 * #64139 "name a paired server from its QR code"; older readers ignore it). Legacy servers share
 * reusable credentials instead. Null when no address is reachable from another device.
 */
export function pairingQRCodePayload(
  info: OpenCodePairingInfo,
  name?: string | null,
): string | null {
  const label = normalizeServerName(name);
  if (info.mode === "credentials") {
    if (!label) return info.payload;
    const { urls, username, password } = JSON.parse(info.payload) as Record<string, unknown>;
    return JSON.stringify({ urls, username, password, name: label });
  }
  const urls = reachablePairingAddresses(info);
  return urls.length
    ? JSON.stringify(label ? { code: info.code, urls, name: label } : { code: info.code, urls })
    : null;
}

/**
 * The pairing details to copy: the QR payload, or, when only this computer's own addresses exist
 * (an SSH port forward, a second app on this machine), the same JSON with those addresses.
 */
export function pairingCopyPayload(info: OpenCodePairingInfo, name?: string | null): string {
  const qr = pairingQRCodePayload(info, name);
  if (qr) return qr;
  if (info.mode === "credentials") return info.payload;
  const label = normalizeServerName(name);
  return JSON.stringify(
    label
      ? { code: info.code, urls: info.urls, name: label }
      : { code: info.code, urls: info.urls },
  );
}

export function suggestedPairingAddress(info: OpenCodeWebAccessInfo | null): string | null {
  if (!info?.local.available || info.tailscale.serveState !== "active") return null;
  const { url } = info.local;
  const { proxyTarget, publicUrl } = info.tailscale;
  if (!url || !proxyTarget) return null;
  try {
    return new URL(url).origin === new URL(proxyTarget).origin ? publicUrl : null;
  } catch {
    return null;
  }
}

/** The override changes only advertised addresses, never the pairing secret. */
export function pairingInfoForAddress(
  info: OpenCodePairingInfo,
  address: string,
): OpenCodePairingInfo {
  if (!address.trim()) {
    return info.mode === "link"
      ? {
          ...info,
          payload: `${preferredPairingAddress(info.urls)}/auth/connect/${encodeURIComponent(info.code)}`,
        }
      : info;
  }
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new Error("Enter a complete HTTPS address for your OpenCode proxy.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Use HTTPS for a custom pairing address to protect pairing secrets.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use a server address without credentials, a path, query, or fragment.");
  }
  if (info.mode === "link") {
    return {
      ...info,
      urls: [url.origin],
      payload: `${url.origin}/auth/connect/${encodeURIComponent(info.code)}`,
    };
  }
  const payload = { urls: [url.origin], username: info.username, password: info.password };
  return { mode: "credentials", ...payload, payload: JSON.stringify(payload), name: info.name };
}
