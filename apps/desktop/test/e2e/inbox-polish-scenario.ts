import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

export const inboxPolishScenario: Scenario = {
  description:
    "sweep-settle Inbox rows with batch undo, persist and restore a prompt stash, and recover a crashed route",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run(page, { client, session, runRoot }) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(composer).toBeVisible();
    const dock = page.locator("[data-palot-composer-dock]");
    const initialReadiness = await composer.evaluate((input) => ({
      inert: Boolean(input.closest("[inert]")),
      documentFocused: document.hasFocus(),
    }));
    // The dock is visible but deliberately inert until cold transcript hydration
    // finishes. fill() can otherwise return without focusing or emitting input.
    await expect(dock).not.toHaveAttribute("inert");
    await composer.focus();
    await expect(composer).toBeFocused();
    await composer.fill("Save this prompt for later");
    await expect(composer).toHaveValue("Save this prompt for later");
    await composer.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect(page.getByText("Prompt stashed", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
    const persisted = await readStashStorage(page);
    expect(persisted).toHaveLength(1);
    expect(JSON.parse(persisted[0]![1]).value[0].draft.text).toBe("Save this prompt for later");
    await page.reload();
    await expect(composer).toBeVisible();
    await expect(dock).not.toHaveAttribute("inert");
    expect(await readStashStorage(page)).toEqual(persisted);
    await page.getByRole("button", { name: "Prompt stash", exact: true }).click();
    await page
      .getByRole("button", { name: "Restore Save this prompt for later", exact: true })
      .click();
    await expect(composer).toHaveValue("Save this prompt for later");
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
    await page.screenshot({ path: join(runRoot, "stash-restored.png") });

    const first = await client.session.create({
      title: "Sweep task one",
      location: session.location,
    });
    const second = await client.session.create({
      title: "Sweep task two",
      location: session.location,
    });
    const inboxButton = page.getByRole("button", { name: /^Show inbox/ });
    if ((await inboxButton.getAttribute("aria-pressed")) !== "true") await inboxButton.click();
    await page.evaluate(
      async (ids) => {
        const profileID = (await window.palot.runtimeStatus()).profileID!;
        for (const sessionID of ids)
          await window.palot.dispatchSessionTriage({
            type: "inbox",
            profileID,
            sessionID,
            at: Date.now(),
          });
      },
      [first.id, second.id],
    );
    const row = (title: string) =>
      page
        .locator("[data-inbox-card]")
        .filter({ has: page.getByRole("button", { name: new RegExp(`^Open ${title},`) }) });
    const one = row("Sweep task one");
    const two = row("Sweep task two");
    await expect(one).toBeVisible();
    await expect(two).toBeVisible();
    const settleButton = one.getByRole("button", { name: "Settle task", exact: true });
    await expect(settleButton).toHaveAttribute("data-inbox-settle");
    await page.mouse.move(850, 400);
    const actionOpacity = () =>
      settleButton.evaluate((button) => getComputedStyle(button.parentElement!).opacity);
    await expect.poll(actionOpacity).toBe("0");
    await one.hover();
    await settleButton.hover();
    await expect.poll(actionOpacity).toBe("1");
    await expect
      .poll(() =>
        settleButton.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          );
        }),
      )
      .toBe(true);
    const start = await settleButton.boundingBox();
    const end = await two.boundingBox();
    if (!start || !end) throw new Error("Sweep targets are not visible");
    await page.evaluate(() => {
      const events: object[] = [];
      Reflect.set(window, "__inboxPolishPointerEvents", events);
      for (const type of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "gotpointercapture",
        "lostpointercapture",
      ]) {
        window.addEventListener(
          type,
          (event) => {
            if (!(event instanceof PointerEvent) || events.length >= 100) return;
            const target = event.target instanceof Element ? event.target : null;
            const hit = document.elementFromPoint(event.clientX, event.clientY);
            events.push({
              type,
              trusted: event.isTrusted,
              pointerID: event.pointerId,
              pointerType: event.pointerType,
              settle: Boolean(target?.closest("[data-inbox-settle]")),
              captured: target?.hasPointerCapture(event.pointerId) ?? false,
              hitRow: hit?.closest<HTMLElement>("[data-inbox-sweep-key]")?.dataset.inboxSweepKey,
            });
          },
          true,
        );
      }
    });
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await expect(one).toHaveAttribute("data-inbox-sweep", "true");
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
    await expect(page.locator('[data-inbox-sweep="true"]')).toHaveCount(2);
    await page.screenshot({ path: join(runRoot, "inbox-sweep.png") });
    await page.mouse.up();
    const events = (await page.evaluate(() =>
      Reflect.get(window, "__inboxPolishPointerEvents"),
    )) as {
      type: string;
      trusted: boolean;
      pointerType: string;
      settle: boolean;
      captured: boolean;
      hitRow?: string;
    }[];
    expect(events.find((event) => event.type === "pointerdown")).toMatchObject({
      trusted: true,
      pointerType: "mouse",
      settle: true,
    });
    expect(
      events.some(
        (event) => event.type === "pointermove" && event.trusted && event.hitRow === second.id,
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === "pointerup" && event.trusted && event.hitRow === second.id,
      ),
    ).toBe(true);
    await writeFile(
      join(runRoot, "inbox-polish-input.json"),
      JSON.stringify({ initialReadiness, stashKey: persisted[0]![0], events }, null, 2),
    );
    await expect(one).toHaveCount(0);
    await expect(two).toHaveCount(0);
    await expect(page.getByText("Settled 2 tasks", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(one).toBeVisible();
    await expect(two).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("palot:e2e-render-error")));
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(page.getByText("E2E workspace render failure", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy details", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open diagnostics", exact: true })).toBeVisible();
    await expect(inboxButton).toBeVisible();
    await expect(one).toBeVisible();
    await page.screenshot({ path: join(runRoot, "route-error-recovery.png") });
    await page.getByRole("button", { name: "Reload view", exact: true }).click();
    await expect(composer).toHaveValue("Save this prompt for later");
  },
  async assert(page) {
    await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  },
};

function readStashStorage(page: Page) {
  return page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("palot.desktop.state.composer.stash:"),
    ),
  );
}
