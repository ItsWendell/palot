/**
 * Zoom and pan for an image laid out at its fitted size. `zoom` is relative to that fitted
 * size (1 = fitted) and `x`/`y` offset the image centre from its fitted centre, in pixels.
 */
export interface ImageZoomView {
  zoom: number;
  x: number;
  y: number;
}

/** Fitted layout size and natural width of the image. */
export interface ImageZoomSize {
  width: number;
  height: number;
  naturalWidth: number;
}

export const FITTED_IMAGE_VIEW: ImageZoomView = { zoom: 1, x: 0, y: 0 };

const MIN_MAX_ZOOM = 8;
/** Larger per-event deltas come from mouse wheels; cap them so one notch is a usable step. */
const MAX_WHEEL_ZOOM_DELTA = 50;

/** Allows at least 8× the fitted size, and always enough to reach actual pixels. */
export function maxImageZoom(size: ImageZoomSize | null): number {
  if (!size || size.width <= 0) return MIN_MAX_ZOOM;
  return Math.max(MIN_MAX_ZOOM, size.naturalWidth / size.width);
}

/**
 * Keeps the zoomed image covering its fitted footprint. Bounding by the fitted footprint,
 * not the stage edges, keeps the anchor steady through small pinch increments.
 */
export function clampImageView(view: ImageZoomView, size: ImageZoomSize | null): ImageZoomView {
  const zoom = clamp(view.zoom, 1, maxImageZoom(size));
  if (zoom === 1) return FITTED_IMAGE_VIEW;
  if (!size) return { zoom, x: 0, y: 0 };
  const limitX = (size.width * (zoom - 1)) / 2;
  const limitY = (size.height * (zoom - 1)) / 2;
  return { zoom, x: clamp(view.x, -limitX, limitX), y: clamp(view.y, -limitY, limitY) };
}

/** Zooms so the image point under `anchor` (offset from the fitted centre) stays put. */
export function zoomImageViewAt(
  view: ImageZoomView,
  nextZoom: number,
  anchor: { x: number; y: number },
  size: ImageZoomSize | null,
): ImageZoomView {
  const zoom = clamp(nextZoom, 1, maxImageZoom(size));
  const ratio = zoom / view.zoom;
  return clampImageView(
    {
      zoom,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    size,
  );
}

/** Ctrl-wheel (and Chromium's trackpad pinch) zoom factor for one wheel event. */
export function wheelZoomFactor(deltaY: number, unit = 1): number {
  const delta = clamp(deltaY * unit, -MAX_WHEEL_ZOOM_DELTA, MAX_WHEEL_ZOOM_DELTA);
  return Math.exp(-delta / 100);
}

/** Zoom as a percentage of the image's natural size. */
export function imageZoomPercent(view: ImageZoomView, size: ImageZoomSize | null): number | null {
  if (!size || size.naturalWidth <= 0) return null;
  return Math.round(((view.zoom * size.width) / size.naturalWidth) * 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
