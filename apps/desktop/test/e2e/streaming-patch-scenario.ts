import type { OpenCodeClient } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const PROMPT = "Apply the scripted large multi-file patch exactly, preserving every line.";
const COMPLETE = "STREAMING_PATCH_COMPLETE";
const PATCH_MODEL = { providerID: "test", id: "gpt-5-streaming-patch" };
const FIRST_MARKER = "PATCH_FIRST_MARKER";
const OLD_LINE = 'export const previous = "PATCH_OLD_CONTENT";';
const LONG_LINE = `PATCH_LONG_LINE_START_${"0123456789abcdef".repeat(180)}_PATCH_LONG_LINE_END`;
const FILES = ["streaming-patch-alpha.ts", "streaming-patch-beta.py"].map((name, file) => ({
  name,
  lines: Array.from({ length: 1_200 }, (_, line) => {
    if (file === 0 && line === 0) return `// ${FIRST_MARKER}`;
    if (file === 0 && line === 1) return `// ${LONG_LINE}`;
    const value = `PATCH_${file === 0 ? "ALPHA" : "BETA"}_${String(line + 1).padStart(4, "0")} retained content`;
    return file === 0
      ? `export const line${line + 1} = "${value}";`
      : `line_${line + 1} = "${value}"`;
  }),
}));
const PATCH_TEXT = [
  "*** Begin Patch",
  ...FILES.flatMap((file, index) => [
    `*** ${index === 0 ? "Update" : "Add"} File: ${file.name}`,
    ...(index === 0 ? ["@@", `-${OLD_LINE}`] : []),
    ...file.lines.map((line) => `+${line}`),
  ]),
  "*** End Patch",
].join("\n");
const INPUT = JSON.stringify({ patchText: PATCH_TEXT });
const PATCH_LINE_COUNT = PATCH_TEXT.split("\n").length;
// About 10.5 seconds of real argument deltas. Boundaries intentionally split
// lines and JSON escapes, like a provider's token stream, not complete inputs.
const CHUNK_SIZE = Math.ceil(INPUT.length / 300);
const INPUT_CHUNKS = Array.from({ length: Math.ceil(INPUT.length / CHUNK_SIZE) }, (_, index) =>
  INPUT.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
);

export const streamingPatchScenario: Scenario = {
  description:
    "verify full finalized patch history; additionally verify live streaming when native input deltas are available",
  prompt: PROMPT,
  expectedModelCalls: 2,
  async prepare(home) {
    // beta-19151's official patch plugin only exposes patch to gpt-* models
    // excluding gpt-4 and oss. The ordinary test-model only gets edit/write.
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        providers: {
          test: {
            models: {
              [PATCH_MODEL.id]: {
                name: "Streaming Patch Test Model",
                limit: { context: 100_000, output: 30_000 },
              },
            },
          },
        },
      }),
      { mode: 0o600 },
    );
  },
  arrange(llm) {
    llm.toolInputChunks("patch", INPUT_CHUNKS, 35);
    llm.text(COMPLETE);
  },
  async run(page, { client, session, llm, runRoot, projectDirectory }) {
    const snapshots: Array<{ phase: string; state: Awaited<ReturnType<typeof patchViewport>> }> =
      [];
    const native = observeNativePatchInput(client, session.id);
    let liveAssertions: "not-run" | "running" | "passed" | "unavailable" | "failed" = "not-run";
    let finalizedAssertions: "not-run" | "running" | "passed" | "failed" = "not-run";
    let capabilityGap: string | null = null;
    let presentation: unknown = null;
    try {
      await startStreamProbe(page);
      await expect
        .poll(() => {
          native.check();
          return native.state.connected;
        })
        .toBe(true);
      await client.session.switchModel({ sessionID: session.id, model: PATCH_MODEL });
      await writeFile(join(projectDirectory, FILES[0]!.name), `${OLD_LINE}\n`);
      await client.session.prompt({ sessionID: session.id, text: PROMPT });
      await llm.waitForCalls(1);
      const request = llm.requests.find((entry) => JSON.stringify(entry.body).includes(PROMPT));
      const tools = request?.body.tools as Array<{ function?: { name?: string }; name?: string }>;
      expect(tools.map((tool) => tool.function?.name ?? tool.name)).toContain("patch");
      await expect
        .poll(
          () => {
            native.check();
            return native.state.deltaCount > 0 || native.state.endedCount > 0;
          },
          { timeout: 25_000 },
        )
        .toBe(true);

      const viewer = page.locator("[data-palot-streaming-patch]");
      const contents = fileContents(viewer, 0);
      const generating = page.getByText("Generating patch", { exact: false }).first();

      if (native.state.deltaCount > 0) {
        liveAssertions = "running";
        // No expansion clicks: argument streaming must open the viewer itself.
        await expect(viewer).toBeVisible();
        await expect(contents).toBeVisible();
        await expect(generating).toBeVisible();
        await expect(
          viewer.getByRole("button", { name: "Copy full patch", exact: true }),
        ).toBeEnabled();
        await expect
          .poll(async () => (await patchViewport(contents)).lastVisibleLine, { timeout: 8_000 })
          .toBeGreaterThan(240);
        const following = await patchViewport(contents);
        expect(following.renderedRows).toBeLessThan(150);
        expect(following.firstRenderedLine).toBeGreaterThan(1);
        expect(following.distanceFromBottom).toBeLessThan(80);
        expect(llm.scriptedCalls()).toBe(1);
        await expect(generating).toBeVisible();
        snapshots.push({ phase: "following-beyond-old-cap", state: following });
        await page.screenshot({ path: join(runRoot, "streaming-patch-following.png") });

        await contents.evaluate((element) => {
          element.scrollTop = 0;
        });
        const first = codeRow(contents, FILES[0]!.lines[0]!);
        const longLine = codeRow(contents, FILES[0]!.lines[1]!);
        await expect(first).toContainText(FIRST_MARKER);
        await expect(first).toBeVisible();
        await expect(codeRow(contents, OLD_LINE, "-").locator("[data-patch-code]")).toHaveText(
          OLD_LINE,
        );
        await assertCleanCode(viewer);
        await expect(longLine).toContainText(LONG_LINE);
        await expect(longLine).toBeVisible();
        const ordinaryLineHeight = await contents
          .locator(`[data-patch-line="${sourceLine(FILES[0]!.lines[2]!)}"]`)
          .evaluate((element) => element.getBoundingClientRect().height);
        expect(
          await longLine.evaluate((element) => element.getBoundingClientRect().height),
        ).toBeLessThanOrEqual(ordinaryLineHeight + 1);
        const scrolledUp = await patchViewport(contents);
        expect(scrolledUp.scrollTop).toBeLessThanOrEqual(2);
        expect(scrolledUp.renderedRows).toBeLessThan(150);
        expect(scrolledUp.scrollWidth).toBeGreaterThan(scrolledUp.clientWidth + 2_000);
        await contents.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        expect(await contents.evaluate((element) => element.scrollLeft)).toBeGreaterThan(2_000);
        const horizontalOffset = await contents.evaluate((element) => element.scrollLeft);
        const follow = fileSection(viewer, 0).getByRole("button", {
          name: "Follow changes",
          exact: true,
        });
        await expect(follow).toBeVisible();

        // Observe actual new UI input, not just elapsed time or network emissions.
        // The historical rows must stay in place as the virtual canvas grows.
        await expect
          .poll(async () => (await patchViewport(contents)).scrollHeight, { timeout: 5_000 })
          .toBeGreaterThan(scrolledUp.scrollHeight + 2_000);
        const held = await patchViewport(contents);
        expect(await contents.evaluate((element) => element.scrollLeft)).toBe(horizontalOffset);
        expect(held.scrollTop).toBeLessThanOrEqual(2);
        expect(held.renderedRows).toBeLessThan(150);
        await expect(first).toContainText(FIRST_MARKER);
        await expect(generating).toBeVisible();
        expect(llm.scriptedCalls()).toBe(1);
        snapshots.push({ phase: "history-held-during-new-input", state: held });
        await page.screenshot({ path: join(runRoot, "streaming-patch-history.png") });

        await follow.click();
        await expect
          .poll(async () => (await patchViewport(contents)).distanceFromBottom)
          .toBeLessThan(80);
        const secondContents = fileContents(viewer, 1);
        await expect(secondContents).toBeVisible();
        await expect
          .poll(async () => (await patchViewport(secondContents)).lastVisibleLine, {
            timeout: 8_000,
          })
          .toBeGreaterThan(1_600);
        const resumed = await patchViewport(secondContents);
        expect(resumed.renderedRows).toBeLessThan(150);
        expect(resumed.firstRenderedLine).toBeGreaterThan(1_200);
        expect(resumed.distanceFromBottom).toBeLessThan(80);
        await expect(follow).toBeHidden();
        await expect(generating).toBeVisible();
        expect(llm.scriptedCalls()).toBe(1);
        snapshots.push({ phase: "following-resumed-second-file", state: resumed });
        await page.screenshot({ path: join(runRoot, "streaming-patch-resumed.png") });
        liveAssertions = "passed";
      } else {
        liveAssertions = "unavailable";
        capabilityGap =
          "The native API emitted tool.input.started and tool.input.ended without tool.input.delta. Live auto-opening, progressive rendering, and scroll retention during incoming input were not verified. This run verifies only the finalized patch viewer.";
        console.log(`Palot streaming-patch: LIVE ASSERTIONS UNAVAILABLE. ${capabilityGap}`);
      }

      finalizedAssertions = "running";
      await client.session.wait({ sessionID: session.id });
      await expect(page.getByText(COMPLETE, { exact: true })).toBeVisible();
      await expect
        .poll(() => {
          native.check();
          return native.state.endedCount;
        })
        .toBe(1);
      expect(native.state.startedCount).toBe(1);
      expect(native.state.endedInputMatches).toBe(true);
      for (const file of FILES) {
        expect(await readFile(join(projectDirectory, file.name), "utf8")).toBe(
          `${file.lines.join("\n")}\n`,
        );
      }
      await openFinalizedPatch(page);
      await expect(viewer.locator("section[data-patch-file]")).toHaveCount(2);
      await expect(
        viewer.getByRole("button", { name: "Copy full patch", exact: true }),
      ).toBeEnabled();
      const finalTop = await assertFinalizedHistory(viewer);
      await assertSyntaxHighlighting(contents);
      snapshots.push({ phase: "finalized-history", state: finalTop });
      await page.screenshot({ path: join(runRoot, "streaming-patch-finalized-history.png") });
      for (let file = 0; file < FILES.length; file += 1) {
        await fileSection(viewer, file)
          .getByRole("button", { name: "Follow changes", exact: true })
          .click();
        await assertFinalizedBottom(fileContents(viewer, file), file);
      }
      snapshots.push({
        phase: "finalized-bottom",
        state: await patchViewport(fileContents(viewer, 1)),
      });
      await page.screenshot({ path: join(runRoot, "streaming-patch-finalized.png") });
      presentation = await captureFinalizedPresentation(page, viewer, contents, runRoot);
      native.check();
      finalizedAssertions = "passed";
      console.log(
        `Palot streaming-patch: finalized viewer and exact filesystem contents passed; live assertions: ${liveAssertions}; native input deltas: ${native.state.deltaCount}.`,
      );
    } catch (error) {
      if (liveAssertions === "running") liveAssertions = "failed";
      if (finalizedAssertions === "running") finalizedAssertions = "failed";
      throw error;
    } finally {
      await native.stop();
      const probe = await stopStreamProbe(page);
      await writeFile(
        join(runRoot, "streaming-patch-emissions.json"),
        JSON.stringify(llm.emissions, null, 2),
        { mode: 0o600 },
      );
      await writeFile(
        join(runRoot, "streaming-patch-probe.json"),
        JSON.stringify(
          {
            scenario: "streaming-patch",
            verificationMode:
              native.state.deltaCount > 0
                ? "native-live-and-finalized"
                : native.state.endedCount > 0
                  ? "finalized-only"
                  : "undetermined",
            liveAssertions,
            finalizedAssertions,
            capabilityGap,
            nativeEvents: native.state,
            presentation,
            note: "Correctness probe, not a benchmark: includes Playwright assertions and screenshots. Hidden-window frame sampling is skipped.",
            patchLines: PATCH_LINE_COUNT,
            longestLineCharacters: LONG_LINE.length,
            chunks: INPUT_CHUNKS.length,
            chunkDelayMs: 35,
            snapshots,
            probe,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
  },
  async assert(page) {
    await expect(page.getByText(COMPLETE, { exact: true })).toBeVisible();
    const viewer = page.locator("[data-palot-streaming-patch]");
    for (let file = 0; file < FILES.length; file += 1) {
      await assertFinalizedBottom(fileContents(viewer, file), file);
    }
  },
};

function observeNativePatchInput(client: OpenCodeClient, sessionID: string) {
  const controller = new AbortController();
  const state = {
    connected: false,
    startedCount: 0,
    deltaCount: 0,
    endedCount: 0,
    endedInputMatches: false,
    error: null as string | null,
  };
  let patchID: string | null = null;
  const subscription = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: controller.signal })) {
        if (event.type === "server.connected") state.connected = true;
        if (
          event.type === "session.tool.input.started" &&
          event.data.sessionID === sessionID &&
          event.data.name === "patch"
        ) {
          patchID = event.data.id;
          state.startedCount += 1;
        }
        if (
          event.type === "session.tool.input.delta" &&
          event.data.sessionID === sessionID &&
          event.data.id === patchID
        ) {
          state.deltaCount += 1;
        }
        if (
          event.type === "session.tool.input.ended" &&
          event.data.sessionID === sessionID &&
          event.data.id === patchID
        ) {
          state.endedCount += 1;
          state.endedInputMatches = event.data.text === INPUT;
        }
      }
      if (!controller.signal.aborted) state.error = "Native event subscription ended unexpectedly";
    } catch (error) {
      if (!controller.signal.aborted) state.error = String(error);
    }
  })();
  return {
    state,
    check() {
      if (state.error) throw new Error(state.error);
    },
    async stop() {
      controller.abort();
      await subscription;
    },
  };
}

async function openFinalizedPatch(page: Page) {
  // Completed turn/group disclosures can hide the tool before its own disclosure.
  await expect
    .poll(
      async () => {
        for (const selector of ["[data-palot-turn-activity]", "[data-palot-activity-group]"]) {
          const collapsed = page.locator(`${selector} > button[aria-expanded="false"]`);
          for (const trigger of await collapsed.all()) {
            if (await trigger.isVisible()) await trigger.click();
          }
        }
        const tool = page.locator('[data-palot-tool-name="patch"]');
        if (!(await tool.isVisible())) return false;
        const trigger = tool.locator(':scope > button[aria-expanded="false"]');
        // The title contains file links; a center click opens a file instead.
        if (await trigger.isVisible()) await trigger.press("Enter");
        return page.locator("[data-palot-streaming-patch]").isVisible();
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const viewer = page.locator("[data-palot-streaming-patch]");
  const showPatch = viewer.getByRole("button", { name: "Show proposed changes", exact: true });
  if (await showPatch.isVisible()) await showPatch.click();
  await expect(fileContents(viewer, 0)).toBeVisible();
  await viewer.scrollIntoViewIfNeeded();
}

function fileSection(viewer: Locator, file: number) {
  return viewer.locator(`section[data-patch-file="${FILES[file]!.name}"]`);
}

function fileContents(viewer: Locator, file: number) {
  return fileSection(viewer, file).getByRole("region", {
    name: `Proposed changes for ${FILES[file]!.name}`,
    exact: true,
  });
}

function sourceLine(code: string, prefix = "+") {
  const index = PATCH_TEXT.split("\n").indexOf(`${prefix}${code}`);
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

function codeRow(contents: Locator, code: string, prefix = "+") {
  return contents.locator(`[data-patch-line="${sourceLine(code, prefix)}"]`);
}

async function assertCleanCode(viewer: Locator) {
  await expect(viewer.locator("[data-patch-code]").first()).toBeAttached();
  const code = await viewer.locator("[data-patch-code]").allTextContents();
  expect(code.every((line) => !/^[+-]|\*\*\* (Begin|End|Add|Update)/.test(line))).toBe(true);
  expect(await viewer.textContent()).not.toMatch(/\*\*\* (Begin|End|Add|Update)/);
  for (const hunk of await viewer.locator("[data-patch-hunk]").allTextContents()) {
    expect(hunk).not.toContain("@@");
  }
  expect(await viewer.locator("[data-patch-line]").count()).toBeLessThan(150);
}

async function assertFinalizedHistory(viewer: Locator) {
  for (let file = 0; file < FILES.length; file += 1) {
    const fixture = FILES[file]!;
    const section = fileSection(viewer, file);
    const contents = fileContents(viewer, file);
    await expect(section).toContainText(fixture.name);
    await expect(section).toContainText("+1200");
    if (file === 0) await expect(section).toContainText("−1");
    await contents.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await assertFinalizedBottom(contents, file);
    await assertCleanCode(viewer);
    await contents.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await expect(codeRow(contents, fixture.lines[600]!).locator("[data-patch-code]")).toHaveText(
      fixture.lines[600]!,
    );
    await assertCleanCode(viewer);
    await contents.evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await expect(codeRow(contents, fixture.lines[0]!).locator("[data-patch-code]")).toHaveText(
      fixture.lines[0]!,
    );
    await expect(codeRow(contents, fixture.lines[0]!)).toHaveAttribute(
      "data-patch-kind",
      "addition",
    );
    await expect(
      section.getByRole("button", { name: "Follow changes", exact: true }),
    ).toBeVisible();
  }
  const contents = fileContents(viewer, 0);
  const deleted = codeRow(contents, OLD_LINE, "-");
  await expect(deleted).toHaveAttribute("data-patch-kind", "deletion");
  await expect(deleted.locator("[data-patch-code]")).toHaveText(OLD_LINE);
  await assertCleanCode(viewer);
  const longLine = codeRow(contents, FILES[0]!.lines[1]!);
  await expect(longLine).toContainText(LONG_LINE);
  await expect(longLine).toBeVisible();
  const ordinaryHeight = await contents
    .locator(`[data-patch-line="${sourceLine(FILES[0]!.lines[2]!)}"]`)
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(
    await longLine.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(ordinaryHeight + 1);
  const state = await patchViewport(contents);
  expect(state.firstRenderedLine).toBe(sourceLine(OLD_LINE, "-"));
  expect(state.renderedRows).toBeLessThan(150);
  expect(state.scrollTop).toBeLessThanOrEqual(2);
  expect(state.scrollWidth).toBeGreaterThan(state.clientWidth + 2_000);
  await contents.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await contents.evaluate((element) => element.scrollLeft)).toBeGreaterThan(2_000);
  const horizontalOffset = await contents.evaluate((element) => element.scrollLeft);
  await contents.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(codeRow(contents, FILES[0]!.lines[600]!)).toBeAttached();
  expect(await contents.evaluate((element) => element.scrollLeft)).toBe(horizontalOffset);
  await contents.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(codeRow(contents, FILES[0]!.lines[0]!)).toBeAttached();
  const second = fileContents(viewer, 1);
  await second.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  await expect(codeRow(second, FILES[1]!.lines[600]!)).toBeAttached();
  expect(await contents.evaluate((element) => element.scrollLeft)).toBe(horizontalOffset);
  expect((await patchViewport(contents)).scrollTop).toBeLessThanOrEqual(2);
  await second.evaluate((element) => {
    element.scrollTop = 0;
  });
  await contents.evaluate((element) => {
    element.scrollLeft = 0;
  });
  return state;
}

async function assertFinalizedBottom(contents: Locator, file: number) {
  const lastCode = FILES[file]!.lines.at(-1)!;
  await expect(codeRow(contents, lastCode).locator("[data-patch-code]")).toHaveText(lastCode);
  await expect
    .poll(async () => (await patchViewport(contents)).lastVisibleLine)
    .toBe(sourceLine(lastCode));
  await assertSyntaxHighlighting(contents);
  const state = await patchViewport(contents);
  expect(state.renderedRows).toBeLessThan(75);
  expect(state.firstRenderedLine).toBeGreaterThan(sourceLine(lastCode) - 75);
  expect(state.distanceFromBottom).toBeLessThan(2);
}

async function assertSyntaxHighlighting(contents: Locator) {
  // Syntax must survive the change tint, rather than painting all code green.
  await expect.poll(async () => (await syntaxColors(contents)).length).toBeGreaterThan(1);
}

function syntaxColors(contents: Locator) {
  return contents.evaluate((element) => {
    return [
      ...new Set(
        Array.from(element.querySelectorAll<HTMLElement>("[data-patch-token]"))
          .filter((token) => token.textContent?.trim())
          .map((token) => getComputedStyle(token).color),
      ),
    ].sort();
  });
}

type AppearanceBridge = {
  appearancePreferences: Record<string, unknown>;
  updateAppearance(input: {
    preferences: Record<string, unknown>;
    resolvedScheme: "light" | "dark";
  }): Promise<unknown>;
};

async function captureFinalizedPresentation(
  page: Page,
  viewer: Locator,
  contents: Locator,
  runRoot: string,
) {
  const previousViewport = page.viewportSize();
  const previous = await page.evaluate(() => {
    const palot = (globalThis as unknown as { palot: AppearanceBridge }).palot;
    return {
      preferences: palot.appearancePreferences,
      resolvedScheme:
        document.documentElement.dataset.resolvedTheme === "dark"
          ? ("dark" as const)
          : ("light" as const),
    };
  });
  try {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.evaluate(async (preferences) => {
      await (globalThis as unknown as { palot: AppearanceBridge }).palot.updateAppearance({
        preferences: { ...preferences, mode: "dark", darkContrast: 100 },
        resolvedScheme: "dark",
      });
    }, previous.preferences);
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "dark");
    const transcript = page.getByRole("region", { name: "Task transcript", exact: true });
    await transcript.press("Home");
    await expect(transcript).toHaveAttribute("data-bottom-locked", "false");
    await viewer.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await resetFileScrolls(viewer, "top");
    await assertSyntaxHighlighting(contents);
    await page.screenshot({ path: join(runRoot, "streaming-patch-finalized-dark.png") });
    await page.setViewportSize({ width: 920, height: 640 });
    await viewer.scrollIntoViewIfNeeded();
    await resetFileScrolls(viewer, "top");
    await assertSyntaxHighlighting(contents);
    await transcript.press("Home");
    await expect(transcript).toHaveAttribute("data-bottom-locked", "false");
    await viewer.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect.poll(async () => (await viewer.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    const bounds = await viewer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(921);
    await page.screenshot({
      path: join(runRoot, "streaming-patch-finalized-narrow-dark-contrast.png"),
    });
    const darkColors = await syntaxColors(contents);
    await assertAppliedDiffColor(viewer, contents);
    await resetFileScrolls(viewer, "top");
    await page.evaluate(async (preferences) => {
      await (globalThis as unknown as { palot: AppearanceBridge }).palot.updateAppearance({
        preferences: { ...preferences, mode: "light" },
        resolvedScheme: "light",
      });
    }, previous.preferences);
    await expect(page.locator("html")).toHaveAttribute("data-resolved-theme", "light");
    await assertSyntaxHighlighting(contents);
    await expect.poll(() => syntaxColors(contents)).not.toEqual(darkColors);
    await page.screenshot({ path: join(runRoot, "streaming-patch-finalized-narrow-light.png") });
    await assertAppliedDiffColor(viewer, contents);
    await resetFileScrolls(viewer, "top");
    await page.setViewportSize({ width: 1280, height: 1100 });
    await viewer.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await assertSyntaxHighlighting(contents);
    await page.screenshot({ path: join(runRoot, "streaming-patch-finalized-wide-light.png") });
    return {
      appearances: ["dark", "light"],
      viewports: [
        { width: 920, height: 640 },
        { width: 1280, height: 1100 },
      ],
      darkThemeContrast: 100,
      note: "Palot theme contrast preference, not a claim about OS high-contrast settings.",
      state: await patchViewport(contents),
    };
  } finally {
    await page.evaluate(async (input) => {
      await (globalThis as unknown as { palot: AppearanceBridge }).palot.updateAppearance(input);
    }, previous);
    if (previousViewport) await page.setViewportSize(previousViewport);
    await resetFileScrolls(viewer, "bottom");
    for (let file = 0; file < FILES.length; file += 1) {
      await assertFinalizedBottom(fileContents(viewer, file), file);
    }
  }
}

async function assertAppliedDiffColor(viewer: Locator, contents: Locator) {
  const keywordColor = await contents
    .locator("[data-patch-token]")
    .filter({ hasText: /^export\s*$/ })
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  await viewer.getByRole("button", { name: "Show applied diff", exact: true }).click();
  try {
    // Word-diff emphasis adds wrapper spans. Compare the syntax token itself,
    // not an ancestor that happens to have the same textContent.
    const diffKeyword = viewer
      .locator("diffs-container")
      .first()
      .locator("span:not(:has(span))")
      .filter({ hasText: /^export\s*$/ })
      .first();
    await expect(diffKeyword).toBeAttached();
    await expect
      .poll(() => diffKeyword.evaluate((element) => getComputedStyle(element).color))
      .toBe(keywordColor);
  } finally {
    await viewer.getByRole("button", { name: "Show proposed changes", exact: true }).click();
  }
}

async function resetFileScrolls(viewer: Locator, position: "top" | "bottom") {
  for (let file = 0; file < FILES.length; file += 1) {
    const contents = fileContents(viewer, file);
    await contents.evaluate((element, position) => {
      element.scrollTop = position === "top" ? 0 : element.scrollHeight;
      element.scrollLeft = 0;
    }, position);
    const code = position === "top" ? FILES[file]!.lines[0]! : FILES[file]!.lines.at(-1)!;
    await expect(codeRow(contents, code)).toBeAttached();
  }
}

function patchViewport(contents: Locator) {
  return contents.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    const rows = Array.from(element.querySelectorAll<HTMLElement>("[data-patch-line]"));
    const visibleRows = rows.filter((row) => {
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    });
    return {
      renderedRows: rows.length,
      firstRenderedLine: Number(rows[0]?.dataset.patchLine ?? 0),
      lastVisibleLine: Number(visibleRows.at(-1)?.dataset.patchLine ?? 0),
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      distanceFromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
    };
  });
}

async function startStreamProbe(page: Page) {
  await page.evaluate(() => {
    const started = performance.now();
    const visibilityAtStart = document.visibilityState;
    const frameIntervalsMs: number[] = [];
    const longTasks: Array<{ startTime: number; duration: number }> = [];
    const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const observer = longTasksSupported
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        })
      : null;
    observer?.observe({ type: "longtask" });
    let frame = 0;
    let previous = started;
    let visibilityChanged = false;
    const onVisibilityChange = () => {
      visibilityChanged = true;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const sample = (now: number) => {
      frameIntervalsMs.push(now - previous);
      previous = now;
      frame = requestAnimationFrame(sample);
    };
    if (visibilityAtStart === "visible") frame = requestAnimationFrame(sample);
    (
      globalThis as unknown as { __palotStopStreamingPatchProbe: () => unknown }
    ).__palotStopStreamingPatchProbe = () => {
      cancelAnimationFrame(frame);
      for (const entry of observer?.takeRecords() ?? []) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const framesValid = visibilityAtStart === "visible" && !visibilityChanged;
      return {
        durationMs: performance.now() - started,
        visibilityAtStart,
        visibilityAtEnd: document.visibilityState,
        visibilityChanged,
        framesValid,
        frameIntervalsMs: framesValid ? frameIntervalsMs : [],
        longTasksSupported,
        longTasks,
      };
    };
  });
}

function stopStreamProbe(page: Page) {
  return page.evaluate(() => {
    const probe = globalThis as unknown as { __palotStopStreamingPatchProbe?: () => unknown };
    const result = probe.__palotStopStreamingPatchProbe?.() ?? null;
    delete probe.__palotStopStreamingPatchProbe;
    return result;
  });
}
