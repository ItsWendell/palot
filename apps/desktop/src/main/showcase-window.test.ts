import { describe, expect, test } from "vitest";
import { resolveShowcaseConfiguration } from "./showcase-window";

describe("showcase window", () => {
  test("centers a 16:9 canvas and insets the Palot window", () => {
    const configuration = resolveShowcaseConfiguration(
      {
        PALOT_SHOWCASE: "1",
        PALOT_SHOWCASE_BACKGROUND: "/tmp/background.png",
        PALOT_SHOWCASE_LAYOUT_PATH: "/tmp/layout.json",
      },
      { x: 0, y: 25, width: 1_512, height: 944 },
    );

    expect(configuration).toEqual({
      backgroundPath: "/tmp/background.png",
      layoutPath: "/tmp/layout.json",
      zoomFactor: 0.9,
      canvas: { x: 116, y: 137, width: 1_280, height: 720 },
      window: { x: 132, y: 153, width: 1_248, height: 688 },
    });
  });

  test("stays disabled for normal launches", () => {
    expect(
      resolveShowcaseConfiguration({}, { x: 0, y: 0, width: 1_512, height: 944 }),
    ).toBeUndefined();
  });
});
