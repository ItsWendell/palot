import { File as CodeFile, type SelectedLineRange } from "@pierre/diffs/react";
import { FileCode2, FolderOpen, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { runtimeAtom } from "../../atoms/workspace";
import { useWorkspaceFile } from "../../hooks/use-workspace-file";
import { cn } from "../../lib/cn";
import { contentCacheKey } from "../../lib/file-diffs";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { pierreViewerStyle, pierreViewerTheme } from "../file-viewer-theme";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { classifyWorkspaceFile, type WorkspaceFilePreview } from "./workspace-file-preview";

const PdfPreview = lazy(() => import("./pdf-preview"));

export function FileTab({
  tab,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "file" }>;
  active?: boolean;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const query = useWorkspaceFile(tab.resource.location, tab.resource.path, active);
  const preview = useMemo(
    () => (query.data ? classifyWorkspaceFile(tab.resource.path, query.data) : null),
    [tab.resource.path, query.data],
  );
  const [markdownSource, setMarkdownSource] = useState(false);
  const selectedLines = useMemo<SelectedLineRange | null>(
    () => (tab.resource.line ? { start: tab.resource.line, end: tab.resource.line } : null),
    [tab.resource.line],
  );
  const scrolledTarget = useRef<string | null>(null);
  const text = preview && "text" in preview ? preview.text : "";
  const file = useMemo(
    () => ({
      name: tab.resource.path,
      contents: text,
      cacheKey: contentCacheKey(tab.resource.path, text),
    }),
    [tab.resource.path, text],
  );
  const options = useMemo(
    () => ({
      ...pierreViewerTheme,
      theme: appearance.codeThemePair,
      themeType: appearance.scheme,
      onPostRender(node: HTMLElement) {
        const line = tab.resource.line;
        if (!line) return;
        const targetKey = `${tab.resource.path}:${line}`;
        if (scrolledTarget.current === targetKey) return;
        const root = node.shadowRoot ?? node;
        const target = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
        if (!target) return;
        scrolledTarget.current = targetKey;
        target.scrollIntoView({ block: "center" });
      },
    }),
    [appearance.codeThemePair, appearance.scheme, tab.resource.line, tab.resource.path],
  );

  const fullPath =
    tab.resource.path.startsWith("/") || tab.resource.path.startsWith("~")
      ? tab.resource.path
      : `${tab.resource.location.directory.replace(/\/+$/, "")}/${tab.resource.path}`;
  const fileHref = `file://${encodeURI(fullPath)}${tab.resource.line ? `#L${tab.resource.line}` : ""}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <FileCode2 className="size-3 text-muted-foreground" aria-hidden="true" />
        <a
          href={fileHref}
          className="min-w-0 flex-1 truncate text-meta hover:underline"
          title={tab.resource.path}
          onClick={(event) => event.preventDefault()}
        >
          {tab.resource.path}
          {tab.resource.line ? `:${tab.resource.line}` : ""}
        </a>
        {preview?.kind === "markdown" ? (
          <div className="flex shrink-0 items-center gap-0.5" aria-label="Markdown view">
            <Button
              type="button"
              variant={markdownSource ? "ghost" : "secondary"}
              size="xs"
              aria-pressed={!markdownSource}
              onClick={() => setMarkdownSource(false)}
            >
              Preview
            </Button>
            <Button
              type="button"
              variant={markdownSource ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={markdownSource}
              onClick={() => setMarkdownSource(true)}
            >
              Source
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open in editor"
          title="Open in editor"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.externalOpen(
              {
                resource: {
                  kind: "file",
                  path: fullPath,
                  line: tab.resource.line,
                },
              },
              runtime?.connectionID,
            );
          }}
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
          disabled={
            runtime?.profileID !== tab.resource.profileID ||
            runtime?.capabilities?.localPathActions !== true
          }
          onClick={() => {
            void palot.revealFileInFinder(fullPath, runtime?.connectionID);
          }}
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh file"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden="true" />
        </Button>
      </div>
      {query.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading file
        </div>
      ) : query.isError ? (
        <Empty className="rounded-none p-5">
          <EmptyHeader>
            <EmptyTitle>Could not load file</EmptyTitle>
            <EmptyDescription>{query.error.message}</EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw data-icon="inline-start" /> Retry
          </Button>
        </Empty>
      ) : preview?.kind === "too-large" || preview?.kind === "binary" ? (
        <Empty className="rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Preview unavailable</EmptyTitle>
            <EmptyDescription>
              {preview.kind === "too-large"
                ? `${tab.resource.path} exceeds the ${preview.limitMiB} MiB preview limit.`
                : `${tab.resource.path} is not a supported image, PDF, audio, video, or UTF-8 text file.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !active && preview && "data" in preview ? null : preview?.kind === "pdf" ? (
        <Suspense
          fallback={
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
              <Spinner /> Loading PDF preview
            </div>
          }
        >
          <PdfPreview key={tab.resource.path} data={preview.data} path={tab.resource.path} />
        </Suspense>
      ) : preview?.kind === "image" ? (
        <ImageFilePreview preview={preview} path={tab.resource.path} />
      ) : preview?.kind === "audio" || preview?.kind === "video" ? (
        <MediaFilePreview preview={preview} path={tab.resource.path} />
      ) : preview?.kind === "markdown" && !markdownSource ? (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
          <MarkdownContent value={preview.text} className="mx-auto max-w-4xl" />
        </div>
      ) : (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--code-background)]">
          <CodeFile
            file={file}
            selectedLines={selectedLines}
            options={options}
            style={pierreViewerStyle}
            className="min-w-full"
          />
        </div>
      )}
    </div>
  );
}

function ImageFilePreview({
  preview,
  path,
}: {
  preview: Extract<WorkspaceFilePreview, { kind: "image" | "pdf" }>;
  path: string;
}) {
  const url = usePreviewObjectURL(preview);
  const [failedURL, setFailedURL] = useState<string | null>(null);

  if (!url) return <PreviewLoading />;
  if (failedURL === url) return <PreviewFailed path={path} />;
  return (
    <div className="palot-native-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
      <img
        src={url}
        alt={path}
        className="max-h-full max-w-full object-contain"
        draggable={false}
        onError={() => setFailedURL(url)}
      />
    </div>
  );
}

function MediaFilePreview({
  preview,
  path,
}: {
  preview: Extract<WorkspaceFilePreview, { kind: "audio" | "video" }>;
  path: string;
}) {
  const url = usePreviewObjectURL(preview);
  const [failedURL, setFailedURL] = useState<string | null>(null);

  if (!url) return <PreviewLoading />;
  if (failedURL === url) return <PreviewFailed path={path} />;
  return (
    <div className="palot-native-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
      {preview.kind === "audio" ? (
        <audio
          key={url}
          src={url}
          controls
          preload="metadata"
          aria-label={`Audio preview: ${path}`}
          className="w-full max-w-xl"
          onError={() => setFailedURL(url)}
        />
      ) : (
        <video
          key={url}
          src={url}
          controls
          preload="metadata"
          aria-label={`Video preview: ${path}`}
          className="max-h-full max-w-full"
          onError={() => setFailedURL(url)}
        />
      )}
    </div>
  );
}

function usePreviewObjectURL(preview: Extract<WorkspaceFilePreview, { data: Uint8Array }>) {
  const [objectURL, setObjectURL] = useState<{ data: Uint8Array; url: string } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(preview.data)], { type: preview.mime }),
    );
    setObjectURL({ data: preview.data, url });
    return () => URL.revokeObjectURL(url);
  }, [preview.data, preview.mime]);

  return objectURL?.data === preview.data ? objectURL.url : null;
}

function PreviewLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
      <Spinner /> Loading preview
    </div>
  );
}

function PreviewFailed({ path }: { path: string }) {
  return (
    <Empty className="rounded-none p-5">
      <EmptyHeader>
        <EmptyTitle>Preview unavailable</EmptyTitle>
        <EmptyDescription>Could not display {path}.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
