import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const prompts = ["First short question.", "Second short question.", "Third short question."];
const answers = ["First short answer.", "Second short answer.", "Third short answer."];

export const shortTranscriptScenario: Scenario = {
  description: "retain earlier exchanges when new messages still fit in the transcript viewport",
  prompt: "",
  expectedModelCalls: 3,
  arrange(llm) {
    for (const answer of answers) llm.text(answer);
  },
  async run(page, { client, session, runRoot }) {
    // Preserve the fixture's "all three exchanges fit" precondition under tiling WMs.
    await page.setViewportSize({ width: 1440, height: 920 });
    for (const [index, prompt] of prompts.entries()) {
      await page.getByLabel("Message Palot").fill(prompt);
      await page.getByRole("button", { name: "Send message" }).click();
      await client.session.wait({ sessionID: session.id });
      const transcript = page.getByLabel("Task transcript", { exact: true });
      await expect(transcript.getByText(answers[index]!, { exact: true })).toBeVisible();
      const expected = prompts
        .slice(0, index + 1)
        .flatMap((text, number) => [text, answers[number]!]);
      for (const text of expected) {
        await expect(transcript.getByText(text, { exact: true })).toBeVisible();
      }
      const metrics = await transcript.evaluate((viewport) => ({
        scrollTop: viewport.scrollTop,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        rows: Array.from(viewport.querySelectorAll("[data-turn-row-id]")).map((row) => ({
          text: row.textContent,
          top: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
          height: row.getBoundingClientRect().height,
          visible: row.checkVisibility({ contentVisibilityAuto: true }),
        })),
      }));
      await writeFile(join(runRoot, `short-transcript-${index + 1}.json`), JSON.stringify(metrics));
      expect(metrics.scrollTop).toBe(0);
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
      expect(metrics.rows.every((row) => row.visible && row.top >= 0 && row.height > 0)).toBe(true);
      await page.screenshot({ path: join(runRoot, `short-transcript-${index + 1}.png`) });
    }
  },
  async assert(page) {
    const transcript = page.getByLabel("Task transcript", { exact: true });
    for (const text of [...prompts, ...answers]) {
      await expect(transcript.getByText(text, { exact: true })).toBeVisible();
    }
  },
};
