import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

const NAME = "E2E build shell";
const ELSEWHERE = "Renamed elsewhere";

export const terminalRenameScenario: Scenario = {
  description:
    "rename a persistent terminal from its tab, keep the name across a reload, follow a rename from another client, and clear it",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page) {
    await page.keyboard.press("Control+Backquote");
  },
  async assert(page, { client, llm, runRoot }) {
    const terminal = page.locator("[data-workbench-terminal]");
    await expect(terminal.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(terminal.locator("..").getByText("connecting", { exact: true })).toHaveCount(0);
    const ptyID = (await terminal.getAttribute("data-workbench-terminal"))!;
    expect(ptyID).toBeTruthy();
    const info = () => client.experimental.persistentPty.get({ ptyID });
    const bottom = page.locator('[data-workbench-pane="bottom"]');
    const tab = bottom.getByRole("tab").first();
    try {
      // The tab shows OpenCode's automatic title until someone renames the terminal.
      await expect.poll(async () => (await info()).title).toBeTruthy();
      await expect
        .poll(async () => (await tab.textContent())?.trim() === (await info()).title)
        .toBe(true);
      expect((await info()).userTitle).toBeNull();

      await tab.dblclick();
      const field = bottom.getByRole("textbox", { name: "Terminal name", exact: true });
      await expect(field).toBeFocused();
      await field.fill(NAME);
      await page.screenshot({
        path: join(runRoot, "terminal-rename-editing.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Enter");
      await expect(field).toHaveCount(0);
      await expect(bottom.getByRole("tab", { name: NAME, exact: true })).toBeVisible();
      await expect.poll(async () => (await info()).userTitle).toBe(NAME);

      // The name comes from OpenCode, so a fresh view shows it again.
      await page.reload();
      await expect(page.locator(`[data-workbench-terminal="${ptyID}"] canvas`)).toBeVisible({
        timeout: 30_000,
      });
      const renamed = bottom.getByRole("tab", { name: NAME, exact: true });
      await expect(renamed).toBeVisible();
      await page.screenshot({
        path: join(runRoot, "terminal-rename-reloaded.png"),
        animations: "disabled",
      });

      // A rename from the TUI or another window arrives as persistent-pty.updated.
      await client.experimental.persistentPty.update({ ptyID, title: ELSEWHERE });
      const elsewhere = bottom.getByRole("tab", { name: ELSEWHERE, exact: true });
      await expect(elsewhere).toBeVisible();
      await page.getByRole("button", { name: /^Running work: / }).click();
      await expect(
        page.getByRole("button").filter({ has: page.getByText(ELSEWHERE, { exact: true }) }),
      ).toBeVisible();
      await page.screenshot({
        path: join(runRoot, "terminal-rename-running-work.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");

      // Emptying the field from the context menu restores the automatic title.
      await elsewhere.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Rename terminal", exact: true }).click();
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(ELSEWHERE);
      await field.fill("");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await info()).userTitle).toBeNull();
      const automatic = (await info()).title;
      expect(automatic).not.toBe(ELSEWHERE);
      await expect(bottom.getByRole("tab", { name: automatic, exact: true })).toBeVisible();
      await page.screenshot({
        path: join(runRoot, "terminal-rename-cleared.png"),
        animations: "disabled",
      });
    } finally {
      await client.experimental.persistentPty.remove({ ptyID }).catch(() => undefined);
    }
    expect(llm.requests).toHaveLength(0);
  },
};
