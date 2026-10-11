import type { OpenCodePairImportInput } from "../../shared";
import { preferredPairingAddress } from "./pairing-address";

export function parsePairingText(
  text: string,
  selectedAddress = "",
): {
  input:
    | Omit<Extract<OpenCodePairImportInput, { link: string }>, "allowPlainHttp">
    | Omit<Extract<OpenCodePairImportInput, { payload: unknown }>, "allowPlainHttp">;
  urls: string[];
  selectedAddress?: string;
} {
  if (text.length > 16_384) throw new Error("Pairing details are too long.");
  if (!text.trim().startsWith("{")) {
    let url: URL;
    try {
      url = new URL(text.trim());
    } catch {
      throw new Error("Enter a complete one-time pairing URL or pairing JSON.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/auth\/connect\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname) ||
      text.length > 2_048
    )
      throw new Error("Enter an OpenCode one-time pairing URL without extra parameters.");
    return { input: { link: text.trim() }, urls: [url.origin] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Enter valid pairing JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid pairing JSON.");
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.urls) || !payload.urls.length || payload.urls.length > 16)
    throw new Error("Pairing JSON needs between 1 and 16 server URLs.");
  const urls = [
    ...new Set(
      payload.urls.map((address: unknown) => {
        if (typeof address !== "string" || address.length > 2_048)
          throw new Error("Pairing JSON contains an invalid server URL.");
        const url = new URL(address.trim());
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error("Pairing JSON contains an invalid server URL.");
        return url.origin;
      }),
    ),
  ];
  if ("code" in payload) {
    if (
      typeof payload.code !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(payload.code) ||
      "username" in payload ||
      "password" in payload
    )
      throw new Error("One-time pairing JSON needs a valid code, without reusable credentials.");
    const address = selectedAddress || preferredPairingAddress(urls)!;
    if (!urls.includes(address)) throw new Error("Select an advertised pairing address.");
    // Redeem exactly one explicitly displayed target. Never send the code to every address.
    return {
      input: { link: `${address}/auth/connect/${payload.code}` },
      urls,
      selectedAddress: address,
    };
  }
  if (
    typeof payload.username !== "string" ||
    !payload.username ||
    typeof payload.password !== "string" ||
    !payload.password
  )
    throw new Error("Legacy pairing JSON needs server URLs, username, and password.");
  return {
    input: { payload: { urls, username: payload.username, password: payload.password } },
    urls,
  };
}
