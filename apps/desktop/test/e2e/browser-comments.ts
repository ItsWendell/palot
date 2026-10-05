import { expect, type Page } from "@playwright/test";
import type { PalotBrowserSelection } from "../../src/shared/browser-contract";
import type { Scenario } from "./scenarios.ts";

type Context = Parameters<NonNullable<Scenario["assert"]>>[1];

export async function verifyBrowserComments(page: Page, { client, session, llm }: Context) {
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { __browserSelection?: PalotBrowserSelection };
    target.__browserSelection = undefined;
    window.palot.onBrowserEvent((event) => {
      if (event.type === "inspect" && event.selection) target.__browserSelection = event.selection;
    });
  });
  const guest = page.locator('webview[data-browser-visible="true"]');
  const box = await guest.boundingBox();
  if (!box) throw new Error("Visible browser guest missing");
  const heading = await guest.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(
      "(()=>{const r=document.querySelector('h1').getBoundingClientRect();return {x:r.x+Math.min(40,r.width/2),y:r.y+r.height/2}})()",
    ),
  );
  await page.getByRole("button", { name: "Comment on page element", exact: true }).click();
  await page.mouse.click(box.x + heading.x, box.y + heading.y);
  const editor = page.getByRole("form", { name: "Browser element comment" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("img")).toBeVisible();
  const selection = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __browserSelection?: PalotBrowserSelection })
        .__browserSelection,
  );
  if (!selection?.element.ref) throw new Error("Element picker returned no live reference");
  expect(selection.element.text).toContain("Browser fixture ready");
  await page
    .getByRole("textbox", { name: "Comment about selected element" })
    .fill("Check this heading's wording.");
  await page.getByRole("button", { name: "Attach comment to prompt" }).click();
  await expect(editor).toHaveCount(0);
  const pending = page.getByRole("region", { name: "Pending browser comments" });
  await expect(pending).toBeVisible();
  llm.tool("execute", {
    code: `const snapshot = await tools.browser.snapshot({tabID:${JSON.stringify(selection.tabID)}}); return {snapshot, selected:await tools.browser.evaluate({tabID:${JSON.stringify(selection.tabID)},ref:${JSON.stringify(selection.element.ref)},script:'element => element.textContent'})};`,
  });
  llm.text("Browser comment applied.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByText("Browser comment applied.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await client.session.wait({ sessionID: session.id });
  const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data;
  const user = messages.findLast((message) => message.type === "user");
  expect(JSON.stringify(user?.metadata)).toContain("Check this heading's wording.");
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .findLast((part) => part.type === "tool");
  expect(JSON.stringify(tool)).toContain("Browser fixture ready");
  expect(tool?.type === "tool" && tool.state.status).toBe("completed");
  expect(llm.scriptedCalls()).toBe(6);

  // A same-process child document can spoof DOM getters. Selection must still
  // succeed through trusted frame attribution, and replacement revokes its ref.
  await guest.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(`new Promise(resolve => {
    const frame = document.createElement('iframe'); frame.id = 'comment-frame'; frame.src = '/hidden';
    frame.style.cssText = 'width:400px;height:200px;position:fixed;left:8px;top:8px;z-index:9999';
    frame.onload = () => { const heading = frame.contentDocument.querySelector('h1'); Object.defineProperty(heading,'ownerDocument',{get(){throw new Error('untrusted ownerDocument')}}); resolve(true); };
    document.body.append(frame);
  })`),
  );
  const framed = await guest.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(
      `(()=>{const f=document.getElementById('comment-frame');const a=f.getBoundingClientRect();const b=f.contentDocument.querySelector('h1').getBoundingClientRect();return {x:a.x+f.clientLeft+b.x+20,y:a.y+f.clientTop+b.y+b.height/2}})()`,
    ),
  );
  const currentBox = await guest.boundingBox();
  if (!currentBox) throw new Error("Visible browser guest missing");
  await page.getByRole("button", { name: "Comment on page element", exact: true }).click();
  await page.mouse.click(currentBox.x + framed.x, currentBox.y + framed.y);
  await expect(editor).toBeVisible();
  await page
    .getByRole("textbox", { name: "Comment about selected element" })
    .fill("Keep this child-frame description after navigation.");
  await page.getByRole("button", { name: "Attach comment to prompt" }).click();
  const selectedGeneration = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __browserSelection?: PalotBrowserSelection })
        .__browserSelection?.generation,
  );
  await guest.evaluate((element) =>
    (element as Electron.WebviewTag).executeJavaScript(
      `new Promise(resolve=>{const f=document.getElementById('comment-frame');f.onload=()=>resolve(true);f.src='/hidden?replacement=1'})`,
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(
        (tabID) =>
          (
            globalThis as typeof globalThis & {
              __browserState?: { tabs: Array<{ id: string; generation: number }> };
            }
          ).__browserState?.tabs.find((tab) => tab.id === tabID)?.generation,
        selection.tabID,
      ),
    )
    .toBeGreaterThan(selectedGeneration!);
  llm.text("Child-frame comment retained without a stale reference.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Child-frame comment retained without a stale reference.", { exact: true }),
  ).toBeVisible();
  await client.session.wait({ sessionID: session.id });
  const latest = (await client.message.list({ sessionID: session.id, order: "asc" })).data.findLast(
    (message) => message.type === "user",
  );
  const restored = latest?.metadata?.browserComments as unknown as Array<PalotBrowserSelection>;
  expect(restored[0]?.element.ref).toBeUndefined();
  expect(JSON.stringify(restored)).toContain("Keep this child-frame description after navigation.");
  expect(llm.scriptedCalls()).toBe(7);
}
