import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const OWNER_PROMPT = "OWNER_GUEST_LIVE Show the guest a live reply.";
const LIVE = 'LIVE_GUEST_REPLY <img src="https://invalid.example" onerror="alert(1)">';
const SUGGESTION = "GUEST_APPROVAL_PROBE Explain the result, please.";
const APPROVED = "The approved guest message reached the agent.";

export const guestLinksScenario: Scenario = {
  description:
    "share a task over loopback, stream safely to a separate browser, approve a guest message and revoke access",
  prompt: "",
  expectedModelCalls: 2,
  arrange(llm) {
    llm.textChunks(
      ["LIVE_GUEST_REPLY ", '<img src="https://invalid.example" onerror="alert(1)">'],
      200,
    );
    llm.text(APPROVED);
  },
  async run(page, { session, client, llm, runRoot }) {
    await page.evaluate(() => {
      location.hash = "#/settings/general";
    });
    const toggle = page.getByRole("switch", { name: "Guest links (beta)", exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.evaluate((id) => {
      location.hash = `#/sessions/${id}`;
    }, session.id);
    await page.getByRole("button", { name: "Task actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Share with a guest…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Share with a guest", exact: true });
    await dialog.getByRole("button", { name: "Create guest link", exact: true }).click();
    await dialog.getByRole("button", { name: "Show Local guest link", exact: true }).click();
    const localUrl = (
      await dialog
        .getByRole("group", { name: "Local guest link", exact: true })
        .locator('[data-slot="copy-field-value"]')
        .innerText()
    ).trim();
    expect(localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/g\/[A-Za-z0-9_-]{32}\/$/);
    await dialog.getByRole("button", { name: "Show QR code", exact: true }).click();
    await expect(dialog.getByAltText("Guest link QR code")).toBeVisible();
    await page.screenshot({ path: join(runRoot, "guest-share-dialog.png") });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.keyboard.press("Escape");

    // Ordinary Chromium has no Palot preload, credentials, or Electron context.
    const executablePath =
      process.env.PALOT_E2E_GUEST_BROWSER ??
      ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const context = await browser.newContext();
      const guest = await context.newPage();
      await guest.goto(localUrl);
      const sharedSession = await client.session.get({ sessionID: session.id });
      await expect(guest.getByRole("heading", { level: 1 })).toHaveText(
        sharedSession.title ?? "Untitled task",
      );
      expect(await guest.evaluate(() => "palot" in window)).toBe(false);
      await page.getByRole("textbox", { name: "Message Palot", exact: true }).fill(OWNER_PROMPT);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(guest.getByLabel("Task transcript")).toContainText(LIVE);
      await expect(guest.locator("#transcript img, #transcript script")).toHaveCount(0);
      await guest.getByLabel("Your name", { exact: true }).fill("Jamie");
      await guest.getByLabel("Message for the owner", { exact: true }).fill(SUGGESTION);
      await guest.getByRole("button", { name: "Ask the owner to send", exact: true }).click();
      await expect(guest.getByText("Waiting for owner approval", { exact: true })).toBeVisible();
      const pending = page.getByRole("region", { name: "Pending guest messages", exact: true });
      await expect(pending).toContainText("Guest message from Jamie");
      await expect(pending).toContainText(SUGGESTION);
      const before = await client.message.list({ sessionID: session.id, limit: 100 });
      expect(JSON.stringify(before)).not.toContain(SUGGESTION);
      expect(llm.scriptedCalls()).toBe(1);
      await page.screenshot({ path: join(runRoot, "guest-message-pending.png") });
      await page.setViewportSize({ width: 920, height: 640 });
      await expect(pending.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
      await page.screenshot({ path: join(runRoot, "guest-message-pending-minimum.png") });
      await page.setViewportSize({ width: 1440, height: 920 });
      await guest.screenshot({ path: join(runRoot, "guest-page.png"), fullPage: true });
      await guest.setViewportSize({ width: 390, height: 844 });
      await guest.emulateMedia({ colorScheme: "dark" });
      await guest.screenshot({ path: join(runRoot, "guest-page-mobile-dark.png"), fullPage: true });
      await pending.getByRole("button", { name: "Send", exact: true }).click();
      await expect(guest.getByLabel("Task transcript")).toContainText(APPROVED);
      await expect(guest.getByText("Sent by the owner", { exact: true })).toBeVisible({
        timeout: 15000,
      });
      const sent = await client.message.list({ sessionID: session.id, limit: 100 });
      expect(
        sent.data.filter((message) => message.type === "user").map((message) => message.text),
      ).toContain(`Guest message from Jamie (unverified):\n\n${SUGGESTION}`);
      await expect(pending).toHaveCount(0);
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Stop sharing", exact: true }).click();
      await expect(
        guest.getByText("Guest link ended or disconnected. Reload to reconnect.", { exact: true }),
      ).toBeVisible();
      await expect(guest.getByLabel("Task transcript")).toBeEmpty();
      await expect(
        guest.getByRole("button", { name: "Ask the owner to send", exact: true }),
      ).toBeDisabled();
      await guest.screenshot({ path: join(runRoot, "guest-revoked.png") });
      await expect(fetch(localUrl)).rejects.toThrow();
    } finally {
      await browser.close();
    }
  },
  async assert(page) {
    await expect(page.getByText(APPROVED, { exact: true })).toBeVisible();
  },
};
