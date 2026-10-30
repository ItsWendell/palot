import type { SessionMessageInfo } from "@opencode/client";
import { expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { gzipSync, strToU8, zipSync } from "fflate";
import type { Scenario } from "./scenarios.ts";

const RESPONSE = "msg_file_viewer_two_assistant";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfoAAAAASUVORK5CYII=",
  "base64",
);
const files = [
  "data.sqlite",
  "bundle.zip",
  "hello.txt.gz",
  "document.odt",
  "sheets.ods",
  "slides.odp",
  "book.epub",
  "document.rtf",
  "notes.txt",
];
const odf = (body: string) =>
  zipSync({
    "content.xml": strToU8(
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${body}</office:body></office:document-content>`,
    ),
  });

export const fileViewer2Scenario: Scenario = {
  description:
    "preview SQLite, archives, OpenDocument, EPUB and RTF; add file line comments to the composer",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const sql = await initSqlJs({
      wasmBinary: new Uint8Array(
        await readFile(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")),
      ).buffer,
    });
    const database = new sql.Database();
    try {
      database.run("CREATE TABLE items (id INTEGER, label TEXT)");
      for (let i = 1; i <= 51; i++)
        database.run("INSERT INTO items VALUES (?, ?)", [i, `Item ${i}`]);
      await writeFile(join(projectDirectory, "data.sqlite"), database.export());
    } finally {
      database.close();
    }
    await writeFile(
      join(projectDirectory, "bundle.zip"),
      zipSync({ "hello.txt": strToU8("Archive text preview"), "pixel.png": PNG }),
    );
    await writeFile(join(projectDirectory, "hello.txt.gz"), gzipSync(strToU8("Gzip text preview")));
    await writeFile(
      join(projectDirectory, "document.odt"),
      odf(
        "<office:text><text:h>OpenDocument heading</text:h><text:p>Document body</text:p></office:text>",
      ),
    );
    await writeFile(
      join(projectDirectory, "sheets.ods"),
      odf(
        '<office:spreadsheet><table:table table:name="Totals"><table:table-row><table:table-cell office:value="42"/></table:table-row></table:table><table:table table:name="Other"><table:table-row><table:table-cell><text:p>Other sheet</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
      ),
    );
    await writeFile(
      join(projectDirectory, "slides.odp"),
      odf(
        '<office:presentation><draw:page draw:name="First"><text:p>First slide</text:p></draw:page><draw:page draw:name="Second"><text:p>Second slide</text:p></draw:page></office:presentation>',
      ),
    );
    await writeFile(
      join(projectDirectory, "document.rtf"),
      "{\\rtf1\\ansi RTF body\\par Second paragraph}",
    );
    await writeFile(
      join(projectDirectory, "notes.txt"),
      "First line\nReview this line\nLast line\n",
    );
    await writeFile(
      join(projectDirectory, "book.epub"),
      zipSync({
        "META-INF/container.xml": strToU8(
          '<container><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>',
        ),
        "package.opf": strToU8(
          '<package><manifest><item id="a" href="first.xhtml" media-type="application/xhtml+xml"/><item id="b" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
        ),
        "first.xhtml": strToU8(
          '<html><head><title>First chapter</title></head><body><h1>EPUB heading</h1><p>EPUB body</p><img src="cover.png" alt="Book cover"/><script>window.filePreviewExecuted=true</script><img src="https://example.invalid/tracker.png"/></body></html>',
        ),
        "second.xhtml": strToU8(
          "<html><head><title>Second chapter</title></head><body><p>Second chapter body</p></body></html>",
        ),
        "cover.png": PNG,
      }),
    );
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const created = Date.now() - 10_000;
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_file_viewer_two_user",
        type: "user",
        time: { created },
        text: "Preview these files.",
      },
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
      info: { ...session, id: `${session.id}_file_viewer_two`, title: "File viewer fixtures" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "file-viewer-2-session.txt"), imported.id);
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = await readFile(join(runRoot, "file-viewer-2-session.txt"), "utf8");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${encodeURIComponent(id)}`;
    }, sessionID);
  },
  async assert(page, { runRoot }) {
    const response = page.locator(`[data-message-id="${RESPONSE}"]`);
    const open = async (path: string) => {
      await response.getByRole("link", { name: `Open ${path}`, exact: true }).click();
      return page
        .locator('[data-workbench-pane="right"]')
        .getByRole("tabpanel", { name: path, exact: true });
    };
    const sqlite = await open("data.sqlite");
    await expect(sqlite.getByRole("combobox", { name: "Database table" })).toContainText(
      "items (51 rows)",
    );
    await expect(sqlite.getByRole("columnheader", { name: "label", exact: true })).toBeVisible();
    await expect(sqlite.getByRole("cell", { name: "Item 1", exact: true })).toBeVisible();
    await sqlite.getByRole("button", { name: "Next page" }).click();
    await expect(sqlite.getByRole("cell", { name: "Item 51", exact: true })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "file-viewer-2-sqlite.png") });
    const archive = await open("bundle.zip");
    await archive.getByRole("button", { name: "hello.txt", exact: true }).click();
    await expect(archive.locator("diffs-container")).toContainText("Archive text preview");
    await archive.getByRole("button", { name: "Back to archive" }).click();
    await archive.getByRole("button", { name: "pixel.png", exact: true }).click();
    await expect(archive.getByRole("img", { name: "pixel.png" })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "file-viewer-2-archive.png") });
    const gzip = await open("hello.txt.gz");
    await gzip.getByRole("button", { name: "hello.txt", exact: true }).click();
    await expect(gzip.locator("diffs-container")).toContainText("Gzip text preview");
    const odt = await open("document.odt");
    await expect(odt.getByRole("heading", { name: "OpenDocument heading" })).toBeVisible();
    const ods = await open("sheets.ods");
    await expect(ods.getByRole("cell", { name: "42", exact: true })).toBeVisible();
    await ods.getByRole("combobox", { name: "Sheet" }).selectOption({ label: "Other" });
    await expect(ods.getByRole("cell", { name: "Other sheet" })).toBeVisible();
    const odp = await open("slides.odp");
    await odp.getByRole("combobox", { name: "Slide" }).selectOption({ label: "Second" });
    await expect(odp.getByText("Second slide", { exact: true })).toBeVisible();
    const rtf = await open("document.rtf");
    await expect(rtf.getByRole("article")).toContainText("RTF body");
    const epub = await open("book.epub");
    await expect(epub.getByRole("heading", { name: "EPUB heading" })).toBeVisible();
    const cover = epub.getByRole("img", { name: "Book cover" });
    await expect
      .poll(() => cover.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(1);
    expect(await epub.locator("img").count()).toBe(1);
    expect(await page.evaluate(() => Reflect.get(window, "filePreviewExecuted"))).not.toBe(true);
    await page.screenshot({ path: join(runRoot, "file-viewer-2-document.png") });
    await epub.getByRole("combobox", { name: "Chapter" }).selectOption({ label: "Second chapter" });
    await expect(epub.getByText("Second chapter body", { exact: true })).toBeVisible();
    const text = await open("notes.txt");
    await text.locator('diffs-container [data-column-number="2"]').click();
    const editor = text.getByRole("form", { name: "Comment on notes.txt" });
    await editor.getByRole("textbox", { name: "Line comment" }).fill("Please clarify this line.");
    await editor.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByRole("region", { name: "Pending line comments" })).toContainText(
      "Please clarify this line.",
    );
    await expect(text.getByLabel("Pending comments on line 2")).toContainText(
      "Please clarify this line.",
    );
    await page.screenshot({ path: join(runRoot, "file-viewer-2-comment.png") });
  },
};
