import type { SessionMessageInfo } from "@opencode/client";
import { expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const RESPONSE_ID = "msg_workspace_preview_assistant";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfoAAAAASUVORK5CYII=",
  "base64",
);

function wavFixture(): Buffer {
  const pcm = Buffer.alloc(800 * 2);
  const wave = Buffer.alloc(44 + pcm.length);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(pcm.length, 40);
  pcm.copy(wave, 44);
  return wave;
}

function pdfFixture(): string {
  const content = "BT /F1 18 Tf 72 720 Td (Palot PDF preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export const workspacePreviewScenario: Scenario = {
  description:
    "browse and preview image, Markdown, PDF, and audio workspace files through OpenCode",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    await mkdir(join(projectDirectory, "assets"));
    await writeFile(join(projectDirectory, "assets", "nested.txt"), "Nested workspace file\n");
    await writeFile(join(projectDirectory, "preview.png"), PNG);
    await writeFile(join(projectDirectory, "preview.pdf"), pdfFixture());
    await writeFile(join(projectDirectory, "preview.wav"), wavFixture());
    await writeFile(
      join(projectDirectory, "preview.md"),
      "# Workspace preview\n\n<script>window.previewExecuted = true</script>\n",
    );
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      { id: "msg_workspace_preview_user", type: "user", time: { created }, text: "Preview files." },
      {
        id: RESPONSE_ID,
        type: "assistant",
        time: { created: created + 1, completed: created + 2 },
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        finish: "stop",
        content: [
          {
            type: "text",
            text: "Open `preview.png`, `preview.md`, `preview.pdf`, and `preview.wav`.",
          },
        ],
      },
    ];
    const source = await client.session.import({
      info: {
        ...session,
        id: `${session.id}_workspace_preview`,
        title: "Workspace preview fixture",
      },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "workspace-preview-session-id.txt"), source.id, { mode: 0o600 });
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = (
      await readFile(join(runRoot, "workspace-preview-session-id.txt"), "utf8")
    ).trim();
    await page.evaluate((id) => {
      location.hash = `#/sessions/${encodeURIComponent(id)}`;
    }, sessionID);
  },
  async assert(page, { projectDirectory, runRoot, llm }) {
    const response = page.locator(`[data-message-id="${RESPONSE_ID}"]`);
    await response.getByRole("link", { name: "Open preview.png" }).click();
    const imageTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "preview.png",
    });
    const image = imageTab.getByRole("img", { name: "preview.png" });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBe(1);
    await expect(imageTab.getByText("Preview unavailable")).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "workspace-image-preview.png") });

    await response.getByRole("link", { name: "Open preview.md" }).click();
    const markdownTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "preview.md",
    });
    await expect(markdownTab.getByRole("heading", { name: "Workspace preview" })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "workspace-markdown-preview.png") });
    expect(
      await page.evaluate(
        () => (window as unknown as { previewExecuted?: boolean }).previewExecuted,
      ),
    ).not.toBe(true);
    await markdownTab.getByRole("button", { name: "Source" }).click();
    await expect(markdownTab.getByRole("button", { name: "Source" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await markdownTab.getByRole("button", { name: "Preview" }).click();
    await writeFile(join(projectDirectory, "preview.md"), "# Refreshed preview\n");
    await markdownTab.getByRole("button", { name: "Refresh file" }).click();
    await expect(markdownTab.getByRole("heading", { name: "Refreshed preview" })).toBeVisible();

    await response.getByRole("link", { name: "Open preview.pdf" }).click();
    const pdfTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "preview.pdf",
    });
    await expect(pdfTab.getByText("Page 1 of 1")).toBeVisible();
    const pdfPage = pdfTab.getByRole("img", { name: "PDF page 1 of preview.pdf" });
    await expect(pdfPage).toBeVisible();
    expect(await pdfPage.evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(
      0,
    );
    await page.screenshot({ path: join(runRoot, "workspace-pdf-preview.png") });

    await response.getByRole("link", { name: "Open preview.wav" }).click();
    const audioTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "preview.wav",
    });
    const audio = audioTab.locator('audio[controls][aria-label="Audio preview: preview.wav"]');
    await expect(audio).toBeVisible();
    await expect
      .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).readyState))
      .toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: join(runRoot, "workspace-audio-preview.png") });

    await page
      .locator('[data-workbench-pane="right"]')
      .getByRole("button", { name: "Open workbench surface" })
      .click();
    await page.getByRole("menuitem", { name: "Files", exact: true }).click();
    await expect(audioTab.locator("audio")).toHaveCount(0);
    const filesTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "Files",
    });
    await filesTab.getByRole("button", { name: "assets" }).click();
    await filesTab.getByRole("button", { name: "nested.txt" }).click();
    const nestedTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "nested.txt",
    });
    await expect(nestedTab.getByText("Nested workspace file")).toBeVisible();
    await page.locator('[data-workbench-pane="right"]').getByRole("tab", { name: "Files" }).click();
    await filesTab.getByRole("searchbox", { name: "Search workspace files" }).fill("preview.pdf");
    await expect(filesTab.getByRole("region", { name: "Search results" })).toBeVisible();
    await filesTab.getByRole("button", { name: "preview.pdf" }).click();
    await expect(pdfTab.getByText("Page 1 of 1")).toBeVisible();

    await page.getByRole("button", { name: "View turn changes" }).click();
    const turnTab = page.locator('[data-workbench-pane="right"]').getByRole("tabpanel", {
      name: "Turn changes",
    });
    await expect(turnTab.getByText("No changes in this turn")).toBeVisible();
    expect(llm.scriptedCalls()).toBe(0);
  },
};
