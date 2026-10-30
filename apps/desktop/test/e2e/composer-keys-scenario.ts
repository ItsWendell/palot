import type { SessionMessageInfo } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const TURNS = 30;
const DRAFT = "keep this draft";
const lastPromptID = `msg_keys_user_${TURNS}`;

/**
 * PageUp/PageDown page the transcript from the plain and rich composer without moving
 * focus or the caret, and the slash-command highlight stays on the keyboard's row while
 * the list scrolls under a resting pointer.
 */
export const composerKeysScenario: Scenario = {
  description:
    "page the transcript from the composer, and keep the suggestion highlight under a resting pointer",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const base = Date.now() - 600_000;
    const messages: SessionMessageInfo[] = Array.from({ length: TURNS }, (_, index) => {
      const number = index + 1;
      return [
        {
          id: `msg_keys_user_${number}`,
          type: "user" as const,
          time: { created: base + index * 2_000 },
          text: `Paging prompt ${number}.`,
        },
        {
          id: `msg_keys_assistant_${number}`,
          type: "assistant" as const,
          time: { created: base + index * 2_000 + 1, completed: base + index * 2_000 + 2 },
          agent: "build",
          model: { providerID: "test", id: "test-model" },
          finish: "stop" as const,
          content: [
            {
              type: "text" as const,
              text: `Paging reply ${number}.\n\n${"Settled history for page keys. ".repeat(24)}`,
            },
          ],
        },
      ];
    }).flat();
    const source = await client.experimental.session.import({
      info: { ...session, id: `${session.id}_keys`, title: "Composer keys fixture" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "keys-session-id.txt"), source.id, { mode: 0o600 });
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = (await readFile(join(runRoot, "keys-session-id.txt"), "utf8")).trim();
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSession(page, sessionID);
    const transcript = page.getByLabel("Task transcript", { exact: true });
    const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await atBottom(transcript);

    await composer.click();
    await composer.fill(DRAFT);
    await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(4, 4));
    const pageHeight = await visibleHeight(page, transcript);
    const resting = await scrollTop(transcript);
    await composer.press("PageUp");
    await expect.poll(() => scrollTop(transcript)).toBeLessThan(resting - pageHeight * 0.6);
    await expect.poll(() => scrollTop(transcript)).toBeGreaterThan(resting - pageHeight);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(DRAFT);
    expect(
      await composer.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([4, 4]);
    await expect(transcript).toHaveAttribute("data-bottom-locked", "false");
    await page.screenshot({ path: join(runRoot, "composer-keys-paged-up.png") });

    // Shift+PageUp keeps the textarea's own selection behavior.
    const paged = await settledScrollTop(transcript);
    await composer.press("Shift+PageUp");
    expect(await settledScrollTop(transcript)).toBe(paged);

    for (let index = 0; index < 6 && (await distanceFromBottom(transcript)) > 1; index += 1) {
      await composer.press("PageDown");
      await settledScrollTop(transcript);
    }
    await atBottom(transcript);
    await expect(transcript).toHaveAttribute("data-bottom-locked", "true");
    await expect(composer).toBeFocused();

    // An open suggestion list keeps the page keys' native meaning.
    await composer.fill("");
    await composer.pressSequentially("/");
    const suggestions = page.getByRole("listbox", { name: "Composer suggestions" });
    await expect(suggestions).toBeVisible();
    const bottom = await settledScrollTop(transcript);
    await composer.press("PageUp");
    expect(await settledScrollTop(transcript)).toBe(bottom);

    // A pointer resting over the list must not take the highlight when the list scrolls.
    await composer.fill("");
    await composer.pressSequentially("/");
    await expect(suggestions).toBeVisible();
    const options = suggestions.getByRole("option");
    const count = await options.count();
    const list = suggestions.locator("div.overflow-y-auto");
    expect(
      await list.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
      `${count} commands should overflow the suggestion list`,
    ).toBe(true);
    const second = (await options.nth(1).boundingBox())!;
    await page.mouse.move(second.x + 40, second.y + second.height / 2, { steps: 4 });
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await composer.press("ArrowUp");
    await composer.press("ArrowUp");
    await expect(options.nth(count - 1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    // Chromium updates hover with movement-free events after the list scrolls.
    await page.waitForTimeout(400);
    await expect(options.nth(count - 1)).toHaveAttribute("aria-selected", "true");
    await expect(suggestions.locator('[aria-selected="true"]')).toHaveCount(1);
    await page.screenshot({ path: join(runRoot, "composer-keys-resting-pointer.png") });
    const name = (await options
      .nth(count - 1)
      .locator("span.font-medium")
      .textContent())!;
    await composer.press("Enter");
    await expect(composer).toHaveValue(`${name} `);
    await composer.fill("");

    // The rich composer pages the same way.
    await page.evaluate(() => {
      location.hash = "#/settings/general";
    });
    await page.getByRole("switch", { name: "Rich composer (beta)", exact: true }).click();
    await openSession(page, sessionID);
    const rich = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(rich).toHaveAttribute("contenteditable", "true");
    await atBottom(transcript);
    await rich.click();
    await rich.pressSequentially(DRAFT);
    const richResting = await settledScrollTop(transcript);
    await rich.press("PageUp");
    await expect.poll(() => scrollTop(transcript)).toBeLessThan(richResting - pageHeight * 0.6);
    await expect(rich).toBeFocused();
    await expect(rich).toHaveText(DRAFT);
    expect(await rich.evaluate(() => window.getSelection()?.anchorOffset)).toBe(DRAFT.length);
    await writeFile(
      join(runRoot, "composer-keys.json"),
      JSON.stringify({ pageHeight, resting, paged, commands: count, chosen: name }, null, 2),
    );
  },
  async assert() {},
};

async function openSession(page: Page, sessionID: string) {
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, sessionID);
  await expect(page.locator(`[data-message-id="${lastPromptID}"]`)).toBeVisible();
}

function scrollTop(transcript: Locator) {
  return transcript.evaluate((element) => element.scrollTop);
}

function distanceFromBottom(transcript: Locator) {
  return transcript.evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  );
}

async function atBottom(transcript: Locator) {
  await expect.poll(() => distanceFromBottom(transcript)).toBeLessThanOrEqual(1);
}

/** The scroll offset once a smooth scroll has come to rest. */
async function settledScrollTop(transcript: Locator) {
  let previous = Number.NaN;
  await expect
    .poll(async () => {
      const current = await scrollTop(transcript);
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
  return previous;
}

/** Transcript height above the composer dock that overlays its bottom. */
async function visibleHeight(page: Page, transcript: Locator) {
  const viewport = (await transcript.boundingBox())!;
  const dock = (await page.locator("[data-palot-composer-dock]").boundingBox())!;
  return Math.min(viewport.y + viewport.height, dock.y) - viewport.y;
}
