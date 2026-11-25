import { expect, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const STYLE_GUIDE = "https://example.com/style-guide";
const SINGLE_PROMPT = `Which output style should we use? Samples: ${STYLE_GUIDE}.`;
const CUSTOM_ANSWER = "A short checklist with examples";
const LONG_DESCRIPTION =
  "Keep the result brief while preserving the important context, concrete examples, and any caveats that help a reader understand the tradeoffs without opening another document.";
const MULTI_PROMPTS = ["Where should the result go?", "Which extras should we include?"];

export const compactQuestionScenario: Scenario = {
  description: "answer compact native questions with shortcuts, custom text, and preserved steps",
  prompt: "Ask for the output style.",
  expectedModelCalls: 4,
  arrange(llm) {
    llm.tool("question", {
      questions: [
        {
          header: "Output style",
          question: SINGLE_PROMPT,
          options: [
            { label: "Concise", description: LONG_DESCRIPTION },
            { label: "Detailed", description: "Include the full reasoning and supporting detail." },
          ],
        },
      ],
    });
    llm.text("COMPACT SINGLE ANSWER RECEIVED");
    llm.tool("question", {
      questions: [
        {
          header: "Destination",
          question: MULTI_PROMPTS[0],
          options: [
            { label: "Notebook", description: "Save for later reference." },
            { label: "Chat", description: "Keep it in this conversation." },
          ],
        },
        {
          header: "Extras",
          question: MULTI_PROMPTS[1],
          multiple: true,
          options: [
            { label: "Examples", description: "Show concrete usage." },
            { label: "Caveats", description: "Explain the limitations." },
          ],
        },
      ],
    });
    llm.text("COMPACT MULTIPLE ANSWERS RECEIVED");
  },
  async run(page, { client, session, llm, runRoot }) {
    const panel = page.locator("[data-palot-composer-request]");
    const field = page.getByRole("textbox", { name: "Message Palot" });
    const attach = page.getByRole("button", { name: "Add files, commands and more", exact: true });
    // The one model pill also carries the effort.
    const model = page.getByRole("button", { name: /^Model: Test Model/ });
    await expect(attach).toBeVisible();
    await expect(model).toBeVisible();

    // The question opens a panel above the text field; the field and the row stay usable.
    async function assertComposerBeside() {
      await expect(field).toBeVisible();
      await expect(attach).toBeVisible();
      await expect(model).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop task", exact: true })).toBeEnabled();
      await expect(panel.getByRole("button", { name: "Dismiss", exact: true })).toBeEnabled();
    }

    async function assertRestoredComposer() {
      await expect(panel).toBeHidden();
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("data-placeholder", "Do anything");
      await expect(attach).toBeVisible();
      await expect(model).toBeVisible();
    }

    await client.session.prompt({ sessionID: session.id, text: this.prompt });
    await assertQuestion(panel, SINGLE_PROMPT, null);
    await assertComposerBeside();
    await expect(panel.getByText("Output style", { exact: true })).toBeHidden();
    // The empty field doubles as the typed answer.
    await expect(field).toHaveAttribute("data-placeholder", "Type your own answer…");
    await expect(panel.getByText(LONG_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Back", exact: true })).toBeHidden();
    await capturePresentation(page, panel, runRoot);
    const guide = panel.getByRole("link", { name: STYLE_GUIDE, exact: true });
    await guide.click({ button: "right" });
    const linkMenu = page.getByRole("menu", { name: `Link actions for ${STYLE_GUIDE}` });
    await expect(linkMenu.getByRole("menuitem", { name: "Copy link", exact: true })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "compact-question-link-menu.png") });
    await page.keyboard.press("Escape");
    await expect(linkMenu).toBeHidden();

    // 1–9 pick from the empty field; typing then gives the answer in your own words.
    await field.focus();
    await page.keyboard.press("1");
    await expect(panel.locator('input[value="Concise"]')).toBeChecked();
    await expect(field).toHaveJSProperty("value", "");
    const submit = page.getByRole("button", { name: "Submit answer", exact: true });
    await expect(submit).toBeEnabled();
    expect(llm.requests).toHaveLength(1);
    await field.fill(CUSTOM_ANSWER);
    await expect(panel).toBeVisible();
    expect(llm.requests).toHaveLength(1);
    await submit.click();
    await client.experimental.session.wait({ sessionID: session.id });
    await expect(page.getByText("COMPACT SINGLE ANSWER RECEIVED", { exact: true })).toBeVisible();
    await assertRestoredComposer();

    await client.session.prompt({ sessionID: session.id, text: "Ask for destination and extras." });
    await assertQuestion(panel, MULTI_PROMPTS[0]!, "1 of 2");
    await assertComposerBeside();
    await panel.locator('[data-slot="questionnaire-item"]:visible').focus();
    await page.keyboard.press("1");
    await expect(panel.locator('input[value="Notebook"]')).toBeChecked();
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await assertQuestion(panel, MULTI_PROMPTS[1]!, "2 of 2");
    await panel.locator('[data-slot="questionnaire-item"]:visible').focus();
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await expect(panel.locator('input[value="Examples"]')).toBeChecked();
    await expect(panel.locator('input[value="Caveats"]')).toBeChecked();
    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await assertQuestion(panel, MULTI_PROMPTS[0]!, "1 of 2");
    await expect(panel.locator('input[value="Notebook"]')).toBeChecked();
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await assertQuestion(panel, MULTI_PROMPTS[1]!, "2 of 2");
    await expect(panel.locator('input[value="Examples"]')).toBeChecked();
    await expect(panel.locator('input[value="Caveats"]')).toBeChecked();
    expect(llm.requests).toHaveLength(3);
    await page.getByRole("button", { name: "Submit answer", exact: true }).click();
    await client.experimental.session.wait({ sessionID: session.id });
    await assertRestoredComposer();
  },
  async assert(page, { client, session }) {
    await expect(
      page.getByText("COMPACT MULTIPLE ANSWERS RECEIVED", { exact: true }),
    ).toBeVisible();
    const messages = (await client.message.list({ sessionID: session.id, order: "asc" })).data;
    const results = messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool" && part.name === "question" && part.state.status === "completed"
              ? part.state.content.flatMap((content) =>
                  content.type === "text" ? [content.text] : [],
                )
              : [],
          )
        : [],
    );
    // Official tool results prove these answers reached OpenCode, not just local UI state.
    expect(results).toEqual([
      `User has answered your questions: "${SINGLE_PROMPT}"="${CUSTOM_ANSWER}". You can now continue with the user's answers in mind.`,
      `User has answered your questions: "${MULTI_PROMPTS[0]}"="Notebook", "${MULTI_PROMPTS[1]}"="Examples, Caveats". You can now continue with the user's answers in mind.`,
    ]);
  },
};

async function assertQuestion(panel: Locator, prompt: string, count: string | null) {
  await expect(panel).toBeVisible();
  const title = panel.locator('[data-slot="questionnaire-title"]:visible');
  await expect(title).toHaveText(prompt);
  if (count) await expect(panel.getByText(count, { exact: true })).toBeVisible();
  await expect(
    panel.getByText(/^(Questions?|Choose one answer\.|Choose one or type your own answer\.)$/),
  ).toBeHidden();
}

type AppearanceBridge = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
};

async function capturePresentation(page: Page, panel: Locator, runRoot: string) {
  const viewport = page.viewportSize();
  const previous = await page.evaluate(() => {
    const palot = (globalThis as unknown as { palot: AppearanceBridge }).palot;
    return {
      preferences: palot.appearancePreferences,
      resolvedScheme:
        document.documentElement.dataset.resolvedTheme === "dark"
          ? ("dark" as const)
          : ("light" as const),
    };
  });
  const measurements = [];
  try {
    for (const scheme of ["light", "dark"] as const) {
      if (scheme === "dark") await page.setViewportSize({ width: 920, height: 640 });
      await page.evaluate(
        async ({ preferences, scheme }) => {
          await (globalThis as unknown as { palot: AppearanceBridge }).palot.updateAppearance({
            preferences: { ...preferences, mode: scheme },
            resolvedScheme: scheme,
          });
        },
        { preferences: previous.preferences, scheme },
      );
      await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
      const dimensions = await panel.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
      expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth + 1);
      if (scheme === "dark") {
        const lines = await panel
          .getByText(LONG_DESCRIPTION, { exact: true })
          .evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
          });
        expect(lines).toBeGreaterThan(1);
      }
      measurements.push({ scheme, viewport: page.viewportSize(), ...dimensions });
      await page.screenshot({ path: join(runRoot, `compact-question-${scheme}.png`) });
    }
    await writeFile(
      join(runRoot, "compact-question-layout.json"),
      JSON.stringify(measurements, null, 2),
    );
  } finally {
    await page.evaluate(async (input) => {
      await (globalThis as unknown as { palot: AppearanceBridge }).palot.updateAppearance(input);
    }, previous);
    if (viewport) await page.setViewportSize(viewport);
  }
}
