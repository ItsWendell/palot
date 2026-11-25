import { expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

const NOTEBOOK = JSON.stringify({
  nbformat: 4,
  metadata: { language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", source: ["# Notebook fixture"] },
    {
      cell_type: "code",
      source: ["print(6 * 7)"],
      execution_count: 1,
      outputs: [{ output_type: "stream", name: "stdout", text: ["answer 42\n"] }],
    },
  ],
});

function workspaceTree(page: Page) {
  return page.getByRole("tree", { name: "Workspace files", exact: true });
}

async function openFromTree(page: Page, ...segments: string[]) {
  // Each opened file becomes the active tab; return to the Files tab first.
  await page.getByRole("tab", { name: "Files" }).click();
  // Pierre's tree renders in a shadow root; the app labels its inner tree "Workspace files".
  // The task list is a tree too, and comes first in the DOM.
  const tree = workspaceTree(page);
  for (const segment of segments)
    await tree.getByRole("treeitem", { name: segment, exact: true }).click();
}

export const fileViewerScenario: Scenario = {
  description:
    "browse the workspace tree, preview CSV, notebook, Mermaid and binary files, and edit and save text with conflict protection",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  // Without run(), the harness would send the (empty) prompt to the model.
  async run() {},
  async prepareProject({ projectDirectory }) {
    await mkdir(join(projectDirectory, "data"), { recursive: true });
    await writeFile(join(projectDirectory, "notes.txt"), "first line\n");
    await writeFile(join(projectDirectory, "data", "table.csv"), "name,value\nalpha,1\nbeta,2\n");
    await writeFile(join(projectDirectory, "data", "analysis.ipynb"), NOTEBOOK);
    await writeFile(join(projectDirectory, "diagram.mmd"), "graph TD\nA-->B\n");
    await writeFile(
      join(projectDirectory, "guide.md"),
      "---\ntitle: Frontmatter fixture\nstatus: draft\n---\n# Guide body\n",
    );
    await writeFile(join(projectDirectory, "blob.bin"), Buffer.from([0, 1, 2, 80, 65, 76, 0, 255]));
  },
  async assert(page, { projectDirectory, runRoot }) {
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.getByRole("button", { name: "Show changes" }).click();
    await page.getByRole("button", { name: "Open workbench surface" }).last().click();
    await page.getByRole("menuitem", { name: "Files", exact: true }).click();
    await expect(workspaceTree(page)).toBeVisible();

    // CSV: a table, with Source in the header opening the editor.
    await openFromTree(page, "data", "table.csv");
    const table = page.getByRole("table", { name: "Table: data/table.csv" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("cell", { name: "beta" })).toBeVisible();
    await page.screenshot({ path: join(runRoot, "file-viewer-csv.png") });

    await openFromTree(page, "analysis.ipynb");
    await expect(page.getByRole("heading", { name: "Notebook fixture" })).toBeVisible();
    await expect(page.getByText("answer 42").first()).toBeVisible();
    await page.screenshot({ path: join(runRoot, "file-viewer-notebook.png") });

    await openFromTree(page, "diagram.mmd");
    await expect(
      page.getByRole("button", { name: "Open Mermaid diagram preview" }).first(),
    ).toBeVisible();

    await openFromTree(page, "blob.bin");
    await expect(page.getByLabel("Hex: blob.bin").first()).toBeVisible();

    // Text: edit and save with Mod+S.
    const notes = join(projectDirectory, "notes.txt");
    await openFromTree(page, "notes.txt");
    // The file first renders read-only; keystrokes only count once the edit session holds
    // the file, Pierre's editor has made the content an editable textbox, and it has focus.
    const editor = page.getByRole("textbox", { name: "notes.txt", exact: true });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    // Keys right after focus, before the editor has seen a selectionchange, must still land.
    await editor.focus();
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    await expect(editor).toContainText("first line edited");
    await expect(page.getByRole("status", { name: "Unsaved changes" })).toBeVisible();
    await page.keyboard.press("Control+s");
    await expect.poll(() => readFile(notes, "utf8")).toBe("first line edited\n");
    await expect(page.getByRole("status", { name: "Unsaved changes" })).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "file-viewer-saved.png") });

    // A change on disk under unsaved edits is never overwritten silently.
    await editor.getByText("first line edited", { exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" again");
    await writeFile(notes, "agent rewrite\n");
    await page.keyboard.press("Control+s");
    const conflict = page.getByText("Changed on disk", { exact: true });
    await expect(conflict).toBeVisible();
    expect(await readFile(notes, "utf8")).toBe("agent rewrite\n");
    await page.screenshot({ path: join(runRoot, "file-viewer-conflict.png") });
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(notes, "utf8")).toBe("first line edited again\n");
    await expect(conflict).toHaveCount(0);

    // YAML frontmatter previews as a property list, not as a rule and a heading of YAML.
    await openFromTree(page, "guide.md");
    const properties = page.getByRole("region", { name: "Properties" });
    await expect(properties.getByRole("term")).toHaveText(["title", "status"]);
    await expect(properties.getByRole("definition")).toHaveText(["Frontmatter fixture", "draft"]);
    await expect(page.getByRole("heading", { name: "Guide body" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /title:/ })).toHaveCount(0);
  },
};
