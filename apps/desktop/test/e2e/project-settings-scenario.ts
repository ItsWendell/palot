import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Scenario } from "./scenarios.ts";

type PalotApi = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
  runtimeStatus(): Promise<{ connected: boolean }>;
};

const execFileAsync = promisify(execFile);
const NAME = "Project settings fixture";
const OTHER_NAME = "Other settings fixture";
const START = "printf 'project-settings-started' > startup-must-not-run.txt";
const canonicalDirectory = (root: string) => join(root, "canonical-checkout");
const otherDirectory = (root: string) => join(root, "other-settings-project");

export const projectSettingsScenario: Scenario = {
  description:
    "edit project metadata through the native settings UI without moving files or sessions",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepareProject({ projectDirectory }) {
    await writeFile(join(projectDirectory, "README.md"), "Project settings primary fixture\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: projectDirectory });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=palot-e2e@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Primary settings fixture",
      ],
      { cwd: projectDirectory },
    );
  },
  async seed(client, { projectDirectory, runRoot }) {
    await execFileAsync("git", ["worktree", "add", "--detach", canonicalDirectory(runRoot)], {
      cwd: projectDirectory,
    });
    await writeFile(join(projectDirectory, "original-checkout-marker.txt"), "original checkout\n");
    await writeFile(
      join(canonicalDirectory(runRoot), "canonical-checkout-marker.txt"),
      "canonical checkout\n",
    );
    const other = otherDirectory(runRoot);
    await mkdir(other, { recursive: true });
    await execFileAsync("git", ["init", "--quiet"], { cwd: other });
    await writeFile(join(other, "README.md"), "Distinct settings scope fixture\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: other });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=palot-e2e@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Settings scope fixture",
      ],
      { cwd: other },
    );
    const second = await client.location.get({ location: { directory: other } });
    await client.project.update({ projectID: second.project.id, name: OTHER_NAME });
  },
  async run(page, { client, session, projectDirectory, runRoot }) {
    const project = (await client.location.get({ location: { directory: projectDirectory } }))
      .project;
    const originalSession = await client.session.get({ sessionID: session.id });
    await page.evaluate((projectID) => {
      location.hash = `#/settings/project?projectID=${encodeURIComponent(projectID)}`;
    }, project.id);
    await expect(
      page.getByRole("heading", { name: "Project", exact: true, level: 1 }),
    ).toBeVisible();
    const name = page.getByLabel("Project name", { exact: true });
    const canonical = page.getByLabel("Main checkout directory", { exact: true });
    const save = page.getByRole("button", { name: "Save project", exact: true });
    await name.fill(NAME);
    await page.getByLabel("Worktree startup command", { exact: true }).fill(START);
    await page.getByLabel("Icon color", { exact: true }).fill("blue");

    // Validation failure retains the whole draft and does not change server metadata.
    await canonical.fill("relative/path");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("Enter an absolute path");
    await expect(name).toHaveValue(NAME);
    expect((await client.project.list()).find((item) => item.id === project.id)?.name).not.toBe(
      NAME,
    );
    await canonical.fill(canonicalDirectory(runRoot));
    await save.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Project settings saved." }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const updated = (await client.project.list()).find((item) => item.id === project.id);
        return {
          name: updated?.name,
          start: updated?.commands?.start,
          color: updated?.icon?.color,
          canonical: updated?.canonical,
        };
      })
      .toEqual({ name: NAME, start: START, color: "blue", canonical: canonicalDirectory(runRoot) });
    expect((await client.session.get({ sessionID: session.id })).location).toEqual(
      originalSession.location,
    );
    expect(await readFile(join(projectDirectory, "original-checkout-marker.txt"), "utf8")).toBe(
      "original checkout\n",
    );
    expect(
      await readFile(join(canonicalDirectory(runRoot), "canonical-checkout-marker.txt"), "utf8"),
    ).toBe("canonical checkout\n");
    await expect(
      access(join(canonicalDirectory(runRoot), "original-checkout-marker.txt")),
    ).rejects.toThrow();
    for (const directory of [projectDirectory, canonicalDirectory(runRoot)]) {
      await expect(access(join(directory, "startup-must-not-run.txt"))).rejects.toThrow();
    }

    // Project switching must never submit the unsaved name to either scope.
    await name.fill("Unsaved name must not leak");
    await page.getByRole("combobox", { name: "Settings project", exact: true }).click();
    await page.getByRole("option", { name: OTHER_NAME, exact: false }).click();
    await expect(name).toHaveValue(OTHER_NAME);
    await expect(save).toBeDisabled();
    await page.getByRole("combobox", { name: "Settings project", exact: true }).click();
    await page.getByRole("option", { name: NAME, exact: false }).click();
    await expect(name).toHaveValue(NAME);
    await expect(save).toBeDisabled();
    await capturePresentation(page, runRoot);

    // Explicit clear leaves unrelated fields intact.
    await page.getByLabel("Icon color", { exact: true }).fill("");
    await save.click();
    await expect(save).toBeDisabled();
    await expect
      .poll(async () => {
        const updated = (await client.project.list()).find((item) => item.id === project.id);
        return {
          name: updated?.name,
          start: updated?.commands?.start,
          color: updated?.icon?.color ?? "",
        };
      })
      .toEqual({ name: NAME, start: START, color: "" });
  },
  async assert(page) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(NAME);
    await expect(page.getByLabel("Worktree startup command", { exact: true })).toHaveValue(START);
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
      ),
    ).toMatchObject({ connected: true });
  },
};

async function capturePresentation(page: Page, runRoot: string) {
  const viewport = page.viewportSize();
  const previous = await page.evaluate(() => {
    const bridge = (globalThis as unknown as { palot: PalotApi }).palot;
    return {
      preferences: bridge.appearancePreferences,
      resolvedScheme:
        document.documentElement.dataset.resolvedTheme === "dark"
          ? ("dark" as const)
          : ("light" as const),
    };
  });
  try {
    for (const scheme of ["light", "dark"] as const) {
      await page.evaluate(
        async ({ preferences, scheme }) => {
          await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
            preferences: { ...preferences, mode: scheme },
            resolvedScheme: scheme,
          });
        },
        { preferences: previous.preferences, scheme },
      );
      await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
      for (const size of [viewport ?? { width: 1280, height: 900 }, { width: 920, height: 640 }]) {
        await page.setViewportSize(size);
        await page.getByLabel("Project name", { exact: true }).scrollIntoViewIfNeeded();
        const overflow = await page
          .locator("form")
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        await page.screenshot({
          path: join(runRoot, `project-settings-${scheme}-${size.width}x${size.height}.png`),
        });
        await page
          .getByRole("button", { name: "Save project", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(page.getByLabel("Main checkout directory", { exact: true })).toBeVisible();
        await page.screenshot({
          path: join(
            runRoot,
            `project-settings-${scheme}-${size.width}x${size.height}-checkout.png`,
          ),
        });
      }
    }
  } finally {
    await page.evaluate(async (input) => {
      await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(input);
    }, previous);
    if (viewport) await page.setViewportSize(viewport);
  }
}
