import type { Rectangle } from "electron";

export function fitWindowBounds(
  bounds: Rectangle,
  workAreas: Rectangle[],
  primaryWorkArea: Rectangle,
): Rectangle {
  const target = workAreas
    .map((workArea) => ({ workArea, overlap: overlapArea(bounds, workArea) }))
    .sort((left, right) => right.overlap - left.overlap)[0];
  const workArea = target && target.overlap > 0 ? target.workArea : primaryWorkArea;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);

  if (!target || target.overlap === 0) {
    return {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    };
  }

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

function overlapArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
