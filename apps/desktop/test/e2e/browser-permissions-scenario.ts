import { expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const MIC_PROBE = `navigator.mediaDevices.getUserMedia({audio:true}).then(stream => { const tracks = stream.getAudioTracks().length; stream.getTracks().forEach(track => track.stop()); return 'granted:' + tracks; }, error => error.name)`;

async function enableBrowser(page: Page, sessionID: string) {
  await page.evaluate(() => {
    location.hash = "#/settings/browser";
  });
  await page.getByRole("switch", { name: "Enable experimental browser" }).check();
  // The agent's browser tools exist only once Palot has attached the task's browser.
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      palot: { onBrowserEvent(listener: (event: { type: string; state?: unknown }) => void): void };
      __browserAttached?: boolean;
    };
    target.palot.onBrowserEvent((event) => {
      if (event.type === "state" && event.state) target.__browserAttached = true;
    });
  });
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, sessionID);
  await page.getByLabel("Current task").waitFor();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __browserAttached?: boolean }).__browserAttached,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * A page asks for the microphone while an agent drives the browser. The prompt appears in Palot,
 * outside the page, and only the person's answer decides; it is remembered per site until reset.
 */
export function createBrowserPermissionsScenario(): Scenario {
  let fixture: Server | null = null;
  let address = "";
  return {
    description:
      "ask the person for a page's microphone access in the task browser, remember the answer per site, and reset it",
    prompt: "Check the microphone on the fixture page.",
    expectedModelCalls: 4,
    async prepare() {
      fixture = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Mic fixture</title><h1>Mic fixture</h1>");
      });
      await new Promise<void>((resolve) => fixture!.listen(0, "127.0.0.1", resolve));
      fixture.unref();
      const bound = fixture.address();
      if (!bound || typeof bound === "string") throw new Error("Fixture server did not bind");
      address = `http://127.0.0.1:${bound.port}`;
    },
    arrange(llm) {
      // The agent opens the page and asks for the microphone; the call waits for the person.
      llm.tool("execute", {
        code: `const tab = await tools.browser.tabs.open({url: ${JSON.stringify(address)}});
        return {tabID: tab.id, result: await tools.browser.evaluate({tabID: tab.id, script: ${JSON.stringify(MIC_PROBE)}})};`,
      });
      llm.text("Microphone allowed.");
      // Remembered: the second request is answered without a prompt.
      llm.tool("execute", {
        code: `const [tab] = (await tools.browser.tabs.list({})).tabs;
        return {result: await tools.browser.evaluate({tabID: tab.id, script: ${JSON.stringify(MIC_PROBE)}})};`,
      });
      llm.text("Microphone still allowed.");
    },
    async run(page, { client, session, runRoot }) {
      await enableBrowser(page, session.id);
      await client.session.prompt({ sessionID: session.id, text: "Check the microphone." });
      const prompt = page.getByText(/^127\.0\.0\.1:\d+ wants to use your microphone$/);
      await expect(prompt).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: join(runRoot, "browser-permissions-prompt.png") });
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await client.experimental.session.wait({ sessionID: session.id });
      await client.session.prompt({ sessionID: session.id, text: "Check it again." });
      await client.experimental.session.wait({ sessionID: session.id });
    },
    async assert(page, { client, session, runRoot }) {
      try {
        const outputs = (await client.message.list({ sessionID: session.id, order: "asc" })).data
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .flatMap((part) =>
            part.type === "tool" && part.state.status === "completed"
              ? part.state.content.flatMap((content) =>
                  content.type === "text" ? [JSON.parse(content.text).result] : [],
                )
              : [],
          );
        expect(outputs.map((result) => result?.value ?? result)).toEqual([
          "granted:1",
          "granted:1",
        ]);
        await expect(page.getByText(/wants to use your microphone/)).toHaveCount(0);

        // The site's answer shows beside the address bar and can be reset.
        const site = page.getByRole("button", { name: /^Site permissions for 127\.0\.0\.1:/ });
        await expect(site).toBeVisible();
        await page.screenshot({ path: join(runRoot, "browser-permissions-allowed.png") });
        await site.click();
        await expect(page.getByText("Microphone: Allowed")).toBeVisible();
        await page.getByRole("menuitem", { name: "Reset and reload page" }).click();
        await expect(site).toHaveCount(0);
      } finally {
        fixture?.close();
      }
    },
  };
}
