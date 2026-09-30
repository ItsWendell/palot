import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Browser } from "@opencode/plugin-browser/rpc";

/** Kill only the isolated fixture guest's positively identified Electron renderer. */
export async function verifyBrowserRecovery(page: Page, runRoot: string, address: string) {
  const before = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __browserBindingID: string;
      __browserState: Browser.State;
    };
    return { bindingID: state.__browserBindingID, inventory: state.__browserState };
  });
  const failed = before.inventory.tabs.find((tab) => tab.url === `${address}/hidden`)!;
  expect(failed).toBeDefined();
  const healthy = page.locator('webview[data-browser-visible="true"]');
  const healthyGuestID = await healthy.evaluate((element) =>
    (element as Electron.WebviewTag).getWebContentsId(),
  );
  await healthy.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(
      "globalThis.__crashSurvivor = 'healthy-tab-survived'",
    ),
  );
  const failedGuestID = await page
    .locator("webview")
    .evaluateAll(
      (elements, url) =>
        (elements as Electron.WebviewTag[])
          .find((element) => element.getURL() === url)
          ?.getWebContentsId(),
      `${address}/hidden`,
    );
  expect(failedGuestID).toBeDefined();
  const metrics = await page.evaluate(() => window.palot.performanceSnapshot());
  const guest = metrics.guests?.find((item) => item.webContentsID === failedGuestID);
  if (!guest || !Number.isSafeInteger(guest.processID) || guest.processID <= 1)
    throw new Error("Fixture guest has no live owned renderer process");
  expect(guest.processID).not.toBe(metrics.hostProcessID);
  expect(metrics.processes.find((item) => item.pid === guest.processID)?.type).toBe("Tab");
  expect(metrics.guests?.filter((item) => item.processID === guest.processID)).toHaveLength(1);
  // Public Electron diagnostics identify this exact guest, not a guessed PID
  // or a process-name search. Keep production guest DevTools restrictions intact.
  process.kill(guest.processID, "SIGKILL");
  await expect(page.locator("webview")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const state = globalThis as typeof globalThis & { __browserState: Browser.State };
        return state.__browserState.tabs.find((tab) => tab.id === id)?.loadError;
      }, failed.id),
    )
    .toBeTruthy();
  expect(
    await healthy.evaluate((element) => (element as Electron.WebviewTag).getWebContentsId()),
  ).toBe(healthyGuestID);
  expect(
    await healthy.evaluate((element) =>
      (element as Electron.WebviewTag).executeJavaScript("globalThis.__crashSurvivor"),
    ),
  ).toBe("healthy-tab-survived");
  await page.getByRole("tab", { name: "Palot hidden fixture", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/reload/i);
  await expect(page.locator("webview")).toHaveCount(1);
  const crashed = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __browserBindingID: string;
      __browserState: Browser.State;
      __browserDetached?: boolean;
    };
    return {
      bindingID: state.__browserBindingID,
      inventory: state.__browserState,
      detached: !!state.__browserDetached,
    };
  });
  expect(crashed.bindingID).toBe(before.bindingID);
  expect(crashed.detached).toBe(false);
  expect(crashed.inventory.tabs).toHaveLength(2);
  expect(crashed.inventory.tabs.find((tab) => tab.id === failed.id)!.generation).toBeGreaterThan(
    failed.generation,
  );
  await page.getByRole("button", { name: "Reload page" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("webview")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Browser address" })).toHaveValue(
    `${address}/hidden`,
  );
  await expect
    .poll(() =>
      page
        .locator('webview[data-browser-visible="true"]')
        .evaluate((element) =>
          (element as Electron.WebviewTag).executeJavaScript(
            "document.querySelector('h1')?.textContent",
          ),
        ),
    )
    .toBe("Browser fixture ready");
  const recovered = await page.evaluate(
    () => (globalThis as typeof globalThis & { __browserState: Browser.State }).__browserState,
  );
  expect(recovered.tabs.map((tab) => tab.id).sort()).toEqual(
    before.inventory.tabs.map((tab) => tab.id).sort(),
  );
  expect(recovered.focusedTabID).toBe(failed.id);
  expect(recovered.tabs.find((tab) => tab.id === failed.id)?.loadError).toBeUndefined();
  await page.getByRole("tab", { name: "Palot browser fixture", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Browser address" })).toHaveValue(`${address}/`);
  await expect
    .poll(() => healthy.evaluate((element) => (element as Electron.WebviewTag).getWebContentsId()))
    .toBe(healthyGuestID);
  await writeFile(
    path.join(runRoot, "browser-recovery.json"),
    JSON.stringify({ before, crashed, healthyGuestID, terminatedGuest: guest, recovered }, null, 2),
  );
}
