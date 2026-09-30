import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url&no-inline";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";

const MAX_PAGES = 200;
const MAX_RENDER_PIXELS = 8_000_000;
const MAX_PAGE_DIMENSION = 8_192;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// The worker is a bundled same-origin asset; PDF content never enters the DOM as HTML.
GlobalWorkerOptions.workerSrc = workerURL;

type LoadedDocument = { data: Uint8Array; document: PDFDocumentProxy };
type RenderState = {
  document: PDFDocumentProxy;
  page: number;
  zoom: number;
  status: "ready" | "error";
  message?: string;
};

export default function PdfPreview({ data, path }: { data: Uint8Array; path: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [documentError, setDocumentError] = useState<{ data: Uint8Array } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const document = loaded?.data === data ? loaded.document : null;
  const pageCount = document ? Math.min(document.numPages, MAX_PAGES) : 0;
  const page = Math.min(pageNumber, pageCount);
  const zoom = ZOOMS[zoomIndex] ?? 1;

  useEffect(() => {
    let cancelled = false;
    // PDF.js transfers the buffer to its worker. Keep the query cache's bytes intact.
    let task: ReturnType<typeof getDocument>;
    try {
      task = getDocument({
        data: new Uint8Array(data),
        isEvalSupported: false,
        enableXfa: false,
        maxImageSize: MAX_RENDER_PIXELS,
      });
    } catch {
      setDocumentError({ data });
      return;
    }
    void task.promise.then(
      (pdf) => {
        if (cancelled) return;
        if (pdf.numPages < 1) {
          setDocumentError({ data });
          return;
        }
        setPageNumber(1);
        setLoaded({ data, document: pdf });
      },
      () => {
        if (!cancelled) setDocumentError({ data });
      },
    );
    return () => {
      cancelled = true;
      void task.destroy().catch(() => undefined);
    };
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || !page) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<typeof document.getPage>>["render"]> | null =
      null;
    setRenderState(null);

    const render = async () => {
      let pdfPage: Awaited<ReturnType<typeof document.getPage>> | null = null;
      try {
        pdfPage = await document.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: zoom });
        const { width, height } = viewport;
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0 ||
          width > MAX_PAGE_DIMENSION ||
          height > MAX_PAGE_DIMENSION ||
          width * height > MAX_RENDER_PIXELS
        ) {
          throw new Error("This PDF page is too large to preview.");
        }
        const ratio = Math.max(
          1,
          Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(MAX_RENDER_PIXELS / (width * height)),
          ),
        );
        canvas.width = Math.ceil(width * ratio);
        canvas.height = Math.ceil(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable.");
        renderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (!cancelled) setRenderState({ document, page, zoom, status: "ready" });
      } catch (error) {
        if (!cancelled) {
          setRenderState({
            document,
            page,
            zoom,
            status: "error",
            message: error instanceof Error ? error.message : "Could not render this PDF page.",
          });
        }
      } finally {
        pdfPage?.cleanup();
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [document, page, zoom]);

  if (documentError?.data === data) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>Preview unavailable</EmptyTitle>
          <EmptyDescription>Could not open {path} as a PDF.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const current =
    renderState?.document === document && renderState.page === page && renderState.zoom === zoom
      ? renderState
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {document ? (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border px-2 py-1 text-meta">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPageNumber(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>
            Page {page} of {pageCount}
            {document.numPages > MAX_PAGES ? ` (first ${MAX_PAGES} of ${document.numPages})` : ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => setPageNumber(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex(zoomIndex - 1)}
          >
            <Minus aria-hidden="true" />
          </Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex(zoomIndex + 1)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div className="palot-native-scrollbar relative min-h-0 flex-1 overflow-auto p-5">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`PDF page ${page} of ${path}`}
          className={`mx-auto shadow-sm ${current?.status === "ready" ? "block" : "hidden"}`}
        />
        {!document || !current ? (
          <div className="flex h-full items-center justify-center gap-2 text-meta text-muted-foreground">
            <Spinner /> Loading PDF preview
          </div>
        ) : current.status === "error" ? (
          <div className="flex h-full items-center justify-center text-meta text-muted-foreground">
            {current.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
