import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { measureInteraction } from "./performance.ts";
import type { Scenario } from "./scenarios.ts";

const LABELS = ["ALPHA", "BETA", "GAMMA", "DELTA"] as const;
const CHUNK_COUNT = 450;
const CHUNK_DELAY_MS = 40;
const MAX_DELTAS_PER_SESSION = 2_000;
const PRE_ACTION_STREAM_MS = 500;
const POST_ACTION_STREAM_MS = 650;
const READING_HOLD_MS = 700;
const marker = (label: string) => `[PALOT_INTERACTION_${label}]`;
const title = (label: string) => `Palot E2E: interaction-${label.toLowerCase()}`;

type ActionKind = "navigation" | "wheel-up" | "resume" | "stop";
interface ResponseSample {
  kind: ActionKind;
  timeOrigin: number;
  eventAt: number | null;
  eventObservedAt: number | null;
  usefulDOMAt: number | null;
  untrustedEvents: number;
  checks: number;
  markerLookups: number;
  failure: string | null;
}
interface ResponseProbe {
  result: Promise<ResponseSample>;
  stop(): void;
}
type ProbeWindow = typeof globalThis & { __palotInteractionResponse?: ResponseProbe };

/** Serialized into the renderer. No permanent rAF loop, transcript text scans, or
 * geometry history: cache one marker and check only on relevant DOM/scroll events.
 * A navigation candidate gets one viewport/marker bounds check per DOM notification;
 * all work is bounded by the deadline and callback/lookup caps. This observes DOM
 * readiness, including the surface fade, NOT compositor presentation. */
export function installInteractionResponseProbe(
  target: Element,
  options: { kind: ActionKind; sessionID?: string; label?: string; timeoutMs?: number },
): void {
  const browser = globalThis as ProbeWindow;
  browser.__palotInteractionResponse?.stop();
  let root = document.querySelector('[aria-label="Current task"]');
  if (!root) throw new Error("Current task is missing");
  // The thread normally retains its main element. Observe its stable host as well
  // so a hydration remount cannot leave the probe attached only to a detached tree.
  const observationRoot = root.parentElement ?? root;
  const sample: ResponseSample = {
    kind: options.kind,
    timeOrigin: performance.timeOrigin,
    eventAt: null,
    eventObservedAt: null,
    usefulDOMAt: null,
    untrustedEvents: 0,
    checks: 0,
    markerLookups: 0,
    failure: null,
  };
  let resolve!: (sample: ResponseSample) => void;
  const result = new Promise<ResponseSample>((done) => {
    resolve = done;
  });
  let finished = false;
  let viewport = root.querySelector<HTMLElement>('[aria-label="Task transcript"]');
  let surface = root.querySelector<HTMLElement>("[data-palot-transcript-surface]");
  let liveMarker: Element | null = null;
  const initialTop = viewport?.scrollTop ?? 0;
  const eventType = options.kind === "navigation" || options.kind === "stop" ? "click" : "wheel";
  const finish = (failure: string | null) => {
    if (finished) return;
    finished = true;
    sample.failure = failure;
    observer.disconnect();
    clearTimeout(deadline);
    target.removeEventListener(eventType, onInput, true);
    observationRoot.removeEventListener("scroll", check, true);
    observationRoot.removeEventListener("transitionend", check, true);
    resolve({ ...sample });
  };
  const check = () => {
    if (finished || sample.eventAt === null) return;
    if (++sample.checks > 1_000) return finish("DOM response observer callback cap exceeded");
    if (!root?.isConnected) root = observationRoot.querySelector('[aria-label="Current task"]');
    if (!root) return;
    let ready = false;
    if (options.kind === "stop") {
      // Stop removal alone is insufficient: require the idle composer replacement.
      ready =
        root.querySelector('[aria-label="Stop task"]') === null &&
        root.querySelector('[aria-label="Send message"]') !== null;
    } else if (options.kind === "navigation") {
      if (!viewport?.isConnected) {
        viewport = root.querySelector<HTMLElement>('[aria-label="Task transcript"]');
        liveMarker = null;
      }
      if (!surface?.isConnected)
        surface = root.querySelector<HTMLElement>("[data-palot-transcript-surface]");
      if (!viewport || !surface || !location.hash.includes(options.sessionID!)) return;
      if (!liveMarker?.isConnected) {
        if (++sample.markerLookups > 60) return finish("Navigation marker lookup cap exceeded");
        // Only the bounded fixture's bold markers, never all descendants or textContent
        // of the growing transcript. Keep the selected node until it is replaced.
        const candidates = viewport.querySelectorAll("strong");
        liveMarker =
          Array.from(candidates).findLast((node) =>
            node.textContent?.startsWith(`${options.label} live `),
          ) ?? null;
      }
      if (
        !liveMarker ||
        surface.dataset.palotTranscriptState !== "visible" ||
        Number.parseFloat(getComputedStyle(surface).opacity) < 0.99
      )
        return;
      const bounds = liveMarker.getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      ready = bounds.height > 0 && bounds.bottom > clip.top && bounds.top < clip.bottom;
    } else if (viewport) {
      ready =
        options.kind === "wheel-up"
          ? viewport.dataset.bottomLocked === "false" && viewport.scrollTop < initialTop - 100
          : viewport.dataset.bottomLocked === "true" &&
            viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2;
    }
    if (!ready) return;
    sample.usefulDOMAt = performance.now();
    performance.mark(`palot:interaction-streaming:${options.kind}:useful-dom`);
    finish(null);
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted) sample.untrustedEvents += 1;
    if (sample.eventAt !== null) return;
    sample.eventAt = event.timeStamp;
    sample.eventObservedAt = performance.now();
    performance.mark(`palot:interaction-streaming:${options.kind}:input`);
    // React's event handler/default wheel action has not run in this capture listener.
    // Subsequent mutations, scroll events, or transitionend provide the milestone.
  };
  const observer = new MutationObserver(check);
  observer.observe(observationRoot, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-bottom-locked", "data-palot-transcript-state", "aria-label"],
  });
  const deadline = setTimeout(
    () => finish("Timed out waiting for useful DOM response"),
    options.timeoutMs ?? 5_000,
  );
  target.addEventListener(eventType, onInput, true);
  observationRoot.addEventListener("scroll", check, true);
  observationRoot.addEventListener("transitionend", check, true);
  browser.__palotInteractionResponse = {
    result,
    stop: () => finish("Probe stopped before response"),
  };
}

async function stopResponseProbe(page: Page) {
  await page.evaluate(() => {
    const browser = globalThis as ProbeWindow;
    browser.__palotInteractionResponse?.stop();
    delete browser.__palotInteractionResponse;
  });
}

export const interactionStreamingPerformanceScenario: Scenario = {
  description:
    "measure trusted wheel, warm session navigation, and Stop during four continuous streams",
  prompt: "",
  expectedModelCalls: 0,
  arrange(llm) {
    for (const label of LABELS) {
      llm.route(marker(label), (script) => {
        script.text(
          Array.from({ length: 60 }, (_, index) => `${label} warm history ${index}.`).join("\n\n"),
        );
        script.textChunks(
          [
            ...Array.from(
              { length: CHUNK_COUNT },
              (_, index) =>
                `\n\n**${label} live ${String(index).padStart(3, "0")}** Streaming a deterministic paragraph while navigation, reading, and cancellation remain available.`,
            ),
            `\n\n${label} INTERACTION STREAM COMPLETE`,
          ],
          CHUNK_DELAY_MS,
        );
      });
    }
  },
  async run(page, { client, session, projectDirectory, llm, profile, runRoot }) {
    const sessions = [{ id: session.id, label: LABELS[0] as string }];
    for (const label of LABELS.slice(1)) {
      const created = await client.session.create({ location: { directory: projectDirectory } });
      sessions.push({ id: created.id, label });
    }
    for (const entry of sessions) {
      await client.session.update({ sessionID: entry.id, title: title(entry.label) });
      await client.session.prompt({
        sessionID: entry.id,
        text: `${marker(entry.label)} Warm history.`,
      });
      await client.session.wait({ sessionID: entry.id });
    }
    const navigation = page.getByRole("button", { name: /^(Show|Hide) navigation$/ });
    if ((await navigation.getAttribute("aria-pressed")) === "false") await navigation.click();
    const sessionButton = (label: string) =>
      page.getByRole("button", { name: new RegExp(`^Open ${title(label)}, `) });
    const transcript = page.getByLabel("Task transcript", { exact: true });
    // Warm both navigation directions and transcript measurement before subscribing/prompts.
    for (const label of ["BETA", "ALPHA", "BETA", "ALPHA"]) {
      await sessionButton(label).click();
      await expect(transcript).toContainText(`${label} warm history 59.`);
      await expect(page.locator("[data-palot-transcript-surface]")).toHaveAttribute(
        "data-palot-transcript-state",
        "visible",
      );
    }

    const controller = new AbortController();
    const requestOptions = { signal: controller.signal };
    const deltas = new Map(sessions.map(({ id }) => [id, [] as number[]]));
    const interrupted = new Map<string, number>();
    const deltasAfterInterruption = new Map<string, number>();
    const completed = new Set<string>();
    const errors: unknown[] = [];
    let connected = false;
    let workload: Promise<void> | undefined;
    const checkErrors = () => {
      if (errors.length) throw new AggregateError(errors, "Interaction streaming workload failed");
    };
    const subscription = (async () => {
      try {
        for await (const event of client.event.subscribe(requestOptions)) {
          if (event.type === "server.connected") connected = true;
          if (event.type === "session.execution.interrupted")
            interrupted.set(event.data.sessionID, Date.now());
          if (event.type === "session.text.delta" && event.data.delta.length > 0) {
            const samples = deltas.get(event.data.sessionID);
            if (!samples) continue;
            if (interrupted.has(event.data.sessionID)) {
              deltasAfterInterruption.set(
                event.data.sessionID,
                (deltasAfterInterruption.get(event.data.sessionID) ?? 0) + 1,
              );
            }
            if (samples.length >= MAX_DELTAS_PER_SESSION)
              throw new Error("Session text delta retention cap exceeded");
            samples.push(Date.now());
          }
        }
        if (!controller.signal.aborted)
          throw new Error("Interaction event subscription ended unexpectedly");
      } catch (error) {
        if (!controller.signal.aborted) errors.push(error);
      }
    })();
    try {
      await expect
        .poll(
          () => {
            checkErrors();
            return connected;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      workload = Promise.all(
        sessions.map(async ({ id, label }) => {
          try {
            await client.session.prompt(
              { sessionID: id, text: `${marker(label)} Stream the interaction fixture.` },
              requestOptions,
            );
            await client.session.wait({ sessionID: id }, requestOptions);
            completed.add(id);
          } catch (error) {
            if (!controller.signal.aborted) errors.push(error);
          }
        }),
      ).then(() => {});
      await expect
        .poll(
          () => {
            checkErrors();
            return sessions.every(({ id }) => deltas.get(id)!.length >= 8);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(transcript).toContainText("ALPHA live");
      await expect(transcript).toHaveAttribute("data-bottom-locked", "true");
      const actions: unknown[] = [];

      const action = async (
        name: string,
        kind: ActionKind,
        target: Locator,
        dispatch: () => Promise<void>,
        selected: (typeof sessions)[number],
      ) => {
        checkErrors();
        const contentionStartedAt = Date.now();
        // Tiny successful actions may fit between two 40 ms deltas. Prove surrounding
        // concurrency with a labelled envelope, NOT fabricated "during click" counts.
        await sleep(PRE_ACTION_STREAM_MS);
        for (const entry of sessions)
          expect(completed.has(entry.id), `${entry.label} finished before ${name}`).toBe(false);
        await target.evaluate(installInteractionResponseProbe, {
          kind,
          sessionID: selected.id,
          label: selected.label,
        });
        const dispatchStartedAt = Date.now();
        await dispatch();
        const response = await page.evaluate(async () => {
          const probe = (globalThis as ProbeWindow).__palotInteractionResponse;
          if (!probe) throw new Error("Interaction response probe is missing");
          return probe.result;
        });
        const responseReceivedAt = Date.now();
        expect(response.failure, JSON.stringify(response)).toBeNull();
        expect(response.untrustedEvents).toBe(0);
        expect(response.eventAt).not.toBeNull();
        expect(response.usefulDOMAt).not.toBeNull();
        expect(response.usefulDOMAt!).toBeGreaterThanOrEqual(response.eventAt!);
        let idleConfirmedAt: number | null = null;
        if (kind === "stop") {
          await expect
            .poll(() => {
              checkErrors();
              return interrupted.has(selected.id);
            })
            .toBe(true);
          await client.session.wait({ sessionID: selected.id }, requestOptions);
          expect((await client.session.active())[selected.id]?.type).not.toBe("running");
          idleConfirmedAt = Date.now();
        }
        await sleep(POST_ACTION_STREAM_MS);
        checkErrors();
        const contentionEndedAt = Date.now();
        const overlap = sessions.map(({ id, label }) => {
          const samples = deltas.get(id)!;
          const before = samples.filter(
            (at) => at >= contentionStartedAt && at < dispatchStartedAt,
          );
          const during = samples.filter(
            (at) => at >= dispatchStartedAt && at <= responseReceivedAt,
          );
          const after = samples.filter((at) => at > responseReceivedAt && at <= contentionEndedAt);
          expect(
            before.length,
            `${label} must stream immediately before ${name}`,
          ).toBeGreaterThanOrEqual(2);
          expect(before.at(-1)! - before[0]!).toBeGreaterThanOrEqual(200);
          if (kind !== "stop" || id !== selected.id) {
            expect(
              after.length,
              `${label} must stream immediately after ${name}`,
            ).toBeGreaterThanOrEqual(2);
            expect(after.at(-1)! - after[0]!).toBeGreaterThanOrEqual(300);
            expect(completed.has(id), `${label} finished during ${name}`).toBe(false);
          }
          return {
            sessionID: id,
            label,
            beforeCount: before.length,
            duringDispatchToDOMReceiptCount: during.length,
            afterCount: after.length,
            lastBeforeAt: before.at(-1),
            firstAfterAt: after[0] ?? null,
            interruptionAt: interrupted.get(id) ?? null,
          };
        });
        const evidence = {
          name,
          kind,
          selectedSessionID: selected.id,
          contentionStartedAt,
          dispatchStartedAt,
          responseReceivedAt,
          contentionEndedAt,
          response,
          eventToUsefulDOMMs: response.usefulDOMAt! - response.eventAt!,
          overlap,
          idleConfirmedAt,
          dispatchToInterruptionReceiptMs:
            kind === "stop" ? interrupted.get(selected.id)! - dispatchStartedAt : null,
        };
        actions.push(evidence);
        await stopResponseProbe(page);
        return evidence;
      };

      const interact = async () => {
        await action(
          "switch-to-beta",
          "navigation",
          sessionButton("BETA"),
          () => sessionButton("BETA").click(),
          sessions[1]!,
        );
        await action(
          "switch-to-alpha",
          "navigation",
          sessionButton("ALPHA"),
          () => sessionButton("ALPHA").click(),
          sessions[0]!,
        );
        await transcript.hover();
        await action(
          "wheel-up",
          "wheel-up",
          transcript,
          () => page.mouse.wheel(0, -900),
          sessions[0]!,
        );
        // Two bounded scroll reads while live deltas continue: no per-frame geometry sampler.
        const readingTop = await transcript.evaluate((element) => element.scrollTop);
        const anchorText = await transcript.evaluate((element) => {
          const clip = element.getBoundingClientRect();
          return (
            Array.from(element.querySelectorAll("strong")).find((node) => {
              const rect = node.getBoundingClientRect();
              return rect.top >= clip.top && rect.bottom < clip.top + clip.height / 2;
            })?.textContent ?? null
          );
        });
        expect(anchorText, "reading anchor must be on screen").not.toBeNull();
        const readingAnchor = transcript.getByText(anchorText!, { exact: true });
        const anchorBefore = await readingAnchor.boundingBox();
        const readingStartedAt = Date.now();
        await sleep(READING_HOLD_MS);
        await expect(transcript).toHaveAttribute("data-bottom-locked", "false");
        const readingAfter = await transcript.evaluate((element) => ({
          top: element.scrollTop,
          gap: element.scrollHeight - element.clientHeight - element.scrollTop,
        }));
        const anchorAfter = await readingAnchor.boundingBox();
        await writeFile(
          join(runRoot, "reading-position.json"),
          JSON.stringify(
            {
              readingTop,
              readingAfter,
              anchorText,
              anchorBefore,
              anchorAfter,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        // Above-viewport measurements may legitimately adjust scrollTop. The
        // reader's visible text, not its raw scroll offset, must stay stationary.
        expect(anchorBefore).not.toBeNull();
        expect(anchorAfter).not.toBeNull();
        expect(
          Math.abs(anchorAfter!.y - anchorBefore!.y),
          "streaming must not move the visible reading anchor",
        ).toBeLessThanOrEqual(2);
        expect(readingAfter.gap).toBeGreaterThan(300);
        const readingEndedAt = Date.now();
        const readingOverlap = sessions.map(({ id, label }) => {
          const during = deltas
            .get(id)!
            .filter((at) => at >= readingStartedAt && at <= readingEndedAt);
          expect(
            during.length,
            `${label} must stream while keeping the reading position`,
          ).toBeGreaterThanOrEqual(2);
          expect(during.at(-1)! - during[0]!).toBeGreaterThanOrEqual(300);
          return {
            sessionID: id,
            label,
            count: during.length,
            firstAt: during[0],
            lastAt: during.at(-1),
          };
        });
        await action(
          "resume-live-edge",
          "resume",
          transcript,
          () => page.mouse.wheel(0, 100_000),
          sessions[0]!,
        );
        const stop = page.getByRole("button", { name: "Stop task", exact: true });
        await expect(stop).toBeEnabled();
        await action("stop-alpha", "stop", stop, () => stop.click(), sessions[0]!);
        const cancelledAt = interrupted.get(session.id)!;
        const emissionsForAlpha = () =>
          llm.emissions.filter(({ payload }) => JSON.stringify(payload).includes("ALPHA live "))
            .length;
        const emissionsAfterStop = emissionsForAlpha();
        // Keep observing until the other three finite streams finish, not just until
        // the Stop button disappears. This also rejects an uncancelled provider stream.
        await workload;
        checkErrors();
        // Event ordering, not wall-clock comparison: same-millisecond late deltas count too.
        expect(deltasAfterInterruption.get(session.id) ?? 0).toBe(0);
        expect(emissionsForAlpha()).toBe(emissionsAfterStop);
        expect(emissionsAfterStop).toBeLessThan(CHUNK_COUNT);
        expect(interrupted.size).toBe(1);
        for (const entry of sessions.slice(1)) {
          const exported = await client.session.export({ sessionID: entry.id });
          expect(JSON.stringify(exported.messages)).toContain(
            `${entry.label} INTERACTION STREAM COMPLETE`,
          );
        }
        expect(
          JSON.stringify((await client.session.export({ sessionID: session.id })).messages),
        ).not.toContain("ALPHA INTERACTION STREAM COMPLETE");
        return {
          actions,
          reading: {
            startedAt: readingStartedAt,
            endedAt: readingEndedAt,
            beforeTop: readingTop,
            after: readingAfter,
            anchor: { text: anchorText, before: anchorBefore, after: anchorAfter },
            overlap: readingOverlap,
          },
          cancellation: {
            interruptedAt: cancelledAt,
            emissionsAfterStop,
            verifiedUntil: Date.now(),
            deltasAfterInterruption: 0,
            providerEmissionsAfterQuietBarrier: 0,
          },
        };
      };
      const measured = profile
        ? await measureInteraction(
            page,
            "wheel-navigation-stop-under-four-streaming-sessions",
            interact,
            {
              captureLongAnimationFrames: true,
              processSampleIntervalMs: 500,
            },
          )
        : { result: await interact(), report: null };
      const payload = {
        interaction: measured.report,
        workload: {
          ...measured.result,
          sessions,
          settings: {
            sessionCount: sessions.length,
            chunkCount: CHUNK_COUNT,
            chunkDelayMs: CHUNK_DELAY_MS,
            warmHistoryParagraphs: 60,
            geometryProbe: false,
            actionSequence: [
              "switch-to-beta",
              "switch-to-alpha",
              "wheel-up",
              "resume-live-edge",
              "stop-alpha",
            ],
            preActionStreamMs: PRE_ACTION_STREAM_MS,
            postActionStreamMs: POST_ACTION_STREAM_MS,
            readingHoldMs: READING_HOLD_MS,
          },
        },
        definitions: {
          latency:
            "trusted event.timeStamp to useful DOM observation on mutation/scroll/transitionend; not compositor paint",
          eventTiming:
            "thresholded discrete Event Timing entries, not INP; wheel is measured by the dedicated DOM observer",
          concurrency:
            "Node receipt times of session-scoped text deltas in bounded pre/action/post envelopes; action-only counts can be zero for fast actions",
          clockDomains:
            "response timestamps use renderer performance.timeOrigin; *At envelope/interruption fields use Node Date.now and are not subtracted from renderer timestamps",
        },
      };
      await writeFile(
        join(runRoot, "interaction-streaming-performance.json"),
        JSON.stringify(payload, null, 2),
        { mode: 0o600 },
      );
      if (profile)
        await writeFile(join(runRoot, "performance.json"), JSON.stringify(payload, null, 2), {
          mode: 0o600,
        });
      checkErrors();
    } catch (error) {
      errors.push(error);
    } finally {
      controller.abort();
      // Abort owned wait requests/subscription even after an assertion fails. Runner
      // teardown owns cancelling the isolated service/model streams on failure.
      const cleanup = await Promise.allSettled([subscription, workload, stopResponseProbe(page)]);
      errors.push(
        ...cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
      );
    }
    checkErrors();
  },
  async assert(_page, { llm }) {
    expect(llm.scriptedCalls()).toBe(LABELS.length * 2);
    for (const label of LABELS)
      expect(llm.requests.filter((request) => request.route === marker(label))).toHaveLength(2);
  },
};
