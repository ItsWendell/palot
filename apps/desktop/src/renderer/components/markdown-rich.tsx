import { useAtomValue } from "jotai";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const MAX_MERMAID_CHARACTERS = 20_000;
const MAX_MERMAID_LINES = 500;
const MIN_MERMAID_ZOOM = 1;
const MAX_MERMAID_ZOOM = 4;
const MERMAID_ZOOM_STEP = 0.25;

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let mermaidRenderQueue = Promise.resolve();

function loadMermaid() {
  mermaidModule ??= import("mermaid");
  return mermaidModule;
}

export function MarkdownMath({ "data-math": expression }: { "data-math"?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void import("katex").then(({ default: katex }) => {
      if (!active) return;
      setHtml(katex.renderToString(expression ?? "", { throwOnError: false, displayMode: true }));
    });
    return () => {
      active = false;
    };
  }, [expression]);

  if (!html) return <div className="markdown-math-fallback">$$ {expression} $$</div>;
  return <div className="markdown-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MarkdownInlineMath({ "data-math": expression }: { "data-math"?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void import("katex").then(({ default: katex }) => {
      if (!active) return;
      setHtml(katex.renderToString(expression ?? "", { throwOnError: false }));
    });
    return () => {
      active = false;
    };
  }, [expression]);

  if (!html) return <code>{`$${expression ?? ""}$`}</code>;
  return <span className="markdown-inline-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MermaidDiagram({ code }: { code: string }) {
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const id = useId().replaceAll(":", "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const lineCount = code.split("\n").length;
  const renderable = code.length <= MAX_MERMAID_CHARACTERS && lineCount <= MAX_MERMAID_LINES;
  const themeKey = [
    appearance.scheme,
    appearance.themeID,
    appearance.uiFontFamily,
    appearance.preferences.lightContrast,
    appearance.preferences.darkContrast,
  ].join(":");

  useEffect(() => {
    if (!renderable) return;
    let active = true;
    setSvg(null);
    setError(false);
    void loadMermaid()
      .then(({ default: mermaid }) => {
        const render = mermaidRenderQueue.then(async () => {
          mermaid.initialize({
            securityLevel: "strict",
            startOnLoad: false,
            layout: "dagre",
            look: "classic",
            theme: "base",
            themeVariables: mermaidThemeVariables(appearance.uiFontFamily),
          });
          return mermaid.render(`palot-mermaid-${id}`, code);
        });
        mermaidRenderQueue = render.then(
          () => undefined,
          () => undefined,
        );
        return render;
      })
      .then((result) => {
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [appearance.uiFontFamily, code, id, renderable, themeKey]);

  if (!renderable) {
    return (
      <div className="markdown-mermaid-source">
        <p>Diagram source is too large to render safely.</p>
        <pre>{code}</pre>
      </div>
    );
  }
  if (error) {
    return (
      <div className="markdown-mermaid-error">
        <p>Could not render this diagram.</p>
        <pre>{code}</pre>
      </div>
    );
  }
  if (!svg) return <div className="markdown-mermaid-loading">Rendering diagram…</div>;
  return <MermaidDiagramPreview svg={svg} />;
}

function MermaidDiagramPreview({ svg }: { svg: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="group/markdown-mermaid relative">
        <button
          type="button"
          aria-label="Open Mermaid diagram preview"
          onClick={() => setOpen(true)}
          className="markdown-mermaid w-full cursor-zoom-in border-0 bg-transparent text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Open Mermaid diagram preview"
          onClick={() => setOpen(true)}
          className="absolute top-2 right-11 opacity-0 shadow-sm transition-opacity group-hover/markdown-mermaid:opacity-100 focus-visible:opacity-100"
        >
          <Maximize2 aria-hidden="true" />
        </Button>
      </div>
      <MermaidLightbox svg={svg} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function MermaidLightbox({
  svg,
  open,
  onOpenChange,
}: {
  svg: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const frameRef = useRef<HTMLDivElement>(null);

  const updateZoom = useCallback((nextZoom: number, anchor?: { x: number; y: number }) => {
    const frame = frameRef.current;
    const currentZoom = zoomRef.current;
    const boundedZoom = Math.min(MAX_MERMAID_ZOOM, Math.max(MIN_MERMAID_ZOOM, nextZoom));
    if (!frame || boundedZoom === currentZoom) return;

    const point = anchor ?? { x: frame.clientWidth / 2, y: frame.clientHeight / 2 };
    const ratio = boundedZoom / currentZoom;
    const nextScrollLeft = (frame.scrollLeft + point.x) * ratio - point.x;
    const nextScrollTop = (frame.scrollTop + point.y) * ratio - point.y;
    zoomRef.current = boundedZoom;
    setZoom(boundedZoom);
    requestAnimationFrame(() => {
      frame.scrollLeft = nextScrollLeft;
      frame.scrollTop = nextScrollTop;
    });
  }, []);

  const attachFrame = useCallback(
    (frame: HTMLDivElement | null) => {
      frameRef.current = frame;
      if (!frame) return;

      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const bounds = frame.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.01);
        updateZoom(zoomRef.current * factor, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      };
      // React delegates wheel events passively, which cannot cancel browser pinch zoom.
      frame.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        frame.removeEventListener("wheel", onWheel);
        frameRef.current = null;
      };
    },
    [updateZoom],
  );

  function close() {
    zoomRef.current = 1;
    setZoom(1);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
        else onOpenChange(true);
      }}
    >
      {open ? (
        <DialogContent
          showCloseButton={false}
          className="inset-0 grid h-dvh w-dvw max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] rounded-none bg-transparent p-0 ring-0 data-open:animate-none data-closed:animate-none sm:max-w-none"
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              updateZoom(zoom + MERMAID_ZOOM_STEP);
            } else if (event.key === "-") {
              event.preventDefault();
              updateZoom(zoom - MERMAID_ZOOM_STEP);
            } else if (event.key === "0") {
              event.preventDefault();
              updateZoom(1);
            }
          }}
        >
          <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 px-3 pt-9 pb-3 sm:px-4">
            <div className="palot-promoted-blur pointer-events-auto rounded-lg border bg-popover/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
              <DialogTitle className="text-xs">Mermaid diagram</DialogTitle>
              <DialogDescription className="text-micro!">
                Pinch to zoom · Two-finger scroll to pan
              </DialogDescription>
            </div>
            <div className="palot-promoted-blur pointer-events-auto flex items-center gap-1 rounded-lg border bg-popover/95 p-1 shadow-sm backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom out"
                disabled={zoom <= MIN_MERMAID_ZOOM}
                onClick={() => updateZoom(zoom - MERMAID_ZOOM_STEP)}
              >
                <Minus aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Fit diagram to window"
                onClick={() => updateZoom(1)}
                className="min-w-14 tabular-nums"
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom in"
                disabled={zoom >= MAX_MERMAID_ZOOM}
                onClick={() => updateZoom(zoom + MERMAID_ZOOM_STEP)}
              >
                <Plus aria-hidden="true" />
              </Button>
              <div className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close Mermaid diagram preview"
                onClick={close}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div
            ref={attachFrame}
            className="min-h-0 overscroll-contain overflow-auto"
            onDoubleClick={(event) => {
              const frame = frameRef.current;
              if (!frame) return;
              const bounds = frame.getBoundingClientRect();
              updateZoom(zoom === 1 ? 2 : 1, {
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              });
            }}
          >
            <div
              className="markdown-mermaid-lightbox grid place-items-center p-4 sm:p-10"
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function mermaidThemeVariables(fontFamily: string) {
  const background = themeColor("--background", "rgb(255, 255, 255)");
  const foreground = themeColor("--foreground", "rgb(24, 24, 27)");
  const muted = themeColor("--muted", "rgb(244, 244, 245)");
  const mutedForeground = themeColor("--muted-foreground", "rgb(113, 113, 122)");
  const card = themeColor("--card", background);
  const accent = themeColor("--accent", muted);
  const border = themeColor("--border", mutedForeground);

  return {
    fontFamily,
    background,
    primaryColor: muted,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: card,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: accent,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,
    lineColor: mutedForeground,
    textColor: foreground,
    edgeLabelBackground: background,
    clusterBkg: background,
    clusterBorder: border,
    titleColor: foreground,
    actorBkg: muted,
    actorBorder: border,
    actorTextColor: foreground,
    actorLineColor: mutedForeground,
    signalColor: foreground,
    signalTextColor: foreground,
    labelBoxBkgColor: background,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: foreground,
    noteBkgColor: card,
    noteBorderColor: border,
    noteTextColor: foreground,
    activationBkgColor: accent,
    activationBorderColor: border,
  };
}

function themeColor(property: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  if (!value) return fallback;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return value;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  const red = data[0] ?? 0;
  const green = data[1] ?? 0;
  const blue = data[2] ?? 0;
  const alpha = data[3] ?? 255;
  return alpha === 255
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}
