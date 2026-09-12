import type { SessionMessageInfo } from "@opencode/client";
import { expect, type ConsoleMessage, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { measureInteraction } from "./performance.ts";
import type { Scenario } from "./scenarios.ts";

const PROMPT_COUNT = 120;
const SOURCE_DRAFT = "Keep this unsent rail navigation draft.";
const label = (number: number) =>
  `Rail prompt ${String(number).padStart(3, "0")}: review fixture turn ${number}.`;
const messageID = (number: number) => `msg_rail_user_${String(number).padStart(3, "0")}`;

const STREAM_PREFIX = "Rail streaming sample";
type ScenarioContext = Parameters<NonNullable<Scenario["run"]>>[1];

export const transcriptRailScenario = createRailScenario(false);
// arrange has no profile context and the harness expects a fixed model-call count.
export const transcriptRailStreamingScenario = createRailScenario(true);

function createRailScenario(streaming: boolean): Scenario {
  return {
    description: streaming
      ? "exercise the bounded rail during a scripted local continuation; --profile records a rail-specific streaming smoke measurement"
      : "navigate a bounded gutter rail by pointer and keyboard, prepend history, and reveal the compact rail on hover/focus without losing the draft",
    prompt: "",
    expectedModelCalls: streaming ? 1 : 0,
    arrange(llm) {
      if (streaming) {
        llm.textChunks(
          Array.from(
            { length: 100 },
            (_, index) => `${STREAM_PREFIX} ${index + 1}: settled history remains navigable.\n\n`,
          ),
          150,
        );
      }
    },
    async seed(client, { projectDirectory, runRoot }) {
      const session = await client.session.create({ location: { directory: projectDirectory } });
      const base = Date.now() - 600_000;
      const messages: SessionMessageInfo[] = Array.from({ length: PROMPT_COUNT }, (_, index) => {
        const number = index + 1;
        return [
          {
            id: messageID(number),
            type: "user" as const,
            time: { created: base + index * 2_000 },
            text: label(number),
          },
          {
            id: `msg_rail_assistant_${String(number).padStart(3, "0")}`,
            type: "assistant" as const,
            time: { created: base + index * 2_000 + 1, completed: base + index * 2_000 + 2 },
            agent: "build",
            model: { providerID: "test", id: "test-model" },
            finish: "stop" as const,
            content: [
              {
                type: "text" as const,
                text: `Completed rail fixture turn ${number}.\n\n${number === PROMPT_COUNT ? "Short final response." : "Settled history content for viewport navigation. ".repeat(number === PROMPT_COUNT - 1 ? 60 : 20)}`,
              },
            ],
          },
        ];
      }).flat();
      // Import settled turns through the official API, never a provider or renderer injection.
      const source = await client.session.import({
        info: { ...session, id: `${session.id}_rail`, title: "Transcript rail fixture" },
        messages,
        location: session.location,
      });
      await writeFile(join(runRoot, "rail-session-id.txt"), source.id, { mode: 0o600 });
      await client.session.remove({ sessionID: session.id });
    },
    async run(page, context) {
      const { client, session, llm, runRoot } = context;
      const originalViewport = page.viewportSize();
      const source = { id: (await readFile(join(runRoot, "rail-session-id.txt"), "utf8")).trim() };
      let historyRequests = 0;
      const countHistory = (message: ConsoleMessage) => {
        const prefix = "[opencode-client] request started ";
        const text = message.text();
        if (!text.startsWith(prefix)) return;
        const request = JSON.parse(text.slice(prefix.length)) as { path: string };
        const url = new URL(request.path, "https://opencode.invalid");
        if (url.pathname === `/api/session/${source.id}/message` && !url.searchParams.has("type")) {
          historyRequests += 1;
        }
      };
      page.on("console", countHistory);
      try {
        await page.setViewportSize({ width: 1600, height: 800 });
        await navigate(page, source.id);
        // A visible composer alone can still belong to the previous route.
        await expect(page.locator(`[data-message-id="${messageID(120)}"]`)).toBeVisible();
        // The fixture is imported before Electron starts, avoiding a live creation
        // event's workspace refresh racing/cancelling initial prompt-index hydration.
        const rail = page.getByRole("listbox", { name: "Prompt navigation", exact: true });
        await expect(rail.getByRole("option").first()).toHaveAttribute("aria-setsize", "100");
        const transcript = page.getByLabel("Task transcript", { exact: true });
        await expect
          .poll(() =>
            transcript.evaluate(
              (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          )
          .toBeLessThanOrEqual(1);
        // Regression: the penultimate response is still visible at the reading
        // line, but actual bottom position must select the latest sent prompt.
        await expect
          .poll(async () => {
            const previous = await page
              .locator('[data-message-id="msg_rail_assistant_119"]')
              .boundingBox();
            const clip = await transcript.boundingBox();
            return Boolean(
              previous && clip && previous.y < clip.y && previous.y + previous.height > clip.y,
            );
          })
          .toBe(true);
        await expect(rail.getByRole("option", { name: label(120), exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect
          .poll(() =>
            rail.evaluate(
              (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          )
          .toBeLessThanOrEqual(1);
        await page.screenshot({ path: join(runRoot, "transcript-rail-latest-at-bottom.png") });
        await transcript.hover();
        await page.mouse.wheel(0, -30);
        await expect(rail.getByRole("option", { name: label(119), exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await page.mouse.wheel(0, 10_000);
        await expect(rail.getByRole("option", { name: label(120), exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const composer = page.getByRole("textbox", { name: "Message Palot" });
        await expect(composer).toBeVisible();
        await expectTwoLineComposer(page);
        const emptyHeight = (await composer.boundingBox())!.height;
        await composer.fill("First line\nSecond line\nThird line\nFourth line");
        await expect
          .poll(async () => (await composer.boundingBox())!.height)
          .toBeGreaterThan(emptyHeight);
        await composer.fill("");
        await expectTwoLineComposer(page);
        await composer.fill(SOURCE_DRAFT);
        await expect(rail).toBeVisible();
        await expectCompactRail(page);
        // The outline indexes 100 user messages while the transcript starts with ten turns.
        await expect(rail.getByRole("option").first()).toHaveAttribute("aria-setsize", "100");
        const selected = rail.getByRole("option", { name: label(115), exact: true });
        await selected.hover();
        await expect(page.getByRole("tooltip")).toHaveText(label(115));
        await expect(rail.getByRole("option").first()).toHaveAttribute("aria-setsize", "100");
        expect(llm.scriptedCalls()).toBe(0);
        await page.screenshot({ path: join(runRoot, "transcript-rail-wide-preview.png") });
        await selected.click();
        await expectAligned(page, 115);

        // Moving focus previews a prompt without jumping; Enter commits the selection.
        await composer.hover();
        await rail.focus();
        await rail.press("ArrowUp");
        await expect(page.getByRole("tooltip")).toHaveText(label(114));
        await expectAligned(page, 115);
        await rail.press("Enter");
        await expectAligned(page, 114);
        await rail.press("ArrowDown");
        await expect(page.getByRole("tooltip")).toHaveText(label(115));
        await rail.press("Enter");
        await expectAligned(page, 115);

        // Explicit pagination must leave the current reading position intact. Multiple
        // pages also grow the ordinal list well beyond its on-screen capacity.
        const earlier = rail.locator("../..").getByRole("button", {
          name: "Load earlier prompts",
          exact: true,
        });
        let loaded = 100;
        const historyBeforeIndexPage = historyRequests;
        for (let pageNumber = 0; loaded < PROMPT_COUNT && pageNumber < 4; pageNumber += 1) {
          await expect(earlier).toBeEnabled();
          await earlier.click();
          await expect
            .poll(async () =>
              Number(await rail.getByRole("option").first().getAttribute("aria-setsize")),
            )
            .toBeGreaterThan(loaded);
          loaded = Number(await rail.getByRole("option").first().getAttribute("aria-setsize"));
          await expectAligned(page, 115);
        }
        expect(loaded).toBe(PROMPT_COUNT);
        expect(historyRequests).toBe(historyBeforeIndexPage);
        await expect(earlier).toHaveCount(0);
        expect(await rail.getByRole("option").count()).toBeLessThanOrEqual(45);
        const capacity = await rail.evaluate((element) => ({
          viewport: element.clientHeight,
          content: element.scrollHeight,
        }));
        expect(capacity.content).toBeGreaterThan(capacity.viewport);

        // Home reveals an ordinal that was not mounted before the rail scrolled.
        await composer.hover();
        await rail.focus();
        await rail.press("Home");
        await expect.poll(() => rail.evaluate((element) => element.scrollTop)).toBe(0);
        await expect(rail).toHaveCSS("mask-image", /100% - [1-9]/);
        await expect(rail.getByRole("option", { name: label(1), exact: true })).toBeVisible();
        await expect(page.getByRole("tooltip")).toHaveText(label(1));
        await rail.press("Enter");
        await expectAligned(page, 1);
        await rail.press("ArrowDown");
        await rail.press("Enter");
        await expectAligned(page, 2);
        await expect(composer).toHaveValue(SOURCE_DRAFT);
        await page.screenshot({ path: join(runRoot, "transcript-rail-wide-history.png") });

        // The cap stays compact on tall windows and yields space on short panes.
        for (const height of [1200, 640]) {
          await page.setViewportSize({ width: 1600, height });
          await expectCompactRail(page);
        }

        await page.setViewportSize({ width: 920, height: 640 });
        const railSurface = rail.locator("../..");
        await composer.focus();
        await composer.hover();
        await expect(railSurface).toHaveCSS("opacity", "0");
        const transcriptBounds = await page
          .getByLabel("Task transcript", { exact: true })
          .boundingBox();
        if (!transcriptBounds) throw new Error("Missing compact transcript bounds");
        const railBounds = await railSurface.boundingBox();
        if (!railBounds) throw new Error("Missing compact rail bounds");
        // Hover the expanded left-edge hit area, not an already-visible marker.
        await page.mouse.move(transcriptBounds.x + 2, railBounds.y + railBounds.height / 2);
        await expect(railSurface).toHaveCSS("opacity", "1");
        await page.screenshot({ path: join(runRoot, "transcript-rail-narrow-hover.png") });
        await composer.hover();
        await expect(railSurface).toHaveCSS("opacity", "0");
        await rail.focus();
        await expect(railSurface).toHaveCSS("opacity", "1");
        await rail.press("Home");
        await rail.press("ArrowDown");
        await rail.press("ArrowDown");
        await rail.press("Enter");
        await expectAligned(page, 3);
        await expect(composer).toHaveValue(SOURCE_DRAFT);
        const compactRailBounds = await railSurface.boundingBox();
        const bodyBounds = await page
          .getByText("Completed rail fixture turn 3.", { exact: true })
          .boundingBox();
        if (!compactRailBounds || !bodyBounds) throw new Error("Missing compact rail/text bounds");
        expect(compactRailBounds.x + compactRailBounds.width + 1).toBeLessThanOrEqual(bodyBounds.x);
        await page.screenshot({ path: join(runRoot, "transcript-rail-narrow-focus.png") });
        await expectTwoLineComposer(page);
        await page.getByRole("button", { name: "Task actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Prompt timeline", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("textbox", { name: "Search prompts" })).toBeVisible();
        await dialog.getByRole("textbox", { name: "Search prompts" }).fill("Rail prompt 003");
        await dialog.getByRole("button", { name: new RegExp(label(3)) }).click();
        await expect(dialog).toHaveCount(0);
        await expectAligned(page, 3);
        await expect(composer).toHaveValue(SOURCE_DRAFT);
        await page.screenshot({ path: join(runRoot, "transcript-rail-narrow-fallback.png") });
        expect((await client.session.export({ sessionID: source.id })).messages).toHaveLength(
          PROMPT_COUNT * 2,
        );
        expect(await client.session.inbox.list({ sessionID: source.id })).toHaveLength(0);
        expect(llm.scriptedCalls()).toBe(0);
        if (streaming) await exerciseStreamingRail(page, source.id, context);
      } catch (error) {
        await page.screenshot({ path: join(runRoot, "transcript-rail-failure.png") }).catch(() => {
          // A closed renderer must not replace the original scenario failure.
        });
        throw error;
      } finally {
        page.off("console", countHistory);
        try {
          await navigate(page, session.id);
        } finally {
          await client.session.remove({ sessionID: source.id });
          if (originalViewport) await page.setViewportSize(originalViewport);
        }
      }
    },
    async assert(_page, { llm }) {
      expect(llm.scriptedCalls()).toBe(streaming ? 1 : 0);
    },
  };
}

async function exerciseStreamingRail(page: Page, sessionID: string, context: ScenarioContext) {
  const { client, llm, profile, cssSelectorStats, reactProfile, runRoot } = context;
  await page.setViewportSize({ width: 1600, height: 800 });
  const rail = page.getByRole("listbox", { name: "Prompt navigation", exact: true });
  const composer = page.getByRole("textbox", { name: "Message Palot" });
  await expect(rail).toBeVisible();
  await composer.hover();
  await rail.focus();
  await rail.press("Home");
  await rail.press("Enter");
  await expectAligned(page, 1);
  // The correctness flow above warms the same hover and reveal paths.
  const emissionCount = () =>
    llm.emissions.filter((emission) => JSON.stringify(emission.payload).includes(STREAM_PREFIX))
      .length;
  await client.session.prompt({
    sessionID,
    text: "Continue the scripted rail navigation fixture.",
  });
  try {
    await expect.poll(emissionCount).toBeGreaterThan(0);
    await expect(rail.getByRole("option").first()).toHaveAttribute("aria-setsize", "121");
    // Explicitly unlock the transcript again after the new prompt is appended.
    await rail.focus();
    await rail.press("Home");
    await rail.press("Enter");
    await expectAligned(page, 1);

    const sampleBounds = async () => {
      await expect(rail).toBeVisible();
      const options = await rail.getByRole("option").count();
      expect(options).toBeLessThanOrEqual(80);
      await expect(rail.getByRole("option").first()).toHaveAttribute("aria-setsize", "121");
      await expect(composer).toHaveValue(SOURCE_DRAFT);
      return {
        options,
        loadedPrompts: 121,
        rail: await rail.boundingBox(),
        transcript: await page
          .getByRole("region", { name: "Task transcript", exact: true })
          .boundingBox(),
      };
    };
    const interact = async () => {
      const emissionsBefore = emissionCount();
      const samples = [await sampleBounds()];
      for (const number of [2, 4, 6]) {
        const option = rail.getByRole("option", { name: label(number), exact: true });
        await option.hover();
        await expect(page.getByRole("tooltip")).toHaveText(label(number));
        await option.click();
        await expectAligned(page, number);
        await composer.hover();
        await rail.focus();
        await rail.press("ArrowDown");
        await expect(page.getByRole("tooltip")).toHaveText(label(number + 1));
        await rail.press("Enter");
        await expectAligned(page, number + 1);
        samples.push(await sampleBounds());
      }
      const emissionsAfter = emissionCount();
      expect(emissionsAfter).toBeGreaterThan(emissionsBefore);
      // Export is a persisted snapshot, not the live streaming overlay.
      expect((await client.session.active())[sessionID]).toEqual({ type: "running" });
      return { emissionsBefore, emissionsAfter, assistantStillStreaming: true, samples };
    };
    const measured = profile
      ? await measureInteraction(
          page,
          "transcript-rail-hover-and-jump-during-streaming",
          interact,
          {
            captureCssSelectorStats: cssSelectorStats,
            processSampleIntervalMs: 500,
          },
        )
      : { result: await interact(), report: null };
    await page.screenshot({ path: join(runRoot, "transcript-rail-wide-streaming.png") });
    if (profile) {
      const streamingLatency = await page.evaluate(() => {
        const browser = globalThis as unknown as { palotStreamingLatency?: () => unknown[] };
        return browser.palotStreamingLatency?.() ?? [];
      });
      await writeFile(
        join(runRoot, "rail-streaming-performance.json"),
        JSON.stringify(
          {
            scope:
              "Rail-specific streaming interaction smoke measurement, not the session-switch baseline or an improvement comparison.",
            buildMode: reactProfile ? "react-profiling" : "production",
            viewport: page.viewportSize(),
            interaction: measured.report,
            workload: measured.result,
            streamingLatency,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
  } finally {
    // Let the one owned local continuation settle before the outer fixture cleanup.
    await client.session.wait({ sessionID });
  }
  await expect(composer).toHaveValue(SOURCE_DRAFT);
  const completed = await client.session.export({ sessionID });
  expect(
    completed.messages.some(
      (message) =>
        message.type === "assistant" &&
        message.content.some((part) => part.type === "text" && part.text.includes(STREAM_PREFIX)),
    ),
  ).toBe(true);
  expect(llm.scriptedCalls()).toBe(1);
  expect(await client.session.inbox.list({ sessionID })).toHaveLength(0);
}

async function expectTwoLineComposer(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message Palot" });
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const style = getComputedStyle(element);
        const contentHeight =
          element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        return Math.abs(contentHeight - 2 * parseFloat(style.lineHeight));
      }),
    )
    .toBeLessThanOrEqual(1);
}

async function expectCompactRail(page: Page) {
  const rail = page.getByRole("listbox", { name: "Prompt navigation", exact: true });
  await expect
    .poll(() =>
      rail.evaluate((element) => {
        const rail = element.parentElement!.parentElement!.getBoundingClientRect();
        const transcript = document
          .querySelector('[aria-label="Task transcript"]')!
          .getBoundingClientRect();
        const composer = document
          .querySelector("[data-palot-composer-dock]")!
          .getBoundingClientRect();
        const availableBottom = Math.min(transcript.bottom, composer.top);
        return {
          bounded: rail.height <= 360 && rail.height <= (availableBottom - transcript.top) * 0.7,
          centered:
            Math.abs(rail.top + rail.height / 2 - (transcript.top + availableBottom) / 2) < 2,
        };
      }),
    )
    .toEqual({ bounded: true, centered: true });
}

async function expectAligned(page: Page, number: number) {
  const target = page.locator(`[data-message-id="${messageID(number)}"]`);
  await expect(target).toBeVisible();
  await expect
    .poll(async () => {
      const row = await target.boundingBox();
      const viewport = await page
        .getByRole("region", { name: "Task transcript", exact: true })
        .boundingBox();
      return row && viewport ? Math.abs(row.y - viewport.y) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(8);
}

async function navigate(page: Page, sessionID: string) {
  const url = new URL(page.url());
  url.hash = `/sessions/${sessionID}`;
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
}
