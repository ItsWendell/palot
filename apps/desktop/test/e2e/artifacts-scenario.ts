import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "Publish the coverage summary as an artifact.";
const TITLE = "Coverage summary";

function files(version: number) {
  return {
    "index.html": `<!doctype html><meta charset="utf-8"><title>Coverage v${version}</title><link rel="stylesheet" href="style.css"><main><h1>Coverage v${version}</h1><p>Lines covered: ${version === 1 ? "82" : "91"}%</p></main><script src="app.js"></script>`,
    "style.css":
      "body{margin:0;font:16px system-ui;background:#f1f5f9;color:#172033}main{padding:32px}h1{color:rgb(0, 128, 0)}",
    "app.js": "document.body.dataset.script = 'ran';",
  };
}

async function captureWindow(page: Page, file: string) {
  // Surface captures can misplace embedded Electron guests; capture the composited viewport.
  const capture = await page.context().newCDPSession(page);
  try {
    const { data } = await capture.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: false,
      captureBeyondViewport: false,
    });
    await writeFile(file, Buffer.from(data, "base64"));
  } finally {
    await capture.detach();
  }
}

async function enableBrowser(page: Page, sessionID: string) {
  await page.evaluate(() => {
    location.hash = "#/settings/browser";
  });
  await page.getByRole("switch", { name: "Enable experimental browser" }).check();
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      palot: { onBrowserEvent(listener: (event: { type: string; state?: unknown }) => void): void };
      __browserAttached?: boolean;
    };
    target.palot.onBrowserEvent((event) => {
      if (event.type === "state" && event.state) target.__browserAttached = true;
    });
  });
  await page.evaluate((id) => {
    location.hash = `#/sessions/${id}`;
  }, sessionID);
  await page.getByLabel("Current task").waitFor();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __browserAttached?: boolean }).__browserAttached,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

type ArtifactPage = {
  origin: string;
  heading: string | undefined;
  color: string | undefined;
  script: string | undefined;
  bridge: string;
  node: string;
  asset: number | string;
  api: number | string;
  other: number | string;
};

async function inspectArtifact(page: Page, otherURL: string): Promise<ArtifactPage> {
  const guest = page.locator('webview[data-browser-visible="true"]');
  await expect(guest).toHaveCount(1);
  return guest.evaluate(
    (element, other) =>
      (element as Electron.WebviewTag).executeJavaScript(`(async () => {
        const status = (url) => fetch(url).then((response) => response.status, () => "blocked");
        const heading = document.querySelector("h1");
        return {
          origin,
          heading: heading?.textContent,
          color: heading ? getComputedStyle(heading).color : undefined,
          script: document.body.dataset.script,
          bridge: typeof globalThis.palot,
          node: typeof globalThis.require,
          asset: await status(new URL("app.js", location.href).href),
          api: await status(new URL("/api/session", location.href).href),
          other: await status(new URL(${JSON.stringify(other)}, location.href).href),
        };
      })()`),
    otherURL,
  );
}

/**
 * OpenCode's opt-in artifacts (2.2.4+): the agent publishes through Code Mode, the transcript
 * shows a card instead of a tool row, Open shows the served page in the task's Palot Browser,
 * and a later update refreshes the earlier card and the open page.
 */
export const artifactsScenario: Scenario = {
  description:
    "publish an OpenCode artifact through Code Mode, open it in the task browser, and follow an update",
  prompt: PROMPT,
  expectedModelCalls: 2,
  openCodeConfig: { experimental: { artifacts: true } },
  arrange(llm) {
    llm.tool("execute", {
      code: `return await tools.opencode.artifact_create(${JSON.stringify({ title: TITLE, files: files(1) })});`,
    });
    llm.text("Published the coverage summary.");
  },
  async run(page, { client, session }) {
    await enableBrowser(page, session.id);
    await client.session.prompt({ sessionID: session.id, text: PROMPT });
    await client.experimental.session.wait({ sessionID: session.id });
  },
  async assert(page, { client, session, llm, runRoot }) {
    const location = { directory: session.location.directory };
    const listed = await client.experimental.artifacts.list({ sessionID: session.id, location });
    expect(listed.data).toHaveLength(1);
    const published = listed.data[0]!;
    expect(published).toMatchObject({ title: TITLE, provider: "local", entry: "index.html" });
    // Not opened from the transcript, so the task browser gets no credential for it.
    const other = await client.experimental.artifacts.create({
      title: "Unopened",
      files: { "index.html": "<h1>private</h1>" },
      location,
    });

    const card = page.getByRole("group", { name: `Artifact: ${TITLE}` });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Published · HTML · updated");
    await expect(page.getByRole("button", { name: /Orchestrated/ })).toHaveCount(0);
    await card.screenshot({ path: join(runRoot, "artifact-card.png") });

    await card.getByRole("button", { name: `Open ${TITLE} in Palot Browser` }).click();
    await expect(page.getByRole("tab", { name: "Coverage v1" })).toBeVisible();
    const address = page.getByRole("textbox", { name: "Browser address" });
    await expect(address).toHaveValue(/^127\.0\.0\.1:\d+$/);
    await expect
      .poll(async () => (await inspectArtifact(page, other.data.url)).heading)
      .toBe("Coverage v1");
    const first = await inspectArtifact(page, other.data.url);
    await writeFile(join(runRoot, "artifact-page.json"), JSON.stringify(first, null, 2));
    expect(first).toMatchObject({
      // Served with `sandbox allow-scripts`: scripts run in an opaque origin.
      origin: "null",
      color: "rgb(0, 128, 0)",
      script: "ran",
      bridge: "undefined",
      node: "undefined",
      asset: 200,
    });
    // The credential reaches only this artifact's own files.
    expect(first.api).not.toBe(200);
    expect(first.other).not.toBe(200);
    await captureWindow(page, join(runRoot, "artifact-browser.png"));

    llm.tool("execute", {
      code: `return await tools.opencode.artifact_update(${JSON.stringify({ id: published.id, title: `${TITLE} v2`, files: files(2) })});`,
    });
    llm.text("Updated the coverage summary.");
    await client.session.prompt({ sessionID: session.id, text: "Update it with the new numbers." });
    await client.experimental.session.wait({ sessionID: session.id });
    await llm.waitForCalls(4);

    // The earlier card follows the update; the new one says what changed.
    const cards = page.getByRole("group", { name: `Artifact: ${TITLE} v2` });
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Published · HTML");
    await expect(cards.last()).toContainText("Updated · HTML");
    await expect(page.locator("webview")).toHaveCount(1);

    // Open again reuses the artifact's tab and reloads its entry.
    await cards
      .first()
      .getByRole("button", { name: /^Open / })
      .click();
    await expect(page.getByRole("tab", { name: "Coverage v2" })).toBeVisible();
    await expect(page.locator("webview")).toHaveCount(1);
    await expect
      .poll(async () => (await inspectArtifact(page, other.data.url)).heading)
      .toBe("Coverage v2");
    await captureWindow(page, join(runRoot, "artifact-updated.png"));
  },
};
