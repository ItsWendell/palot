import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";
import { measureInteraction } from "./performance.ts";
import { measureBrowserRetention } from "./browser-retention.ts";
import { verifyBrowserRecovery } from "./browser-recovery.ts";
import { prepareBrowserPopupFixture, verifyBrowserPopups } from "./browser-popup.ts";
import { useIsolatedHttpProfile } from "./isolated-http-profile.ts";
import { verifyBrowserComments } from "./browser-comments.ts";
import type { Browser } from "@opencode/plugin-browser/rpc";

const PROMPT = "Use the browser to inspect the fixture page and report its title.";

async function captureBrowserWindow(page: Page, file: string) {
  // Surface-mode CDP captures can misrepresent embedded Electron guest layout.
  // Capture the composited window viewport rather than that synthetic surface.
  const capture = await page.context().newCDPSession(page);
  try {
    const { data } = await capture.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: false,
      captureBeyondViewport: false,
    });
    await writeFile(file, Buffer.from(data, "base64"));
  } finally {
    await capture.detach();
  }
}

export function createBrowserNativeScenario(transport: "local" | "http"): Scenario {
  let fixture: Server | null = null;
  let popupFixture: Awaited<ReturnType<typeof prepareBrowserPopupFixture>> | null = null;
  let address = "";
  let rendererErrors: string[] = [];
  let restoreProfile: (() => Promise<void>) | undefined;
  const cleanupProfile = async () => {
    const cleanup = restoreProfile;
    restoreProfile = undefined;
    await cleanup?.();
  };
  return {
    description: `attach the experimental agent browser over ${transport === "http" ? "paired HTTP" : "local transport"} and browse a local fixture`,
    prompt: PROMPT,
    // The runner waits before assert(); the popup helper sends a second prompt
    // during assert() and verifies its two additional calls there.
    expectedModelCalls: 2,
    async prepareProject() {
      rendererErrors = [];
      popupFixture = await prepareBrowserPopupFixture(() => address);
      fixture = createServer((request, response) => {
        response.setHeader("Set-Cookie", "palot_fixture=retained; Path=/; SameSite=Lax");
        if (popupFixture!.handle(request, response)) return;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          `<!doctype html><title>Palot ${request.url === "/hidden" ? "hidden" : "browser"} fixture</title><style>body {font:24px system-ui;padding:32px;background:#f1f5f9;color:#172033}</style><h1>Browser fixture ready</h1><input aria-label="Fixture input" placeholder="Type here"><p><a href="/popup" target="_blank">Open popup</a></p><form action="/post" method="post" target="_blank"><button>Submit popup form</button></form>`,
        );
      });
      await new Promise<void>((resolve) => fixture!.listen(0, "127.0.0.1", resolve));
      fixture.unref();
      const bound = fixture.address();
      if (!bound || typeof bound === "string")
        throw new Error("Fixture server did not bind a port");
      address = `http://127.0.0.1:${bound.port}`;
    },
    arrange(llm) {
      llm.tool("execute", {
        code: `const tab = await tools.browser.tabs.open({url: ${JSON.stringify(address)}});
        const hidden = await tools.browser.tabs.open({url: ${JSON.stringify(`${address}/hidden`)}, focus:false});
        await tools.browser.evaluate({tabID:hidden.id,script:'globalThis.__palotRetention = "hidden-state-retained"'});
        await tools.browser.tabs.focus({tabID:hidden.id});
        await tools.browser.tabs.focus({tabID:tab.id});
        const retained = await tools.browser.evaluate({tabID:hidden.id,script:'({marker:globalThis.__palotRetention,bridge:typeof globalThis.palot,node:typeof globalThis.require})'});
        const audit = await tools.browser.lighthouse({tabID: tab.id});
        return {snapshot:await tools.browser.snapshot({tabID: tab.id}),retained,audit};`,
      });
      llm.text("Browser inspection complete.");
      llm.tool("execute", {
        code: `const listed = await tools.browser.tabs.list({});
        const popup = listed.tabs.find(tab => tab.url.endsWith('/popup'));
        if (!popup) throw new Error('Managed popup tab missing');
        await tools.browser.tabs.focus({tabID: popup.id});
        return {snapshot: await tools.browser.snapshot({tabID: popup.id}), screenshot: await tools.browser.screenshot({tabID: popup.id})};`,
      });
      llm.text("Popup inspection complete.");
    },
    async run(page, { client, session }) {
      try {
        if (transport === "http") restoreProfile = await useIsolatedHttpProfile(page);
        page.on("pageerror", (error) => rendererErrors.push(error.message));
        // The UI opt-in attaches the plugin. The browser operation itself is
        // invoked by OpenCode's real agent tool.
        await page.evaluate(() => {
          location.hash = "#/settings/browser";
        });
        await expect(page.getByRole("switch", { name: "Show full URL" })).not.toBeChecked();
        await page.getByRole("switch", { name: "Enable experimental browser" }).check();
        await page.evaluate(() => {
          const target = globalThis as typeof globalThis & {
            palot: {
              onBrowserEvent: (
                listener: (event: {
                  bindingID: string;
                  type: string;
                  state?: Browser.State | null;
                  error?: string;
                }) => void,
              ) => () => void;
            };
            __browserAttached?: boolean;
            __browserAttachError?: string;
            __browserBindingID?: string;
            __browserDetached?: boolean;
            __browserReattached?: boolean;
            __browserState?: Browser.State;
          };
          target.palot.onBrowserEvent((event) => {
            if (event.type !== "state") return;
            if (event.error) target.__browserAttachError = event.error;
            if (!event.state && event.bindingID === target.__browserBindingID)
              target.__browserDetached = true;
            if (event.state) {
              if (target.__browserBindingID && event.bindingID !== target.__browserBindingID)
                target.__browserReattached = true;
              if (!target.__browserBindingID || target.__browserDetached)
                target.__browserBindingID = event.bindingID;
              if (event.bindingID === target.__browserBindingID)
                target.__browserState = event.state;
              target.__browserAttached = true;
              target.__browserAttachError = undefined;
            }
          });
        });
        await page.evaluate((sessionID) => {
          location.hash = `#/sessions/${sessionID}`;
        }, session.id);
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const state = globalThis as typeof globalThis & {
                  __browserAttached?: boolean;
                  __browserAttachError?: string;
                };
                return state.__browserAttached
                  ? "attached"
                  : (state.__browserAttachError ?? "pending");
              }),
            { timeout: 20_000 },
          )
          .toBe("attached");
        await client.session.prompt({ sessionID: session.id, text: PROMPT });
        await client.session.wait({ sessionID: session.id });
      } catch (error) {
        await cleanupProfile();
        throw error;
      }
    },
    async assert(page, context) {
      try {
        const { client, session, llm, runRoot, profile, visible } = context;
        await expect(page.getByText("Browser inspection complete.", { exact: true })).toBeVisible();
        const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data;
        expect(JSON.stringify(messages)).toContain("Browser fixture ready");
        const tool = messages
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool");
        if (tool?.type !== "tool" || tool.state.status !== "completed")
          throw new Error("Browser inspection tool did not complete");
        const output = tool.state.content.find((part) => part.type === "text");
        if (output?.type !== "text") throw new Error("Browser inspection returned no text");
        expect(JSON.parse(output.text).retained.value).toEqual({
          marker: "hidden-state-retained",
          bridge: "undefined",
          node: "undefined",
        });
        expect(JSON.parse(output.text).audit.scores).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "accessibility", score: expect.any(Number) }),
            expect.objectContaining({ id: "seo", score: expect.any(Number) }),
            expect.objectContaining({ id: "best-practices", score: expect.any(Number) }),
          ]),
        );
        expect(JSON.parse(output.text).audit.files).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "lighthouse.json" }),
            expect.objectContaining({ name: "lighthouse.html" }),
          ]),
        );
        expect(llm.scriptedCalls()).toBe(2);
        const addressBar = page.getByRole("textbox", { name: "Browser address" });
        await expect(addressBar).toHaveValue(address);
        await page.getByRole("tab", { name: "Palot hidden fixture", exact: true }).click();
        await expect(addressBar).toHaveValue(address);
        await addressBar.focus();
        await expect(addressBar).toHaveValue(`${address}/hidden`);
        await page.getByRole("tab", { name: "Palot browser fixture", exact: true }).click();
        await expect(addressBar).toHaveValue(address);
        await page.evaluate(() => {
          location.hash = "#/settings/browser";
        });
        await page.getByRole("switch", { name: "Show full URL" }).check();
        await page.evaluate((sessionID) => {
          location.hash = `#/sessions/${sessionID}`;
        }, session.id);
        await expect(addressBar).toHaveValue(`${address}/`);
        await expect(page.locator("webview")).toHaveCount(2);
        const guestIDs = await page
          .locator("webview")
          .evaluateAll((elements) =>
            elements.map((element) =>
              (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId(),
            ),
          );
        const first = page.getByRole("tab", { name: "Palot browser fixture", exact: true });
        const second = page.getByRole("tab", { name: "Palot hidden fixture", exact: true });
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect(second).toBeVisible();
        await second.click();
        await expect(second).toHaveAttribute("aria-selected", "true");
        await expect(addressBar).toHaveValue(`${address}/hidden`);
        await first.click();
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect(addressBar).toHaveValue(`${address}/`);
        await page.getByRole("button", { name: "Expand right workbench" }).click();
        await expect
          .poll(() =>
            page
              .locator('[data-shell-panel="center"]')
              .evaluate((element) => element.getBoundingClientRect().width),
          )
          .toBe(0);
        await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(1);
        expect(
          await page
            .locator("webview")
            .evaluateAll((elements) =>
              elements.map((element) => (element as Electron.WebviewTag).getWebContentsId()),
            ),
        ).toEqual(guestIDs);
        await page.getByRole("button", { name: "Restore right workbench" }).click();
        await expect
          .poll(() =>
            page
              .locator('[data-shell-panel="center"]')
              .evaluate((element) => element.getBoundingClientRect().width),
          )
          .toBeGreaterThan(360);
        await expect(addressBar).toHaveValue(`${address}/`);
        await expect
          .poll(() =>
            page.locator('webview[data-browser-visible="true"]').evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return (
                document.elementFromPoint(
                  bounds.x + bounds.width / 2,
                  bounds.y + bounds.height / 2,
                ) === element
              );
            }),
          )
          .toBe(true);
        const viewport = await page
          .locator('webview[data-browser-visible="true"]')
          .evaluate(async (element) => ({
            host: element.getBoundingClientRect().toJSON(),
            page: await (element as Electron.WebviewTag).executeJavaScript(
              "({width:innerWidth,height:innerHeight,zoom:visualViewport.scale})",
            ),
          }));
        await writeFile(
          path.join(runRoot, "browser-viewport.json"),
          JSON.stringify(viewport, null, 2),
        );
        expect(Math.abs(viewport.host.width - viewport.page.width)).toBeLessThanOrEqual(2);
        const hostViewport = page.locator('[data-slot="browser-viewport"]:visible');
        await hostViewport.evaluate((element) => {
          (element as HTMLElement).style.width = "300px";
        });
        await expect
          .poll(() =>
            page.locator('webview[data-browser-visible="true"]').evaluate(async (element) => ({
              host: Math.round(element.getBoundingClientRect().width),
              page: await (element as Electron.WebviewTag).executeJavaScript("innerWidth"),
            })),
          )
          .toEqual({ host: 300, page: 300 });
        await page
          .locator('webview[data-browser-visible="true"]')
          .evaluate((element) => (element as Electron.WebviewTag).setZoomFactor(1.25));
        await expect
          .poll(() =>
            page
              .locator('webview[data-browser-visible="true"]')
              .evaluate((element) =>
                (element as Electron.WebviewTag).executeJavaScript("innerWidth"),
              ),
          )
          .toBe(240);
        await page
          .locator('webview[data-browser-visible="true"]')
          .evaluate((element) => (element as Electron.WebviewTag).setZoomFactor(1));
        await hostViewport.evaluate((element) => {
          (element as HTMLElement).style.width = "";
        });
        await expect
          .poll(() =>
            hostViewport.evaluate((element) => Math.round(element.getBoundingClientRect().width)),
          )
          .toBe(Math.round(viewport.host.width));
        await expect
          .poll(() =>
            page
              .locator('webview[data-browser-visible="true"]')
              .evaluate(async (element) =>
                Math.abs(
                  element.getBoundingClientRect().width -
                    (await (element as Electron.WebviewTag).executeJavaScript("innerWidth")),
                ),
              ),
          )
          .toBeLessThanOrEqual(2);
        if (profile) {
          const { report } = await measureInteraction(page, "browser-host-tab-switch", async () => {
            for (let index = 0; index < 12; index++) {
              await second.click();
              await expect(addressBar).toHaveValue(`${address}/hidden`);
              await first.click();
              await expect(addressBar).toHaveValue(`${address}/`);
            }
          });
          const { report: idle } = await measureInteraction(page, "browser-host-idle", () =>
            page.waitForTimeout(2000),
          );
          await writeFile(
            path.join(runRoot, "browser-host-performance.json"),
            JSON.stringify(
              {
                backend: "webview",
                pages: 2,
                switches: 24,
                report,
                idle,
              },
              null,
              2,
            ),
          );
        }
        if (visible) {
          const layout = await page
            .locator('webview[data-browser-visible="true"]')
            .evaluate((element) =>
              (element as Electron.WebviewTag).executeJavaScript(`({
          viewport:innerWidth, client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth,
          body:document.body.getBoundingClientRect().toJSON(), heading:document.querySelector('h1').getBoundingClientRect().toJSON(),
          whiteSpace:getComputedStyle(document.querySelector('h1')).whiteSpace
        })`),
            );
          await writeFile(
            path.join(runRoot, "browser-page-layout.json"),
            JSON.stringify(layout, null, 2),
          );
          expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
          await captureBrowserWindow(page, path.join(runRoot, "browser-host-page.png"));
        }
        await page.getByRole("button", { name: "Open workbench surface" }).first().click();
        await expect(page.getByRole("menu")).toBeVisible();
        {
          await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(1);
          expect(
            await page.getByRole("menu").evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(bounds.x + bounds.width / 2, bounds.bottom - 10),
              );
            }),
          ).toBe(true);
          expect(
            await page
              .locator("webview")
              .evaluateAll((elements) =>
                elements.map((element) =>
                  (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId(),
                ),
              ),
          ).toEqual(guestIDs);
        }
        if (visible)
          await captureBrowserWindow(page, path.join(runRoot, "browser-host-overlay.png"));
        await page.keyboard.press("Escape");
        await page
          .locator('webview[data-browser-visible="true"]')
          .evaluate((element) =>
            (element as Electron.WebviewTag).executeJavaScript(
              "globalThis.__routeRetention = 'live-session-page'",
            ),
          );
        await page.evaluate(() => {
          location.hash = "#/settings/browser";
        });
        await expect(
          page.getByRole("switch", { name: "Enable experimental browser" }),
        ).toBeVisible();
        await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(0);
        expect(
          await page
            .locator("webview")
            .evaluateAll((elements) =>
              elements.map((element) => (element as Electron.WebviewTag).getWebContentsId()),
            ),
        ).toEqual(guestIDs);
        const other = await client.session.create({ location: session.location });
        await page.evaluate((id) => {
          location.hash = `#/sessions/${id}`;
        }, other.id);
        await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
        await expect(page.locator('webview[data-browser-visible="true"]')).toHaveCount(0);
        await page.evaluate((id) => {
          location.hash = `#/sessions/${id}`;
        }, session.id);
        await expect(addressBar).toHaveValue(`${address}/`);
        expect(
          await page
            .locator('webview[data-browser-visible="true"]')
            .evaluate((element) =>
              (element as Electron.WebviewTag).executeJavaScript("globalThis.__routeRetention"),
            ),
        ).toBe("live-session-page");
        expect(
          await page
            .locator("webview")
            .evaluateAll((elements) =>
              elements.map((element) => (element as Electron.WebviewTag).getWebContentsId()),
            ),
        ).toEqual(guestIDs);
        await verifyBrowserPopups(page, context, address, popupFixture!);
        expect(llm.scriptedCalls()).toBe(4);
        if (profile)
          await measureBrowserRetention(page, {
            runRoot,
            address,
            sessionID: session.id,
            otherSessionID: other.id,
          });
        await page.getByRole("button", { name: "Reload page" }).click();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await verifyBrowserRecovery(page, runRoot, address);
        await verifyBrowserComments(page, context);
        await captureBrowserWindow(page, path.join(runRoot, "browser-comments.png"));
        await addressBar.fill("file:///etc/passwd");
        await addressBar.press("Enter");
        await expect(page.getByRole("alert")).toContainText("Only HTTP, HTTPS");
        await page.evaluate(() => {
          location.hash = "#/settings/browser";
        });
        await page.getByRole("switch", { name: "Enable experimental browser" }).uncheck();
        await expect(page.locator("webview")).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(() => (globalThis as { __browserDetached?: boolean }).__browserDetached),
          )
          .toBe(true);
        await page.evaluate(() => {
          (globalThis as { __browserReattached?: boolean }).__browserReattached = false;
        });
        await page.getByRole("switch", { name: "Enable experimental browser" }).check();
        await page.evaluate((sessionID) => {
          location.hash = `#/sessions/${sessionID}`;
        }, session.id);
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (globalThis as { __browserReattached?: boolean }).__browserReattached,
              ),
            { timeout: 20_000 },
          )
          .toBe(true);
        await expect(page.getByRole("textbox", { name: "Browser address" })).toHaveValue(
          `${address}/`,
        );
        await page.getByRole("button", { name: "Browser options" }).click();
        await page.getByRole("menuitem", { name: "Find in page" }).click();
        await page.getByRole("textbox", { name: "Find in page" }).fill("Browser fixture");
        await page.getByRole("button", { name: "Close find" }).click();
        await page.evaluate(() => {
          location.hash = "#/settings/browser";
        });
        await page.getByRole("button", { name: "Clear data" }).click();
        await expect(page.getByRole("alertdialog")).toContainText(
          "Clear browser data for this task?",
        );
        await page.getByRole("button", { name: "Clear task data" }).click();
        await expect(page.getByText("Task browser data cleared")).toBeVisible();
        await expect(page.locator("webview")).toHaveCount(0);
        await page.evaluate((sessionID) => {
          location.hash = `#/sessions/${sessionID}`;
        }, session.id);
        await expect(page.getByRole("tab", { name: "Palot browser fixture" })).toHaveCount(0);
        await page.getByRole("button", { name: "Show terminal" }).click();
        const bottomWorkbench = page.locator('[data-workbench-pane="bottom"]');
        await bottomWorkbench.getByRole("button", { name: "Open workbench surface" }).click();
        await page.getByRole("menuitem", { name: "Browser" }).click();
        await expect(bottomWorkbench.getByRole("tab", { name: "New tab" })).toBeVisible();
        await expect(page.locator('[data-workbench-pane="right"]:visible')).toHaveCount(0);
        expect(rendererErrors).toEqual([]);
        await new Promise<void>((resolve, reject) =>
          fixture!.close((error) => (error ? reject(error) : resolve())),
        );
        fixture = null;
        await popupFixture!.close();
        popupFixture = null;
      } finally {
        await cleanupProfile();
      }
    },
  };
}

export const browserNativeScenario = createBrowserNativeScenario("local");
export const browserNativeHttpScenario = createBrowserNativeScenario("http");
