import { Service } from "@opencode/client/service";
import { expect } from "@playwright/test";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

export const sharedServiceScenario: Scenario = {
  description:
    "reuse a shared service, stay disconnected when it disappears, and start only after confirmation",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { runRoot, session }) {
    // This is the harness-owned registration, never the user's shared service.
    const file = join(runRoot, "home", ".local", "state", "opencode", "service.json");
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible();
    await Service.stop({ file });
    await page.reload();
    const start = page.getByRole("button", { name: "Start OpenCode", exact: true });
    await expect(start).toBeVisible();
    expect(await Service.discover({ file })).toBeUndefined();
    await page.getByRole("button", { name: /Try again|Retry connection/, exact: true }).click();
    await expect(start).toBeVisible();
    expect(await Service.discover({ file })).toBeUndefined();

    await start.click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await Service.discover({ file })).toBeUndefined();
    await start.click();
    await confirmation
      .getByRole("button", { name: /Start OpenCode|Start or recover/, exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "Message Palot" })).toBeVisible({
      timeout: 60_000,
    });
    expect(await Service.discover({ file })).toBeDefined();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // The route and persisted task survive backend recovery.
    expect(page.url()).toContain(session.id);
  },
  async assert(_page, { llm }) {
    expect(llm.scriptedCalls()).toBe(0);
  },
};
