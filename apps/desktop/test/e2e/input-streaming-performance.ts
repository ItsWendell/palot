import type { OpenCodeClient } from "@opencode/client";
import { expect, type Page } from "@playwright/test";

// Fixed ASCII keyboard traffic: real keydown/keypress/input/keyup events, not fill().
// Keep this bounded and separate from the parallel benchmark's per-frame scroll probe.
const DRAFT =
  "Keep this exact unsent draft while all four sessions stream. No lost keys: 0123456789.";
const KEY_DELAY_MS = 20;

interface InputProbe {
  clickAt: number | null;
  focusedAtClick: boolean;
  firstKeyAt: number | null;
  lastInputAt: number | null;
  usefulResponseAt: number | null;
  inputEvents: number;
  untrustedEvents: number;
  prefixErrors: number;
  focusLosses: number;
  stop(): void;
}

/** Measures composer input while observing real, session-scoped OpenCode text deltas.
 * Node receipt timestamps prove workload overlap; browser timestamps describe the
 * first correct draft observed at an animation-frame callback (not compositor presentation).
 */
export async function inputUnderStreaming(
  page: Page,
  client: OpenCodeClient,
  sessions: Array<{ id: string; label: string }>,
  runSessions: () => Promise<void>,
  afterTyping?: () => Promise<void>,
) {
  const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
  const transcript = page.getByLabel("Task transcript", { exact: true });
  const controller = new AbortController();
  const deltas = new Map(sessions.map(({ id }) => [id, [] as number[]]));
  let connected = false;
  let subscriptionError: unknown;
  const subscription = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: controller.signal })) {
        if (event.type === "server.connected") connected = true;
        if (event.type === "session.text.delta" && event.data.delta.length > 0) {
          deltas.get(event.data.sessionID)?.push(Date.now());
        }
      }
      if (!controller.signal.aborted) throw new Error("Input workload event subscription ended");
    } catch (error) {
      if (!controller.signal.aborted) subscriptionError = error;
    }
  })();
  let workload: Promise<void> | undefined;
  let workloadCompleted = false;
  let workloadError: unknown;
  try {
    // Subscriptions are live-only: establish the server.connected barrier before prompting.
    await expect
      .poll(
        () => {
          if (subscriptionError) throw subscriptionError;
          return connected;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    workload = runSessions().then(
      () => {
        workloadCompleted = true;
      },
      (error: unknown) => {
        workloadError = error;
        workloadCompleted = true;
      },
    );
    await expect
      .poll(
        () => {
          if (subscriptionError) throw subscriptionError;
          if (workloadError) throw workloadError;
          return sessions.every(({ id }) => (deltas.get(id)?.length ?? 0) >= 3);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(transcript).toContainText("ALPHA stream 0.");
    await expect(composer).toHaveValue("");
    const transcriptBefore = await transcript.textContent();
    // Do not let an automatic composer focus turn the measured click into a no-op.
    await composer.evaluate((element) => (element as HTMLElement).blur());
    await expect(composer).not.toBeFocused();

    await composer.evaluate((element, expected) => {
      const editor = element as HTMLTextAreaElement;
      const browser = globalThis as unknown as { __palotInputProbe?: InputProbe };
      browser.__palotInputProbe?.stop();
      let frame: number | undefined;
      const probe: InputProbe = {
        clickAt: null,
        focusedAtClick: false,
        firstKeyAt: null,
        lastInputAt: null,
        usefulResponseAt: null,
        inputEvents: 0,
        untrustedEvents: 0,
        prefixErrors: 0,
        focusLosses: 0,
        stop() {
          editor.removeEventListener("click", onClick);
          editor.removeEventListener("keydown", onKey);
          editor.removeEventListener("input", onInput);
          editor.removeEventListener("blur", onBlur);
          if (frame !== undefined) cancelAnimationFrame(frame);
        },
      };
      const onClick = (event: MouseEvent) => {
        probe.clickAt = event.timeStamp;
        probe.focusedAtClick = document.activeElement === editor;
        if (!event.isTrusted) probe.untrustedEvents += 1;
        performance.mark("palot:input-streaming:composer-click");
      };
      const onKey = (event: KeyboardEvent) => {
        if (probe.firstKeyAt !== null) return;
        probe.firstKeyAt = event.timeStamp;
        performance.mark("palot:input-streaming:first-key");
      };
      const onInput = (event: Event) => {
        probe.lastInputAt = event.timeStamp;
        probe.inputEvents += 1;
        if (!event.isTrusted) probe.untrustedEvents += 1;
        if (editor.value !== expected.slice(0, probe.inputEvents)) probe.prefixErrors += 1;
        if (frame !== undefined || probe.usefulResponseAt !== null) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (
            editor.value.length > 0 &&
            expected.startsWith(editor.value) &&
            document.activeElement === editor
          ) {
            probe.usefulResponseAt = performance.now();
            performance.mark("palot:input-streaming:useful-response");
          }
        });
      };
      const onBlur = () => {
        if (probe.clickAt !== null) probe.focusLosses += 1;
      };
      editor.addEventListener("click", onClick);
      editor.addEventListener("keydown", onKey);
      editor.addEventListener("input", onInput);
      editor.addEventListener("blur", onBlur);
      browser.__palotInputProbe = probe;
    }, DRAFT);

    expect(workloadCompleted, "workload must still be active before click").toBe(false);
    const clickStartedAt = Date.now();
    await composer.click();
    await expect(composer).toBeFocused();
    const typingStartedAt = Date.now();
    const [, transcriptSamples] = await Promise.all([
      page.keyboard.type(DRAFT, { delay: KEY_DELAY_MS }),
      (async () => {
        // Two bounded DOM reads during keyboard traffic, not a per-frame text/geometry scan.
        const sample = () =>
          transcript.evaluate((element) => ({
            at: performance.now(),
            text: element.textContent ?? "",
          }));
        await page.waitForTimeout(300);
        const first = await sample();
        await page.waitForTimeout(600);
        return [first, await sample()] as const;
      })(),
    ]);
    const typingCompletedAt = Date.now();
    const activeAtTypingEnd = !workloadCompleted;
    await expect(composer).toHaveValue(DRAFT);
    await expect(composer).toBeFocused();
    await expect.poll(() => transcript.textContent()).not.toBe(transcriptBefore);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const overlap = sessions.map(({ id, label }) => {
      const samples = deltas.get(id) ?? [];
      const during = samples.filter((at) => at >= typingStartedAt && at <= typingCompletedAt);
      return {
        sessionID: id,
        label,
        textDeltasBeforeTyping: samples.filter((at) => at < typingStartedAt).length,
        textDeltasDuringTyping: during.length,
        firstDeltaDuringTypingAt: during[0] ?? null,
        lastDeltaDuringTypingAt: during.at(-1) ?? null,
        streamingSpanDuringTypingMs: during.length > 1 ? during.at(-1)! - during[0]! : 0,
      };
    });
    expect(activeAtTypingEnd, "typing must finish before the streaming workload").toBe(true);
    for (const session of overlap) {
      expect(
        session.textDeltasDuringTyping,
        `${session.label} must deliver text while typing`,
      ).toBeGreaterThanOrEqual(2);
      expect(session.textDeltasBeforeTyping).toBeGreaterThanOrEqual(3);
      // Reject a single buffered delivery masquerading as concurrent streaming.
      expect(session.streamingSpanDuringTypingMs).toBeGreaterThanOrEqual(500);
    }
    if (afterTyping) {
      await afterTyping();
      expect(workloadCompleted, "scroll-intent checks must overlap streaming").toBe(false);
    }
    await workload;
    if (workloadError) throw workloadError;
    if (subscriptionError) throw subscriptionError;
    await expect(composer).toHaveValue(DRAFT);
    await expect(composer).toBeFocused();
    await expect(transcript).toContainText("ALPHA PARALLEL STREAM 1 COMPLETE");
    const input = await page.evaluate(() => {
      const probe = (globalThis as unknown as { __palotInputProbe?: InputProbe }).__palotInputProbe;
      if (!probe) throw new Error("Input probe was not installed");
      const { stop: _stop, ...result } = probe;
      return result;
    });
    expect(input.focusedAtClick).toBe(true);
    expect(input.inputEvents).toBe(DRAFT.length);
    expect(input.untrustedEvents).toBe(0);
    expect(input.prefixErrors).toBe(0);
    expect(input.focusLosses).toBe(0);
    expect(input.firstKeyAt).not.toBeNull();
    expect(input.lastInputAt).not.toBeNull();
    expect(input.usefulResponseAt).not.toBeNull();
    expect(transcriptSamples[0].at).toBeGreaterThan(input.firstKeyAt!);
    expect(transcriptSamples[1].at).toBeLessThan(input.lastInputAt!);
    expect(
      transcriptSamples[1].text,
      "transcript must advance between keys, not only before/after typing",
    ).not.toBe(transcriptSamples[0].text);
    return {
      settings: {
        draft: DRAFT,
        characterCount: DRAFT.length,
        keyDelayMs: KEY_DELAY_MS,
        inputMethod: "Playwright keyboard.type",
        scrollProbe: false,
      },
      clickStartedAt,
      typingStartedAt,
      typingCompletedAt,
      activeAtTypingEnd,
      overlap,
      input,
      transcriptDuringTyping: {
        samples: transcriptSamples.map(({ at, text }) => ({ at, characterCount: text.length })),
        changedBetweenSamples: true,
        definition:
          "transcript text differs between two renderer samples strictly inside the keyboard interval; not compositor presentation",
      },
      usefulResponse: {
        definition:
          "first correct nonempty focused draft observed in requestAnimationFrame after keydown; not compositor presentation",
        firstKeyToDraftFrameMs: input.usefulResponseAt! - input.firstKeyAt!,
      },
      correctness: {
        exactDraftAfterTyping: true,
        exactDraftAfterWorkload: true,
        focusRetained: true,
        visibleTranscriptAdvanced: true,
        transcriptAdvancedDuringTyping: true,
        allSessionsDeliveredTextDuringTyping: true,
      },
    };
  } finally {
    controller.abort();
    await subscription;
    await workload;
    await page.evaluate(() => {
      const browser = globalThis as unknown as { __palotInputProbe?: InputProbe };
      browser.__palotInputProbe?.stop();
      delete browser.__palotInputProbe;
    });
  }
}
