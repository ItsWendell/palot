/** Shared safe Markdown renderer for messages, responses, and reasoning. */

import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { calloutsExtension } from "@tanstack/markdown/extensions/callouts";
import type { MarkdownComponentProps, MarkdownComponents } from "@tanstack/markdown/react";
import type { InlineNode, MarkdownExtension } from "@tanstack/markdown";
import { useAtomValue } from "jotai";
import {
  Braces,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FileText,
  Globe2,
  ZoomIn,
} from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { LocationRef } from "@opencode/client";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useWorkspaceFile } from "../hooks/use-workspace-file";
import { remoteMarkdownFaviconsAtom } from "../atoms/ui";
import { cn } from "../lib/cn";
import { duckDuckGoFaviconUrl } from "../lib/markdown-favicon";
import { transformInlineMath } from "../lib/markdown-math";
import { isCompleteSessionID, sessionLinksExtension } from "../lib/markdown-session-links";
import { palot } from "../services/palot";
import { isLocalBrowserURL } from "../lib/browser-address";
import { MarkdownCodeBlock } from "./markdown-code-block";
import type { CodeAnimationRange } from "./highlighted-code";
import { PalotMarkdown, useMarkdownBlockStreaming } from "./palot-markdown-react";
import { ImageLightbox } from "./read-image-preview";
import {
  fileReferenceHref,
  fileReferenceLabel,
  parseFileReference,
  workspaceRelativePath,
  type FileReference,
} from "../lib/file-reference";
import { MarkdownInlineMath, MarkdownMath } from "./markdown-rich";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

const MARKDOWN_EXTENSIONS = [
  calloutsExtension(),
  mathExtension(),
  detailsExtension(),
  autoLinkExtension(),
  setextHeadingExtension(),
  indentedCodeExtension(),
  streamingMarkdownExtension(),
];
const MarkdownRenderContext = createContext({
  baseUrl: undefined as string | undefined,
  idPrefix: "markdown",
  passiveMedia: false,
  remoteFavicons: false,
  streaming: false,
});
const MarkdownLinkContext = createContext(false);
export type WorkspaceFileOpenHandler = (
  reference: MarkdownFileReference,
  event?: ReactMouseEvent | ReactKeyboardEvent,
) => void;
const MarkdownWorkspaceDirectoryContext = createContext<string | undefined>(undefined);
const MarkdownWorkspaceLocationContext = createContext<LocationRef | undefined>(undefined);
const MarkdownWorkspaceFileContext = createContext<WorkspaceFileOpenHandler | null>(null);
/** `~` is the server's home; only a local connection can open it. */
const MarkdownHomePathsContext = createContext(false);
const MarkdownWebLinkContext = createContext<((url: string) => void) | null>(null);
const MarkdownSessionLinkContext = createContext<((sessionID: string) => void) | null>(null);

function MarkdownDetails({
  children,
  open,
  "data-summary": summary,
}: {
  children?: ReactNode;
  open?: string;
  "data-summary"?: string;
}) {
  return (
    <details open={open !== undefined} className="markdown-details">
      <summary>
        <ChevronDown className="markdown-details-chevron" aria-hidden="true" />
        <span>{summary || "Details"}</span>
      </summary>
      <div className="markdown-details-content">{children}</div>
    </details>
  );
}

export type MarkdownFileReference = FileReference;

export function MarkdownWorkspaceProvider({
  children,
  onOpenFile,
  onOpenWebLink,
  onOpenSession,
  workspaceDirectory,
  workspaceLocation,
  allowHomePaths = false,
}: {
  children?: ReactNode;
  onOpenFile(reference: MarkdownFileReference, event?: ReactMouseEvent | ReactKeyboardEvent): void;
  onOpenWebLink?(url: string): void;
  onOpenSession?(sessionID: string): void;
  workspaceDirectory?: string;
  /** Lets local workspace images load through the task's own OpenCode server. */
  workspaceLocation?: LocationRef;
  /** Link `~/…` paths; only meaningful when the server shares this machine's home. */
  allowHomePaths?: boolean;
}) {
  return (
    <MarkdownHomePathsContext.Provider value={allowHomePaths}>
      <MarkdownWorkspaceLocationContext.Provider value={workspaceLocation}>
        <MarkdownWorkspaceDirectoryContext.Provider value={workspaceDirectory}>
          <MarkdownWorkspaceFileContext.Provider value={onOpenFile}>
            <MarkdownWebLinkContext.Provider value={onOpenWebLink ?? null}>
              <MarkdownSessionLinkContext.Provider value={onOpenSession ?? null}>
                {children}
              </MarkdownSessionLinkContext.Provider>
            </MarkdownWebLinkContext.Provider>
          </MarkdownWorkspaceFileContext.Provider>
        </MarkdownWorkspaceDirectoryContext.Provider>
      </MarkdownWorkspaceLocationContext.Provider>
    </MarkdownHomePathsContext.Provider>
  );
}

export function useWorkspaceFileOpener() {
  return useContext(MarkdownWorkspaceFileContext);
}

export function useWorkspaceDirectory() {
  return useContext(MarkdownWorkspaceDirectoryContext);
}

export function isLocalMarkdownWebLink(url: URL): boolean {
  return isLocalBrowserURL(url);
}

function MarkdownPre({ children, ...props }: MarkdownComponentProps<"pre">) {
  const { streaming } = useContext(MarkdownRenderContext);
  const blockStreaming = useMarkdownBlockStreaming();
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return <pre {...props}>{children}</pre>;
  }
  const projection = projectStreamingCode(children.props.children);
  const code = projection.code.replace(/\n$/, "");
  const language = children.props.className?.match(/language-([^\s]+)/)?.[1] ?? "text";
  const metadata = props as typeof props &
    Record<"data-code-meta" | "data-code-highlight-lines" | "data-filename", string | undefined>;
  const meta = metadata["data-code-meta"];
  const highlightLines = metadata["data-code-highlight-lines"]
    ?.split(",")
    .map(Number)
    .filter((line) => Number.isSafeInteger(line) && line > 0);
  const live = streaming && blockStreaming;
  return (
    <MarkdownCodeBlock
      code={code}
      language={language}
      streaming={live}
      animationRanges={projection.animationRanges}
      filename={metadata["data-filename"]}
      lineNumbers={meta ? /\b(?:lineNumbers|showLineNumbers)\b/.test(meta) : false}
      highlightLines={highlightLines}
    />
  );
}

function MarkdownTable({
  children,
  "data-table-copy": serialized,
}: {
  children?: ReactNode;
  "data-table-copy"?: string;
}) {
  const { copiedKey, copy } = useClipboardCopy();
  const formats = useMemo(() => {
    try {
      return JSON.parse(serialized ?? "{}") as { markdown?: string; tsv?: string; csv?: string };
    } catch {
      return {};
    }
  }, [serialized]);

  function copyTable(format: "tsv" | "markdown" | "csv") {
    const value = formats[format];
    if (!value) return;
    void copy(value, format);
  }

  return (
    <div className="markdown-table-frame">
      <div className="markdown-table-actions">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy table">
                {copiedKey ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => copyTable("tsv")}>Copy as TSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyTable("markdown")}>
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyTable("csv")}>Copy as CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <table>{children}</table>
    </div>
  );
}

function projectStreamingCode(children: ReactNode): {
  code: string;
  animationRanges: CodeAnimationRange[];
} {
  let code = "";
  const animationRanges: CodeAnimationRange[] = [];

  const visit = (node: ReactNode): void => {
    if (typeof node === "string" || typeof node === "number") {
      code += String(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (
      !isValidElement<{
        children?: ReactNode;
        style?: Record<string, string | number>;
        "data-markdown-stream-code"?: string;
        "data-markdown-stream-start-at"?: string | number;
      }>(node)
    ) {
      return;
    }

    const start = code.length;
    visit(node.props.children);
    const end = code.length;
    if (node.props["data-markdown-stream-code"] === undefined || end <= start) return;
    const delay = milliseconds(node.props.style?.["--palot-markdown-stream-delay"]);
    const duration = milliseconds(node.props.style?.["--palot-markdown-stream-duration"]);
    const startAt = milliseconds(node.props["data-markdown-stream-start-at"]);
    animationRanges.push({ start, end, delay, duration, startAt });
  };

  visit(children);
  return { code, animationRanges };
}

function milliseconds(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function MarkdownLink({ href, children, ...props }: MarkdownComponentProps<"a">) {
  const { baseUrl, idPrefix, remoteFavicons } = useContext(MarkdownRenderContext);
  const openWorkspaceFile = useContext(MarkdownWorkspaceFileContext);
  const openWebLink = useContext(MarkdownWebLinkContext);
  const allowHome = useContext(MarkdownHomePathsContext);
  const fileReference =
    !baseUrl && openWorkspaceFile ? parseFileReference(href, { source: "href", allowHome }) : null;
  if (fileReference && openWorkspaceFile) {
    return (
      <MarkdownLinkContext.Provider value>
        <MarkdownFileLink reference={fileReference} onOpen={openWorkspaceFile}>
          {children}
        </MarkdownFileLink>
      </MarkdownLinkContext.Provider>
    );
  }
  const resolvedHref = resolveMarkdownLinkUrl(href, baseUrl, idPrefix);
  const isWebUrl = Boolean(
    resolvedHref && (/^https?:\/\//i.test(resolvedHref) || resolvedHref.startsWith("//")),
  );
  // Like OpenCode, only labelled web links get a site icon; email, files and image links stay plain.
  const icon =
    isWebUrl && !containsMarkdownImage(children)
      ? markdownLinkIcon(resolvedHref, remoteFavicons)
      : null;
  return (
    <MarkdownLinkContext.Provider value>
      <a
        {...props}
        className={cn(props.className, icon && "markdown-link")}
        href={resolvedHref}
        target={isWebUrl ? "_blank" : undefined}
        rel={isWebUrl ? "noopener noreferrer" : undefined}
        onClick={(event) => {
          if (resolvedHref?.startsWith("#")) {
            event.preventDefault();
            document.getElementById(resolvedHref.slice(1))?.scrollIntoView({ block: "start" });
            return;
          }
          if (isWebUrl && resolvedHref) {
            event.preventDefault();
            if (openWebLink) openWebLink(resolvedHref);
            else void palot.openExternalUrl(resolvedHref);
          }
        }}
      >
        {icon ? (
          <>
            {icon}
            <span className="markdown-link-label">{children}</span>
          </>
        ) : (
          children
        )}
      </a>
    </MarkdownLinkContext.Provider>
  );
}

function containsMarkdownImage(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement<{ children?: ReactNode }>(child) &&
      (child.type === MarkdownImage ||
        child.type === "img" ||
        containsMarkdownImage(child.props.children)),
  );
}

function markdownLinkIcon(href: string | undefined, remoteFavicons: boolean): ReactNode {
  if (!href || href.startsWith("#")) return null;
  const faviconUrl = remoteFavicons ? duckDuckGoFaviconUrl(href) : null;
  if (!faviconUrl) return <MarkdownLinkIconFrame />;
  return <RemoteMarkdownLinkIcon key={faviconUrl} faviconUrl={faviconUrl} />;
}

function MarkdownLinkIconFrame({ children }: { children?: ReactNode }) {
  return (
    <span className="markdown-link-icon" aria-hidden="true" data-markdown-copy="exclude">
      <Globe2 />
      {children}
    </span>
  );
}

function RemoteMarkdownLinkIcon({ faviconUrl }: { faviconUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <MarkdownLinkIconFrame>
      {!failed ? (
        <img
          className={cn("markdown-link-favicon", loaded && "is-loaded")}
          src={faviconUrl}
          alt=""
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </MarkdownLinkIconFrame>
  );
}

function MarkdownInlineCode({ children, className, ...props }: MarkdownComponentProps<"code">) {
  const openWorkspaceFile = useContext(MarkdownWorkspaceFileContext);
  const allowHome = useContext(MarkdownHomePathsContext);
  const linked = useContext(MarkdownLinkContext);
  const value = projectStreamingCode(children).code;
  // Code that is exactly a web URL opens like a link; code inside a link already goes there.
  const url = !className && !linked ? inlineCodeUrl(value) : undefined;
  if (url) {
    return (
      <MarkdownLink href={url}>
        <code {...props}>{children}</code>
      </MarkdownLink>
    );
  }
  const reference =
    !className && !value.includes("\n") && openWorkspaceFile
      ? parseFileReference(value, { source: "code", allowHome })
      : null;
  if (reference && openWorkspaceFile) {
    return (
      <MarkdownFileLink reference={reference} onOpen={openWorkspaceFile}>
        {fileReferenceLabel(reference)}
      </MarkdownFileLink>
    );
  }
  return (
    <code {...props} className={className}>
      {children}
    </code>
  );
}

function MarkdownFileLink({
  reference,
  onOpen,
  children,
}: {
  reference: MarkdownFileReference;
  onOpen: WorkspaceFileOpenHandler;
  children: ReactNode;
}) {
  const workspaceDirectory = useContext(MarkdownWorkspaceDirectoryContext);
  const icon = workspaceFileIcon(reference.path);
  const fileHref = fileReferenceHref(reference, workspaceDirectory);
  const label = fileReferenceLabel(reference);
  const open = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.preventDefault();
    onOpen(reference, event);
  };

  return (
    <a
      href={fileHref}
      role={fileHref ? undefined : "link"}
      tabIndex={fileHref ? undefined : 0}
      title={label}
      aria-label={`Open ${label}`}
      onClick={open}
      onKeyDown={(event) => {
        if (!fileHref && event.key === "Enter") open(event);
      }}
      className="inline-flex max-w-full cursor-pointer items-center gap-1 text-info underline-offset-4 outline-none hover:underline focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring aria-busy:cursor-progress aria-busy:opacity-70"
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </a>
  );
}

function workspaceFileIcon(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "json" || extension === "jsonc") {
    return <Braces className="size-[0.9em] shrink-0" aria-hidden="true" />;
  }
  if (["md", "mdx", "txt", "rst"].includes(extension ?? "")) {
    return <FileText className="size-[0.9em] shrink-0" aria-hidden="true" />;
  }
  return <FileCode2 className="size-[0.9em] shrink-0" aria-hidden="true" />;
}

function MarkdownImage({ alt, src, className, title, ...props }: MarkdownComponentProps<"img">) {
  const { baseUrl, passiveMedia } = useContext(MarkdownRenderContext);
  const workspaceLocation = useContext(MarkdownWorkspaceLocationContext);
  const localImage = workspaceLocation
    ? localMarkdownImage(src, workspaceLocation.directory)
    : null;
  if (localImage && workspaceLocation) {
    return (
      <WorkspaceMarkdownImage
        {...props}
        alt={alt}
        title={title}
        className={className}
        image={localImage}
        location={workspaceLocation}
      />
    );
  }

  const placeholder = <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>;
  // Remote images stay gated so rendering never silently fetches tracking URLs.
  if (!passiveMedia) return placeholder;

  const resolvedSrc = resolveMarkdownImageUrl(src, baseUrl);
  if (!resolvedSrc) return placeholder;
  return (
    <MarkdownImageView
      {...props}
      alt={alt}
      title={title}
      className={className}
      src={resolvedSrc}
      name={markdownImageName(alt, resolvedSrc)}
      mime={markdownImageMime(resolvedSrc)}
    />
  );
}

interface LocalMarkdownImage {
  /** Path shown to people and opened outside Palot when the image is not in the workspace. */
  path: string;
  /** Workspace-relative path read through OpenCode, or null outside the workspace. */
  relativePath: string | null;
}

const LOCAL_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

function localMarkdownImage(
  src: string | undefined,
  workspaceDirectory: string,
): LocalMarkdownImage | null {
  if (!src) return null;
  const value = src.trim();
  // Any other URL scheme (https:, data:, blob:, …) is not a local file reference.
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("file:") &&
    !/^[A-Za-z]:[\\/]/.test(value)
  )
    return null;
  let path = value;
  if (value.startsWith("file:")) {
    try {
      path = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
  }
  path = path.replace(/[?#].*$/, "");
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (!extension || !LOCAL_IMAGE_EXTENSIONS.has(extension)) return null;
  const relativePath = path.startsWith("~")
    ? null
    : workspaceRelativePath(workspaceDirectory, path);
  return { path, relativePath: relativePath || null };
}

function WorkspaceMarkdownImage({
  alt,
  title,
  className,
  image,
  location,
  ...props
}: Omit<MarkdownComponentProps<"img">, "src"> & {
  image: LocalMarkdownImage;
  location: LocationRef;
}) {
  const openFile = useContext(MarkdownWorkspaceFileContext);
  const query = useWorkspaceFile(location, image.relativePath ?? "", image.relativePath !== null);
  const mime = markdownImageMime(image.path);
  const objectURL = useBlobURL(query.data, mime);
  const name = markdownImageName(alt, image.path);

  if (image.relativePath !== null && objectURL) {
    return (
      <MarkdownImageView
        {...props}
        alt={alt}
        title={title}
        className={className}
        src={objectURL}
        name={name}
        mime={mime}
      />
    );
  }

  const loading = image.relativePath !== null && query.isPending;
  const label = loading ? `Loading image: ${name}` : alt ? `[Image: ${alt}]` : `[Image: ${name}]`;
  if (!openFile || loading) return <span className="text-muted-foreground">{label}</span>;
  // Outside the workspace (or unreadable): keep the reference actionable instead of inert text.
  return (
    <button
      type="button"
      title={image.path}
      aria-label={`Open image ${image.path}`}
      onClick={(event) => openFile({ path: image.path }, event)}
      className="cursor-pointer text-info underline-offset-4 outline-none hover:underline focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}

function useBlobURL(data: Uint8Array | undefined, mime: string): string | null {
  const [entry, setEntry] = useState<{ data: Uint8Array; url: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mime }));
    setEntry({ data, url });
    return () => URL.revokeObjectURL(url);
  }, [data, mime]);
  return entry && entry.data === data ? entry.url : null;
}

function MarkdownImageView({
  alt,
  src,
  className,
  title,
  name,
  mime,
  ...props
}: MarkdownComponentProps<"img"> & { src: string; name: string; mime: string }) {
  const linked = useContext(MarkdownLinkContext);
  const [open, setOpen] = useState(false);
  const dimensions = markdownImageDimensions(title);
  const image = (
    <img
      {...props}
      alt={alt}
      src={src}
      {...(title ? { title } : {})}
      {...(dimensions ? { width: dimensions.width, height: dimensions.height } : {})}
      draggable={false}
      className={cn("max-w-full rounded-lg", className)}
    />
  );

  if (linked) return image;

  return (
    <>
      <button
        type="button"
        aria-label={`Open image preview: ${name}`}
        onClick={() => setOpen(true)}
        className="group relative inline-flex max-w-full cursor-zoom-in overflow-hidden rounded-lg align-middle outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {image}
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/20 group-hover:opacity-100 group-focus-visible:bg-black/20 group-focus-visible:opacity-100">
          <span className="grid size-9 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-sm backdrop-blur-sm">
            <ZoomIn className="size-4" aria-hidden="true" />
          </span>
        </span>
      </button>
      <ImageLightbox src={src} name={name} mime={mime} open={open} onOpenChange={setOpen} />
    </>
  );
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  code: MarkdownInlineCode,
  img: MarkdownImage,
  pre: MarkdownPre,
  table: MarkdownTable,
  "palot-math": MarkdownMath,
  "palot-inline-math": MarkdownInlineMath,
  "palot-details": MarkdownDetails,
  "palot-session-link": MarkdownSessionLink,
} satisfies MarkdownComponents;

function MarkdownSessionLink({
  children,
  "data-session-id": sessionID,
}: {
  children?: ReactNode;
  "data-session-id"?: string;
}) {
  const openSession = useContext(MarkdownSessionLinkContext);
  if (!openSession || !sessionID || !isCompleteSessionID(sessionID)) return <>{children}</>;
  return (
    <button
      type="button"
      className="cursor-pointer text-info underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => openSession(sessionID)}
    >
      {children}
    </button>
  );
}

interface MarkdownContentProps {
  value: string;
  className?: string;
  streaming?: boolean;
  passiveMedia?: boolean;
  baseUrl?: string;
}

export const MarkdownContent = memo(function MarkdownContent({
  value,
  className,
  streaming = false,
  passiveMedia = false,
  baseUrl,
}: MarkdownContentProps) {
  return (
    <div className={cn("markdown typeset-chat select-text", className)}>
      <MarkdownBody
        value={value}
        streaming={streaming}
        passiveMedia={passiveMedia}
        baseUrl={baseUrl}
      />
    </div>
  );
});

const MarkdownBody = memo(function MarkdownBody({
  value,
  streaming,
  passiveMedia,
  baseUrl,
}: Required<Pick<MarkdownContentProps, "value" | "streaming" | "passiveMedia">> &
  Pick<MarkdownContentProps, "baseUrl">) {
  const remoteFavicons = useAtomValue(remoteMarkdownFaviconsAtom);
  const openSession = useContext(MarkdownSessionLinkContext);
  const extensions = useMemo(
    () =>
      openSession && !baseUrl
        ? [...MARKDOWN_EXTENSIONS, sessionLinksExtension(streaming)]
        : MARKDOWN_EXTENSIONS,
    [baseUrl, openSession, streaming],
  );
  const generatedID = useId().replaceAll(":", "");
  const idPrefix = `markdown-${generatedID}`;
  const context = useMemo(
    () => ({ baseUrl, idPrefix, passiveMedia, remoteFavicons, streaming }),
    [baseUrl, idPrefix, passiveMedia, remoteFavicons, streaming],
  );
  return (
    <MarkdownRenderContext.Provider value={context}>
      <PalotMarkdown
        allowHtml={false}
        components={MARKDOWN_COMPONENTS}
        extensions={extensions}
        frontmatter={false}
        headingIds
        idPrefix={idPrefix}
        streaming={streaming}
      >
        {value}
      </PalotMarkdown>
    </MarkdownRenderContext.Provider>
  );
});

function resolveMarkdownLinkUrl(
  value: string | undefined,
  baseUrl: string | undefined,
  idPrefix: string,
): string | undefined {
  if (value?.startsWith("#")) {
    const id = value.slice(1);
    return `#${id.startsWith(`${idPrefix}-`) ? id : `${idPrefix}-${id}`}`;
  }
  if (!value || !baseUrl) return value;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function resolveMarkdownImageUrl(
  value: string | undefined,
  baseUrl: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function markdownImageName(alt: string | undefined, src: string | undefined): string {
  if (alt?.trim()) return alt.trim();
  if (!src) return "Image";
  try {
    const filename = new URL(src, "https://markdown.invalid").pathname.split("/").at(-1);
    return filename ? decodeURIComponent(filename) : "Image";
  } catch {
    return "Image";
  }
}

function markdownImageMime(src: string): string {
  const dataMime = src.match(/^data:([^;,]+)/)?.[1];
  if (dataMime) return dataMime;

  const extension = src.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  if (extension === "svg") return "image/svg+xml";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension && ["avif", "bmp", "gif", "png", "webp"].includes(extension)) {
    return `image/${extension}`;
  }
  return "Image";
}

function markdownImageDimensions(
  title: string | undefined,
): { width: number; height: number } | null {
  if (!title) return null;
  const named = title.match(/width\s*=\s*(\d{1,4}).*height\s*=\s*(\d{1,4})/i);
  const shorthand = title.match(/(\d{1,4})\s*(?:x|×)\s*(\d{1,4})/i);
  const width = Number(named?.[1] ?? shorthand?.[1]);
  const height = Number(named?.[2] ?? shorthand?.[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function detailsExtension(): MarkdownExtension {
  return {
    name: "palot-details",
    parseBlock(context) {
      const opening = context.lines[context.index]?.match(/^ {0,3}<details(\s+open)?\s*>\s*$/i);
      if (!opening) return undefined;

      const body: string[] = [];
      let summary = "Details";
      let cursor = context.index + 1;
      let foundEnd = false;
      while (cursor < context.lines.length) {
        const line = context.lines[cursor] ?? "";
        if (/^ {0,3}<\/details>\s*$/i.test(line)) {
          foundEnd = true;
          cursor += 1;
          break;
        }
        const summaryMatch = line.match(/^ {0,3}<summary>(.*?)<\/summary>\s*$/i);
        if (summaryMatch) {
          summary = summaryMatch[1]?.trim() || summary;
        } else {
          body.push(line);
        }
        cursor += 1;
      }

      if (!foundEnd) return undefined;
      context.consume(cursor - context.index);
      return {
        type: "component",
        name: "details",
        tagName: "palot-details",
        attributes: {},
        properties: {
          "data-summary": summary,
          ...(opening[1] ? { open: "true" } : {}),
        },
        children: context.parseBlocks(body.join("\n")),
      };
    },
  };
}

function mathExtension(): MarkdownExtension {
  return {
    name: "palot-math",
    parseBlock(context) {
      if (!/^ {0,3}\$\$\s*$/.test(context.lines[context.index] ?? "")) return undefined;
      const body: string[] = [];
      let cursor = context.index + 1;
      while (
        cursor < context.lines.length &&
        !/^ {0,3}\$\$\s*$/.test(context.lines[cursor] ?? "")
      ) {
        body.push(context.lines[cursor] ?? "");
        cursor += 1;
      }
      if (cursor >= context.lines.length) return undefined;
      context.consume(cursor - context.index + 1);
      return {
        type: "component",
        name: "math",
        tagName: "palot-math",
        attributes: {},
        properties: { "data-math": body.join("\n") },
        children: [],
      };
    },
    transformInline(nodes) {
      return transformInlineMath(nodes);
    },
  };
}

function indentedCodeExtension(): MarkdownExtension {
  return {
    name: "palot-indented-code",
    parseBlock(context) {
      if (indentedCodeLine(context.lines[context.index]) === null) return undefined;

      const code: string[] = [];
      let count = 0;
      while (context.index + count < context.lines.length) {
        const line = context.lines[context.index + count] ?? "";
        const value = indentedCodeLine(line);
        if (value !== null) {
          code.push(value);
          count += 1;
          continue;
        }
        if (
          line.trim() === "" &&
          indentedCodeLine(context.lines[context.index + count + 1]) !== null
        ) {
          code.push("");
          count += 1;
          continue;
        }
        break;
      }
      context.consume(count);
      return { type: "code", value: code.join("\n") };
    },
  };
}

function indentedCodeLine(line: string | undefined): string | null {
  if (line?.startsWith("\t")) return line.slice(1);
  return line?.startsWith("    ") ? line.slice(4) : null;
}

function setextHeadingExtension(): MarkdownExtension {
  return {
    name: "palot-setext-headings",
    parseBlock(context) {
      const value = context.lines[context.index];
      const underline = context.lines[context.index + 1];
      const match = underline?.match(/^ {0,3}(=+|-+)\s*$/);
      if (!value?.trim() || !match || startsBlock(value)) return undefined;

      context.consume(2);
      return {
        type: "heading",
        depth: match[1]?.startsWith("=") ? 1 : 2,
        children: context.parseInline(value.trim()),
      };
    },
  };
}

function startsBlock(value: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,}|(?:[*+-]|\d+[.)])\s+)/.test(value);
}

function autoLinkExtension(): MarkdownExtension {
  return {
    name: "palot-auto-links",
    transformInline: autoLinkNodes,
  };
}

function autoLinkNodes(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "text") return autoLinkText(node.value);
    if (node.type === "strong" || node.type === "emphasis" || node.type === "strike") {
      return [{ ...node, children: autoLinkNodes(node.children) }];
    }
    return [node];
  });
}

function autoLinkText(value: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern = /(?:https?:\/\/|file:\/\/|www\.)[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    if (insideIncompleteLinkDestination(value, start)) continue;
    const literal = trimAutoLinkLiteral(match[0]);
    // Like GFM, a web autolink needs a host right after its prefix.
    if (/^(?:https?:\/\/|www\.)(?![A-Za-z0-9-])/i.test(literal)) continue;
    const href = literal.startsWith("www.")
      ? `http://${literal}`
      : literal.startsWith("http://") ||
          literal.startsWith("https://") ||
          literal.startsWith("file://")
        ? literal
        : `mailto:${literal}`;
    if (start > offset) nodes.push({ type: "text", value: value.slice(offset, start) });
    nodes.push({ type: "link", href, children: [{ type: "text", value: literal }] });
    offset = start + literal.length;
  }
  if (offset < value.length) nodes.push({ type: "text", value: value.slice(offset) });
  return nodes.length > 0 ? nodes : [{ type: "text", value }];
}

/** GFM-style trailing punctuation backtracking, matching OpenCode's marked autolinks. */
function trimAutoLinkLiteral(value: string): string {
  let end = value.length;
  let previous = -1;
  while (end !== previous) {
    previous = end;
    while (/[.,!?;:*_'"~]$/.test(value.slice(0, end))) end -= 1;
    while (value[end - 1] === ")" && unbalancedClosing(value.slice(0, end), "(", ")")) end -= 1;
    while (value[end - 1] === "]" && unbalancedClosing(value.slice(0, end), "[", "]")) end -= 1;
  }
  return value.slice(0, end);
}

/** OpenCode links inline code only when the whole span is one web URL. */
function inlineCodeUrl(value: string): string | undefined {
  const href = value.trim().replace(/[),.;!?]+$/, "");
  if (!/^https?:\/\/[^\s<>()`"']+$/i.test(href)) return undefined;
  try {
    return new URL(href).href;
  } catch {
    return undefined;
  }
}

function unbalancedClosing(value: string, open: string, close: string): boolean {
  return value.split(close).length > value.split(open).length;
}

function insideIncompleteLinkDestination(value: string, offset: number): boolean {
  return value.lastIndexOf("](", offset) > value.lastIndexOf(")", offset);
}
