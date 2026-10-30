import { File as CodeFile, type SelectedLineRange, type LineAnnotation } from "@pierre/diffs/react";
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
import { Banner } from "../ui/banner";
import { FileEditor, useFileEditing } from "./file-editor";
import { classifyWorkspaceFile, type WorkspaceFilePreview } from "./workspace-file-preview";
import { isRichFilePreview, RichFilePreview } from "./rich-file-preview";
import { ReviewCommentEditor, useReviewComments } from "../review-comment-editor";
import { canCommentOnRange } from "../../lib/review-comments";

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
  onTaskEdit,
}: {
  tab: Extract<WorkbenchTab, { kind: "file" }>;
  scope: WorkbenchScope;
  pane?: WorkbenchPaneID;
  text: string;
  onTaskEdit?(text: string): void;
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
      <MarkdownContent value={text} onTaskEdit={onTaskEdit} className="mx-auto max-w-4xl" />
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
  const ownsConnection = runtime?.profileID === tab.resource.profileID;
  const query = useWorkspaceFile(
    tab.resource.location,
    tab.resource.path,
    active && ownsConnection,
  );
  useFileWatch(
    tab.resource.location,
    tab.resource.path,
    active && runtime?.profileID === tab.resource.profileID,
  );
  const diskPreview = useMemo(
    () => (query.data ? classifyWorkspaceFile(tab.resource.path, query.data) : null),
    [tab.resource.path, query.data],
  );
  const editing = useFileEditing(
    tab,
    ownsConnection ? query.data : undefined,
    diskPreview && "text" in diskPreview ? diskPreview.text : undefined,
  );
  const retainDraft = editing.state.dirty || (!ownsConnection && editing.state.generation > 0);
  const preview = useMemo(() => {
    if (!retainDraft) return diskPreview;
    // Previews (Markdown, tables, notebooks, diagrams) follow unsaved edits.
    const draft = classifyWorkspaceFile(
      tab.resource.path,
      new TextEncoder().encode(editing.state.contents),
    );
    return "text" in draft ? draft : { kind: "text" as const, text: editing.state.contents };
  }, [diskPreview, editing.state.contents, retainDraft, tab.resource.path]);
  const [sourceView, setSourceView] = useState(false);
  // A cached read-only file can still add local context to its own task's draft.
  const review = useReviewComments(
    tab.resource.profileID,
    scope?.profileID === tab.resource.profileID ? scope.sessionID : undefined,
    true,
  );
  const [commentRange, setCommentRange] = useState<SelectedLineRange | null>(null);
  const pendingComments = review.comments.filter(
    (comment) => comment.path === tab.resource.path && comment.side !== "deletions",
  );
  const lineAnnotations = useMemo<LineAnnotation[]>(
    () =>
      [...new Set(pendingComments.map((comment) => comment.selection.endLine))].map(
        (lineNumber) => ({ lineNumber }),
      ),
    [review.comments, tab.resource.path],
  );
  const renderAnnotation = (annotation: LineAnnotation) => (
    <div
      className="space-y-1 border-y border-border bg-muted px-3 py-2 text-sm"
      aria-label={`Pending comments on line ${annotation.lineNumber}`}
    >
      {pendingComments
        .filter((comment) => comment.selection.endLine === annotation.lineNumber)
        .map((comment) => (
          <p key={comment.id} className="break-words whitespace-pre-wrap">
            <span className="text-meta text-muted-foreground">
              Pending ·{" "}
              {comment.selection.startLine === comment.selection.endLine
                ? `line ${comment.selection.startLine}`
                : `lines ${comment.selection.startLine}–${comment.selection.endLine}`}{" "}
            </span>
            {comment.comment}
          </p>
        ))}
    </div>
  );
  const previewLabel = preview ? sourcePreviewLabel(preview) : null;
  const showSource = previewLabel === null || sourceView;
  const selectedLines = useMemo<SelectedLineRange | null>(
    () =>
      tab.resource.line
        ? { start: tab.resource.line, end: tab.resource.endLine ?? tab.resource.line }
        : null,
    [tab.resource.line, tab.resource.endLine],
  );
  const scrolledTarget = useRef<string | null>(null);
  const text = preview && "text" in preview ? preview.text : "";
  const isText = preview !== null && "text" in preview;
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
      ...(review.enabled
        ? {
            enableLineSelection: true,
            onLineSelectionEnd: (range: SelectedLineRange | null) =>
              setCommentRange(range && canCommentOnRange(range) ? range : null),
          }
        : {}),
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
    [
      appearance.codeThemePair,
      appearance.scheme,
      tab.resource.line,
      tab.resource.path,
      review.enabled,
    ],
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
    <div
      className="flex min-h-0 flex-1 flex-col bg-card"
      onKeyDownCapture={(event) => {
        if (
          !active ||
          !isText ||
          !(event.metaKey || event.ctrlKey) ||
          event.altKey ||
          event.shiftKey ||
          event.key.toLowerCase() !== "s"
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        void editing.save();
      }}
    >
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
        {editing.state.dirty ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-foreground"
            role="status"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          />
        ) : null}
        {isText ? (
          <>
            {!ownsConnection ? (
              <span
                className="text-meta text-muted-foreground"
                title="Read-only: switch to the connection that owns this file to edit it."
              >
                Read-only
              </span>
            ) : null}
            {editing.state.dirty ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={editing.state.saving}
                  onClick={editing.revert}
                >
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={!ownsConnection || editing.state.saving}
                  title={
                    !ownsConnection
                      ? "Switch to the connection that owns this file to save it."
                      : undefined
                  }
                  onClick={() => void editing.save()}
                >
                  {editing.state.saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : null}
          </>
        ) : null}
        {previewLabel ? (
          <div className="flex shrink-0 items-center gap-0.5" aria-label="File view">
            <Button
              type="button"
              variant={sourceView ? "ghost" : "secondary"}
              size="xs"
              aria-pressed={!sourceView}
              onClick={() => setSourceView(false)}
            >
              {previewLabel}
            </Button>
            <Button
              type="button"
              variant={sourceView ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={sourceView}
              onClick={() => setSourceView(true)}
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
      <Banner
        open={editing.state.conflict && editing.state.dirty}
        status="warning"
        title="Changed on disk"
        actions={
          <>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!ownsConnection || editing.state.saving}
              onClick={() => void editing.save(true)}
            >
              Overwrite
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!ownsConnection || editing.state.saving}
              onClick={() => void editing.reload()}
            >
              Reload (discard my edits)
            </Button>
          </>
        }
      />
      {query.isPending && !retainDraft ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading file
        </div>
      ) : query.isError && !retainDraft ? (
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
                  ? "Office previews support .docx, .xlsx, .pptx, .odt, .ods and .odp. Legacy, template and macro-enabled formats are not supported."
                  : `${tab.resource.path} is not a supported image, PDF, document, SQLite database, archive, audio, video, font, notebook, table, diagram or UTF-8 text file.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !active && preview && "data" in preview ? null : preview &&
        isRichFilePreview(preview) &&
        !("text" in preview && showSource) ? (
        <RichFilePreview preview={preview} path={tab.resource.path} />
      ) : preview?.kind === "office" ? (
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
      ) : preview?.kind === "markdown" && !showSource ? (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
          {scope ? (
            <MarkdownDocumentPreview
              tab={tab}
              scope={scope}
              pane={pane}
              text={text}
              onTaskEdit={
                ownsConnection && !editing.state.saving
                  ? (contents) => editing.session.change(contents)
                  : undefined
              }
            />
          ) : (
            <MarkdownContent
              value={text}
              onTaskEdit={
                ownsConnection && !editing.state.saving
                  ? (contents) => editing.session.change(contents)
                  : undefined
              }
              className="mx-auto max-w-4xl"
            />
          )}
        </div>
      ) : (
        <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--code-background)]">
          {ownsConnection || editing.state.dirty ? (
            <FileEditor
              path={tab.resource.path}
              contents={editing.state.generation ? editing.state.contents : text}
              generation={editing.state.generation}
              editable={ownsConnection}
              onChange={(contents) => editing.session.change(contents)}
              selectedLines={commentRange ?? selectedLines}
              options={options}
              lineAnnotations={lineAnnotations}
              renderAnnotation={renderAnnotation}
            />
          ) : (
            <CodeFile
              file={file}
              selectedLines={commentRange ?? selectedLines}
              options={options}
              lineAnnotations={lineAnnotations}
              renderAnnotation={renderAnnotation}
              style={pierreViewerStyle}
              className="min-w-full"
            />
          )}
        </div>
      )}
      {review.enabled && commentRange && isText && showSource ? (
        <ReviewCommentEditor
          key={`${tab.resource.path}:${commentRange.start}:${commentRange.end}`}
          path={tab.resource.path}
          range={commentRange}
          onSave={(text) => {
            review.add(tab.resource.path, commentRange, text);
            setCommentRange(null);
          }}
          onCancel={() => setCommentRange(null)}
        />
      ) : null}
    </div>
  );
}

/** The preview half of a Preview/Source toggle, or null for files shown only as source. */
function sourcePreviewLabel(preview: WorkspaceFilePreview): string | null {
  if (preview.kind === "delimited") return "Table";
  if (preview.kind === "markdown" || preview.kind === "notebook" || preview.kind === "mermaid")
    return "Preview";
  return null;
}

/** Archive entries reuse the same previews without file editing, links or disk access. */
export function ReadOnlyFilePreview({
  data,
  path,
  depth,
}: {
  data: Uint8Array;
  path: string;
  depth: number;
}) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const preview = useMemo(() => classifyWorkspaceFile(path, data), [path, data]);
  if (preview.kind === "too-large")
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Preview unavailable</EmptyTitle>
          <EmptyDescription>
            {path} exceeds the {preview.limitMiB} MiB preview limit.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (preview.kind === "archive" && depth >= 3)
    return <PreviewFailed path="nested archive (three-level preview limit)" />;
  if (isRichFilePreview(preview))
    return <RichFilePreview preview={preview} path={path} depth={depth} />;
  if (preview.kind === "image") return <ImageFilePreview preview={preview} path={path} />;
  if (preview.kind === "audio" || preview.kind === "video")
    return <MediaFilePreview preview={preview} path={path} />;
  if (preview.kind === "pdf")
    return (
      <Suspense fallback={<PreviewLoading />}>
        <PdfPreview data={data} path={path} />
      </Suspense>
    );
  if (preview.kind === "office")
    return (
      <Suspense fallback={<PreviewLoading />}>
        <OfficePreview data={data} path={path} format={preview.format} />
      </Suspense>
    );
  // Text/Markdown stays source-only here: no archive text can fetch a URL or open a disk path.
  if ("text" in preview)
    return (
      <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto">
        <CodeFile
          file={{ name: path, contents: preview.text }}
          options={{
            ...pierreViewerTheme,
            theme: appearance.codeThemePair,
            themeType: appearance.scheme,
          }}
          style={pierreViewerStyle}
        />
      </div>
    );
  return <PreviewFailed path={path} />;
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
