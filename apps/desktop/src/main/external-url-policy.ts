const MAX_EXTERNAL_URL_LENGTH = 8_192;

export function allowedExternalUrl(input: string, _development?: boolean): string | null {
  if (input.length > MAX_EXTERNAL_URL_LENGTH) return null;
  try {
    const url = new URL(input);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    return null;
  } catch {
    return null;
  }
}
