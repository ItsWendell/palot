import { workspaceRelativePath } from "./file-reference";

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
};
export type MarkdownMediaSource = {
  kind: "audio" | "video";
  mime: string;
  url?: string;
  path?: string;
};

/** No HTTP(S), protocol-relative URLs, out-of-workspace files or automatic remote fetches. */
export function markdownMediaSource(
  value: string | undefined,
  directory?: string,
): MarkdownMediaSource | null {
  if (!value) return null;
  const src = value.trim();
  const dataMime = src.match(/^data:((?:audio|video)\/[\w.+-]+)[;,]/i)?.[1];
  if (dataMime)
    return { kind: dataMime.startsWith("video/") ? "video" : "audio", mime: dataMime, url: src };
  const extension = src.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const mime = extension ? MIME[extension] : undefined;
  if (src.startsWith("blob:"))
    return {
      kind: mime?.startsWith("audio/") ? "audio" : "video",
      mime: mime ?? "video/webm",
      url: src,
    };
  if (!mime || !directory || src.startsWith("//")) return null;
  let path = src;
  if (src.startsWith("file:")) {
    try {
      const url = new URL(src);
      if (url.hostname && url.hostname !== "localhost") return null;
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[A-Za-z]:[\\/]/.test(src)) return null;
  path = workspaceRelativePath(directory, path.replace(/[?#].*$/, "")) ?? "";
  return path ? { kind: mime.startsWith("audio/") ? "audio" : "video", mime, path } : null;
}
