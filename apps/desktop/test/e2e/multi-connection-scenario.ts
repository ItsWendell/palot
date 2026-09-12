import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios";
import { startLoopbackServiceProxy } from "./loopback-service-proxy.ts";

const localTitle = "Overview local collision";
const remoteTitle = "Overview remote collision";
const remoteName = "Overview isolated remote";

async function closeSessionWindow(child: Page) {
  const closed = child.waitForEvent("close");
  await child.evaluate(
    () => void (globalThis as unknown as { palot: PalotApi }).palot.closeWindow(),
  );
  await closed;
}

async function assertWindowOwner(child: Page, sessionID: string, profileID: string) {
  await expect
    .poll(() => {
      const route = new URL(child.url().split("#")[1]!, "http://e2e.invalid");
      return { path: route.pathname, profileID: route.searchParams.get("profileID") };
    })
    .toEqual({ path: `/sessions/${sessionID}`, profileID });
  await expect(
    child
      .getByRole("main", { name: "Current task", exact: true })
      .getByText(remoteTitle, { exact: true }),
  ).toBeVisible();
}

async function assertSessionMenu(page: Page, row: Locator) {
  await row.click({ button: "right" });
  for (const name of [
    "Open in new window",
    "Fork",
    "Fork from prompt…",
    "Schedule follow-up",
    "Delete task",
  ]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
}

async function assertOwner(page: Page, sessionID: string, profileID: string) {
  await expect
    .poll(() => {
      const route = new URL(page.url().split("#")[1]!, "http://e2e.invalid");
      return { path: route.pathname, profileID: route.searchParams.get("profileID") };
    })
    .toEqual({ path: `/sessions/${sessionID}`, profileID });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
      ),
    )
    .toMatchObject({ profileID, connected: true });
  await expect(page.getByRole("textbox", { name: "Message Palot", exact: true })).toBeVisible();
}

async function assertInboxEdgeAlignment(page: Page, title: string) {
  const row = page.getByRole("button", { name: new RegExp(`^${title} ·`) });
  const status = page
    .locator("[data-inbox-card]")
    .filter({ has: row })
    .locator("[data-inbox-status]");
  const toggle = page.getByRole("button", { name: /^Inbox\s+\d+$/ });
  const chevron = toggle.locator("svg").first().locator("path, polyline").first();
  let timestampEdge = 0;
  await expect
    .poll(
      async () => {
        const [timeBounds, iconBounds] = await Promise.all([
          status.boundingBox(),
          chevron.boundingBox(),
        ]);
        if (timeBounds) timestampEdge = timeBounds.x + timeBounds.width;
        return timeBounds && iconBounds
          ? Math.abs(timeBounds.x + timeBounds.width - iconBounds.x - iconBounds.width)
          : Infinity;
      },
      { message: "Visible Inbox chevron drawing aligns with the timestamp edge" },
    )
    .toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(
      async () => {
        const bounds = await chevron.boundingBox();
        return bounds ? Math.abs(bounds.x + bounds.width - timestampEdge) : Infinity;
      },
      { message: "Collapsed chevron drawing retains the same optical edge" },
    )
    .toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(status).toBeVisible();
}

async function captureOverview(page: Page, runRoot: string) {
  const viewport = page.viewportSize();
  const appearance = await page.evaluate(() => {
    const api = (globalThis as unknown as { palot: PalotApi }).palot;
    return {
      preferences: api.appearancePreferences,
      resolvedScheme:
        document.documentElement.dataset.resolvedTheme === "dark"
          ? ("dark" as const)
          : ("light" as const),
    };
  });
  try {
    await page.setViewportSize({ width: 920, height: 640 });
    for (const scheme of ["light", "dark"] as const) {
      await page.evaluate(
        async ({ preferences, scheme }) => {
          await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
            preferences: { ...preferences, mode: scheme },
            resolvedScheme: scheme,
          });
        },
        { preferences: appearance.preferences, scheme },
      );
      await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", scheme);
      for (const mode of ["inbox", "projects"] as const) {
        await page
          .getByRole("button", { name: mode === "inbox" ? /^Show inbox/ : "Show projects" })
          .click();
        await expect(
          page.getByRole("button", { name: new RegExp(`^${remoteTitle} · ${remoteName}`) }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: new RegExp(`^${localTitle} ·`) }),
        ).toBeVisible();
        for (const title of [localTitle, remoteTitle]) {
          const row = page.getByRole("button", { name: new RegExp(`^${title} ·`) });
          await expect
            .poll(
              () =>
                row.evaluate((button, remote) => {
                  const surface = button.closest("[data-inbox-card]") ?? button;
                  const bounds = surface.getBoundingClientRect();
                  const badge = surface.querySelector('[role="img"]')?.getBoundingClientRect();
                  if (!remote) return !badge;
                  return Boolean(
                    badge &&
                    badge.top >= bounds.top &&
                    badge.bottom <= bounds.bottom &&
                    badge.left >= bounds.left &&
                    badge.right <= bounds.right,
                  );
                }, title === remoteTitle),
              { message: `Connection badge stays inside its ${mode} task row` },
            )
            .toBe(true);
          if (mode === "inbox") {
            await expect
              .poll(
                () =>
                  row.evaluate((button) => {
                    const card = button.closest("[data-inbox-card]");
                    return card ? card.getBoundingClientRect().height : 0;
                  }),
                { message: "Inbox keeps its larger multi-line cards, not compact project rows" },
              )
              .toBeGreaterThan(45);
            await assertInboxEdgeAlignment(page, title);
          }
        }
        if (mode === "projects") {
          const localRow = page.getByRole("button", { name: new RegExp(`^${localTitle} ·`) });
          const remoteRow = page.getByRole("button", {
            name: new RegExp(`^${remoteTitle} · ${remoteName}`),
          });
          const section = page.locator("[data-project-section]").filter({ has: localRow });
          const profileID = await section.getAttribute("data-profile-id");
          const projectID = await section.getAttribute("data-project-id");
          const ownerSection = page.locator(
            `[data-project-section][data-profile-id=${JSON.stringify(profileID)}][data-project-id=${JSON.stringify(projectID)}]`,
          );
          const toggle = ownerSection.locator("button[aria-expanded]").first();
          await expect
            .poll(
              () =>
                ownerSection.evaluate((section) => {
                  const trigger = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
                  const title = trigger?.querySelector("span");
                  const chevron = trigger
                    ?.querySelectorAll("svg")
                    .item(trigger.querySelectorAll("svg").length - 1);
                  const action = section.querySelector<HTMLButtonElement>(
                    'button[aria-label^="New task in"]',
                  );
                  if (!trigger || !title || !chevron || !action) return false;
                  const sectionBounds = section.getBoundingClientRect();
                  const triggerBounds = trigger.getBoundingClientRect();
                  const titleBounds = title.getBoundingClientRect();
                  const actionBounds = action.getBoundingClientRect();
                  const chevronBounds = chevron.getBoundingClientRect();
                  const padding = parseFloat(getComputedStyle(trigger).paddingLeft);
                  return (
                    Math.abs(triggerBounds.left - sectionBounds.left) <= 1 &&
                    Math.abs(triggerBounds.right - sectionBounds.right) <= 1 &&
                    Math.abs(titleBounds.left - triggerBounds.left - padding) <= 1 &&
                    titleBounds.right <= actionBounds.left + 1 &&
                    actionBounds.right <= chevronBounds.left + 1
                  );
                }),
              {
                message:
                  "Project title stays left-aligned, with the add action before the right chevron",
              },
            )
            .toBe(true);
          await toggle.click();
          await expect(localRow).toBeHidden();
          await expect(remoteRow).toBeVisible();
          await page.getByRole("button", { name: /^Show inbox/ }).click();
          await expect(localRow).toBeVisible();
          await page.getByRole("button", { name: "Show projects", exact: true }).click();
          await expect(localRow).toBeHidden();
          await toggle.click();
          await expect(localRow).toBeVisible();
          await expect(remoteRow).toBeVisible();
        }
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        await page.screenshot({
          path: join(runRoot, `overview-${mode}-${scheme}-920x640.png`),
          animations: "disabled",
        });
        if (mode === "inbox") {
          await page.getByRole("button", { name: /^Filter tasks/ }).click();
          await page.getByRole("menuitem", { name: /^Servers/ }).hover();
          await expect(
            page.getByRole("menuitemcheckbox", { name: new RegExp(`^${remoteName}`) }),
          ).toBeVisible();
          await page.screenshot({
            path: join(runRoot, `overview-server-filters-${scheme}-920x640.png`),
            animations: "disabled",
          });
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
      }
    }
    await page.getByRole("button", { name: /^Show inbox/ }).click();
    await page.evaluate(async (preferences) => {
      await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance({
        preferences: { ...preferences, mode: "dark", uiFontSize: 19 },
        resolvedScheme: "dark",
      });
    }, appearance.preferences);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--theme-ui-font-size")
            .trim(),
        ),
      )
      .toBe("19px");
    await assertInboxEdgeAlignment(page, localTitle);
    await assertInboxEdgeAlignment(page, remoteTitle);
    await page.screenshot({
      path: join(runRoot, "overview-inbox-large-type-920x640.png"),
      animations: "disabled",
    });
  } finally {
    await page.evaluate(async (appearance) => {
      await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(appearance);
    }, appearance);
    if (viewport) await page.setViewportSize(viewport);
    await page.getByRole("button", { name: /^Show inbox/ }).click();
  }
}

export const multiConnectionScenario: Scenario = {
  description:
    "Concurrent local and remote inboxes with colliding session IDs, owner-scoped rename, background events, and stale remote isolation",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async run() {},
  async assert(
    page,
    { client, session, projectDirectory, runRoot, llm, uncertainCleanup, visible },
  ) {
    // All backend state is created through the generated client. A second real
    // service gets its own home and registration; never discover the user service.
    const home = join(runRoot, "overview-remote-home");
    await mkdir(home, { recursive: true, mode: 0o700 });
    const file = join(home, ".local/state/opencode/service.json");
    let started = false;
    let profileID: string | undefined;
    let proxy: Awaited<ReturnType<typeof startLoopbackServiceProxy>> | undefined;
    const original = await page.evaluate(async () =>
      (globalThis as unknown as { palot: PalotApi }).palot.listOpenCodeProfiles(),
    );
    try {
      // Attempt registration cleanup even if ensure fails during startup. Like
      // the main harness, the SDK cannot identify an unregistered contender.
      started = true;
      const endpoint = await Service.ensure({
        file,
        version: packageJson.devDependencies["@opencode/client"],
        command: [process.env.OPENCODE_BIN ?? "opencode2", "serve", "--service", "--port=0"],
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_DATA_HOME: join(home, ".local/share"),
          XDG_STATE_HOME: join(home, ".local/state"),
          XDG_CACHE_HOME: join(home, ".cache"),
          OPENCODE_TEST_HOME: home,
          OPENCODE_CONFIG_CONTENT: "{}",
          OPENCODE_AUTH_CONTENT: "{}",
          OPENCODE_DISABLE_PROJECT_CONFIG: "1",
          OPENCODE_PURE: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
        },
      }).catch((cause: unknown) => {
        const message =
          "Secondary isolated Service.ensure failed before returning an endpoint; an unregistered contender may survive and cleanup cannot be verified through the public API.";
        uncertainCleanup(message);
        throw new Error(message, { cause });
      });
      const remote = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
      proxy = await startLoopbackServiceProxy(endpoint);
      await client.session.rename({ sessionID: session.id, title: localTitle });
      // The public create contract accepts an explicit ID: identical IDs on two
      // databases catch accidental active-client and unscoped-cache fallbacks.
      const collision = await remote.session.create({
        id: session.id,
        title: remoteTitle,
        location: { directory: projectDirectory },
      });
      expect(collision.id).toBe(session.id);
      profileID = await page.evaluate(
        async ({ url, name }) => {
          const api = (globalThis as unknown as { palot: PalotApi }).palot;
          const snapshot = await api.createOpenCodeProfile({
            kind: "remote",
            name,
            urls: [url],
            credential: { type: "none" },
            allowPlainHttp: true,
          });
          const profile = snapshot.profiles.find((entry) => entry.name === name)!;
          await api.connectOpenCodeProfile(profile.id);
          // Profile IPC does not itself update renderer query state. Exercise the
          // normal focus-triggered registry refresh, not a reload/private store edit.
          window.dispatchEvent(new Event("focus"));
          return profile.id;
        },
        { url: proxy.url, name: remoteName },
      );

      const showInbox = page.getByRole("button", { name: /^Show inbox/ });
      if (!(await showInbox.isVisible())) {
        await page.getByRole("button", { name: "Show navigation", exact: true }).click();
      }
      await showInbox.click();
      const options = page.getByRole("button", { name: "Inbox options", exact: true });
      await expect(page.getByRole("button", { name: "Connection scope", exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "Inbox view settings", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add project folder", exact: true }),
      ).toBeVisible();
      await options.click();
      await page.getByRole("menuitem", { name: "Connections", exact: true }).hover();
      const monitor = page.getByRole("menuitemcheckbox", {
        name: new RegExp(`^Monitor ${remoteName}`),
      });
      await expect(monitor).toBeVisible();
      if ((await monitor.getAttribute("aria-checked")) !== "true") await monitor.click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const localRow = page.getByRole("button", { name: new RegExp(`^${localTitle} ·`) });
      const remoteRow = page.getByRole("button", {
        name: new RegExp(`^${remoteTitle} · ${remoteName}`),
      });
      await expect(localRow).toBeVisible({ timeout: 30_000 });
      await expect(remoteRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Pinned 0", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Snoozed 0", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Refresh / })).toHaveCount(0);
      await expect
        .poll(
          () =>
            page.getByRole("button", { name: /^Inbox\s+\d+$/ }).evaluate((trigger) => {
              const label = trigger.querySelector("span")?.getBoundingClientRect();
              const chevron = trigger.querySelector("svg")?.getBoundingClientRect();
              return Boolean(label && chevron && chevron.left > label.right);
            }),
          { message: "Inbox retains the original right-aligned collapse control" },
        )
        .toBe(true);

      // Filtering hides rows without stopping the monitored connection.
      await page.getByRole("button", { name: /^Filter tasks/ }).click();
      await page.getByRole("menuitem", { name: /^Servers/ }).hover();
      await page.getByRole("menuitemcheckbox", { name: new RegExp(`^${remoteName}`) }).click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(remoteRow).toBeHidden();
      await expect(localRow).toBeVisible();
      expect(
        await page.evaluate(
          async (profileID) =>
            (
              await (globalThis as unknown as { palot: PalotApi }).palot.listOpenCodeRuntimes()
            ).some((runtime) => runtime.profileID === profileID && runtime.connected),
          profileID,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: /^Filter tasks/ }).click();
      await page.getByRole("menuitem", { name: "Clear filters", exact: true }).click();
      await expect(remoteRow).toBeVisible();

      await options.click();
      await page.getByRole("menuitem", { name: "Collapse all sections", exact: true }).click();
      await expect(localRow).toBeHidden();
      await expect(remoteRow).toBeHidden();
      await options.click();
      await page.getByRole("menuitem", { name: "Expand all sections", exact: true }).click();
      await expect(localRow).toBeVisible();
      await expect(remoteRow).toBeVisible();
      // Native visual capture requires a mapped window. Hidden Electron windows
      // on Linux can service DOM commands but stall Chromium's screenshot request.
      if (visible) await captureOverview(page, runRoot);
      await page
        .getByRole("button", { name: new RegExp(`^Actions for ${remoteTitle} on ${remoteName}`) })
        .click();
      await page.getByRole("menuitem", { name: "Settle", exact: true }).click();
      await expect(
        page.locator("[data-inbox-compact-row]").filter({ has: remoteRow }),
      ).toBeVisible();
      await expect(page.locator("[data-inbox-card]").filter({ has: remoteRow })).toHaveCount(0);
      await expect(page.locator("[data-inbox-card]").filter({ has: localRow })).toBeVisible();
      await assertSessionMenu(page, remoteRow);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menuitem", { name: "Open in new window", exact: true }),
      ).toBeHidden();
      await page
        .getByRole("button", { name: new RegExp(`^Actions for ${remoteTitle} on ${remoteName}`) })
        .click();
      await page.getByRole("menuitem", { name: "Move to inbox", exact: true }).click();
      await expect(page.locator("[data-inbox-card]").filter({ has: remoteRow })).toBeVisible();
      // Complete the additional profile's real onboarding once. Writing its
      // localStorage record after startup does not update the mounted atom and
      // would require a reload, defeating this scenario's switching assertion.
      await remoteRow.click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Skip for now", exact: true }).click();
      await localRow.click();
      await assertOwner(page, session.id, original.activeProfileID);
      // Restored row interactions must use the background owner even when the
      // active service has a different task with exactly the same session ID.
      const sourceURL = page.url();
      const sourceOrigin = await page.evaluate(() => performance.timeOrigin);
      const windowCount = page.context().pages().length;
      await assertSessionMenu(page, remoteRow);
      if (visible)
        await page.screenshot({
          path: join(runRoot, "overview-session-context-menu.png"),
          animations: "disabled",
        });
      const [menuWindow] = await Promise.all([
        page.context().waitForEvent("page"),
        page.getByRole("menuitem", { name: "Open in new window", exact: true }).click(),
      ]);
      try {
        await assertWindowOwner(menuWindow, session.id, profileID);
      } finally {
        await closeSessionWindow(menuWindow);
      }
      await assertOwner(page, session.id, original.activeProfileID);
      expect(page.url()).toBe(sourceURL);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(sourceOrigin);

      await page.getByRole("button", { name: "Show projects", exact: true }).click();
      await assertSessionMenu(page, remoteRow);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menuitem", { name: "Open in new window", exact: true }),
      ).toBeHidden();
      const box = (await remoteRow.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 20, y, { steps: 3 });
      await expect(page.locator("[data-session-window-drag-hint]")).toContainText("Drag outside");
      await page.mouse.up();
      expect(page.context().pages()).toHaveLength(windowCount);
      expect(page.url()).toBe(sourceURL);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(-25, y, { steps: 5 });
      await expect(page.locator("[data-session-window-drag-hint]")).toContainText(
        "Release to open",
      );
      const [dragWindow] = await Promise.all([
        page.context().waitForEvent("page"),
        page.mouse.up(),
      ]);
      try {
        await assertWindowOwner(dragWindow, session.id, profileID);
      } finally {
        await closeSessionWindow(dragWindow);
      }
      await assertOwner(page, session.id, original.activeProfileID);
      expect(page.url()).toBe(sourceURL);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(sourceOrigin);
      await page.getByRole("button", { name: /^Show inbox/ }).click();
      await expect(page.locator('[aria-label^="Execution connection:"]')).toHaveCount(0);
      await expect(page.getByText("Run on", { exact: true })).toHaveCount(0);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      await remoteRow.click();
      await assertOwner(page, session.id, profileID);
      const destination = page
        .locator(".palot-composer-context")
        .getByLabel(`Execution connection: ${remoteName}`, { exact: true });
      await expect(destination).toBeVisible();
      await expect(
        page
          .locator(".palot-composer")
          .getByLabel(`Execution connection: ${remoteName}`, { exact: true }),
      ).toHaveCount(0);
      if (visible) {
        await page.setViewportSize({ width: 920, height: 640 });
        await page.screenshot({
          path: join(runRoot, "composer-remote-destination-920x640.png"),
          animations: "disabled",
        });
      }
      await expect(remoteRow).toHaveAttribute("aria-current", "page");
      await expect(localRow).not.toHaveAttribute("aria-current", "page");
      await localRow.click();
      await assertOwner(page, session.id, original.activeProfileID);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

      // Rename the background owner while local is selected, then check both
      // databases. A UI-only title update is not sufficient evidence.
      await page
        .getByRole("button", { name: new RegExp(`^Actions for ${remoteTitle} on ${remoteName}`) })
        .click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const renamed = "Overview remote renamed only";
      const dialog = page.getByRole("dialog", { name: "Rename task", exact: true });
      await dialog.getByRole("textbox", { name: "Task title", exact: true }).fill(renamed);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await remote.session.get({ sessionID: session.id })).title).toBe(renamed);
      expect((await client.session.get({ sessionID: session.id })).title).toBe(localTitle);
      await assertOwner(page, session.id, original.activeProfileID);

      const backgroundTitle = "Overview background event received";
      await remote.session.rename({ sessionID: session.id, title: backgroundTitle });
      const backgroundRow = page.getByRole("button", {
        name: new RegExp(`^${backgroundTitle} · ${remoteName}`),
      });
      await expect(backgroundRow).toBeVisible({ timeout: 30_000 });
      await expect(localRow).toBeVisible();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

      await Service.stop({ file });
      started = false;
      await expect(backgroundRow).toBeVisible();
      await expect(
        page
          .locator("[data-inbox-card]")
          .filter({ has: backgroundRow })
          .getByRole("img", { name: /Disconnected$/ }),
      ).toBeVisible({ timeout: 30_000 });
      await assertOwner(page, session.id, original.activeProfileID);
      await page
        .getByRole("button", {
          name: new RegExp(`^Actions for ${backgroundTitle} on ${remoteName}`),
        })
        .click();
      await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await backgroundRow.click();
      // Offline navigation uses cached renderer state, not a connected main runtime.
      const offlineDestination = page.locator(".palot-composer-context").getByRole("status");
      await expect(offlineDestination).toHaveText(`${remoteName} · Offline`, { timeout: 30_000 });
      if (visible)
        await page.screenshot({
          path: join(runRoot, "composer-offline-destination-920x640.png"),
          animations: "disabled",
        });
      await localRow.click();
      await assertOwner(page, session.id, original.activeProfileID);
      await expect(page.locator(".palot-composer-context").getByRole("status")).toHaveCount(0);
      expect(llm.requests).toHaveLength(0);
    } finally {
      // Release both independently even when one cleanup fails; do not report a
      // failed secondary stop as complete in the runner's resource manifest.
      const cleanup = await Promise.allSettled([
        proxy?.close(),
        started ? Service.stop({ file }) : undefined,
      ]);
      const failures = cleanup.filter((result) => result.status === "rejected");
      if (failures.length) {
        uncertainCleanup("Secondary service or loopback proxy cleanup failed");
        console.error(
          new AggregateError(
            failures.map((result) => result.reason),
            "Secondary fixture cleanup failed",
          ),
        );
      }
      if (profileID && !page.isClosed()) {
        await page.evaluate(
          async ({ originalID, profileID }) => {
            const api = (globalThis as unknown as { palot: PalotApi }).palot;
            await api.switchOpenCodeProfile(originalID);
            await api.deleteOpenCodeProfile(profileID);
          },
          { originalID: original.activeProfileID, profileID },
        );
      }
    }
  },
};
