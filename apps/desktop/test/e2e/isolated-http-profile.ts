import { expect, type Page } from "@playwright/test";
import type { PalotApi } from "../../src/shared/opencode-contract";

/** Pair a disposable HTTP profile only to this E2E run's own loopback service. */
export async function useIsolatedHttpProfile(page: Page) {
  const initial = await page.evaluate(async () => {
    const api = (globalThis as unknown as { palot: PalotApi }).palot;
    const profiles = await api.listOpenCodeProfiles();
    const pairing = await api.openCodePairingInfo();
    const loopback = pairing.urls.find((value) =>
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
    );
    if (!loopback) throw new Error("Isolated service has no loopback pairing address");
    const before = new Set(profiles.profiles.map((profile) => profile.id));
    const created =
      pairing.mode === "link"
        ? await api.importOpenCodePairing({
            link: `${loopback}/auth/connect/${pairing.code}`,
            allowPlainHttp: true,
          })
        : await api.createOpenCodeProfile({
            kind: "remote",
            name: "Browser HTTP fixture",
            urls: [loopback],
            credential: { type: "basic", username: pairing.username, password: pairing.password },
            allowPlainHttp: true,
          });
    const profile = created.profiles.find((entry) => !before.has(entry.id));
    if (!profile) throw new Error("Browser HTTP fixture profile was not created");
    return { originalID: profiles.activeProfileID, profileID: profile.id };
  });
  const cleanup = async () => {
    await page.evaluate(async ({ originalID, profileID }) => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      try {
        await api.switchOpenCodeProfile(originalID);
      } finally {
        await api.deleteOpenCodeProfile(profileID);
      }
    }, initial);
  };
  try {
    await page.evaluate(async (profileID) => {
      const api = (globalThis as unknown as { palot: PalotApi }).palot;
      const key = "palot.desktop.state.onboarding.completed-profiles";
      const completed = JSON.parse(localStorage.getItem(key) ?? '{"version":1,"value":{}}');
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, value: { ...completed.value, [profileID]: 1 } }),
      );
      await api.switchOpenCodeProfile(profileID);
    }, initial.profileID);
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const status = await api.runtimeStatus();
          return {
            connected: status.connected,
            profileID: status.profileID,
            topology: status.topology,
          };
        }),
      )
      .toEqual({ connected: true, profileID: initial.profileID, topology: "remote-machine" });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
