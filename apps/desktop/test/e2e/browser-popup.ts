import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";

export async function prepareBrowserPopupFixture(primary: () => string) {
  const requests: Array<{ path: string; method: string; body: string; cookie: string }> = [];
  const provider = createServer((request, response) => {
    requests.push({
      path: "provider",
      method: request.method ?? "GET",
      body: "",
      cookie: request.headers.cookie ?? "",
    });
    response.writeHead(302, {
      Location: `${primary()}/login-result`,
      "Set-Cookie": "palot_provider=ready; Path=/; SameSite=Lax; HttpOnly",
    });
    response.end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  provider.unref();
  const port = provider.address();
  if (!port || typeof port === "string") throw new Error("Popup provider fixture did not bind");
  return {
    requests,
    handle(request: IncomingMessage, response: ServerResponse) {
      if (!["/popup", "/post", "/login-start", "/login-result"].includes(request.url ?? ""))
        return false;
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({
          path: request.url!,
          method: request.method ?? "GET",
          body,
          cookie: request.headers.cookie ?? "",
        });
        if (request.url === "/login-start") {
          response.writeHead(302, { Location: `http://127.0.0.1:${port.port}/provider` });
          response.end();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><title>Palot popup fixture</title><h1>Managed popup ready</h1><button onclick="window.close()">Finish login</button><script>
          window.opener?.postMessage({kind:'palot-popup',path:location.pathname}, ${JSON.stringify(primary())});
        </script>`);
      });
      return true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

type Context = Parameters<NonNullable<Scenario["assert"]>>[1];

export async function verifyBrowserPopups(
  page: Page,
  context: Context,
  address: string,
  fixture: Awaited<ReturnType<typeof prepareBrowserPopupFixture>>,
) {
  const { client, session, runRoot } = context;
  const addressBar = page.getByRole("textbox", { name: "Browser address" });
  const originalPages = new Set(page.context().pages());
  const opener = page.locator('webview[data-browser-visible="true"]');
  await opener.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(
      "globalThis.__popupMessages=[]; addEventListener('message',e=>{if(e.data?.kind==='palot-popup') __popupMessages.push(e.data.path)});",
    ),
  );
  const open = async (script: string, url: string) => {
    await expect(addressBar).toHaveValue(`${address}/`);
    await expect(opener).toHaveCount(1);
    await opener.evaluate(
      (element, script) => (element as Electron.WebviewTag).executeJavaScript(script, true),
      script,
    );
    await expect(addressBar).toHaveValue(url);
    await expect(
      page.getByRole("tab", { name: "Palot popup fixture", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Focus popup window" })).toBeVisible();
    await expect(page.locator("webview")).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .context()
          .pages()
          .some((candidate) => !originalPages.has(candidate) && candidate.url() === url),
      )
      .toBe(true);
    const popup = page
      .context()
      .pages()
      .find((candidate) => !originalPages.has(candidate) && candidate.url() === url)!;
    await expect(popup.getByRole("heading", { name: "Managed popup ready" })).toBeVisible();
    expect(
      await popup.evaluate(() => ({
        bridge: typeof window.palot,
        node: typeof (globalThis as { require?: unknown }).require,
      })),
    ).toEqual({ bridge: "undefined", node: "undefined" });
    return popup;
  };
  const close = async (popup: Page) => {
    await popup
      .getByRole("button", { name: "Finish login" })
      .click()
      .catch((error: unknown) => {
        // window.close() can destroy the CDP target before the click reply arrives.
        if (!popup.isClosed()) throw error;
      });
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.getByRole("button", { name: "Focus popup window" })).toHaveCount(0);
    await expect(addressBar).toHaveValue(`${address}/`);
    await expect(opener).toHaveCount(1);
  };
  const first = await open("window.open('/popup');true", `${address}/popup`);
  expect(await first.evaluate(() => !!window.opener)).toBe(true);
  expect(await first.evaluate(() => document.cookie)).toContain("palot_fixture=retained");
  await page.getByRole("button", { name: "Focus popup window" }).click();
  await client.session.prompt({
    sessionID: session.id,
    text: "Inspect the managed popup through the browser tool and capture it.",
  });
  await client.session.wait({ sessionID: session.id });
  await expect(page.getByText("Popup inspection complete.", { exact: true })).toBeVisible();
  const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data;
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .findLast((part) => part.type === "tool");
  if (tool?.type !== "tool" || tool.state.status !== "completed")
    throw new Error("Popup browser tool failed");
  const output = tool.state.content.find((part) => part.type === "text");
  if (output?.type !== "text") throw new Error("Popup browser tool returned no text");
  const result = JSON.parse(output.text);
  expect(JSON.stringify(result.snapshot)).toContain("Managed popup ready");
  expect(result.screenshot.files.length).toBeGreaterThan(0);
  await writeFile(path.join(runRoot, "browser-popup-agent.json"), JSON.stringify(result, null, 2));
  // Nested windows are refused before any additional native page exists.
  expect(await first.evaluate(() => window.open("/popup") === null)).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Nested popups");
  await close(first);

  const blank = await open(
    "const child=window.open('about:blank');child.location='/popup';true",
    `${address}/popup`,
  );
  expect(await blank.evaluate(() => !!window.opener)).toBe(true);
  await close(blank);
  const post = await open(
    `document.body.insertAdjacentHTML('beforeend', '<form id="popup-post" action="/post" method="post" target="_blank" rel="opener"><input name="probe" value="a b&amp;c=✓"></form>');document.getElementById('popup-post').submit();true`,
    `${address}/post`,
  );
  expect(fixture.requests.filter((request) => request.path === "/post")).toEqual([
    expect.objectContaining({
      method: "POST",
      body: "probe=a+b%26c%3D%E2%9C%93",
      cookie: expect.stringContaining("palot_fixture=retained"),
    }),
  ]);
  expect(await post.evaluate(() => !!window.opener)).toBe(true);
  await close(post);

  const login = await open("window.open('/login-start');true", `${address}/login-result`);
  expect(fixture.requests.find((request) => request.path === "provider")?.cookie).toContain(
    "palot_fixture=retained",
  );
  expect(fixture.requests.find((request) => request.path === "/login-result")?.cookie).toContain(
    "palot_provider=ready",
  );
  await close(login);
  const received = await opener.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript("globalThis.__popupMessages"),
  );
  expect(received).toEqual(["/popup", "/popup", "/post", "/login-result"]);

  // A popup remains the same guest across route hiding, then closes with its opener.
  const last = await open("window.open('/popup');true", `${address}/popup`);
  await last.evaluate(() => {
    document.body.dataset.retained = "popup-state";
  });
  await page.evaluate(() => {
    location.hash = "#/settings/browser";
  });
  await expect(page.getByRole("switch", { name: "Enable experimental browser" })).toBeVisible();
  expect(last.isClosed()).toBe(false);
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, session.id);
  await expect(page.getByRole("button", { name: "Focus popup window" })).toBeVisible();
  // backgroundThrottling:false intentionally leaves document.visibilityState
  // visible in hidden windows. Native show/hide is covered by surface tests.
  expect(await last.evaluate(() => document.body.dataset.retained)).toBe("popup-state");
  // Deliberately close the opener via its toolbar, not Electron's default linkage.
  await page.getByRole("button", { name: "Close Palot browser fixture", exact: true }).click();
  await expect.poll(() => last.isClosed()).toBe(true);
  // Restore the original fixture as an embedded tab for later lifecycle checks.
  await page.getByRole("button", { name: "Open workbench surface" }).first().click();
  await page.getByRole("menuitem", { name: "Browser", exact: true }).click();
  await expect(addressBar).toHaveValue("about:blank");
  await addressBar.fill(address);
  await addressBar.press("Enter");
  await expect(addressBar).toHaveValue(`${address}/`);
  await writeFile(
    path.join(runRoot, "browser-popup-requests.json"),
    JSON.stringify(fixture.requests, null, 2),
  );
}
