import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  clampImageView,
  FITTED_IMAGE_VIEW,
  type ImageZoomSize,
  type ImageZoomView,
  imageZoomPercent,
  maxImageZoom,
  wheelZoomFactor,
  zoomImageViewAt,
} from "../lib/image-zoom";
import { useReducedMotion } from "./use-reduced-motion";

const DRAG_THRESHOLD = 3;

/**
 * Pinch/Ctrl-wheel zoom and pan for an image that CSS lays out at its fitted size and centres
 * in a stage. Attach `stageRef` to the clipping stage and spread `imageProps` on the `<img>`.
 * Mount a fresh instance (for example with a `key`) for each image so it starts fitted.
 */
export function useImageZoom() {
  const [view, setView] = useState<ImageZoomView>(FITTED_IMAGE_VIEW);
  const [size, setSize] = useState<ImageZoomSize | null>(null);
  const [dragging, setDragging] = useState(false);
  // Button-driven changes ease; pinch, wheel, and drag follow the input directly.
  const [smooth, setSmooth] = useState(false);
  const reducedMotion = useReducedMotion();
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const stageRef = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{
    id: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const apply = useCallback((next: (current: ImageZoomView) => ImageZoomView) => {
    const value = clampImageView(next(viewRef.current), sizeRef.current);
    viewRef.current = value;
    setView(value);
  }, []);

  /** Image centre at its fitted position, in client coordinates. */
  const fittedCentre = useCallback(() => {
    const image = imageRef.current;
    if (!image) return null;
    // The transform scales about the centre, so only the translation moves it.
    const rect = image.getBoundingClientRect();
    const { x, y } = viewRef.current;
    return { x: rect.left + rect.width / 2 - x, y: rect.top + rect.height / 2 - y };
  }, []);

  const zoomAt = useCallback(
    (zoom: number, client?: { x: number; y: number }) => {
      const centre = fittedCentre();
      const stage = stageRef.current?.getBoundingClientRect();
      // Without a pointer, zoom about the middle of what is visible.
      const point =
        client ?? (stage && { x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 });
      const anchor =
        centre && point ? { x: point.x - centre.x, y: point.y - centre.y } : { x: 0, y: 0 };
      apply((current) => zoomImageViewAt(current, zoom, anchor, sizeRef.current));
    },
    [apply, fittedCentre],
  );

  const measure = useCallback(() => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.offsetWidth || !image.offsetHeight) return;
    const next = {
      width: image.offsetWidth,
      height: image.offsetHeight,
      naturalWidth: image.naturalWidth,
    };
    const previous = sizeRef.current;
    if (
      previous?.width === next.width &&
      previous.height === next.height &&
      previous.naturalWidth === next.naturalWidth
    ) {
      return;
    }
    sizeRef.current = next;
    setSize(next);
    // A resized pane refits the image; keep the relative zoom and pull the view back in bounds.
    apply((current) => current);
  }, [apply]);

  const attachStage = useCallback(
    (stage: HTMLElement | null) => {
      stageRef.current = stage;
      if (!stage) return;
      const onWheel = (event: WheelEvent) => {
        const current = viewRef.current;
        // Fitted scrolling stays native so the surrounding surface keeps scrolling.
        if (!event.ctrlKey && current.zoom === 1) return;
        // Chromium delivers trackpad pinch as Ctrl-wheel. Consuming it here also keeps the
        // window's own Ctrl-wheel zoom from firing over the image.
        event.preventDefault();
        event.stopPropagation();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
        setSmooth(false);
        if (event.ctrlKey) {
          zoomAt(current.zoom * wheelZoomFactor(event.deltaY, unit), {
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
        // Use the platform's scroll momentum directly, with no second animation loop.
        apply((view) => ({
          ...view,
          x: view.x - event.deltaX * unit,
          y: view.y - event.deltaY * unit,
        }));
      };
      // React delegates wheel listeners passively, which cannot cancel the default zoom.
      stage.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        stage.removeEventListener("wheel", onWheel);
        stageRef.current = null;
      };
    },
    [apply, zoomAt],
  );

  const attachImage = useCallback(
    (image: HTMLImageElement | null) => {
      imageRef.current = image;
      if (!image) return;
      measure();
      if (typeof ResizeObserver === "undefined") return;
      // The fitted layout box follows the stage size; transforms don't affect it.
      const observer = new ResizeObserver(measure);
      observer.observe(image);
      return () => {
        observer.disconnect();
        imageRef.current = null;
      };
    },
    [measure],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLImageElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }, []);

  const maxZoom = maxImageZoom(size);
  const zoomed = view.zoom > 1;
  const style: CSSProperties = {
    transform:
      zoomed || view.x || view.y
        ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
        : undefined,
    transition: smooth && !reducedMotion ? "transform 180ms ease-out" : undefined,
    touchAction: zoomed ? "none" : undefined,
    cursor: zoomed ? (dragging ? "grabbing" : "grab") : undefined,
  };

  return {
    stageRef: attachStage,
    view,
    zoomed,
    canZoomIn: view.zoom < maxZoom,
    percent: imageZoomPercent(view, size),
    /** Returns to the fitted, centred view. */
    fit() {
      setSmooth(true);
      apply(() => FITTED_IMAGE_VIEW);
    },
    /** Zooms to `zoom` (relative to fitted) about a client point, or the visible centre. */
    zoomTo(zoom: number, client?: { x: number; y: number }) {
      setSmooth(true);
      zoomAt(zoom, client);
    },
    zoomBy(factor: number) {
      setSmooth(true);
      zoomAt(viewRef.current.zoom * factor);
    },
    imageProps: {
      ref: attachImage,
      style,
      onLoad: measure,
      onPointerDown(event: ReactPointerEvent<HTMLImageElement>) {
        if (!event.isPrimary || event.button !== 0 || viewRef.current.zoom === 1) return;
        const { x, y } = viewRef.current;
        drag.current = {
          id: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          x,
          y,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setSmooth(false);
        setDragging(true);
      },
      onPointerMove(event: ReactPointerEvent<HTMLImageElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.clientX;
        const dy = event.clientY - current.clientY;
        if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        current.moved = true;
        apply((view) => ({ ...view, x: current.x + dx, y: current.y + dy }));
      },
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
    },
  };
}
