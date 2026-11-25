import type { SessionMessageInfo } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Scenario } from "./scenarios.ts";

/**
 * Each turn is a prompt, a step that asks for tools, a steer, two more steps and the answer.
 * Six messages per turn put page boundaries on steers, so an older page completes a turn that
 * the newer page started (its row key changes from the steer to the prompt).
 */
const TURNS = 60;
const pad = (number: number) => String(number).padStart(2, "0");
const promptID = (turn: number) => `msg_anchor_${pad(turn)}_a_prompt`;
const steerID = (turn: number) => `msg_anchor_${pad(turn)}_c_steer`;

/**
 * Answers name what the reader sees: their message IDs survive a turn regrouping, and unlike a
 * prompt that becomes a steer, nothing inside them changes when the turn is completed.
 */
const ANCHOR_SELECTOR = "[data-palot-response-message]";

interface ReadingAnchor {
  key: string;
  top: number;
  scrollTop: number;
  scrollHeight: number;
}

export const transcriptPrependAnchorScenario: Scenario = {
  description:
    "keep the message the reader sees in place when older history loads automatically (with wheel momentum during the fetch) or from Load earlier, across pages that regroup a turn",
  prompt: "",
  expectedModelCalls: 0,
  arrange() {},
  async seed(client, { projectDirectory, runRoot }) {
    const session = await client.session.create({ location: { directory: projectDirectory } });
    const base = Date.now() - 3_600_000;
    const at = (turn: number, step: number) => base + turn * 60_000 + step * 1_000;
    const assistant = (
      id: string,
      created: number,
      text: string,
      finish: "tool-calls" | "stop",
    ): SessionMessageInfo => ({
      id,
      type: "assistant",
      time: { created, completed: created + 500 },
      agent: "build",
      model: { providerID: "test", id: "test-model" },
      finish,
      content: [{ type: "text", text }],
    });
    const messages: SessionMessageInfo[] = Array.from({ length: TURNS }, (_, index) => {
      const turn = index + 1;
      return [
        {
          id: promptID(turn),
          type: "user" as const,
          time: { created: at(turn, 0) },
          text: `Anchor prompt ${pad(turn)}: review the fixture module.`,
        },
        assistant(
          `msg_anchor_${pad(turn)}_b_step`,
          at(turn, 1),
          `Looking at fixture ${pad(turn)} first.`,
          "tool-calls",
        ),
        {
          id: steerID(turn),
          type: "user" as const,
          time: { created: at(turn, 2) },
          text: `Anchor steer ${pad(turn)}: also keep the old behaviour.`,
        },
        assistant(
          `msg_anchor_${pad(turn)}_d_step`,
          at(turn, 3),
          `Checking the steer for ${pad(turn)}.`,
          "tool-calls",
        ),
        assistant(
          `msg_anchor_${pad(turn)}_e_step`,
          at(turn, 4),
          `Verifying ${pad(turn)}.`,
          "tool-calls",
        ),
        assistant(
          `msg_anchor_${pad(turn)}_f_answer`,
          at(turn, 5),
          `Anchor answer ${pad(turn)}.\n\n${"The reading position must survive older history loading above it. ".repeat(14)}`,
          "stop",
        ),
      ];
    }).flat();
    const source = await client.experimental.session.import({
      info: { ...session, id: `${session.id}_anchor`, title: "Transcript prepend anchor fixture" },
      messages,
      location: session.location,
    });
    await writeFile(join(runRoot, "anchor-session-id.txt"), source.id, { mode: 0o600 });
    await client.session.remove({ sessionID: session.id });
  },
  async run(page, { runRoot }) {
    const sessionID = (await readFile(join(runRoot, "anchor-session-id.txt"), "utf8")).trim();
    await page.setViewportSize({ width: 1400, height: 820 });
    const url = new URL(page.url());
    url.hash = `/sessions/${sessionID}`;
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(`Anchor answer ${pad(TURNS)}.`, { exact: false })).toBeVisible();
    await waitForBottom(page);
  },
  async assert(page, { runRoot }) {
    const transcript = page.getByLabel("Task transcript", { exact: true });

    // 1. Automatic load near the top. The wheel keeps firing while the page is fetched, as
    // trackpad momentum does at the top edge, which must not drop the reading anchor.
    await installMomentumProbe(page);
    await transcript.hover();
    await page.mouse.wheel(0, -1_000_000);
    await expect.poll(() => readProbe(page).then((probe) => probe.requests)).toBeGreaterThan(0);
    const automatic = await readProbe(page).then((probe) => probe.anchor);
    if (!automatic) throw new Error("Missing the reading anchor at the automatic load");
    await expect.poll(() => readProbe(page).then((probe) => probe.inFlight)).toBe(0);
    await expect.poll(() => scrollHeight(page)).toBeGreaterThan(automatic.scrollHeight);
    await waitForFrames(page, 30);
    expect((await readProbe(page)).momentumEvents).toBeGreaterThan(0);
    await expectAnchorKept(page, automatic, "automatic");
    await page.screenshot({ path: join(runRoot, "prepend-anchor-automatic.png") });
    await page.evaluate(() => {
      (
        globalThis as unknown as { __palotAnchorProbe?: { restore(): void } }
      ).__palotAnchorProbe?.restore();
    });

    // 2. Load earlier from Find in task, while reading in the middle of the transcript.
    await page.mouse.wheel(0, 900);
    await waitForFrames(page, 20);
    await transcript.focus();
    await page.keyboard.press("ControlOrMeta+F");
    const loadEarlier = page.getByRole("button", { name: "Load earlier", exact: true });
    await expect(loadEarlier).toBeEnabled();
    await waitForFrames(page, 10);
    const manual = await readReadingAnchor(page);
    await loadEarlier.click();
    await expect.poll(() => scrollHeight(page)).toBeGreaterThan(manual.scrollHeight);
    await waitForFrames(page, 30);
    await expectAnchorKept(page, manual, "manual");
    await page.screenshot({ path: join(runRoot, "prepend-anchor-manual.png") });
    await page.keyboard.press("Escape");
  },
};

async function expectAnchorKept(page: Page, before: ReadingAnchor, label: string) {
  await expect
    .poll(
      async () => {
        const top = await anchorTop(page, before.key);
        return Math.abs(top - before.top);
      },
      { message: `${label}: ${before.key} moved on screen` },
    )
    .toBeLessThanOrEqual(3);
  const scrollTop = await page
    .getByLabel("Task transcript", { exact: true })
    .evaluate((element) => element.scrollTop);
  // The reader stays with the same message instead of landing on the new top.
  expect(scrollTop, `${label}: scrolled to the new top`).toBeGreaterThan(before.scrollTop + 400);
}

async function readReadingAnchor(page: Page): Promise<ReadingAnchor> {
  return page.getByLabel("Task transcript", { exact: true }).evaluate((viewport, selector) => {
    const top = viewport.getBoundingClientRect().top;
    const element = Array.from(viewport.querySelectorAll<HTMLElement>(selector))
      .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= top && rect.height > 0)
      .toSorted((left, right) => left.rect.top - right.rect.top)[0];
    if (!element) throw new Error("No message is visible in the transcript");
    const key = element.candidate.dataset.palotResponseMessage;
    if (!key) throw new Error("Visible message has no ID");
    return {
      key,
      top: element.rect.top - top,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
    };
  }, ANCHOR_SELECTOR);
}

async function anchorTop(page: Page, key: string): Promise<number> {
  return page.getByLabel("Task transcript", { exact: true }).evaluate((viewport, id) => {
    const element = viewport.querySelector(`[data-palot-response-message="${CSS.escape(id)}"]`);
    if (!element) return Number.POSITIVE_INFINITY;
    return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  }, key);
}

/**
 * Records the reading anchor when the first older-page request starts, and dispatches an upward
 * wheel event every frame while a page request is in flight. At the top edge such events do not
 * scroll, so the anchor is still where the page will be applied.
 */
async function installMomentumProbe(page: Page): Promise<void> {
  await page.getByLabel("Task transcript", { exact: true }).evaluate((viewport, selector) => {
    const browser = globalThis as unknown as {
      console: { debug(...args: unknown[]): void };
      __palotAnchorProbe?: unknown;
    };
    const original = browser.console.debug;
    const pending = new Set<string>();
    const probe = {
      anchor: null as ReadingAnchor | null,
      requests: 0,
      momentumEvents: 0,
      get inFlight() {
        return pending.size;
      },
      restore() {
        browser.console.debug = original;
        delete browser.__palotAnchorProbe;
      },
    };
    browser.__palotAnchorProbe = probe;
    const wheel = () => {
      if (pending.size === 0) return;
      probe.momentumEvents += 1;
      viewport.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }),
      );
      requestAnimationFrame(wheel);
    };
    browser.console.debug = (...args) => {
      const message = typeof args[0] === "string" ? args[0] : "";
      const started = "[opencode-client] request started ";
      const response = "[opencode-client] response ";
      if (message.startsWith(started)) {
        const request = JSON.parse(message.slice(started.length)) as { id: string; path: string };
        if (/\/message\?.*\bcursor\b/.test(request.path) && !/\btype\b/.test(request.path)) {
          probe.requests += 1;
          if (!probe.anchor) {
            const top = viewport.getBoundingClientRect().top;
            const element = Array.from(viewport.querySelectorAll<HTMLElement>(selector))
              .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
              .filter(({ rect }) => rect.top >= top && rect.height > 0)
              .toSorted((left, right) => left.rect.top - right.rect.top)[0];
            const key = element?.candidate.dataset.palotResponseMessage;
            if (element && key)
              probe.anchor = {
                key,
                top: element.rect.top - top,
                scrollTop: viewport.scrollTop,
                scrollHeight: viewport.scrollHeight,
              };
          }
          const idle = pending.size === 0;
          pending.add(request.id);
          if (idle) wheel();
        }
      } else if (message.startsWith(response)) {
        const { id } = JSON.parse(message.slice(response.length)) as { id: string };
        pending.delete(id);
      }
      original(...args);
    };
  }, ANCHOR_SELECTOR);
}

async function readProbe(page: Page): Promise<{
  anchor: ReadingAnchor | null;
  requests: number;
  inFlight: number;
  momentumEvents: number;
}> {
  return page.evaluate(() => {
    const probe = (
      globalThis as unknown as {
        __palotAnchorProbe: {
          anchor: ReadingAnchor | null;
          requests: number;
          inFlight: number;
          momentumEvents: number;
        };
      }
    ).__palotAnchorProbe;
    return {
      anchor: probe.anchor,
      requests: probe.requests,
      inFlight: probe.inFlight,
      momentumEvents: probe.momentumEvents,
    };
  });
}

async function scrollHeight(page: Page): Promise<number> {
  return page
    .getByLabel("Task transcript", { exact: true })
    .evaluate((element) => element.scrollHeight);
}

async function waitForBottom(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .getByLabel("Task transcript", { exact: true })
        .evaluate(
          (element) => element.scrollHeight - element.clientHeight - Math.max(0, element.scrollTop),
        ),
    )
    .toBeLessThanOrEqual(2);
}

async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}
