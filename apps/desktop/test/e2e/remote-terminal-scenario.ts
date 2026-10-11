import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios";
import type { PalotApi } from "../../src/shared/opencode-contract";
import { useIsolatedHttpProfile } from "./isolated-http-profile.ts";

export const remoteTerminalScenario: Scenario = {
  description:
    "Remote-profile terminal creation, input, and reattachment through the real IPC and service",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, session, llm, projectDirectory, runRoot }) {
    const cleanup = await useIsolatedHttpProfile(page);
    const before = new Set(
      (await client.experimental.persistentPty.list({ sessionID: session.id })).map(
        (pty) => pty.id,
      ),
    );
    let terminalID: string | null = null;
    try {
      await page.reload();
      await page.evaluate((id) => {
        window.location.hash = `/sessions/${id}`;
      }, session.id);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { palot: PalotApi }).palot;
            const status = await api.runtimeStatus();
            return {
              connected: status.connected,
              topology: status.topology,
              pty: status.capabilities?.pty,
            };
          }),
        )
        .toEqual({
          connected: true,
          topology: "remote-machine",
          pty: "persistent",
        });
      await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
      await page.keyboard.press("Control+Backquote");
      const terminal = page.locator("[data-workbench-terminal]");
      await expect(terminal.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await expect(terminal.locator("..").getByText("connecting", { exact: true })).toHaveCount(0);
      terminalID = await terminal.getAttribute("data-workbench-terminal");
      expect(terminalID).toBeTruthy();
      expect(before.has(terminalID!)).toBe(false);
      expect((await client.experimental.persistentPty.get({ ptyID: terminalID! })).status).toBe(
        "running",
      );

      const markerPath = join(projectDirectory, "remote-terminal-marker.txt");
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      await terminal.click();
      await page.keyboard.type(`printf 'remote-terminal-input-ok' > ${quote(markerPath)}`);
      await page.keyboard.press("Enter");
      await expect
        .poll(() => readFile(markerPath, "utf8").catch(() => ""))
        .toBe("remote-terminal-input-ok");

      // Reload detaches the UI socket without ending the remote process and obtains a new ticket.
      await page.reload();
      const restored = page.locator(`[data-workbench-terminal="${terminalID}"]`);
      await expect(restored.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await expect(restored.locator("..").getByText("connecting", { exact: true })).toHaveCount(0);
      await restored.click();
      await page.keyboard.type(`printf '%s' '-reattached' >> ${quote(markerPath)}`);
      await page.keyboard.press("Enter");
      await expect
        .poll(() => readFile(markerPath, "utf8").catch(() => ""))
        .toBe("remote-terminal-input-ok-reattached");
      await page.screenshot({ path: join(runRoot, "remote-terminal.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Close Terminal", exact: true }).click();
      expect((await client.experimental.persistentPty.get({ ptyID: terminalID! })).status).toBe(
        "running",
      );
    } finally {
      if (terminalID) await client.experimental.persistentPty.remove({ ptyID: terminalID });
      await cleanup();
    }
    expect(llm.requests).toHaveLength(0);
  },
};
