import { File as CodeFile, type SelectedLineRange } from "@pierre/diffs/react";
import {
  FileCode2,
  FolderOpen,
  Globe,
  Minus,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { resolvedAppearanceAtom } from "../../atoms/appearance";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { useWorkbenchCommands } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { useBrowserSession } from "../../hooks/use-browser-session";
import { useFileWatch } from "../../hooks/use-file-watch";
import { useImageZoom } from "../../hooks/use-image-zoom";
import { useWorkspaceFile } from "../../hooks/use-workspace-file";
import { isHtmlFilePath, openFileInBrowser } from "../../lib/browser-files";
import { cn } from "../../lib/cn";
import { contentCacheKey } from "../../lib/file-diffs";
import {
  fileUrl,
  isAbsoluteFilePath,
  joinFilePath,
  normalizeFilePath,
} from "../../lib/file-reference";
import { showErrorToast } from "../../lib/toast-error";
import type {
  OpenWorkbenchTabInput,
  WorkbenchPaneID,
  WorkbenchScope,
  WorkbenchTab,
} from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { pierreViewerStyle, pierreViewerTheme } from "../file-viewer-theme";
import { useFileReferenceOpener } from "../file-reference-opener";
import {
  MarkdownContent,
  MarkdownWorkspaceProvider,
  type MarkdownFileReference,
} from "../markdown-content";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { classifyWorkspaceFile, type WorkspaceFilePreview } from "./workspace-file-preview";

const PdfPreview = lazy(() => import("./pdf-preview"));
const OfficePreview = lazy(() => import("./office-preview"));

const IMAGE_ZOOM_STEP = 1.5;
const NO_MESSAGES = () => [];

/** Renders a previewed Markdown file whose relative links resolve against its own folder. */
function MarkdownDocumentPreview({
  tab,
  scope,
  pane,
  text,
}: {
  tab: Extract<WorkbenchTab, { kind: "file" }>;
  scope: WorkbenchScope;
  pane?: WorkbenchPaneID;
  text: string;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const workbench = useWorkbenchCommands(scope);
  const location = tab.resource.location;
  const folder = joinFilePath(location.directory, normalizeFilePath(`${tab.resource.path}/..`));
  const localPathActions =
    runtime?.profileID === tab.resource.profileID &&
    runtime?.capabilities?.localPathActions === true;
  const openTab = useCallback(
    (input: OpenWorkbenchTabInput) => workbench.openTab(input, pane ? { pane } : undefined),
    [pane, workbench],
  );
  const opener = useFileReferenceOpener({
    sessionID: scope.sessionID,
    location,
    connectionID: runtime?.profileID === tab.resource.profileID ? runtime.connectionID : undefined,
    localPathActions,
    getMessages: NO_MESSAGES,
    openTab,
  });
  const { open } = opener;
  // Document links are relative to the document, not the task; resolve them to an absolute
  // path so the opener checks exactly that file within the task's locations.
  const openFromDocument = useCallback(
    (reference: MarkdownFileReference, event?: Parameters<typeof open>[1]) =>
      open(
        isAbsoluteFilePath(reference.path) || reference.path.startsWith("~")
          ? reference
          : { ...reference, path: joinFilePath(folder, reference.path) },
        event,
      ),
    [folder, open],
  );
  return (
    <MarkdownWorkspaceProvider
      onOpenFile={openFromDocument}
      workspaceDirectory={folder}
      allowHomePaths={localPathActions}
    >
      {opener.picker}
      <MarkdownContent value={text} className="mx-auto max-w-4xl" />
    </MarkdownWorkspaceProvider>
  );
}

export function FileTab({
  tab,
  active = true,
  scope,
  pane,
}: {
  tab: Extract<WorkbenchTab, { kind: "file" }>;
  active?: boolean;
  /** Lets links inside a previewed document open in the workbench. */
  scope?: WorkbenchScope;
  pane?: WorkbenchPaneID;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const browserEnabled = useAtomValue(experimentalBrowserAtom);
  const browser = useBrowserSession(scope ?? { profileID: "", sessionID: "" });
  const query = useWorkspaceFile(tab.resource.location, tab.resource.path, active);
  useFileWatch(
    tab.resource.location,
    tab.resource.path,
    active && runtime?.profileID === tab.resource.profileID,
  );
  const preview = useMemo(
    () => (query.data ? classifyWorkspaceFile(tab.resource.path, query.data) : null),
    [tab.resource.path, query.data],
  );
  const [markdownSource, setMarkdownSource] = useState(false);
  const selectedLines = useMemo<SelectedLineRange | null>(
    () =>
      tab.resource.line
        ? { start: tab.resource.line, end: tab.resource.endLine ?? tab.resource.line }
        : null,
    [tab.resource.line, tab.resource.endLine],
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

  const fullPath = joinFilePath(tab.resource.location.directory, tab.resource.path);
  const fileHref = fileUrl(fullPath, tab.resource.line);
  const localFiles =
    runtime?.profileID === tab.resource.profileID &&
    runtime?.capabilities?.localPathActions === true;
  const browserBindingID = browser?.bindingID;
  const canOpenInBrowser =
    browserEnabled && localFiles && Boolean(browserBindingID) && isHtmlFilePath(tab.resource.path);

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
        {canOpenInBrowser && browserBindingID ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Open in browser"
            title="Open in browser"
            onClick={() => {
              openFileInBrowser(browserBindingID, fullPath).catch((error: unknown) =>
                showErrorToast("Could not open in Palot Browser", error),
              );
            }}
          >
            <Globe className="size-3.5" aria-hidden="true" />
          </Button>
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
            palot
              .externalOpen(
                {
                  resource: {
                    kind: "file",
                    path: fullPath,
                    line: tab.resource.line,
                  },
                },
                runtime?.connectionID,
              )
              .catch((error: unknown) => showErrorToast("Could not open file", error));
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
      ) : preview?.kind === "too-large" ||
        preview?.kind === "binary" ||
        preview?.kind === "unsupported-office" ? (
        <Empty className="rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Preview unavailable</EmptyTitle>
            <EmptyDescription>
              {preview.kind === "too-large"
                ? `${tab.resource.path} exceeds the ${preview.limitMiB} MiB preview limit.`
                : preview.kind === "unsupported-office"
                  ? "Office previews support .docx, .xlsx and .pptx. Legacy, template and macro-enabled formats are not supported."
                  : `${tab.resource.path} is not a supported image, PDF, Office document, audio, video, or UTF-8 text file.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !active && preview && "data" in preview ? null : preview?.kind === "office" ? (
        <Suspense fallback={<PreviewLoading />}>
          <OfficePreview
            key={tab.resource.path}
            data={preview.data}
            format={preview.format}
            path={tab.resource.path}
          />
        </Suspense>
      ) : preview?.kind === "pdf" ? (
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
          {scope ? (
            <MarkdownDocumentPreview tab={tab} scope={scope} pane={pane} text={preview.text} />
          ) : (
            <MarkdownContent value={preview.text} className="mx-auto max-w-4xl" />
          )}
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
  // Each image gets its own stage so a newly opened image starts fitted.
  return <ZoomableImage key={url} src={url} alt={path} onError={() => setFailedURL(url)} />;
}

function ZoomableImage({ src, alt, onError }: { src: string; alt: string; onError(): void }) {
  const zoom = useImageZoom();

  return (
    <div
      ref={zoom.stageRef}
      data-zoomed={zoom.zoomed || undefined}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5"
    >
      <img
        {...zoom.imageProps}
        src={src}
        alt={alt}
        className="max-h-full max-w-full object-contain select-none"
        draggable={false}
        onError={onError}
      />
      <div
        role="toolbar"
        aria-label="Image zoom"
        className="palot-promoted-blur absolute top-2 right-2 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 shadow-sm backdrop-blur-sm"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={!zoom.zoomed}
          onClick={() => zoom.zoomBy(1 / IMAGE_ZOOM_STEP)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <span
          className="min-w-10 text-center text-micro text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {zoom.percent === null ? "–" : `${zoom.percent}%`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom in"
          title="Zoom in (Ctrl+scroll or pinch)"
          disabled={!zoom.canZoomIn}
          onClick={() => zoom.zoomBy(IMAGE_ZOOM_STEP)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Fit image to pane"
          title="Fit image to pane"
          disabled={!zoom.zoomed}
          onClick={zoom.fit}
        >
          Fit
        </Button>
      </div>
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

function usePreviewObjectURL(
  preview: Extract<WorkspaceFilePreview, { mime: string; data: Uint8Array }>,
) {
  const [objectURL, setObjectURL] = useState<{ data: Uint8Array; url: string } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([blobBytes(preview.data)], { type: preview.mime }));
    setObjectURL({ data: preview.data, url });
    return () => URL.revokeObjectURL(url);
  }, [preview.data, preview.mime]);

  return objectURL?.data === preview.data ? objectURL.url : null;
}

/** Blob already snapshots its parts, so only shared buffers (which Blob rejects) need a copy. */
function blobBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer
    ? (data as Uint8Array<ArrayBuffer>)
    : new Uint8Array(data);
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
