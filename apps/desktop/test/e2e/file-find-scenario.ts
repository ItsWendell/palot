import type { SessionMessageInfo } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "msg_file_find_user";
const RESPONSE = "msg_file_find_assistant";
const FIND = process.platform === "darwin" ? "Meta+f" : "Control+f";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfoAAAAASUVORK5CYII=",
  "base64",
);
// A bare `table.csv` stays code in Markdown; a path links.
const files = ["search.ts", "guide.md", "data/table.csv", "pixel.png"];

/** True when the active find highlight's range is inside the tab panel's visible area. */
async function activeMatchInView(page: Page, panel: Locator): Promise<string | null> {
  const bounds = await panel.boundingBox();
  if (!bounds) return null;
  return page.evaluate(
    ({ top, bottom }) => {
      const active = CSS.highlights.get("palot-diff-find-active");
      const range = active ? ([...active][0] as Range | undefined) : undefined;
      if (!range) return null;
      const rect = range.getBoundingClientRect();
      return rect.height > 0 && rect.top >= top && rect.bottom <= bottom ? range.toString() : null;
    },
    { top: bounds.y, bottom: bounds.y + bounds.height },
  );
}

export const fileFindScenario: Scenario = {
  description:
    "Mod+F finds in a file tab's source, Markdown preview and table, says when an image cannot be searched, and leaves Find in task to the transcript",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const source = Array.from({ length: 200 }, (_, index) =>
      index === 0
        ? "const needle = 1;"
        : index === 100
          ? "useNeedle(needle);"
          : `const filler${index} = ${index};`,
    );
    await writeFile(join(projectDirectory, "search.ts"), `${source.join("\n")}\n`);
    const paragraphs = Array.from({ length: 80 }, (_, index) => `Paragraph ${index} of filler.`);
    await writeFile(
      join(projectDirectory, "guide.md"),
      [
        "# Needle guide",
        "",
        "Find the **nee**dle here.",
        "",
        ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
        "- last needle item",
        "",
      ].join("\n"),
    );
    const rows = Array.from(
      { length: 400 },
      (_, index) => `row${index},${index % 100 === 7 ? "needle" : "hay"}`,
    );
    await mkdir(join(projectDirectory, "data"), { recursive: true });
    await writeFile(
      join(projectDirectory, "data", "table.csv"),
      `name,value\n${rows.join("\n")}\n`,
    );
    await writeFile(join(projectDirectory, "pixel.png"), PNG);
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      { id: PROMPT, type: "user", time: { created }, text: "Show me these files." },
      {
        id: RESPONSE,
        type: "assistant",
        time: { created: created + 1, completed: created + 2 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: files.map((file) => `Open \`${file}\`.`).join("\n\n") }],
      },
    ];
    const imported = await client.experimental.session.import({
      info: { ...session, id: `${session.id}_file_find`, title: "File find fixtures" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "file-find-session.txt"), imported.id);
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = await readFile(join(runRoot, "file-find-session.txt"), "utf8");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${encodeURIComponent(id)}`;
    }, sessionID);
  },
  async assert(page, { runRoot }) {
    await page.setViewportSize({ width: 1440, height: 920 });
    const response = page.locator(`[data-message-id="${PROMPT}"]`);
    const open = async (path: string) => {
      await response.getByRole("link", { name: `Open ${path}`, exact: true }).click();
      return page
        .locator('[data-workbench-pane="right"]')
        .getByRole("tabpanel", { name: path.split("/").at(-1), exact: true });
    };
    const taskFind = page.getByRole("search", { name: "Find in task" });

    // Source view: matches come from the file text, the far match scrolls into view.
    const code = await open("search.ts");
    const editor = code.getByRole("textbox", { name: "search.ts", exact: true });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.getByText("const needle = 1;", { exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.press(FIND);
    const codeFind = code.getByRole("search", { name: "Find in file" });
    const codeInput = codeFind.getByRole("textbox", { name: "Find in file" });
    await expect(codeInput).toBeFocused();
    await expect(taskFind).toHaveCount(0);
    await page.keyboard.type("needle");
    await expect(codeFind.getByRole("status")).toHaveText("1 of 3");
    await page.keyboard.press("Enter");
    await expect(codeFind.getByRole("status")).toHaveText("2 of 3");
    await expect.poll(() => activeMatchInView(page, code)).toBe("Needle");
    await page.keyboard.press("Enter");
    await expect(codeFind.getByRole("status")).toHaveText("3 of 3");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("Shift+Enter");
    await expect(codeFind.getByRole("status")).toHaveText("1 of 3");
    await page.screenshot({ path: join(runRoot, "file-find-source.png") });
    await page.keyboard.press("Escape");
    await expect(codeFind).toHaveCount(0);
    await expect(editor).toBeFocused();

    // Markdown preview: rendered text, including text split by formatting.
    const guide = await open("guide.md");
    await guide.getByRole("heading", { name: "Needle guide" }).click();
    await page.keyboard.press(FIND);
    const guideFind = guide.getByRole("search", { name: "Find in file" });
    await expect(guideFind.getByRole("textbox", { name: "Find in file" })).toBeFocused();
    await page.keyboard.type("needle");
    await expect(guideFind.getByRole("status")).toHaveText("1 of 3");
    await page.keyboard.press("Enter");
    await expect(guideFind.getByRole("status")).toHaveText("2 of 3");
    await page.keyboard.press("Enter");
    await expect(guideFind.getByRole("status")).toHaveText("3 of 3");
    await expect.poll(() => activeMatchInView(page, guide)).toBe("needle");
    await page.screenshot({ path: join(runRoot, "file-find-markdown.png") });
    await page.keyboard.press("Escape");
    await expect(guideFind).toHaveCount(0);

    // Table preview: rows outside the virtualized range still count and scroll into view.
    const table = await open("data/table.csv");
    await table.getByRole("cell", { name: "row0", exact: true }).click();
    await page.keyboard.press(FIND);
    const tableFind = table.getByRole("search", { name: "Find in file" });
    await expect(tableFind.getByRole("textbox", { name: "Find in file" })).toBeFocused();
    await page.keyboard.type("needle");
    await expect(tableFind.getByRole("status")).toHaveText("1 of 4");
    await page.keyboard.press("Shift+Enter");
    await expect(tableFind.getByRole("status")).toHaveText("4 of 4");
    await expect(table.getByRole("cell", { name: "row307", exact: true })).toBeInViewport();
    await expect.poll(() => activeMatchInView(page, table)).toBe("needle");
    await page.keyboard.press("Escape");

    // An image has no text: the bar says so instead of doing nothing.
    const image = await open("pixel.png");
    await image.getByRole("img", { name: "pixel.png" }).click();
    await page.keyboard.press(FIND);
    const imageFind = image.getByRole("search", { name: "Find in file" });
    await expect(imageFind).toContainText("Find is not available in images.");
    await page.keyboard.press("Escape");
    await expect(imageFind).toHaveCount(0);

    // Switching tabs away and back keeps where each view was: source scroll and image zoom.
    const pane = page.locator('[data-workbench-pane="right"]');
    const switchTo = async (name: string) => {
      await pane.getByRole("tab", { name, exact: true }).click();
      await expect(pane.getByRole("tab", { name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    };
    await image.getByRole("button", { name: "Zoom in" }).click();
    const zoomed = await image.getByRole("toolbar", { name: "Image zoom" }).textContent();
    await expect(image.getByRole("button", { name: "Fit image to pane" })).toBeEnabled();
    await switchTo("search.ts");
    const scroller = code.locator(".overflow-auto").first();
    await scroller.evaluate((element) => {
      element.scrollTop = 600;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(600);
    await switchTo("table.csv");
    await switchTo("search.ts");
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(600);
    await switchTo("pixel.png");
    await expect(image.getByRole("button", { name: "Fit image to pane" })).toBeEnabled();
    await expect(image.getByRole("toolbar", { name: "Image zoom" })).toHaveText(zoomed ?? "");

    // Mod+F in the transcript still opens Find in task.
    await response.getByText("Show me these files.").click();
    await page.keyboard.press(FIND);
    await expect(taskFind).toBeVisible();
    await expect(page.getByRole("search", { name: "Find in file" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  },
};
