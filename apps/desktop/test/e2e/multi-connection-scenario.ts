import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios";
import { startLoopbackServiceProxy } from "./loopback-service-proxy.ts";
import {
  chooseProjectsMenuItem,
  openTaskSection,
  openViewMenu,
  showTaskColumn,
  taskColumn,
  taskRow,
} from "./task-list.ts";

const localTitle = "Overview local collision";
const remoteTitle = "Overview remote collision";
const remoteName = "Overview isolated remote";

async function checkNewTaskDestination(
  page: Page,
  localRow: Locator,
  remoteRow: Locator,
  localProfileID: string,
  localName: string,
  remoteProfileID: string,
  sessionID: string,
  projectDirectory: string,
  runRoot: string,
  visible: boolean,
) {
  const newTask = page.getByRole("button", { name: "New task", exact: true });
  const main = page.getByRole("main", { name: "New task", exact: true });
  const picker = main.getByRole("combobox", { name: "Task destination", exact: true });
  const search = page.getByRole("combobox", { name: "Search destinations", exact: true });
  // Destination rows group under a heading that names their server.
  const projectOption = (server: string) =>
    page
      .getByRole("group", { name: new RegExp(server) })
      .getByRole("option")
      .filter({ hasText: projectDirectory });
  const destination = () => {
    const route = new URL(page.url().split("#")[1]!, "http://e2e.invalid");
    return {
      profileID: route.searchParams.get("profileID"),
      projectID: route.searchParams.get("projectID"),
    };
  };
  await remoteRow.click();
  await assertOwner(page, sessionID, remoteProfileID);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+n" : "Control+n");
  // Browsing a remote session must not establish a remote new-task default.
  await expect(main).toBeVisible();
  await expect.poll(() => destination().profileID).toBe(localProfileID);
  await expect.poll(() => destination().projectID).not.toBeNull();
  const localProjectID = destination().projectID;
  await expect(picker).toContainText(localName);
  await picker.click();
  await search.fill(projectDirectory);
  await expect(projectOption(localName)).toBeVisible();
  await expect(projectOption(remoteName)).toBeVisible();
  if (visible) {
    await page.setViewportSize({ width: 920, height: 640 });
    await page.screenshot({
      path: join(runRoot, "new-task-destination-picker-920x640.png"),
      animations: "disabled",
    });
  }
  await search.fill(remoteName);
  await projectOption(remoteName).click();
  await expect(picker).toContainText(remoteName);
  await expect.poll(destination).toEqual({ profileID: remoteProfileID, projectID: localProjectID });
  // Project IDs intentionally collide. Switching servers must retain the owner,
  // not reuse the previous server's checkout or worktree selection.
  await picker.click();
  await search.fill(localName);
  await projectOption(localName).click();
  await expect.poll(destination).toEqual({ profileID: localProfileID, projectID: localProjectID });
  await remoteRow.click();
  await assertOwner(page, sessionID, remoteProfileID);
  await newTask.click();
  await expect.poll(destination).toEqual({ profileID: localProfileID, projectID: localProjectID });
  await page.reload();
  await expect(picker).toContainText(localName);
  await remoteRow.click();
  await assertOwner(page, sessionID, remoteProfileID);
  await newTask.click();
  await expect.poll(destination).toEqual({ profileID: localProfileID, projectID: localProjectID });
  if (visible)
    await page.screenshot({
      path: join(runRoot, "new-task-local-destination-920x640.png"),
      animations: "disabled",
    });
  await localRow.click();
  await assertOwner(page, sessionID, localProfileID);
}

async function checkWarmNavigation(
  page: Page,
  localRow: Locator,
  remoteRow: Locator,
  localProfileID: string,
  remoteProfileID: string,
  sessionID: string,
  runRoot: string,
) {
  const samples: { server: string; visibleMs: number; splashMounts: number }[] = [];
  const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
  await composer.fill("Local draft survives server navigation");
  let remoteDraftCreated = false;
  for (const remote of [true, false, true, false, true, false]) {
    const profileID = remote ? remoteProfileID : localProfileID;
    const title = remote ? remoteTitle : localTitle;
    await page.evaluate(
      ({ profileID, title }) => {
        const state = { started: 0, visibleMs: -1, splashMounts: 0, stop: () => {} };
        const observer = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes) {
              if (
                node instanceof Element &&
                (node.matches('[aria-label="Loading Palot"]') ||
                  node.querySelector('[aria-label="Loading Palot"]'))
              )
                state.splashMounts++;
            }
        });
        observer.observe(document.body, { subtree: true, childList: true });
        let frame = 0;
        const check = () => {
          const task = document.querySelector('[aria-label="Current task"]');
          const route = new URL(location.hash.slice(1), location.origin);
          if (
            state.started &&
            route.searchParams.get("profileID") === profileID &&
            task?.textContent?.includes(title) &&
            task.getBoundingClientRect().height > 0 &&
            document.querySelector('[aria-label="Message Palot"]')
          ) {
            state.visibleMs = performance.now() - state.started;
          } else frame = requestAnimationFrame(check);
        };
        document.addEventListener(
          "pointerdown",
          () => {
            state.started = performance.now();
            frame = requestAnimationFrame(check);
          },
          { once: true },
        );
        state.stop = () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
        };
        Object.assign(window, { __palotNavigationProbe: state });
      },
      { profileID, title },
    );
    await (remote ? remoteRow : localRow).click();
    await assertOwner(page, sessionID, profileID);
    if (remote && !remoteDraftCreated) {
      await expect(composer).toHaveJSProperty("value", "");
      await composer.fill("Remote draft survives server navigation");
      remoteDraftCreated = true;
    } else {
      await expect(composer).toHaveJSProperty(
        "value",
        remote
          ? "Remote draft survives server navigation"
          : "Local draft survives server navigation",
      );
    }
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __palotNavigationProbe: { visibleMs: number } })
              .__palotNavigationProbe.visibleMs,
        ),
      )
      .toBeGreaterThanOrEqual(0);
    samples.push(
      await page.evaluate(
        (server) => {
          const state = (
            window as unknown as {
              __palotNavigationProbe: { visibleMs: number; splashMounts: number; stop(): void };
            }
          ).__palotNavigationProbe;
          state.stop();
          return { server, visibleMs: state.visibleMs, splashMounts: state.splashMounts };
        },
        remote ? "remote" : "local",
      ),
    );
  }
  await writeFile(
    join(runRoot, "warm-navigation.json"),
    JSON.stringify(
      {
        metric: "trusted pointerdown to next-frame target task DOM, not compositor presentation",
        samples,
      },
      null,
      2,
    ),
  );
  expect(
    samples.map((sample) => sample.splashMounts),
    "Warm session switches must never mount the app splash",
  ).toEqual(samples.map(() => 0));
}

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

/** Group by inbox, project and server, light and dark: both servers' tasks stay listed. */
async function captureOverview(page: Page, runRoot: string, localRow: Locator, remoteRow: Locator) {
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
      for (const grouping of ["Inbox", "Project", "Server"] as const) {
        await setGrouping(page, grouping);
        await expect(localRow).toBeVisible();
        await expect(remoteRow).toBeVisible();
        if (grouping === "Server")
          await expect(
            taskColumn(page).getByRole("treeitem", { name: new RegExp(`^${remoteName}`) }),
          ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        await page.screenshot({
          path: join(runRoot, `overview-${grouping.toLowerCase()}-${scheme}-920x640.png`),
          animations: "disabled",
        });
      }
    }
  } finally {
    await setGrouping(page, "Inbox");
    await page.evaluate(async (appearance) => {
      await (globalThis as unknown as { palot: PalotApi }).palot.updateAppearance(appearance);
    }, appearance);
    if (viewport) await page.setViewportSize(viewport);
  }
}

async function setGrouping(page: Page, grouping: "Inbox" | "Project" | "Server") {
  const menu = await openViewMenu(taskColumn(page), page);
  await menu.getByRole("menuitemradio", { name: grouping, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Opens a row's menu and chooses an entry; the list's own entries end with their key. */
async function rowMenu(page: Page, row: Locator, name: string) {
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: new RegExp(`^${name}(\\s*[A-Z])?$`) }).click();
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
        version:
          (
            await page.evaluate(async () =>
              (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
            )
          ).version ?? packageJson.devDependencies["@opencode/client"],
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
      await client.session.update({ sessionID: session.id, title: localTitle });
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

      await showTaskColumn(page);
      await page.getByRole("button", { name: "Open Palot menu", exact: true }).click();
      await page.getByRole("menuitem", { name: "Servers", exact: true }).hover();
      const monitor = page.getByRole("menuitemcheckbox", { name: new RegExp(`^${remoteName} `) });
      await expect(monitor).toBeVisible();
      if ((await monitor.getAttribute("aria-checked")) !== "true") await monitor.click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const column = taskColumn(page);
      const localRow = taskRow(column, localTitle);
      const remoteRow = taskRow(column, remoteTitle);
      await expect(localRow).toBeVisible({ timeout: 30_000 });
      await expect(remoteRow).toBeVisible({ timeout: 30_000 });
      // Colliding session ids stay two rows, one per server.
      await expect(column.locator(`[data-session-id="${session.id}"]`)).toHaveCount(2);

      // Filtering hides rows without stopping the monitored connection.
      const view = await openViewMenu(column, page);
      // Keys, not the pointer: a pointer path across the menu opens the submenus it passes.
      await view.getByRole("menuitem", { name: /^Filter/ }).focus();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("menuitem", { name: "Server", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await page
        .getByRole("menuitemradio", {
          name: original.profiles.find((profile) => profile.id === original.activeProfileID)!.name,
          exact: true,
        })
        .click();
      await page.keyboard.press("Escape");
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
      await column.getByRole("button", { name: /^Remove / }).click();
      await expect(remoteRow).toBeVisible();

      // Native visual capture requires a mapped window. Hidden Electron windows
      // on Linux can service DOM commands but stall Chromium's screenshot request.
      if (visible) await captureOverview(page, runRoot, localRow, remoteRow);
      // Settle and move back act on the remote owner, not the focused server's same id.
      await rowMenu(page, remoteRow, "Settle");
      await openTaskSection(column, "Settled");
      await expect(remoteRow).toHaveAttribute("data-placement", "settled");
      await expect(localRow).not.toHaveAttribute("data-placement", "settled");
      await assertSessionMenu(page, remoteRow);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menuitem", { name: "Open in new window", exact: true }),
      ).toBeHidden();
      await rowMenu(page, remoteRow, "Move back");
      await expect(remoteRow).not.toHaveAttribute("data-placement", "settled");
      // Onboarding is app-wide, never repeated when selecting another server.
      await remoteRow.click();
      await assertOwner(page, session.id, profileID);
      await expect(page.getByRole("heading", { name: /Welcome to Palot/ })).toHaveCount(0);
      await localRow.click();
      await assertOwner(page, session.id, original.activeProfileID);
      await checkWarmNavigation(
        page,
        localRow,
        remoteRow,
        original.activeProfileID,
        profileID,
        session.id,
        runRoot,
      );
      await checkNewTaskDestination(
        page,
        localRow,
        remoteRow,
        original.activeProfileID,
        original.profiles.find((profile) => profile.id === original.activeProfileID)!.name,
        profileID,
        session.id,
        projectDirectory,
        runRoot,
        visible,
      );
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

      await setGrouping(page, "Project");
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
      await setGrouping(page, "Inbox");
      await expect(page.locator('[aria-label^="Execution connection:"]')).toHaveCount(0);
      await expect(page.getByText("Run on", { exact: true })).toHaveCount(0);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      await remoteRow.click();
      await assertOwner(page, session.id, profileID);
      const selectedRemoteURL = page.url();
      for (const enabled of [false, true]) {
        await page.getByRole("button", { name: "Open Palot menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Servers", exact: true }).hover();
        const toggle = page.getByRole("menuitemcheckbox", { name: new RegExp(`^${remoteName} `) });
        await expect(toggle).toHaveAttribute("aria-checked", String(!enabled));
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await expect
          .poll(
            async () =>
              (
                await page.evaluate(async () =>
                  (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
                )
              ).connected,
          )
          .toBe(enabled);
        expect(page.url()).toBe(selectedRemoteURL);
        await expect(page.getByRole("heading", { name: /Welcome to Palot/ })).toHaveCount(0);
      }
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
      await rowMenu(page, remoteRow, "Rename");
      const renamed = "Overview remote renamed only";
      const field = column.getByRole("textbox", { name: "Task title", exact: true });
      await field.fill(renamed);
      await field.press("Enter");
      await expect(field).toHaveCount(0);
      await expect
        .poll(async () => (await remote.session.get({ sessionID: session.id })).title)
        .toBe(renamed);
      expect((await remote.session.get({ sessionID: session.id })).title).toBe(renamed);
      expect((await client.session.get({ sessionID: session.id })).title).toBe(localTitle);
      await assertOwner(page, session.id, original.activeProfileID);

      const backgroundTitle = "Overview background event received";
      await remote.session.update({ sessionID: session.id, title: backgroundTitle });
      const backgroundRow = taskRow(column, backgroundTitle);
      await expect(backgroundRow).toBeVisible({ timeout: 30_000 });
      await expect(localRow).toBeVisible();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

      const taskURL = page.url();
      await chooseProjectsMenuItem(column, page, "Add project folder…");
      const folderDialog = page.getByRole("dialog", { name: "Add project folder", exact: true });
      await folderDialog.getByRole("combobox", { name: "Server", exact: true }).click();
      await page.getByRole("option", { name: remoteName, exact: true }).click();
      await expect(
        folderDialog.getByRole("button", { name: "Choose local folder…", exact: true }),
      ).toHaveCount(0);
      await folderDialog
        .getByRole("textbox", { name: "Folder path", exact: true })
        .fill(projectDirectory);
      await folderDialog.getByRole("button", { name: "Browse", exact: true }).click();
      await expect(
        folderDialog.getByRole("navigation", { name: "Folder breadcrumbs" }),
      ).toBeVisible();
      await expect(folderDialog.getByText("Loading folders…", { exact: true })).toHaveCount(0);
      await expect(folderDialog.getByRole("alert")).toHaveCount(0);
      const folderBounds = await folderDialog.boundingBox();
      expect(folderBounds!.y).toBeGreaterThanOrEqual(15);
      expect(folderBounds!.y + folderBounds!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height - 15,
      );
      if (visible)
        await page.screenshot({
          path: join(runRoot, "add-project-remote-folder.png"),
          animations: "disabled",
        });
      await folderDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await assertOwner(page, session.id, original.activeProfileID);
      await page.evaluate(() => {
        window.location.hash = "#/settings/providers";
      });
      await page.getByRole("combobox", { name: "Configure server", exact: true }).click();
      await page.getByRole("option", { name: new RegExp(remoteName) }).click();
      await expect(
        page.getByRole("combobox", { name: "Configure server", exact: true }),
      ).toContainText(remoteName);
      expect(
        (
          await page.evaluate(async () =>
            (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
          )
        ).profileID,
      ).toBe(original.activeProfileID);
      if (visible)
        await page.screenshot({
          path: join(runRoot, "settings-independent-server.png"),
          animations: "disabled",
        });
      await page.evaluate((url) => {
        window.location.hash = new URL(url).hash;
      }, taskURL);
      await assertOwner(page, session.id, original.activeProfileID);

      // Copy through the native UI and verify both isolated databases. Never move/delete source.
      const copyText = "This isolated conversation must survive the server copy unchanged.";
      const copySource = await client.experimental.session.import({
        info: {
          ...(await client.session.get({ sessionID: session.id })),
          id: `ses_${crypto.randomUUID()}`,
          title: "Copy across isolated servers",
          parentID: undefined,
        },
        messages: [
          {
            id: `msg_${crypto.randomUUID()}`,
            type: "user",
            text: copyText,
            time: { created: Date.now() },
          },
        ],
        location: { directory: projectDirectory },
      });
      const copyRow = taskRow(column, "Copy across isolated servers");
      await expect(copyRow).toBeVisible({ timeout: 30_000 });
      await copyRow.click();
      await assertOwner(page, copySource.id, original.activeProfileID);
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Copy task to server…", exact: true }).click();
      const copyDialog = page.getByRole("dialog", { name: "Copy task to server", exact: true });
      await copyDialog.getByRole("combobox", { name: "Destination server" }).click();
      await page.getByRole("option", { name: remoteName, exact: true }).click();
      await copyDialog.getByRole("textbox", { name: "Destination folder" }).fill(projectDirectory);
      if (visible)
        await page.screenshot({
          path: join(runRoot, "copy-task-to-server.png"),
          animations: "disabled",
        });
      await copyDialog.getByRole("button", { name: "Copy task", exact: true }).click();
      await expect(copyDialog).toHaveCount(0);
      await assertOwner(page, copySource.id, profileID);
      expect((await client.session.get({ sessionID: copySource.id })).title).toBe(copySource.title);
      expect((await remote.session.get({ sessionID: copySource.id })).title).toBe(copySource.title);
      const copiedTranscript = await remote.experimental.session.export({
        sessionID: copySource.id,
        sanitize: false,
      });
      expect(copiedTranscript.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "user", text: copyText })]),
      );
      await localRow.click();
      await assertOwner(page, session.id, original.activeProfileID);

      await Service.stop({ file });
      started = false;
      await expect(backgroundRow).toBeVisible();
      await expect(column.getByText(`${remoteName} offline`, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await assertOwner(page, session.id, original.activeProfileID);
      await backgroundRow.click({ button: "right" });
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
