import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BatchProcessingReport } from "../../src/shared/performance-contract";
import { inputUnderStreaming } from "./input-streaming-performance.ts";
import { measureInteraction } from "./performance.ts";
import type { Scenario } from "./scenarios.ts";

const LABELS = ["ALPHA", "BETA", "GAMMA", "DELTA"] as const;
const CHUNK_COUNT = 384;
const CHUNK_INTERVAL_MS = 20;
const route = (label: string) => `[PALOT_BATCH_INPUT_${label}]`;

export function batchTypingOverlap(
  report: BatchProcessingReport,
  firstKeyAt: number,
  lastInputAt: number,
  timeOrigin: number,
) {
  if (
    !report.available ||
    report.status !== "collected" ||
    report.droppedSamples !== 0 ||
    report.timeOrigin !== timeOrigin ||
    !Number.isFinite(firstKeyAt) ||
    !Number.isFinite(lastInputAt) ||
    lastInputAt <= firstKeyAt
  )
    throw new Error("Batch typing evidence is missing, truncated, or uses a different clock");
  // Both bounds are renderer monotonic timestamps, not runner receipt wall clocks.
  const batches = report.samples.filter(
    (sample) => sample.startTime > firstKeyAt && sample.startTime + sample.durationMs < lastInputAt,
  );
  return {
    batchCount: batches.length,
    eventCount: batches.reduce((total, sample) => total + sample.eventCount, 0),
    maxEventCount: Math.max(0, ...batches.map((sample) => sample.eventCount)),
    maxDurationMs: Math.max(0, ...batches.map((sample) => sample.durationMs)),
    maxTextDeltaCharacters: Math.max(0, ...batches.map((sample) => sample.textDeltaCharacters)),
    textBurstBatchCount: batches.filter((sample) => sample.textDeltaCharacters >= 1_000).length,
    clusteredBatchCount: batches.filter((sample) => sample.eventCount >= 8).length,
    definition:
      "complete synchronous renderer callbacks strictly inside first-key to last-input; clustered means at least eight delivered events; text burst means at least 1,000 UTF-16 code units in text deltas (upstream may coalesce events)",
  };
}

/** Identical content and nominal throughput; only arrival clustering differs.
 * This is a workload contrast, not a before/after product optimization. */
export function batchInputChunks(label: string): string[] {
  return [
    ...Array.from(
      { length: CHUNK_COUNT - 1 },
      (_, index) =>
        `${label} stream ${index}. Numbered text keeps ordering observable while the composer receives real keyboard input.\n\n`,
    ),
    `${label} PARALLEL STREAM 1 COMPLETE`,
  ];
}

export function batchInputPerformanceScenario(mode: "steady" | "burst"): Scenario {
  const burstSize = mode === "burst" ? 16 : 1;
  const intervalMs = CHUNK_INTERVAL_MS * burstSize;
  return {
    description: `measure synchronous batch work and typing under four ${mode} text streams`,
    prompt: "",
    expectedModelCalls: 0,
    arrange(llm) {
      for (const label of LABELS) {
        llm.route(route(label), (script) => {
          script.text(`${label} warmed batch input fixture.`);
          script.textBursts(batchInputChunks(label), burstSize, intervalMs);
        });
      }
    },
    async run(page, { client, session, projectDirectory, profile, runRoot }) {
      const sessions = [{ id: session.id, label: LABELS[0] as string }];
      for (const label of LABELS.slice(1)) {
        const created = await client.session.create({ location: { directory: projectDirectory } });
        sessions.push({ id: created.id, label });
      }
      for (const entry of sessions) {
        await client.session.prompt({ sessionID: entry.id, text: `${route(entry.label)} Warm.` });
        await client.session.wait({ sessionID: entry.id });
      }
      const transcript = page.getByLabel("Task transcript", { exact: true });
      await expect(transcript).toContainText("ALPHA warmed batch input fixture.");
      const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
      await composer.click();
      await page.keyboard.type("warm");
      await composer.fill("");
      await composer.evaluate((element) => (element as HTMLElement).blur());

      const controller = new AbortController();
      try {
        const workload = () =>
          inputUnderStreaming(page, client, sessions, async () => {
            await Promise.all(
              sessions.map(async ({ id, label }) => {
                await client.session.prompt(
                  { sessionID: id, text: `${route(label)} Run the numbered text fixture.` },
                  { signal: controller.signal },
                );
                await client.session.wait({ sessionID: id }, { signal: controller.signal });
              }),
            );
          });
        const measured = profile
          ? await measureInteraction(page, `typing-under-${mode}-event-batches`, workload, {
              captureLongAnimationFrames: true,
              captureBatchProcessing: true,
              processSampleIntervalMs: 500,
            })
          : { result: await workload(), report: null };

        // Retain raw measurement even if a later contention/correctness assertion fails.
        await writeFile(
          join(runRoot, "batch-measurement.json"),
          JSON.stringify(measured, null, 2),
          {
            mode: 0o600,
          },
        );

        const batchOverlap = measured.report
          ? batchTypingOverlap(
              measured.report.batchProcessing,
              measured.result.input.firstKeyAt!,
              measured.result.input.lastInputAt!,
              measured.report.measurementWindow.timeOrigin,
            )
          : null;
        if (batchOverlap) {
          expect(
            batchOverlap.batchCount,
            "renderer must process batches while typing",
          ).toBeGreaterThan(0);
          if (mode === "burst")
            expect(
              batchOverlap.textBurstBatchCount,
              "actual renderer text bursts must overlap typing (the service may merge events)",
            ).toBeGreaterThanOrEqual(2);
        }

        // Validate the authoritative output after measurement, not in the hot loop.
        for (const { id, label } of sessions) {
          const exported = await client.session.export({ sessionID: id });
          const response = exported.messages.findLast((message) => message.type === "assistant");
          expect(response?.type).toBe("assistant");
          if (response?.type !== "assistant") throw new Error("Assistant response is missing");
          const text = response.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("");
          expect(text).toBe(batchInputChunks(label).join(""));
        }
        // One bounded DOM read proves visible ordering too, rather than only checking
        // a completion marker that could survive missing or duplicated earlier deltas.
        const rendered = await transcript.textContent();
        expect(
          [...rendered!.matchAll(/ALPHA stream (\d+)\./g)].map((match) => Number(match[1])),
        ).toEqual(Array.from({ length: CHUNK_COUNT - 1 }, (_, index) => index));
        const payload = {
          interaction: measured.report,
          workload: {
            input: measured.result,
            batchOverlap,
            sessions,
            settings: {
              mode,
              sessionCount: sessions.length,
              chunkCount: CHUNK_COUNT,
              burstSize,
              intervalMs,
              nominalChunkIntervalMs: CHUNK_INTERVAL_MS,
              sessionStaggerMs: 0,
              geometryProbe: false,
            },
            correctness: { exactServiceText: true, orderedVisibleText: true },
          },
          definitions: {
            pacing:
              "unchanged provider text payloads grouped by content chunk count; service and renderer may batch them differently",
            comparison:
              "steady and burst are different workloads, not matched before/after product builds",
          },
        };
        await writeFile(
          join(runRoot, "batch-input-performance.json"),
          JSON.stringify(payload, null, 2),
          {
            mode: 0o600,
          },
        );
        if (profile)
          await writeFile(join(runRoot, "performance.json"), JSON.stringify(payload, null, 2), {
            mode: 0o600,
          });
      } finally {
        controller.abort();
      }
    },
    async assert(_page, { llm }) {
      expect(llm.scriptedCalls()).toBe(LABELS.length * 2);
      for (const label of LABELS)
        expect(llm.requests.filter((request) => request.route === route(label))).toHaveLength(2);
    },
  };
}
