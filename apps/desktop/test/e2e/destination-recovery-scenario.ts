import { isLocationNotFoundError } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PalotApi } from "../../src/shared/opencode-contract";
import type { Scenario } from "./scenarios";

const execFileAsync = promisify(execFile);

function runtimeStatus(page: Page) {
  return page.evaluate(async () =>
    (globalThis as unknown as { palot: PalotApi }).palot.runtimeStatus(),
  );
}

function routeOwner(page: Page) {
  const route = new URL(page.url().split("#")[1]!, "http://e2e.invalid");
  return {
    path: route.pathname,
    profileID: route.searchParams.get("profileID"),
    projectID: route.searchParams.get("projectID"),
  };
}

export const destinationRecoveryScenario: Scenario = {
  description:
    "Search a native project/server destination, then recover a genuinely deleted session directory on its original connection",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async prepareProject({ projectDirectory }) {
    // Give OpenCode a real repository identity and a saved canonical checkout,
    // rather than the global project identity of an unborn Git repository.
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Palot E2E",
        "-c",
        "user.email=e2e@palot.invalid",
        "commit",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "Isolated recovery fixture",
      ],
      { cwd: projectDirectory },
    );
  },
  async run() {},
  async assert(page, { client, projectDirectory, runRoot, llm, visible }) {
    const original = await runtimeStatus(page);
    expect(original.connected).toBe(true);
    const profiles = await page.evaluate(async () =>
      (globalThis as unknown as { palot: PalotApi }).palot.listOpenCodeProfiles(),
    );
    const profile = profiles.profiles.find((entry) => entry.id === original.profileID)!;
    const canonical = await client.location.get({ location: { directory: projectDirectory } });
    expect(canonical.project.canonical).toBe(projectDirectory);

    // Exercise the actual searchable destination picker before introducing a
    // missing directory. Nothing is sent to a model by selecting a destination.
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const main = page.getByRole("main", { name: "New task", exact: true });
    const picker = main.getByRole("combobox", { name: "Task destination", exact: true });
    await expect(picker).toBeVisible();
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search destinations", exact: true });
    await search.fill(projectDirectory);
    const destination = page
      .getByRole("option")
      .filter({ hasText: projectDirectory })
      .filter({ hasText: profile.name });
    await expect(destination).toBeVisible();
    await expect(destination).toContainText(projectDirectory);
    await expect(destination).toContainText(profile.name);
    await destination.click();
    await expect
      .poll(() => routeOwner(page))
      .toEqual({ path: "/new", profileID: original.profileID, projectID: canonical.project.id });
    await expect(picker).toContainText(profile.name);

    // This is the only folder this scenario removes. mkdtemp creates a new empty
    // child of the fixture repository; nonrecursive rmdir refuses unexpected
    // contents and cannot remove the canonical checkout or any ancestor.
    const temporaryDirectory = await mkdtemp(join(projectDirectory, "recovery-checkout-"));
    const task = await client.session.create({
      title: "Isolated missing workspace recovery",
      location: { directory: temporaryDirectory },
    });
    expect(task.projectID).toBe(canonical.project.id);
    expect(task.location.directory).toBe(temporaryDirectory);
    await rmdir(temporaryDirectory);
    // Drop the isolated server's location-service cache through its published
    // API so the next mount probes the actual filesystem, not a warmed context.
    await client.location.reload();
    let missingError: unknown;
    try {
      await client.location.get({ location: { directory: temporaryDirectory } });
    } catch (error) {
      missingError = error;
    }
    expect(
      isLocationNotFoundError(missingError),
      "The real service must return the published missing-location error, not a network or generic 404 error",
    ).toBe(true);
    if (!isLocationNotFoundError(missingError))
      throw new Error("Expected a typed LocationNotFoundError");
    expect(missingError.location.directory).toBe(temporaryDirectory);
    await expect
      .poll(() => runtimeStatus(page))
      .toMatchObject({
        connectionID: original.connectionID,
        profileID: original.profileID,
        connected: true,
      });

    await page.evaluate(
      ({ sessionID, profileID }) => {
        location.hash = `#/sessions/${encodeURIComponent(sessionID)}?profileID=${encodeURIComponent(profileID)}`;
      },
      { sessionID: task.id, profileID: original.profileID },
    );
    const recovery = page.getByRole("region", { name: "Missing workspace", exact: true });
    await expect(recovery).toBeVisible({ timeout: 30_000 });
    await expect(recovery).toContainText(temporaryDirectory);
    const directoryInput = recovery.getByRole("combobox", {
      name: "Existing directory",
      exact: true,
    });
    const useDirectory = recovery.getByRole("button", { name: "Use directory", exact: true });
    await expect(useDirectory).toBeDisabled();

    // A failed real directory probe must leave a usable form and preserve the
    // existing task location, rather than silently choosing the local fallback.
    await directoryInput.fill(join(projectDirectory, `never-created-${crypto.randomUUID()}`));
    await useDirectory.click();
    await expect(recovery.getByRole("alert")).toBeVisible();
    await expect(directoryInput).toBeEnabled();
    await expect(useDirectory).toBeEnabled();
    expect((await client.session.get({ sessionID: task.id })).location.directory).toBe(
      temporaryDirectory,
    );
    await expect
      .poll(() => runtimeStatus(page))
      .toMatchObject({
        connectionID: original.connectionID,
        profileID: original.profileID,
        connected: true,
      });
    if (visible) {
      await page.setViewportSize({ width: 920, height: 640 });
      await page.screenshot({
        path: join(runRoot, "missing-workspace-920x640.png"),
        animations: "disabled",
      });
    }

    await directoryInput.fill(canonical.project.canonical);
    await useDirectory.click();
    await expect
      .poll(async () => (await client.session.get({ sessionID: task.id })).location.directory)
      .toBe(projectDirectory);
    await expect(recovery).toBeHidden();
    const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
    await expect(composer).toBeVisible();
    await expect(composer).toBeEditable();
    await composer.fill("Unsent draft after recovering the original connection");
    await expect(composer).toHaveValue("Unsent draft after recovering the original connection");
    const restored = await runtimeStatus(page);
    expect(restored).toMatchObject({
      connectionID: original.connectionID,
      profileID: original.profileID,
      connected: true,
    });
    await expect
      .poll(() => routeOwner(page))
      .toMatchObject({ path: `/sessions/${task.id}`, profileID: original.profileID });
    const moved = await client.session.get({ sessionID: task.id });
    expect(moved.projectID).toBe(canonical.project.id);
    if (visible)
      await page.screenshot({
        path: join(runRoot, "recovered-workspace-920x640.png"),
        animations: "disabled",
      });
    expect(llm.requests).toHaveLength(0);
    await writeFile(
      join(runRoot, "destination-recovery.json"),
      JSON.stringify(
        {
          sessionID: task.id,
          profileID: original.profileID,
          connectionID: original.connectionID,
          typedMissingError: {
            _tag: missingError._tag,
            directory: missingError.location.directory,
          },
          canonical: canonical.project.canonical,
          recoveredDirectory: moved.location.directory,
          ownerPreserved:
            restored.connectionID === original.connectionID &&
            restored.profileID === original.profileID,
          modelCalls: llm.requests.length,
        },
        null,
        2,
      ),
    );
  },
};
