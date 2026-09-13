import type { SessionMessageInfo } from "@opencode/client";
import { expect, type Locator } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios.ts";

const RESPONSE_ID = "msg_markdown_rich_assistant";
const INVALID_DIAGRAM = "this is not a Mermaid diagram";
const RESPONSE = [
  "## Flowchart fixture",
  "```mermaid",
  "flowchart LR",
  "subgraph Review[Review cycle]",
  "A[Read source] --> B[Check result]",
  "end",
  "```",
  "## Sequence fixture",
  "```mermaid",
  "sequenceDiagram",
  "participant Reader",
  "participant Renderer",
  "Reader->>Renderer: Render diagram",
  "Renderer-->>Reader: Ready",
  "```",
  "## Malformed fixture",
  "```mermaid",
  INVALID_DIAGRAM,
  "```",
].join("\n");

async function expectDiagram(svg: Locator, labels: string[]) {
  await expect(svg).toBeAttached();
  for (const label of labels) await expect(svg).toContainText(label);
  await expect
    .poll(() =>
      svg.evaluate((element) => {
        const bounds = (element as SVGSVGElement).viewBox.baseVal;
        return bounds.width > 0 && bounds.height > 0;
      }),
    )
    .toBe(true);
}

export const markdownRichScenario: Scenario = {
  description:
    "render real Mermaid SVGs in both schemes, recover malformed source, and open and close previews",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_markdown_rich_user",
        type: "user",
        time: { created },
        text: "Show the deterministic Mermaid fixtures.",
      },
      {
        id: RESPONSE_ID,
        type: "assistant",
        time: { created: created + 1, completed: created + 2 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [{ type: "text", text: RESPONSE }],
      },
    ];
    const source = await client.session.import({
      info: { ...session, id: `${session.id}_markdown_rich`, title: "Mermaid rendering fixture" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "markdown-rich-session-id.txt"), source.id, { mode: 0o600 });
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = (
      await readFile(join(runRoot, "markdown-rich-session-id.txt"), "utf8")
    ).trim();
    await page.evaluate((id) => {
      location.hash = `#/sessions/${encodeURIComponent(id)}`;
    }, sessionID);
  },
  async assert(page, { runRoot, llm }) {
    const response = page.locator(`[data-message-id="${RESPONSE_ID}"]`);
    const previews = response.locator("button.markdown-mermaid");
    const flowchart = previews.nth(0).locator("svg");
    const sequence = previews.nth(1).locator("svg");
    const appearance = await page.evaluate(() => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      return {
        preferences: api.appearancePreferences,
        resolvedScheme:
          document.documentElement.dataset.resolvedTheme === "dark"
            ? ("dark" as const)
            : ("light" as const),
      };
    });
    let lightSVGs: string[] | undefined;
    try {
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate(
          async ({ preferences, scheme }) => {
            await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
              preferences: { ...preferences, source: "palot", mode: scheme },
              resolvedScheme: scheme,
            });
          },
          { preferences: appearance.preferences, scheme },
        );
        await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
        await expect(previews).toHaveCount(2);
        await expectDiagram(flowchart, ["Review cycle", "Read source", "Check result"]);
        await expectDiagram(sequence, ["Reader", "Renderer", "Render diagram", "Ready"]);
        if (lightSVGs) {
          for (const [index, svg] of [flowchart, sequence].entries()) {
            await expect.poll(() => svg.innerHTML()).not.toBe(lightSVGs[index]);
          }
        }
        await expect(response.locator(".markdown-mermaid-error")).toHaveCount(1);
        await expect(response.locator(".markdown-mermaid-error")).toContainText(
          "Could not render this diagram.",
        );
        await expect(response.locator(".markdown-mermaid-error pre")).toHaveText(INVALID_DIAGRAM);

        for (const [index, name] of ["flowchart", "sequence"].entries()) {
          await previews.nth(index).scrollIntoViewIfNeeded();
          await previews.nth(index).click();
          const dialog = page.getByRole("dialog", { name: "Mermaid diagram", exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog.locator(".markdown-mermaid-lightbox svg")).toBeVisible();
          await page.screenshot({ path: join(runRoot, `mermaid-${name}-${scheme}.png`) });
          if (index === 0)
            await page
              .getByRole("button", { name: "Close Mermaid diagram preview", exact: true })
              .click();
          else await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
        }
        if (scheme === "light")
          lightSVGs = await Promise.all([flowchart.innerHTML(), sequence.innerHTML()]);
      }
      expect(llm.scriptedCalls()).toBe(0);
    } finally {
      await page.evaluate(async (input) => {
        await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
      }, appearance);
    }
  },
};
