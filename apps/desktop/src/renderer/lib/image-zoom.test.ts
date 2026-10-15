import { describe, expect, it } from "vitest";
import {
  clampImageView,
  FITTED_IMAGE_VIEW,
  imageZoomPercent,
  maxImageZoom,
  wheelZoomFactor,
  zoomImageViewAt,
} from "./image-zoom";

const size = { width: 400, height: 200, naturalWidth: 4000 };

describe("image zoom", () => {
  it("keeps the image point under the pointer fixed while zooming", () => {
    const anchor = { x: 100, y: -40 };
    const view = zoomImageViewAt(FITTED_IMAGE_VIEW, 2, anchor, size);
    // Image-local offset of the anchor is the same before and after.
    expect((anchor.x - view.x) / view.zoom).toBeCloseTo(anchor.x);
    expect((anchor.y - view.y) / view.zoom).toBeCloseTo(anchor.y);
    const next = zoomImageViewAt(view, 3, anchor, size);
    expect((anchor.x - next.x) / next.zoom).toBeCloseTo(anchor.x);
  });

  it("never zooms below fit and returns to a centred view there", () => {
    const zoomed = zoomImageViewAt(FITTED_IMAGE_VIEW, 2, { x: 150, y: 50 }, size);
    expect(zoomImageViewAt(zoomed, 0.25, { x: 0, y: 0 }, size)).toEqual(FITTED_IMAGE_VIEW);
  });

  it("caps zoom at 8× fit or actual pixels, whichever is larger", () => {
    expect(maxImageZoom(size)).toBe(10);
    expect(maxImageZoom({ width: 400, height: 200, naturalWidth: 400 })).toBe(8);
    expect(zoomImageViewAt(FITTED_IMAGE_VIEW, 50, { x: 0, y: 0 }, size).zoom).toBe(10);
  });

  it("clamps panning so the zoomed image still covers its fitted footprint", () => {
    expect(clampImageView({ zoom: 2, x: 1000, y: -1000 }, size)).toEqual({
      zoom: 2,
      x: 200,
      y: -100,
    });
    // A pane that shrank refits the image and pulls the view back in bounds.
    expect(
      clampImageView({ zoom: 2, x: 200, y: 0 }, { width: 200, height: 100, naturalWidth: 4000 }),
    ).toEqual({ zoom: 2, x: 100, y: 0 });
  });

  it("turns wheel deltas into bounded zoom steps", () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    // A mouse-wheel notch is capped so one notch is a usable step.
    expect(wheelZoomFactor(-120)).toBeCloseTo(wheelZoomFactor(-50));
    expect(wheelZoomFactor(-3, 16)).toBeCloseTo(wheelZoomFactor(-48));
  });

  it("reports zoom as a percentage of the natural size", () => {
    expect(imageZoomPercent(FITTED_IMAGE_VIEW, size)).toBe(10);
    expect(imageZoomPercent({ zoom: 10, x: 0, y: 0 }, size)).toBe(100);
    expect(imageZoomPercent(FITTED_IMAGE_VIEW, null)).toBeNull();
  });
});
