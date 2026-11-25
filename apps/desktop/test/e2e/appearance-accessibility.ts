import { expect, type Page } from "@playwright/test";

/** Command surfaces are deliberately opaque on every native material tier. */
export async function assertCommandPaletteMaterial(page: Page): Promise<void> {
  const html = page.locator("html");
  const originalReduced = await html.getAttribute("data-reduced-transparency");
  const originalTier = await html.getAttribute("data-chrome-tier");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const backdrop = page.locator(".palot-surface-backdrop[data-tone='command']");
  await backdrop.waitFor();
  try {
    // Exercise the fallback and its reverse without pretending Linux has macOS
    // vibrancy. The command palette stays solid even when native chrome is glass.
    for (const reduced of [false, true, false]) {
      await html.evaluate((element, value) => {
        element.setAttribute("data-reduced-transparency", String(value));
      }, reduced);
      await expect(html).toHaveAttribute("data-chrome-tier", originalTier!);
      const material = await backdrop.evaluate((element) => {
        const style = getComputedStyle(element);
        const reference = document.createElement("div");
        reference.style.backgroundColor = "var(--command-background-opaque)";
        element.append(reference);
        const expected = getComputedStyle(reference).backgroundColor;
        reference.remove();
        const context = document.createElement("canvas").getContext("2d")!;
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return {
          background: style.backgroundColor,
          expected,
          alpha: context.getImageData(0, 0, 1, 1).data[3],
          filter: style.backdropFilter,
          image: style.backgroundImage,
        };
      });
      expect(material.background).toBe(material.expected);
      expect(material.alpha).toBe(255);
      expect(material.filter).toBe("none");
      expect(material.image).toBe("none");
    }
  } finally {
    await html.evaluate((element, value) => {
      if (value === null) element.removeAttribute("data-reduced-transparency");
      else element.setAttribute("data-reduced-transparency", value);
    }, originalReduced);
    await page.keyboard.press("Escape");
  }
}

interface ReducedMotionProbe {
  transitionProperties: string[];
  spinnerIterationCount: string;
  pulseIterationCount: string;
}

/**
 * Reduced motion removes movement but keeps colour and opacity transitions and
 * running progress indicators, for both the OS media query and Palot's own setting.
 */
export async function assertReducedMotion(page: Page): Promise<void> {
  const probe = (useAttribute: boolean) =>
    page.evaluate((attribute): ReducedMotionProbe => {
      const root = document.documentElement;
      const original = root.getAttribute("data-reduced-motion");
      if (attribute) root.setAttribute("data-reduced-motion", "true");
      const moving = document.createElement("div");
      moving.style.transition = "transform 200ms, height 200ms, opacity 200ms";
      const spinner = document.createElement("span");
      spinner.className = "animate-spin";
      const pulse = document.createElement("span");
      pulse.className = "animate-pulse";
      document.body.append(moving, spinner, pulse);
      try {
        return {
          transitionProperties: getComputedStyle(moving)
            .transitionProperty.split(",")
            .map((value) => value.trim()),
          spinnerIterationCount: getComputedStyle(spinner).animationIterationCount,
          pulseIterationCount: getComputedStyle(pulse).animationIterationCount,
        };
      } finally {
        moving.remove();
        spinner.remove();
        pulse.remove();
        if (original === null) root.removeAttribute("data-reduced-motion");
        else root.setAttribute("data-reduced-motion", original);
      }
    }, useAttribute);

  for (const signal of ["setting", "media"] as const) {
    await page.emulateMedia({ reducedMotion: signal === "media" ? "reduce" : "no-preference" });
    const result = await probe(signal === "setting");
    expect(result.transitionProperties, `${signal}: colour and opacity still fade`).toContain(
      "opacity",
    );
    for (const movement of ["transform", "height", "all"]) {
      expect(result.transitionProperties, `${signal}: ${movement} changes at once`).not.toContain(
        movement,
      );
    }
    expect(result.spinnerIterationCount, `${signal}: spinners keep turning`).toBe("infinite");
    expect(result.pulseIterationCount, `${signal}: pulses keep running`).toBe("infinite");
  }
}
