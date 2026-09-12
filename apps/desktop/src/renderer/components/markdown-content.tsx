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
  createContext,
  isValidElement,
  memo,
  useContext,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { remoteMarkdownFaviconsAtom } from "../atoms/ui";
import { cn } from "../lib/cn";
import { duckDuckGoFaviconUrl } from "../lib/markdown-favicon";
import { transformInlineMath } from "../lib/markdown-math";
import { palot } from "../services/palot";
import { MarkdownCodeBlock } from "./markdown-code-block";
import type { CodeAnimationRange } from "./highlighted-code";
import { PalotMarkdown, useMarkdownBlockStreaming } from "./palot-markdown-react";
import { ImageLightbox } from "./read-image-preview";
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
const WORKSPACE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "env",
  "fish",
  "go",
  "gql",
  "graphql",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "lock",
  "md",
  "mdx",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const MarkdownRenderContext = createContext({
  baseUrl: undefined as string | undefined,
  idPrefix: "markdown",
  passiveMedia: false,
  streaming: false,
});
const MarkdownLinkContext = createContext(false);
export type WorkspaceFileOpenHandler = (
  reference: MarkdownFileReference,
  event?: ReactMouseEvent | ReactKeyboardEvent,
) => void;
const MarkdownWorkspaceDirectoryContext = createContext<string | undefined>(undefined);
const MarkdownWorkspaceFileContext = createContext<WorkspaceFileOpenHandler | null>(null);

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

export interface MarkdownFileReference {
  path: string;
  line?: number;
}

export function MarkdownWorkspaceProvider({
  children,
  onOpenFile,
  workspaceDirectory,
}: {
  children?: ReactNode;
  onOpenFile(reference: MarkdownFileReference, event?: ReactMouseEvent | ReactKeyboardEvent): void;
  workspaceDirectory?: string;
}) {
  return (
    <MarkdownWorkspaceDirectoryContext.Provider value={workspaceDirectory}>
      <MarkdownWorkspaceFileContext.Provider value={onOpenFile}>
        {children}
      </MarkdownWorkspaceFileContext.Provider>
    </MarkdownWorkspaceDirectoryContext.Provider>
  );
}

export function useWorkspaceFileOpener() {
  return useContext(MarkdownWorkspaceFileContext);
}

export function useWorkspaceDirectory() {
  return useContext(MarkdownWorkspaceDirectoryContext);
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

function MarkdownLink({
  href,
  children,
  remoteFavicons,
  ...props
}: MarkdownComponentProps<"a"> & { remoteFavicons: boolean }) {
  const { baseUrl, idPrefix } = useContext(MarkdownRenderContext);
  const openWorkspaceFile = useContext(MarkdownWorkspaceFileContext);
  const fileReference = !baseUrl && openWorkspaceFile ? parseWorkspaceFileReference(href) : null;
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
  const icon = markdownLinkIcon(resolvedHref, remoteFavicons);
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
            void palot.openExternalUrl(resolvedHref);
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
  const value = projectStreamingCode(children).code;
  const reference =
    !className && !value.includes("\n") && openWorkspaceFile
      ? parseWorkspaceFileReference(value)
      : null;
  if (reference && openWorkspaceFile) {
    return (
      <MarkdownFileLink reference={reference} onOpen={openWorkspaceFile}>
        {workspaceFileLabel(reference)}
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
  const absolutePath = resolveFileReferenceAbsolutePath(reference.path, workspaceDirectory);
  const fileHref = absolutePath
    ? `file://${encodeURI(absolutePath)}${reference.line ? `#L${reference.line}` : ""}`
    : `file://${encodeURI(reference.path)}${reference.line ? `#L${reference.line}` : ""}`;

  return (
    <a
      href={fileHref}
      title={workspaceFileLabel(reference)}
      aria-label={`Open ${workspaceFileLabel(reference)}`}
      onClick={(event) => {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          onOpen(reference, event);
        } else {
          onOpen(reference);
        }
      }}
      className="inline-flex max-w-full cursor-pointer items-center gap-1 text-info underline-offset-4 outline-none hover:underline focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </a>
  );
}

function resolveFileReferenceAbsolutePath(
  filePath: string,
  workspaceDirectory?: string,
): string | null {
  if (filePath.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(filePath).pathname);
    } catch {
      return null;
    }
  }
  if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return filePath;
  }
  if (filePath.startsWith("~/")) {
    return filePath;
  }
  if (workspaceDirectory) {
    return `${workspaceDirectory.replace(/\/+$/, "")}/${filePath.replace(/^\.\//, "")}`;
  }
  return null;
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
  const linked = useContext(MarkdownLinkContext);
  const [open, setOpen] = useState(false);
  const placeholder = <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>;
  if (!passiveMedia) return placeholder;

  const resolvedSrc = resolveMarkdownImageUrl(src, baseUrl);
  if (!resolvedSrc) return placeholder;
  const name = markdownImageName(alt, resolvedSrc);
  const dimensions = markdownImageDimensions(title);
  const image = (
    <img
      {...props}
      alt={alt}
      src={resolvedSrc}
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
      <ImageLightbox
        src={resolvedSrc}
        name={name}
        mime={markdownImageMime(resolvedSrc)}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

const MARKDOWN_COMPONENTS = {
  code: MarkdownInlineCode,
  img: MarkdownImage,
  pre: MarkdownPre,
  table: MarkdownTable,
  "palot-math": MarkdownMath,
  "palot-inline-math": MarkdownInlineMath,
  "palot-details": MarkdownDetails,
} satisfies MarkdownComponents;

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
    <div className={cn("markdown typeset-chat", className)}>
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
  const generatedID = useId().replaceAll(":", "");
  const idPrefix = `markdown-${generatedID}`;
  const context = useMemo(
    () => ({ baseUrl, idPrefix, passiveMedia, streaming }),
    [baseUrl, idPrefix, passiveMedia, streaming],
  );
  const components = useMemo<MarkdownComponents>(
    () => ({
      ...MARKDOWN_COMPONENTS,
      a: (props) => <MarkdownLink {...props} remoteFavicons={remoteFavicons} />,
    }),
    [remoteFavicons],
  );
  return (
    <MarkdownRenderContext.Provider value={context}>
      <PalotMarkdown
        allowHtml={false}
        components={components}
        extensions={MARKDOWN_EXTENSIONS}
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

const POSIX_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/workspace/",
  "/workspaces/",
];

const KNOWN_EXTENSIONLESS_FILES = new Set([
  "dockerfile",
  "makefile",
  "gnumakefile",
  "justfile",
  "gemfile",
  "procfile",
  "brewfile",
  "caddyfile",
  "vagrantfile",
  "jenkinsfile",
  "license",
  "licence",
  "copying",
  "notice",
  "readme",
  "changelog",
]);

function parseWorkspaceFileReference(value: string | undefined): MarkdownFileReference | null {
  if (!value) return null;
  let path = value.trim();
  if (!path || /^(?:https?|mailto):/i.test(path)) return null;

  if (path.startsWith("<") && path.endsWith(">")) {
    path = path.slice(1, -1).trim();
  }

  let line: number | undefined;
  const lineLabel = path.match(/\s+\(line\s+(\d+)\)$/i);
  if (lineLabel) {
    line = Number(lineLabel[1]);
    path = path.slice(0, lineLabel.index).trim();
  }

  const hashLine = path.match(/#L(\d+)(?:-L?\d+|[Cc]\d+)?$/i);
  if (hashLine) {
    line ??= Number(hashLine[1]);
    path = path.slice(0, hashLine.index);
  }

  const queryIndex = path.indexOf("?");
  if (queryIndex >= 0) {
    const search = new URLSearchParams(path.slice(queryIndex + 1));
    const start = Number(search.get("start"));
    if (!line && Number.isSafeInteger(start) && start > 0) line = start;
    path = path.slice(0, queryIndex);
  }

  const colonLine = path.match(/:(\d+)(?::\d+)?$/);
  if (colonLine) {
    line ??= Number(colonLine[1]);
    path = path.slice(0, colonLine.index);
  }

  if (path.startsWith("file://")) {
    try {
      const parsed = new URL(path);
      path = decodeURIComponent(parsed.pathname);
      if (process.platform === "win32" && path.startsWith("/")) {
        path = path.slice(1);
      }
    } catch {
      return null;
    }
  }

  path = path.replaceAll("\\", "/");
  if (!likelyWorkspaceFile(path)) return null;
  return { path, ...(line ? { line } : {}) };
}

function likelyWorkspaceFile(path: string): boolean {
  if (!path || path.endsWith("/")) return false;
  if (POSIX_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (path.startsWith("~/") || /^[A-Za-z]:\//.test(path)) return true;

  const name = path.split("/").at(-1) ?? "";
  if (KNOWN_EXTENSIONLESS_FILES.has(name.toLowerCase())) return true;
  const extension = name.match(/\.([a-z0-9+_-]{1,15})$/i)?.[1]?.toLowerCase();
  return Boolean(extension && (path.includes("/") || WORKSPACE_FILE_EXTENSIONS.has(extension)));
}

function workspaceFileLabel(reference: MarkdownFileReference): string {
  return `${reference.path}${reference.line ? ` (line ${reference.line})` : ""}`;
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

function trimAutoLinkLiteral(value: string): string {
  let end = value.length;
  while (/[.,!?;:]$/.test(value.slice(0, end))) end -= 1;
  while (value[end - 1] === ")" && unbalancedClosing(value.slice(0, end), "(", ")")) end -= 1;
  while (value[end - 1] === "]" && unbalancedClosing(value.slice(0, end), "[", "]")) end -= 1;
  return value.slice(0, end);
}

function unbalancedClosing(value: string, open: string, close: string): boolean {
  return value.split(close).length > value.split(open).length;
}

function insideIncompleteLinkDestination(value: string, offset: number): boolean {
  return value.lastIndexOf("](", offset) > value.lastIndexOf(")", offset);
}
