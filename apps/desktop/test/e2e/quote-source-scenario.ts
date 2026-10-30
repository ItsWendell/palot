import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

const HIGHLIGHT = "palot-response-quote";

export const quoteSourceScenario: Scenario = {
  description:
    "keep a pending quote's exact source highlighted and inspect nested file-tree guides",
  prompt: "",
  expectedModelCalls: 2,
  arrange(llm) {
    llm.text("A ring buffer keeps logs bounded.\n\nA **ring buffer** keeps logs bounded too.");
    llm.text("It retains a fixed number of entries.");
  },
  async prepareProject({ projectDirectory }) {
    await mkdir(join(projectDirectory, "src/nested"), { recursive: true });
    await writeFile(join(projectDirectory, "src/root.ts"), "export {};\n");
    await writeFile(join(projectDirectory, "src/nested/child.ts"), "export {};\n");
  },
  async run(page, { client, session, runRoot }) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await client.session.prompt({ sessionID: session.id, text: "Explain bounded logs." });
    await client.experimental.session.wait({ sessionID: session.id });
    // Start from settled history, not the streaming renderer's final DOM replacement.
    await page.reload({ waitUntil: "domcontentloaded" });
    const response = page.locator("[data-palot-response-message]").last();
    const quoted = response.locator("strong");
    const highlightText = () =>
      page.evaluate((name) => {
        const highlight = CSS.highlights.get(name);
        return highlight ? [...highlight].map((range) => range.toString()) : [];
      }, HIGHLIGHT);
    const selectQuote = async () => {
      await expect(quoted).toHaveText("ring buffer");
      await quoted.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.getByRole("button", { name: "Ask about selection", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Question about this selection" }),
      ).toBeFocused();
      await expect.poll(highlightText).toEqual(["ring buffer"]);
      expect(
        await quoted.evaluate((element, name) => {
          const range = [...CSS.highlights.get(name)!][0]!;
          return element.contains(range.startContainer) && element.contains(range.endContainer);
        }, HIGHLIGHT),
      ).toBe(true);
    };
    await selectQuote();
    const pane = page.locator('[data-workbench-pane="right"]');
    const field = page.getByRole("textbox", { name: "Question about this selection" });
    await field.fill("Why is it bounded?");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect.poll(highlightText).toEqual(["ring buffer"]);
      await page.screenshot({ path: join(runRoot, `quote-source-${colorScheme}.png`) });
    }
    // Chromium's live range moves on insertion. Even identical text at the captured
    // offsets must not keep a now-expanded range highlighted.
    await quoted.evaluate((element) => element.prepend(document.createTextNode("ring buffer")));
    await expect.poll(highlightText).toEqual([]);
    await quoted.evaluate((element) => element.firstChild!.remove());
    await pane.getByRole("button", { name: /^Close BTW:/ }).click();
    await expect.poll(highlightText).toEqual([]);
    await selectQuote();
    await field.fill("Why is it bounded?");
    await field.press("Enter");
    await expect.poll(highlightText).toEqual([]);
    await expect(
      pane.getByText("It retains a fixed number of entries.", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(runRoot, "quote-source-submitted.png") });

    await pane.getByRole("button", { name: "Open workbench surface" }).click();
    await page.getByRole("menuitem", { name: "Files", exact: true }).click();
    const files = pane.getByRole("tabpanel", { name: "Files", exact: true });
    await files.locator('[data-item-path="src/"]').click();
    await files.locator('[data-item-path="src/nested/"]').click();
    const child = files.locator('[data-item-path="src/nested/child.ts"]');
    await expect(child).toBeVisible();
    await child.hover();
    const guides = await child.evaluate((element) => {
      const root = element.getRootNode() as ShadowRoot;
      return [...element.querySelectorAll<HTMLElement>('[data-item-section="spacing-item"]')].map(
        (guide) => {
          const folder = [...root.querySelectorAll<HTMLElement>("[data-item-path]")].find(
            (row) => row.dataset.itemPath === guide.dataset.ancestorPath,
          )!;
          const icon = folder.querySelector('[data-item-section="icon"]')!.getBoundingClientRect();
          const line = guide.getBoundingClientRect();
          const style = getComputedStyle(guide);
          return {
            ancestor: guide.dataset.ancestorPath,
            offset: Math.abs(line.left + 0.5 - (icon.left + icon.width / 2)),
            opacity: style.opacity,
            borderWidth: style.borderLeftWidth,
          };
        },
      );
    });
    expect(guides).toHaveLength(2);
    await writeFile(join(runRoot, "tree-guides.json"), JSON.stringify(guides, null, 2));
    await page.screenshot({ path: join(runRoot, "nested-tree-guides.png") });
    for (const guide of guides) expect(guide.offset).toBeLessThanOrEqual(0.5);
  },
  async assert(page) {
    await expect(page.locator('[data-item-path="src/nested/child.ts"]')).toBeVisible();
  },
};
