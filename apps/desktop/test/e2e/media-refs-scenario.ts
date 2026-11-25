import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withMediaRefs } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "Compare the attached screenshot with chart.png.";
// 4×4 opaque PNG, so a decoded preview has a measurable size.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4YaMBRwzEcQDxwxLBXOwG1wAAAABJRU5ErkJggg==";
const STORED = /media:[0-9a-f]{64}/;
// `MEDIA_REFS_STORAGE_KEY` in the renderer's `lib/media-refs.ts`.
const MEDIA_REFS_STORAGE_KEY = "palot.opencode.media-refs";

async function expectDecoded(image: Locator) {
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

async function expandActivity(page: Page) {
  for (const selector of [
    "[data-palot-turn-activity] > button[aria-expanded='false']",
    "[data-palot-activity-group] > button[aria-expanded='false']",
    "[data-palot-tool-kind='read'] button[aria-expanded='false']",
  ]) {
    const triggers = page.locator(selector);
    for (let index = 0; index < (await triggers.count()); index += 1) {
      await triggers.nth(index).click({ force: true });
    }
  }
}

/**
 * OpenCode's opt-in server-stored media (`experimental.media_blob`, 2.2.0+): by default Palot's
 * transcript reads ask for `media:` references and render both a user attachment and a tool
 * image from them, while session export stays self-contained.
 */
export const mediaRefsScenario: Scenario = {
  description:
    "render a user attachment and a read tool image from server-stored media references after reload",
  prompt: PROMPT,
  expectedModelCalls: 2,
  openCodeConfig: { experimental: { media_blob: true } },
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, "chart.png"), Buffer.from(PNG, "base64"));
  },
  arrange(llm) {
    llm.tool("read", { path: "chart.png" });
    llm.text("Both images match.");
  },
  async run(_page, { client, session }) {
    await client.session.prompt({
      sessionID: session.id,
      text: PROMPT,
      files: [{ uri: `data:image/png;base64,${PNG}`, name: "attached.png" }],
    });
    await client.experimental.session.wait({ sessionID: session.id });
  },
  async assert(page, { client, session }) {
    // The server keeps both images as blobs and names them by reference for clients that ask.
    const stored = await withMediaRefs(client).message.list({
      sessionID: session.id,
      limit: 20,
      order: "desc",
    });
    const storedText = JSON.stringify(stored.data);
    expect(storedText.match(new RegExp(STORED, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(storedText).not.toContain("iVBORw0KGgo");
    const exported = JSON.stringify(
      await client.experimental.session.export({ sessionID: session.id }),
    );
    expect(exported).not.toMatch(STORED);
    expect(exported).toContain("iVBORw0KGgo");

    // Palot asks for references unless switched off. A reload then hydrates the transcript from
    // message reads, not from live events.
    const reload = async () => {
      await page.reload();
      await page.evaluate((id) => {
        window.location.hash = `/sessions/${id}`;
      }, session.id);
      await expect(page.getByText("Both images match.", { exact: true })).toBeVisible();
    };
    const attachment = page.getByRole("button", { name: "Open preview of attached.png" });

    // "0" is the off switch: the same reads return inline bytes.
    await page.evaluate((key) => localStorage.setItem(key, "0"), MEDIA_REFS_STORAGE_KEY);
    await reload();
    await expect(attachment.locator("..").locator("img")).toHaveAttribute("src", /^data:/);

    await page.evaluate((key) => localStorage.removeItem(key), MEDIA_REFS_STORAGE_KEY);
    await reload();
    await expect(attachment).toBeVisible();
    await expectDecoded(attachment.locator("..").locator("img"));

    const toolImage = page.getByRole("img", { name: /chart\.png$/ });
    await expect
      .poll(
        async () => {
          await expandActivity(page);
          return toolImage.count();
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expectDecoded(toolImage.first());
  },
};
