import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios";

type ProfileSnapshot = { activeProfileID: string; profiles: { id: string }[] };
interface PalotApi {
  listOpenCodeProfiles(): Promise<ProfileSnapshot>;
  openCodePairingInfo(): Promise<{ urls: string[]; username: string; password: string }>;
  createOpenCodeProfile(input: {
    kind: "remote";
    name: string;
    urls: string[];
    credential: { type: "basic"; username: string; password: string };
    allowPlainHttp: boolean;
  }): Promise<ProfileSnapshot>;
  switchOpenCodeProfile(id: string): Promise<unknown>;
  deleteOpenCodeProfile(id: string): Promise<unknown>;
  runtimeStatus(): Promise<{
    connected: boolean;
    profileID: string;
    topology: string;
    capabilities?: { pty: string };
  }>;
}

export const remoteTerminalScenario: Scenario = {
  description:
    "Remote-profile terminal creation, input, and reattachment through the real IPC and service",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(page, { client, session, llm, projectDirectory, runRoot }) {
    const initial = await page.evaluate(async () => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      const profiles = await api.listOpenCodeProfiles();
      const pairing = await api.openCodePairingInfo();
      const loopback = pairing.urls.find((value) =>
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
      );
      if (!loopback) throw new Error("Isolated service has no loopback pairing address");
      // This is the isolated E2E service, not an external host or the shared user service.
      const before = new Set(profiles.profiles.map((profile) => profile.id));
      const created = await api.createOpenCodeProfile({
        kind: "remote",
        name: "Remote terminal fixture",
        urls: [loopback],
        credential: { type: "basic", username: pairing.username, password: pairing.password },
        allowPlainHttp: true,
      });
      const profile = created.profiles.find((entry) => !before.has(entry.id))!;
      // Match the harness's onboarding fixture for this additional isolated profile.
      const key = "palot.desktop.state.onboarding.completed-profiles";
      const completed = JSON.parse(localStorage.getItem(key) ?? '{"version":1,"value":{}}');
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, value: { ...completed.value, [profile.id]: 1 } }),
      );
      await api.switchOpenCodeProfile(profile.id);
      return { originalID: profiles.activeProfileID, profileID: profile.id };
    });
    const location = { directory: projectDirectory };
    const before = new Set((await client.pty.list({ location })).data.map((pty) => pty.id));
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
              profileID: status.profileID,
              topology: status.topology,
              pty: status.capabilities?.pty,
            };
          }),
        )
        .toEqual({
          connected: true,
          profileID: initial.profileID,
          topology: "remote-machine",
          pty: "legacy",
        });
      await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
      await page.keyboard.press("Control+Backquote");
      const terminal = page.locator("[data-workbench-terminal]");
      await expect(terminal.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await expect(terminal.locator("..").getByText("connecting", { exact: true })).toHaveCount(0);
      terminalID = await terminal.getAttribute("data-workbench-terminal");
      expect(terminalID).toBeTruthy();
      expect(before.has(terminalID!)).toBe(false);
      expect((await client.pty.get({ ptyID: terminalID!, location })).data.status).toBe("running");

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
      expect((await client.pty.get({ ptyID: terminalID!, location })).data.status).toBe("running");
    } finally {
      if (terminalID) await client.pty.remove({ ptyID: terminalID, location });
      await page.evaluate(async ({ originalID, profileID }) => {
        const api = (globalThis as unknown as { palot: PalotApi }).palot;
        await api.switchOpenCodeProfile(originalID);
        await api.deleteOpenCodeProfile(profileID);
      }, initial);
    }
    expect(llm.requests).toHaveLength(0);
  },
};
