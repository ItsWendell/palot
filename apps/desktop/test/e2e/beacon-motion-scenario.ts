import { expect, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const BEACON = "[data-palot-beacon]";
const TRACKING = "[data-beacon-tracking]";
const LEAN = "[data-beacon-lean]";
const GESTURE_TIMEOUT = 8_000;

export const beaconMotionScenario: Scenario = {
  description:
    "interactive Palot beacon tracking, finite gestures, reduced motion, and compact fit",
  prompt: "",
  expectedModelCalls: 0,
  onboarding: true,
  arrange() {},
  async run(page, { runRoot }) {
    const defaultSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => new URL(page.url()).hash).toContain("/welcome");
    const welcomeBeacon = page.locator(BEACON);
    await expect(welcomeBeacon).toHaveAccessibleName("Say hello to Palot");
    await expect(welcomeBeacon).toHaveAttribute("data-gesture", "idle");
    expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);

    const welcome = await exerciseBeacon(
      page,
      welcomeBeacon,
      page.getByRole("button", { name: "Continue", exact: true }),
    );
    await captureSurfaces(page, runRoot, "welcome", defaultSize);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("heading", { name: "Where should Palot start?" }).waitFor();
    const projectName = await page
      .locator("[data-onboarding-project-name]")
      .first()
      .getAttribute("data-onboarding-project-name");
    expect(projectName).toBeTruthy();
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    const newTask = page.getByRole("main", { name: "New task", exact: true });
    await newTask.waitFor();
    await page.getByRole("combobox", { name: `Project: ${projectName}`, exact: true }).waitFor();
    const composer = newTask.getByRole("textbox", { name: "Message Palot", exact: true });
    const newTaskBeacon = newTask.locator(BEACON);
    await expect(newTaskBeacon).toHaveAccessibleName("Say hello to Palot");
    const draft = "An unsent beacon focus check";
    await composer.fill(draft);
    const newTaskMotion = await exerciseBeacon(page, newTaskBeacon, composer);
    await expect(composer).toHaveValue(draft);
    await composer.fill("");
    await captureSurfaces(page, runRoot, "new-task", defaultSize);
    await writeFile(
      join(runRoot, "beacon-motion.json"),
      JSON.stringify({ defaultSize, welcome, newTask: newTaskMotion }, null, 2),
      { mode: 0o600 },
    );
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: null });
  },
  async assert(page) {
    await expect(page.getByRole("main", { name: "New task", exact: true })).toBeVisible();
    await expect(page.locator(BEACON)).toHaveAttribute("data-gesture", "idle");
    await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toHaveValue("");
  },
};

async function translation(tracking: Locator) {
  return tracking.evaluate((element) => {
    // Computed SVG CSS transforms are in local SVG units, not displayed pixels.
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const svg = element.closest("svg");
    if (!svg) throw new Error("Beacon tracking must be inside its SVG");
    const screen = svg.getScreenCTM();
    if (!screen) throw new Error("Beacon SVG has no screen transform");
    return {
      x: matrix.m41,
      y: matrix.m42,
      displayedX: matrix.m41 * Math.hypot(screen.a, screen.b),
      displayedY: matrix.m42 * Math.hypot(screen.c, screen.d),
      scaleX: Math.hypot(screen.a, screen.b),
      scaleY: Math.hypot(screen.c, screen.d),
    };
  });
}

async function exerciseBeacon(page: Page, beacon: Locator, focusTarget: Locator) {
  await expect(beacon).toBeVisible();
  const tracking = beacon.locator(TRACKING);
  const lean = beacon.locator(LEAN);
  const bounds = await beacon.boundingBox();
  if (!bounds) throw new Error("Beacon has no visible bounds");
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await focusTarget.focus();
  const samples = [];
  for (const sign of [-1, 1]) {
    await page.mouse.move(
      Math.max(2, Math.min(viewport.width - 2, center.x + sign * 250)),
      Math.max(2, Math.min(viewport.height - 2, center.y + sign * 180)),
    );
    await expect
      .poll(async () => {
        const offset = await translation(tracking);
        return Math.min(offset.x * sign, offset.y * sign);
      })
      .toBeGreaterThan(0.05);
    const offset = await translation(tracking);
    expect(Math.abs(offset.x)).toBeLessThanOrEqual(3.05);
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(3.05);
    expect(Math.abs(offset.displayedX)).toBeLessThanOrEqual(3.05 * offset.scaleX);
    expect(Math.abs(offset.displayedY)).toBeLessThanOrEqual(3.05 * offset.scaleY);
    await expect(focusTarget).toBeFocused();
    samples.push(offset);
  }

  // Leaving the renderer exercises reset without activating another native app.
  await page.mouse.move(-10, -10);
  await expect
    .poll(async () => {
      const offset = await translation(tracking);
      return Math.max(Math.abs(offset.x), Math.abs(offset.y));
    })
    .toBeLessThan(0.05);
  await expect(focusTarget).toBeFocused();

  const gestures = [];
  for (let index = 0; index < 2; index += 1) {
    await beacon.click();
    await expect(beacon).toHaveAttribute("data-gesture", /^(hello|orbit)$/);
    gestures.push(await beacon.getAttribute("data-gesture"));
    await expect(beacon).toHaveAttribute("data-gesture", "idle", { timeout: GESTURE_TIMEOUT });
  }

  // Change the real media-query result while a finite gesture is in flight.
  await beacon.click();
  await expect(beacon).toHaveAttribute("data-gesture", /^(hello|orbit)$/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(beacon).toHaveAttribute("data-gesture", "idle");
  await expect
    .poll(async () => {
      const offset = await translation(tracking);
      return Math.max(Math.abs(offset.x), Math.abs(offset.y));
    })
    .toBeLessThan(0.01);
  await expect
    .poll(() =>
      lean.evaluate(
        (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).isIdentity,
      ),
    )
    .toBe(true);
  await focusTarget.focus();
  await page.mouse.move(viewport.width - 2, viewport.height - 2, { steps: 8 });
  await expect(focusTarget).toBeFocused();
  await expect(beacon).toBeDisabled();
  await beacon.evaluate((element) => (element as HTMLButtonElement).click());
  // Sample multiple frames: disabled activation cannot restart reduced-motion animation.
  const staticFrames = await beacon.evaluate(async (element) => {
    const frames = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push({
        gesture: element.getAttribute("data-gesture"),
        transforms: ["[data-beacon-tracking]", "[data-beacon-lean]"].map((selector) => {
          const child = element.querySelector(selector);
          if (!child) throw new Error(`Missing ${selector}`);
          return new DOMMatrixReadOnly(getComputedStyle(child).transform).isIdentity;
        }),
      });
    }
    return frames;
  });
  expect(
    staticFrames.every((frame) => frame.gesture === "idle" && frame.transforms.every(Boolean)),
  ).toBe(true);
  return { samples, gestures, staticFrames };
}

async function captureSurfaces(
  page: Page,
  runRoot: string,
  surface: "welcome" | "new-task",
  defaultSize: { width: number; height: number },
) {
  for (const scheme of ["light", "dark"] as const) {
    // Exercise the existing native appearance bridge; Chromium media emulation
    // alone need not update Electron's persisted/resolved color scheme.
    await page.evaluate(async (mode) => {
      const api = Reflect.get(window, "palot");
      await api.updateAppearance({
        preferences: { ...api.appearancePreferences, mode },
        resolvedScheme: mode,
      });
    }, scheme);
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
    for (const [size, viewport] of [
      ["default", defaultSize],
      ["minimum", { width: 920, height: 640 }],
    ] as const) {
      // These are responsive renderer checks in the native client, not evidence
      // of compositor-enforced BrowserWindow minimum dimensions.
      await page.setViewportSize(viewport);
      await expect(page.locator(BEACON)).toBeInViewport({ ratio: 1 });
      if (surface === "new-task") {
        const main = page.getByRole("main", { name: "New task", exact: true });
        await expect(main.getByRole("heading", { level: 1 })).toBeInViewport({ ratio: 1 });
        await expect(
          main.getByRole("textbox", { name: "Message Palot", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await expect
          .poll(() =>
            main.evaluate((element) => {
              const heading = element.querySelector("h1")!.getBoundingClientRect();
              const beacon = element.querySelector("[data-palot-beacon]")!.getBoundingClientRect();
              const composer = element.querySelector(".palot-composer-shell");
              if (!composer) throw new Error("New-task composer shell was not rendered");
              const bounds = composer.getBoundingClientRect();
              return (
                beacon.top >= 0 &&
                beacon.bottom <= heading.top + 1 &&
                heading.bottom <= bounds.top + 1 &&
                bounds.bottom <= innerHeight + 1 &&
                bounds.left >= 0 &&
                bounds.right <= innerWidth + 1 &&
                element.scrollHeight <= element.clientHeight + 1
              );
            }),
          )
          .toBe(true);
      } else {
        await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport({
          ratio: 1,
        });
      }
      await page.screenshot({ path: join(runRoot, `beacon-${surface}-${scheme}-${size}.png`) });
    }
  }
  await page.setViewportSize(defaultSize);
}
