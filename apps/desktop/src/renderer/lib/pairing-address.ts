import type { OpenCodePairingInfo, OpenCodeWebAccessInfo } from "../../shared";

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
      ? { ...info, payload: `${info.urls[0]}/auth/connect/${encodeURIComponent(info.code)}` }
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
  return { mode: "credentials", ...payload, payload: JSON.stringify(payload) };
}
