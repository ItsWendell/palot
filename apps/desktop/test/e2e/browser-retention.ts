import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Browser } from "@opencode/plugin-browser/rpc";
import type { PalotPerformanceSnapshot } from "../../src/shared/performance-contract";

/** An accumulating workload, not independent samples or a GPU performance benchmark. */
export async function measureBrowserRetention(
  page: Page,
  options: { runRoot: string; address: string; sessionID: string; otherSessionID: string },
) {
  const original = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __browserBindingID: string;
      __browserState: Browser.State;
    };
    return { bindingID: state.__browserBindingID, tabs: state.__browserState.tabs };
  });
  const samples: Array<{
    phase: string;
    guests: number;
    visibleGuests: number;
    snapshots: PalotPerformanceSnapshot[];
  }> = [];
  const sample = async (phase: string, guests: number, visibleGuests: number) => {
    await expect(page.locator("webview")).toHaveCount(guests);
    await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(visibleGuests);
    const snapshots: PalotPerformanceSnapshot[] = [];
    for (let index = 0; index < 3; index++) {
      // Space snapshots so CPU's interval sample is meaningful. No forced GC:
      // retained working set is not equivalent to leaked or live JS heap.
      await page.waitForTimeout(500);
      snapshots.push(await page.evaluate(() => window.palot.performanceSnapshot()));
    }
    samples.push({ phase, guests, visibleGuests, snapshots });
  };
  await sample("two-tabs", 2, 1);
  for (let batch = 0; batch < 2; batch++) {
    for (let index = 0; index < 4; index++) {
      await page.evaluate(
        async ({ bindingID, url }) => {
          await window.palot.browserCommand(bindingID, { type: "tabs.open", url, focus: false });
        },
        { bindingID: original.bindingID, url: `${options.address}/retained-${batch * 4 + index}` },
      );
    }
    await sample(`${6 + batch * 4}-tabs`, 6 + batch * 4, 1);
    await expect(page.getByRole("tab", { name: "Palot browser fixture", exact: true })).toHaveCount(
      5 + batch * 4,
    );
  }
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, options.otherSessionID);
  await sample("ten-tabs-inactive-session", 10, 0);
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, options.sessionID);
  await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(1);
  await page.evaluate(
    async ({ bindingID, originalIDs }) => {
      const state = globalThis as typeof globalThis & { __browserState: Browser.State };
      const extras = state.__browserState.tabs.filter((tab) => !originalIDs.includes(tab.id));
      for (const tab of extras) {
        await window.palot.browserCommand(bindingID, { type: "tabs.close", tabID: tab.id });
      }
    },
    { bindingID: original.bindingID, originalIDs: original.tabs.map((tab) => tab.id) },
  );
  await sample("back-to-two-after-explicit-close", 2, 1);
  await writeFile(
    path.join(options.runRoot, "browser-retention.json"),
    JSON.stringify(
      {
        workload: "accumulating-same-origin-tabs-and-session-switch",
        forcedGC: false,
        display: await readFile(path.join(options.runRoot, "display.json"), "utf8")
          .then(JSON.parse)
          .catch(() => ({ mode: "desktop" })),
        samples,
      },
      null,
      2,
    ),
  );
}
