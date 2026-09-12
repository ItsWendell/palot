import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const COMMAND_MARKER = "PALOT_PROCESS_OUTPUT_READY";
const COMMAND = `printf '\\033[1;94m${COMMAND_MARKER}\\033[0m\\n'; sleep 120`;
const TERMINAL_TITLE = "Process picker terminal";

export const processPickerScenario: Scenario = {
  description:
    "inspect real session commands and read-only terminals without stopping them on close",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { client, session, projectDirectory, runRoot }) {
    const location = { directory: projectDirectory };
    const shell = await client.shell.create({
      location,
      cwd: projectDirectory,
      command: COMMAND,
      timeout: 120_000,
      metadata: { sessionID: session.id },
    });
    let terminalID: string | undefined;
    const picker = page.getByRole("button", { name: /^Commands & terminals:/ });
    const output = page.getByRole("region", { name: "Command output", exact: true });
    const commandTab = page.getByRole("tab", { name: COMMAND, exact: true });
    const commandRow = page.getByRole("button").filter({
      has: page.getByText(COMMAND, { exact: true }),
    });

    try {
      await expect(picker).toHaveAccessibleName("Commands & terminals: 1 command");
      await picker.click();
      await expect(commandRow).toContainText("This conversation · Running");
      await commandRow.click();
      await expect(commandTab).toHaveCount(1);
      await expect(output.locator("pre")).toContainText(COMMAND_MARKER);
      const formattedMarker = output.locator("pre span").filter({ hasText: COMMAND_MARKER });
      await expect(formattedMarker).toHaveCSS("font-weight", "700");
      await expect(formattedMarker).toHaveCSS("color", "rgb(85, 85, 255)");
      await expect(output.locator("pre")).not.toContainText("[1;94m");
      await expect(output.getByRole("status")).toHaveText("running");
      await expect(output.getByText(projectDirectory, { exact: true })).toBeVisible();
      await captureSizes(page, output, runRoot, "process-command");

      await page.getByRole("button", { name: `Close ${COMMAND}`, exact: true }).click();
      await expect(commandTab).toHaveCount(0);
      expect((await client.shell.get({ id: shell.data.id, location })).data.status).toBe("running");

      await picker.click();
      await commandRow.click();
      await expect(output.locator("pre")).toContainText(COMMAND_MARKER);
      // Selecting an already-open process focuses its existing tab rather than adding one.
      await picker.click();
      await commandRow.click();
      await expect(commandTab).toHaveCount(1);
      await assertConnected(page);

      const terminal = await client.experimental.persistentPty.create({
        sessionID: session.id,
        command: "/bin/sh",
        args: ["-c", "printf 'PALOT_PROCESS_TERMINAL_READY\\n'; sleep 120"],
        cwd: projectDirectory,
        title: TERMINAL_TITLE,
        env: { TERM: "xterm-256color" },
        size: { cols: 80, rows: 24 },
      });
      terminalID = terminal.id;
      await expect(picker).toHaveAccessibleName("Commands & terminals: 2 processes");
      await picker.click();
      const terminalRow = page.getByRole("button").filter({
        has: page.getByText(TERMINAL_TITLE, { exact: true }),
      });
      await expect(terminalRow).toContainText("This conversation");
      await terminalRow.click();
      const terminalCanvas = page.locator(`[data-workbench-terminal="${terminal.id}"]`);
      const terminalPanel = page.getByRole("tabpanel", { name: "Terminal", exact: true });
      await expect(terminalCanvas.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await expect(terminalPanel.getByText("Read-only terminal", { exact: true })).toBeVisible();
      // Enabled only after the real persistent PTY attachment has connected.
      await expect(
        terminalPanel.getByRole("button", { name: "Take control", exact: true }),
      ).toBeEnabled();
      await captureSizes(page, terminalCanvas, runRoot, "process-terminal");
      expect((await client.experimental.persistentPty.get({ ptyID: terminal.id })).size).toEqual({
        cols: 80,
        rows: 24,
      });

      await page.getByRole("button", { name: "Close Terminal", exact: true }).click();
      await expect(terminalCanvas).toHaveCount(0);
      const surviving = await client.experimental.persistentPty.list({ sessionID: session.id });
      expect(surviving.find((entry) => entry.id === terminal.id)?.status).toBe("running");
      await picker.click();
      await terminalRow.click();
      await expect(page.getByRole("tab", { name: "Terminal", exact: true })).toHaveCount(1);
      await expect(
        terminalPanel.getByRole("button", { name: "Take control", exact: true }),
      ).toBeEnabled();
      await assertConnected(page);
    } finally {
      // These resources belong to the isolated scenario, not the user's service.
      // Cleanup is explicit and separate from the close-tab survival assertions.
      await Promise.all([
        client.shell.remove({ id: shell.data.id, location }),
        terminalID
          ? client.experimental.persistentPty.remove({ ptyID: terminalID })
          : Promise.resolve(),
      ]);
    }
  },
  async assert(page) {
    await assertConnected(page);
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
  },
};

async function assertConnected(page: Page) {
  const runtime = await page.evaluate(() =>
    (
      globalThis as unknown as { palot: { runtimeStatus(): Promise<{ connected: boolean }> } }
    ).palot.runtimeStatus(),
  );
  expect(runtime.connected).toBe(true);
}

async function captureSizes(page: Page, surface: Locator, runRoot: string, name: string) {
  const normal = page.viewportSize() ?? { width: 1280, height: 900 };
  try {
    await expect(surface).toBeVisible();
    await page.screenshot({ path: join(runRoot, `${name}-normal.png`) });
    await page.setViewportSize({ width: 920, height: 640 });
    await expect(surface).toBeVisible();
    const bounds = await surface.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(100);
    expect(bounds!.height).toBeGreaterThan(40);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(641);
    await page.getByRole("button", { name: /^Commands & terminals:/ }).click();
    const popup = page
      .locator('[data-slot="popover-content"]')
      .filter({ hasText: "Commands & terminals" });
    await expect(popup).toBeVisible();
    const popupBounds = await popup.boundingBox();
    expect(popupBounds).not.toBeNull();
    expect(popupBounds!.x).toBeGreaterThanOrEqual(0);
    expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(921);
    await page.screenshot({ path: join(runRoot, `${name}-920x640.png`) });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
      .toBe("dark");
    await page.screenshot({ path: join(runRoot, `${name}-920x640-dark.png`) });
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
  } finally {
    await page.emulateMedia({ colorScheme: null });
    await page.setViewportSize(normal);
  }
}
